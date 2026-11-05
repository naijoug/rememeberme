import { afterEach, expect, it, vi } from 'vitest';
import { MagpieTranslator } from '../src/magpie';
import { failedRoute, responseRoute } from '../src/magpie-observation';

const options = { baseURL: 'http://127.0.0.1:3425/v1', key: 'fixture-private-key', model: 'group/translator' };
const reply = (headers: Record<string, string> = {}) => new Response(JSON.stringify({ model: 'group/translator',
  choices: [{ finish_reason: 'stop', message: { content: '{"text":"测试释义"}' } }] }),
  { headers: { 'Content-Type': 'application/json', ...headers } });
afterEach(() => vi.useRealTimers());

it('records the actual header-selected model instead of the echoed group without logging input or secrets', async () => {
  const observe = vi.fn(); const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => reply({
    'X-Magpie-Model': 'zhipu/glm-5.3-flash', 'X-Magpie-Provider': 'zhipu', 'X-Magpie-Account': 'private@example.test',
  }));
  const translation = await new MagpieTranslator({ ...options, fetch: fetcher, observe }).translate('synthetic');
  expect(translation.source).toBe('magpie'); expect(fetcher).toHaveBeenCalledOnce();
  expect(observe).toHaveBeenCalledWith(expect.objectContaining({ event: 'word_translation', requestedModel: 'group/translator',
    selectedModel: 'zhipu/glm-5.3-flash', selectedProvider: 'zhipu', routeSource: 'response-header', outcome: 'success', upstreamStatus: 200 }));
  const value = observe.mock.calls[0][0];
  expect(value.callId).toMatch(/^rm-word-[a-f0-9-]{36}$/);
  expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ 'X-Magpie-Session': value.callId });
  expect(JSON.stringify(value)).not.toMatch(/synthetic|测试释义|private@example|fixture-private-key/);
});

it('treats absent or inconsistent model headers as unknown and logging failure cannot break a result', async () => {
  const cases: Record<string, string>[] = [{}, { 'X-Magpie-Model': 'group/translator', 'X-Magpie-Provider': 'group' },
    { 'X-Magpie-Model': 'zhipu/glm-5.3-flash', 'X-Magpie-Provider': 'other' },
    { 'X-Magpie-Model': 'zhipu/glm?token=private', 'X-Magpie-Provider': 'zhipu' }];
  for (const headers of cases) {
    const observe = vi.fn((_value: unknown) => { throw new Error('logging failed'); });
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => reply(headers));
    expect((await new MagpieTranslator({ ...options, observe, fetch: fetcher }).translate('test')).source).toBe('magpie');
    expect(observe.mock.calls[0]?.[0]).toMatchObject({ routeSource: 'unknown', outcome: 'success' });
    expect(observe.mock.calls[0]?.[0]).not.toHaveProperty('selectedModel'); expect(fetcher).toHaveBeenCalledOnce();
  }
  expect(responseRoute(new Headers({ 'X-Magpie-Model': 'https://private.example/secret', 'X-Magpie-Provider': 'https:' }))).toBeUndefined();
});

it('returns a timeout promptly and resolves its selected attempt separately from a correlated trace', async () => {
  vi.useFakeTimers(); let session: string | undefined;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    if (init?.method === 'POST') {
      session = new Headers(init.headers).get('X-Magpie-Session')!; return new Promise(() => {});
    }
    expect(String(url)).toContain('magpie/route?session=' + session);
    return new Response(JSON.stringify({ session, route: { model: 'deepseek/deepseek-flash', account: 'hidden', prompt: 'private' } }),
      { headers: { 'Content-Type': 'application/json' } });
  });
  const observe = vi.fn(); const service = new MagpieTranslator({ ...options, timeoutMs: 15, fetch: fetcher, observe });
  const request = service.translate('test'); const check = expect(request).rejects.toMatchObject({ code: 'TRANSLATION_TIMEOUT' });
  await vi.advanceTimersByTimeAsync(15); await check;
  expect(observe).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failure', errorCode: 'TRANSLATION_TIMEOUT',
    selectedModel: 'deepseek/deepseek-flash', routeSource: 'route-trace', durationMs: expect.any(Number) }));
  expect(JSON.stringify(observe.mock.calls)).not.toMatch(/hidden|private|prompt/);
});

it('does not delay a failed translation for an unavailable diagnostic endpoint', async () => {
  vi.useFakeTimers(); const observe = vi.fn(); const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
  const request = new MagpieTranslator({ ...options, timeoutMs: 15, fetch: fetcher, observe }).translate('test');
  const check = expect(request).rejects.toMatchObject({ code: 'TRANSLATION_TIMEOUT' });
  await vi.advanceTimersByTimeAsync(15); await check; expect(observe).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(250);
  expect(observe).toHaveBeenCalledWith(expect.objectContaining({ routeSource: 'unknown', outcome: 'failure' }));
  expect(fetcher.mock.calls[1][1]?.signal?.aborted).toBe(true);
});

it('rejects uncorrelated and oversized trace data without leaking extra fields', async () => {
  for (const value of [{ session: 'other', route: { model: 'zhipu/glm-5.3-flash' } },
    { session: 'fixture', route: { model: 'zhipu/glm-5.3-flash' }, padding: 'x'.repeat(16 * 1024) }]) {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }));
    expect(await failedRoute(new URL(options.baseURL + '/'), options.key, 'fixture', fetcher)).toBeUndefined();
  }
});

it('bounds a stalled diagnostic body and cancels it', async () => {
  vi.useFakeTimers(); const cancel = vi.fn();
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(new ReadableStream({ cancel }),
    { headers: { 'Content-Type': 'application/json' } }));
  const pending = failedRoute(new URL(options.baseURL + '/'), options.key, 'fixture', fetcher);
  await vi.advanceTimersByTimeAsync(250);
  expect(await pending).toBeUndefined(); expect(cancel).toHaveBeenCalledOnce();
});
