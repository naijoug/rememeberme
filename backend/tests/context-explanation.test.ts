import { afterEach, expect, it, vi } from 'vitest';
import fixture from '../../contracts/fixtures/context-explanation-v1.json';
import { EXPLANATION_PATH, EXPLANATION_CAPABILITIES_PATH, isContextExplanationInput, isContextExplanation, type ContextExplanationInput } from '../../contracts/context-explanation';
import { MagpieContextExplainer } from '../src/context-explanation';
import { MagpieTranslator } from '../src/magpie';
import { MagpieCapacity } from '../src/magpie-capacity';
import { WindowLimiter, createRuntime } from '../src/node-runtime';
import { app } from '../src/index';
import { env } from './node-bindings';
const input = fixture.request as ContextExplanationInput;
const fields = { contextualMeaning: '银行', sentenceTranslation: '银行提高了利率。', usageNote: '金融机构。' };
const completion = (content = JSON.stringify(fields)) => ({ choices: [{ finish_reason: 'stop', message: { content } }] });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const options = { baseURL: 'http://127.0.0.1:3425/v1', key: 'fixture-key', model: 'fixture-model' };
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
it('validates exact input and output independently of legacy word definitions', () => {
  expect(isContextExplanationInput(input)).toBe(true); expect(isContextExplanation(fixture.response)).toBe(true);
  for (const bad of [{ ...input, url: 'https://private.test' }, { ...input, word: 'two words' }, { ...input, context: '😀'.repeat(501) }, { ...input, context: ' ' }, { ...input, schemaVersion: 2 }]) expect(isContextExplanationInput(bad)).toBe(false);
  expect(isContextExplanation({ ...fixture.response, provider: 'invented' })).toBe(false);
});
it('defaults off and requires explicit Magpie configuration', () => {
  const config = { databasePath: ':memory:', migrations: 'migrations', publicDirectory: 'public' };
  const runtime = createRuntime({ ...config, configuration: {} });
  expect(runtime.EXPLAINER).toBeUndefined(); runtime.DB.close();
  expect(() => createRuntime({ ...config, configuration: { CONTEXT_EXPLANATION_ENABLED: 'true', TRANSLATION_PROVIDER: 'none' } })).toThrow('requires Magpie');
});
it('sends only the fixed prompt and bounded source data, owns attribution and never caches server-side', async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json(completion()));
  const service = new MagpieContextExplainer({ ...options, fetch: fetcher });
  expect((await service.explain(input)).provider).toBe('magpie'); await service.explain(input);
  expect(fetcher).toHaveBeenCalledTimes(2);
  const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
  expect(body).toMatchObject({ stream: false, max_tokens: 1536, reasoning_effort: 'low', response_format: { type: 'json_object' }, model: 'fixture-model' });
  expect(JSON.parse(body.messages[1].content)).toEqual({ word: input.word, context: input.context });
  expect(body.tools).toBeUndefined(); expect(body.session).toBeUndefined();
});
it('shares a total capacity of two with words and never lets two explanations run together', async () => {
  const capacity = new MagpieCapacity(); let finish!: (value: Response) => void;
  const explaining = new MagpieContextExplainer({ ...options, capacity, fetch: () => new Promise(resolve => { finish = resolve; }) });
  const pending = explaining.explain(input);
  await expect(explaining.explain(input)).rejects.toMatchObject({ code: 'EXPLANATION_BUSY' });
  const word = new MagpieTranslator({ ...options, capacity, fetch: async () => json(completion('{"text":"银行"}')) });
  expect((await word.translate('bank')).source).toBe('magpie');
  finish(json(completion())); await pending;
  const releaseWord = capacity.acquire('word');
  const releaseExplanation=capacity.acquire('explanation');
  expect(releaseExplanation).toBeTypeOf('function'); releaseWord!(); releaseExplanation!();
});
it.each(['headers','body'])('bounds stalled %s and releases capacity after timeout or cancellation', async phase => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(async () => phase === 'headers' ? new Promise(() => {}) : new Response(new ReadableStream({ cancel }), { headers: { 'Content-Type': 'application/json' } }))
    .mockImplementation(async () => json(completion()));
  const service = new MagpieContextExplainer({ ...options, fetch: fetcher });
  const pending = service.explain(input); const check = expect(pending).rejects.toMatchObject({ code: 'EXPLANATION_TIMEOUT' });
  await vi.advanceTimersByTimeAsync(15000); await check;
  expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  expect((await service.explain(input)).schemaVersion).toBe(1);
  if (phase === 'body') expect(cancel).toHaveBeenCalled();
});
it('rejects malformed, truncated, tool, extra-field and oversize results, without fallback', async () => {
  const bad = [completion('bad json'), completion(JSON.stringify({ ...fields, url: 'https://bad.test' })), completion(JSON.stringify({ ...fields, contextualMeaning: '' })),
    { choices: [{ finish_reason: 'length', message: { content: JSON.stringify(fields) } }] },
    { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(fields), tool_calls: [] } }] },
    { ...completion(), padding: 'x'.repeat(65536) }];
  for (const value of bad) {
    const service = new MagpieContextExplainer({ ...options, fetch: async () => json(value) });
    await expect(service.explain(input)).rejects.toMatchObject({ code: 'EXPLANATION_INVALID_RESPONSE' });
  }
});
it('exposes only public capability fields, gates disable/limits, rejects extras, and never writes vocabulary', async () => {
  const logs=vi.spyOn(console, 'info').mockImplementation(()=>{});
  env.LOOKUP_LIMIT = new WindowLimiter(100); env.EXPLANATION_LIMIT = new WindowLimiter(6);
  const capability = await app.request('https://api.example.test' + EXPLANATION_CAPABILITIES_PATH, {}, env);
  expect(await capability.json()).toEqual(fixture.capabilities);
  const post = (value: unknown) => app.request('https://api.example.test' + EXPLANATION_PATH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }, env);
  expect((await post(input)).status).toBe(503);
  const explain = vi.fn().mockResolvedValue(fixture.response); env.EXPLAINER = { explain };
  expect((await post({ ...input, url: 'private' })).status).toBe(400);
  expect((await post({ ...input, context: '中'.repeat(1000) })).status).toBe(200);
  expect((await post({ ...input, padding: 'x'.repeat(16384) })).status).toBe(413);
  expect((await post({ ...input, context: 'bank private-context-marker-never-log' })).status).toBe(200);
  for (let i = 0; i < 2; i++) expect((await post(input)).status).toBe(200);
  expect(JSON.stringify(logs.mock.calls)).not.toContain('private-context-marker-never-log');
  expect((await post(input)).status).toBe(429);
  for (const table of ['users','vocabulary_entries','encounters']) expect((await env.DB.prepare('SELECT count(*) AS n FROM ' + table).first<{ n: number }>())?.n).toBe(0);
});

it('cancels an explanation without waiting for a transport that ignores the signal', async () => {
  const fetcher=vi.fn<typeof fetch>().mockImplementationOnce(()=>new Promise(()=>{})).mockImplementation(async()=>json(completion()));
  const service=new MagpieContextExplainer({...options,fetch:fetcher});const controller=new AbortController();
  const pending=service.explain(input,controller.signal);const check=expect(pending).rejects.toMatchObject({code:'EXPLANATION_CANCELLED'});
  controller.abort();await check;expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  expect((await service.explain(input)).provider).toBe('magpie');
});
