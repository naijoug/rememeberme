import { expect, it, vi } from 'vitest';
import { MagpieTranslator } from '../src/magpie';
import { MyMemoryTranslator, ServerTranslator } from '../src/lookup';
import { createRuntime } from '../src/node-runtime';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const completion = (content = '{"text":"合成释义"}') => ({ choices: [{ finish_reason: 'stop', message: { content } }] });
const options = { baseURL: 'http://127.0.0.1:3425/v1', key: 'magpie-fixture', model: 'zhipu/glm-5.3-flash' };

it('sends only word inference to the configured model, without Hermes discovery, and coalesces/caches in the router', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => json(completion()));
  const service = new ServerTranslator(new MagpieTranslator({ ...options, fetch }));
  const [a, b] = await Promise.all([service.translate('synthetic'), service.translate('synthetic')]);
  expect(a).toEqual({ text: '合成释义', target: 'zh-CN', source: 'magpie' }); expect(b).toEqual(a);
  await service.translate('synthetic'); expect(fetch).toHaveBeenCalledTimes(1);
  const [url, init] = fetch.mock.calls[0];
  expect(String(url)).toBe(options.baseURL + '/chat/completions');
  expect(init).toMatchObject({ method: 'POST', redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer' });
  expect(init?.headers).toMatchObject({ Authorization: 'Bearer magpie-fixture', 'User-Agent': 'RememberMe/translation' });
  const body = JSON.parse(String(init?.body));
  expect(Object.keys(body).sort()).toEqual(['max_tokens', 'messages', 'model', 'stream']);
  expect(body).toMatchObject({ model: options.model, stream: false, max_tokens: 256 });
  expect(body.messages[1]).toEqual({ role: 'user', content: 'synthetic' });
});

it('falls back after upstream failure, expires fallback after one hour, and caches recovered Magpie for seven days', async () => {
  vi.useFakeTimers();
  try {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementationOnce(async () => json({}, 429)).mockImplementation(async () => json(completion()));
    const fallbackFetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => json({ responseStatus: 200, responseData: { translatedText: '备用释义' } }));
    const service = new ServerTranslator(new MagpieTranslator({ ...options, fetch }), new MyMemoryTranslator(fallbackFetch));
    expect((await service.translate('synthetic')).source).toBe('mymemory');
    await service.translate('synthetic'); expect(fallbackFetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3_600_001);
    expect((await service.translate('synthetic')).source).toBe('magpie');
    await vi.advanceTimersByTimeAsync(6 * 86_400_000);
    await service.translate('synthetic'); expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(86_400_001);
    await service.translate('synthetic'); expect(fetch).toHaveBeenCalledTimes(3);
  } finally { vi.useRealTimers(); }
});

it.each(['headers', 'body'])('bounds stalled %s, aborts and releases capacity for a later request', async phase => {
  const cancel = vi.fn();
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementationOnce(async () => phase === 'headers' ? new Promise(() => {})
    : new Response(new ReadableStream({ cancel }), { headers: { 'Content-Type': 'application/json' } })).mockImplementation(async () => json(completion()));
  const service = new MagpieTranslator({ ...options, timeoutMs: 15, maxConcurrent: 1, fetch });
  const first = service.translate('synthetic');
  await expect(service.translate('another')).rejects.toMatchObject({ code: 'TRANSLATION_BUSY' });
  await expect(first).rejects.toMatchObject({ code: 'TRANSLATION_TIMEOUT' });
  expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
  if (phase === 'body') expect(cancel).toHaveBeenCalled();
  expect((await service.translate('synthetic')).source).toBe('magpie');
});

it('rejects malformed, truncated, tool-call and oversized output without caching it', async () => {
  const samples = [completion('not JSON'), completion('{"text":"English only"}'), completion('{"text":""}'),
    completion(JSON.stringify({ text: '中'.repeat(2001) })), { choices: [{ finish_reason: 'length', message: { content: '{"text":"中文"}' } }] },
    { choices: [{ finish_reason: 'stop', message: { content: '{"text":"中文"}', tool_calls: [{ name: 'tool' }] } }] },
    { ...completion(), padding: 'x'.repeat(64 * 1024) }];
  for (const sample of samples) {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementationOnce(async () => json(sample)).mockImplementation(async () => json(completion()));
    const service = new ServerTranslator(new MagpieTranslator({ ...options, fetch }));
    await expect(service.translate('synthetic')).rejects.toMatchObject({ code: 'TRANSLATION_INVALID_RESPONSE' });
    expect((await service.translate('synthetic')).source).toBe('magpie'); expect(fetch).toHaveBeenCalledTimes(2);
  }
});

it('selects Magpie despite retained Hermes configuration and fails closed for invalid configuration', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => json(completion()));
  vi.stubGlobal('fetch', fetch);
  const base = { databasePath: ':memory:', migrations: 'migrations', publicDirectory: 'public' };
  try {
    const runtime = createRuntime({ ...base, configuration: { TRANSLATION_PROVIDER: 'magpie', MAGPIE_API_KEY: options.key,
      HERMES_BASE_URL: 'invalid-retained-url', MYMEMORY_ENABLED: 'false' } });
    try { expect((await runtime.TRANSLATOR!.translate('synthetic')).source).toBe('magpie'); } finally { runtime.DB.close(); }
    expect(() => createRuntime({ ...base, configuration: { TRANSLATION_PROVIDER: 'typo' } })).toThrow('TRANSLATION_PROVIDER');
    expect(() => createRuntime({ ...base, configuration: { TRANSLATION_PROVIDER: 'magpie' } })).toThrow('Magpie configuration');
    expect(() => new MagpieTranslator({ ...options, baseURL: 'http://untrusted.example/v1' })).toThrow();
    expect(() => new MagpieTranslator({ ...options, baseURL: 'https://user:secret@example.test/v1' })).toThrow();
  } finally { vi.unstubAllGlobals(); }
});
