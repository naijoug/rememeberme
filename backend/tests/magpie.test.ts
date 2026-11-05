import { expect, it, vi } from 'vitest';
import { MagpieTranslator } from '../src/magpie';
import { MyMemoryTranslator, ServerTranslator } from '../src/lookup';
import { createRuntime } from '../src/node-runtime';
import { WORD_PRIMARY_TIMEOUT_MS, TRANSLATION_CIRCUIT_COOLDOWN_MS } from '../../contracts/translation-policy';
import { TranslationCircuit } from '../src/translation-circuit';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const completion = (content = '{"text":"合成释义"}') => ({ choices: [{ finish_reason: 'stop', message: { content } }] });
const options = { baseURL: 'http://127.0.0.1:3425/v1', key: 'magpie-fixture', model: 'group/translator' };

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
  expect(Object.keys(body).sort()).toEqual(['max_tokens', 'messages', 'model', 'reasoning_effort', 'stream']);
  expect(body).toMatchObject({ model: options.model, stream: false, max_tokens: 512, reasoning_effort: 'low' });
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
    try {
      expect((await runtime.TRANSLATOR!.translate('synthetic')).source).toBe('magpie');
      expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).model).toBe('group/translator');
    } finally { runtime.DB.close(); }
    expect(() => createRuntime({ ...base, configuration: { TRANSLATION_PROVIDER: 'typo' } })).toThrow('TRANSLATION_PROVIDER');
    expect(() => createRuntime({ ...base, configuration: { TRANSLATION_PROVIDER: 'magpie' } })).toThrow('Magpie configuration');
    expect(() => new MagpieTranslator({ ...options, baseURL: 'http://untrusted.example/v1' })).toThrow();
    expect(() => new MagpieTranslator({ ...options, baseURL: 'https://user:secret@example.test/v1' })).toThrow();
  } finally { vi.unstubAllGlobals(); }
});

it('starts MyMemory after the three-second primary budget instead of exhausting the client deadline', async () => {
  vi.useFakeTimers();
  try {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(() => new Promise(() => {}));
    const fallback = { translate: vi.fn().mockImplementation(async () => ({ text: '备用释义', source: 'mymemory', target: 'zh-CN' })) };
    const service = new ServerTranslator(new MagpieTranslator({ ...options, fetch }), fallback);
    const request = service.translate('synthetic');
    await vi.advanceTimersByTimeAsync(WORD_PRIMARY_TIMEOUT_MS - 1); expect(fallback.translate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect((await request).source).toBe('mymemory');
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(fallback.translate).toHaveBeenCalledOnce();
  } finally { vi.useRealTimers(); }
});

it('bypasses a stalled group after two failures, permits one recovery probe, and closes after success', async () => {
  vi.useFakeTimers();
  try {
    let recover!: (response: Response) => void;
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(() => new Promise(() => {}));
    const fallback = { translate: vi.fn().mockResolvedValue({ text: '备用', source: 'mymemory', target: 'zh-CN' }) };
    const service = new ServerTranslator(new MagpieTranslator({ ...options, fetch }), fallback);
    for (const word of ['first', 'second']) {
      const request = service.translate(word);
      await vi.advanceTimersByTimeAsync(WORD_PRIMARY_TIMEOUT_MS);
      expect((await request).source).toBe('mymemory');
    }
    expect((await service.translate('third')).source).toBe('mymemory');
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(TRANSLATION_CIRCUIT_COOLDOWN_MS - 1);
    expect((await service.translate('fourth')).source).toBe('mymemory');
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    fetch.mockImplementationOnce(() => new Promise(resolve => { recover = resolve; })).mockImplementation(async () => json(completion()));
    const probe = service.translate('fifth');
    const sameWord = service.translate('fifth');
    expect((await service.translate('sixth')).source).toBe('mymemory');
    expect(fetch).toHaveBeenCalledTimes(3);
    recover(json(completion()));
    expect((await probe).source).toBe('magpie'); expect(await sameWord).toEqual(await probe);
    expect((await service.translate('seventh')).source).toBe('magpie');
    expect(fetch).toHaveBeenCalledTimes(4);
    // Circuit recovery never rewrites a successful fallback already in the cache.
    expect((await service.translate('third')).source).toBe('mymemory');
  } finally { vi.useRealTimers(); }
});

it('reopens for a full cooldown after a failed probe and never counts local capacity rejection', async () => {
  vi.useFakeTimers();
  try {
    let resolve!: (response: Response) => void;
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementationOnce(() => new Promise(r => { resolve = r; }))
      .mockImplementation(async () => json({}, 503));
    const service = new MagpieTranslator({ ...options, fetch, maxConcurrent: 1 });
    const active = service.translate('first');
    for (const word of ['second', 'third']) await expect(service.translate(word)).rejects.toMatchObject({ code: 'TRANSLATION_BUSY' });
    resolve(json(completion())); await active;
    await expect(service.translate('fourth')).rejects.toMatchObject({ code: 'TRANSLATION_UNAVAILABLE' });
    await expect(service.translate('fifth')).rejects.toMatchObject({ code: 'TRANSLATION_UNAVAILABLE' });
    expect(fetch).toHaveBeenCalledTimes(3);
    await expect(service.translate('sixth')).rejects.toMatchObject({ code: 'TRANSLATION_CIRCUIT_OPEN' });
    await vi.advanceTimersByTimeAsync(TRANSLATION_CIRCUIT_COOLDOWN_MS);
    await expect(service.translate('seventh')).rejects.toMatchObject({ code: 'TRANSLATION_UNAVAILABLE' });
    await expect(service.translate('eighth')).rejects.toMatchObject({ code: 'TRANSLATION_CIRCUIT_OPEN' });
    expect(fetch).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(TRANSLATION_CIRCUIT_COOLDOWN_MS);
    fetch.mockImplementation(async () => json(completion()));
    expect((await service.translate('ninth')).source).toBe('magpie');
  } finally { vi.useRealTimers(); }
});

it('only opens on consecutive failures and ignores stale completions from before an open circuit', () => {
  vi.useFakeTimers();
  try {
    const circuit = new TranslationCircuit();
    circuit.enter()!(false);
    circuit.enter()!(true);
    const staleSuccess = circuit.enter()!;
    const staleFailure = circuit.enter()!;
    circuit.enter()!(false);
    expect(circuit.enter()).toBeTypeOf('function');
    circuit.enter()!(false);
    staleSuccess(true); staleFailure(false);
    expect(circuit.enter()).toBeUndefined();
    vi.advanceTimersByTime(TRANSLATION_CIRCUIT_COOLDOWN_MS);
    const probe = circuit.enter()!;
    expect(circuit.enter()).toBeUndefined();
    probe(true); probe(false);
    expect(circuit.enter()).toBeTypeOf('function');
  } finally { vi.useRealTimers(); }
});

it('counts invalid upstream output as a circuit failure while keeping fallback-disabled errors explicit', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => json(completion('not JSON')));
  const service = new ServerTranslator(new MagpieTranslator({ ...options, fetch }));
  for (const word of ['first', 'second']) await expect(service.translate(word)).rejects.toMatchObject({ code: 'TRANSLATION_INVALID_RESPONSE' });
  await expect(service.translate('third')).rejects.toMatchObject({ code: 'TRANSLATION_CIRCUIT_OPEN' });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it.each([undefined, 'group/rememberme-context-preserved'])('keeps explanation routing independently configurable (%s)', async contextModel => {
  const calls: Array<Record<string, any>> = [];
  vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>().mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init?.body)); calls.push(body);
    return json(completion(body.response_format ? JSON.stringify({ contextualMeaning: '银行', sentenceTranslation: '银行开门了。', usageNote: '这里指金融机构。' }) : '{"text":"银行"}'));
  }));
  const logs = vi.spyOn(console, 'info').mockImplementation(() => {});
  const runtime = createRuntime({ databasePath: ':memory:', migrations: 'migrations', publicDirectory: 'public',
    configuration: { TRANSLATION_PROVIDER: 'magpie', MAGPIE_API_KEY: options.key, MAGPIE_MODEL: 'group/translator',
      MAGPIE_CONTEXT_MODEL: contextModel, CONTEXT_EXPLANATION_ENABLED: 'true', MYMEMORY_ENABLED: 'false' } });
  try {
    await runtime.TRANSLATOR!.translate('bank');
    await runtime.EXPLAINER!.explain({ schemaVersion: 1, word: 'bank', context: 'The bank opened.', target: 'zh-CN' });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ model: 'group/translator', max_tokens: 512, reasoning_effort: 'low' });
    expect(calls[1]).toMatchObject({ model: contextModel ?? 'group/translator', max_tokens: 1536, response_format: { type: 'json_object' } });
    expect(calls[0].messages).toHaveLength(2);
    expect(JSON.stringify(logs.mock.calls)).not.toContain('The bank opened.');
  } finally { runtime.DB.close(); logs.mockRestore(); vi.unstubAllGlobals(); }
});
