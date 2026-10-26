import { afterEach, expect, it, vi } from 'vitest';
import { PublicLookupClient, TRANSLATION_FIRST_ATTEMPT_MS, TRANSLATION_REQUEST_BUDGET_MS } from './public-lookup';
it('sends only public lookup requests with no credentials and handles rate limits and body bounds', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ definition: {} }), { headers: { 'Content-Type': 'application/json' } }))
    .mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'Content-Type': 'application/json' } }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ text: 'x'.repeat(256 * 1024) }), { headers: { 'Content-Type': 'application/json' } }));
  const client = new PublicLookupClient('https://api.example.test', fetcher);
  await client.request('/api/v1/public/lookup/dictionary', 'POST', { word: 'synthetic' });
  expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
  expect(fetcher.mock.calls[0][1]?.headers).not.toHaveProperty('Authorization');
  await expect(client.request('/api/v1/me', 'POST', {})).rejects.toThrow('Invalid lookup');
  await expect(client.request('/api/v1/public/lookup/translation', 'POST', { word: 'synthetic' })).rejects.toThrow(/Too many lookups/);
  await expect(client.request('/api/v1/public/lookup/dictionary', 'POST', { word: 'synthetic' })).rejects.toThrow(/too large/);
});

const translationPath = '/api/v1/public/lookup/translation';
const input = { word: 'synthetic', target: 'zh-CN' };
const success = () => new Response(JSON.stringify({ translation: { text: '合成', source: 'magpie', target: 'zh-CN' } }), { headers: { 'Content-Type': 'application/json' } });
afterEach(() => vi.useRealTimers());

it('recovers a first network failure automatically with exactly the same read-only body', async () => {
  const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockImplementation(async () => success());
  const result = await new PublicLookupClient('https://api.example.test', fetcher).request(translationPath, 'POST', input);
  expect(result).toMatchObject({ translation: { source: 'magpie' } });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[0][1]?.body).toBe(fetcher.mock.calls[1][1]?.body);
  expect(fetcher.mock.calls.every(([url]) => String(url).endsWith(translationPath))).toBe(true);
});

it.each(['headers', 'body'])('recovers a stalled first %s inside one lookup and cancels the abandoned attempt', async phase => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(async () => phase === 'headers' ? new Promise(() => {})
    : new Response(new ReadableStream({ cancel }), { headers: { 'Content-Type': 'application/json' } }))
    .mockImplementation(async () => success());
  const result = new PublicLookupClient('https://api.example.test', fetcher).request(translationPath, 'POST', input);
  const check = expect(result).resolves.toMatchObject({ translation: { source: 'magpie' } });
  await vi.advanceTimersByTimeAsync(TRANSLATION_FIRST_ATTEMPT_MS); await check;
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  if (phase === 'body') expect(cancel).toHaveBeenCalledOnce();
});

it('bounds two stalled attempts by one total deadline and reports a readable error', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
  const result = new PublicLookupClient('https://api.example.test', fetcher).request(translationPath, 'POST', input);
  const check = expect(result).rejects.toThrow('Chinese translation timed out. Please try again.');
  await vi.advanceTimersByTimeAsync(TRANSLATION_REQUEST_BUDGET_MS); await check;
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls.every(([, init]) => init?.signal?.aborted)).toBe(true);
});

it.each([400, 401, 403, 404, 429])('does not retry HTTP %s', async status => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response('{}', { status }));
  await expect(new PublicLookupClient('https://api.example.test', fetcher).request(translationPath, 'POST', input)).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledOnce();
});

it.each([502, 503, 504])('retries transient HTTP %s only once', async status => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response('upstream unavailable', { status }));
  await expect(new PublicLookupClient('https://api.example.test', fetcher).request(translationPath, 'POST', input)).rejects.toThrow('unavailable');
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('does not retry malformed JSON, oversized bodies or dictionary failures', async () => {
  for (const body of ['{invalid', JSON.stringify({ text: 'x'.repeat(256 * 1024) })]) {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(body, { headers: { 'Content-Type': 'application/json' } }));
    await expect(new PublicLookupClient('https://api.example.test', fetcher).request(translationPath, 'POST', input)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledOnce();
  }
  const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));
  await expect(new PublicLookupClient('https://api.example.test', fetcher).request('/api/v1/public/lookup/dictionary', 'POST', { word: 'synthetic' })).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledOnce();
});

it('discards and cancels a late first response after recovery', async () => {
  vi.useFakeTimers();
  let resolveFirst!: (response: Response) => void;
  const cancel = vi.fn();
  const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; })).mockImplementation(async () => success());
  const result = new PublicLookupClient('https://api.example.test', fetcher).request(translationPath, 'POST', input);
  await vi.advanceTimersByTimeAsync(TRANSLATION_FIRST_ATTEMPT_MS);
  expect(await result).toMatchObject({ translation: { source: 'magpie' } });
  resolveFirst(new Response(new ReadableStream({ cancel }), { headers: { 'Content-Type': 'application/json' } }));
  await vi.advanceTimersByTimeAsync(1);
  expect(cancel).toHaveBeenCalledOnce();
});

it('cancels a stalled dictionary request within its own service budget without translation retries', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
  const result = new PublicLookupClient('https://api.example.test', fetcher).request('/api/v1/public/lookup/dictionary', 'POST', { word: 'synthetic' });
  const check = expect(result).rejects.toThrow('Dictionary lookup timed out.');
  await vi.advanceTimersByTimeAsync(8_000); await check;
  expect(fetcher).toHaveBeenCalledOnce(); expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
});
