import { expect, it, vi } from 'vitest';
import { HermesTranslator } from '../src/hermes';
import { env } from './node-bindings';
import { account, request, create, send } from './helpers';
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const completion = () => response({ choices: [{ message: { content: '{"text":"合成释义"}' } }] });

it('keeps Hermes results compatible with stored definitions and historical MyMemory snapshots', async () => {
  const user = await account();
  env.TRANSLATOR = { translate: async () => ({ text: '合成释义', source: 'hermes', target: 'zh-CN' }) };
  expect((await request('/api/v1/lookup/translation', undefined, 'POST', { word: 'synthetic', target: 'zh-CN' })).status).toBe(401);
  const reply = await request('/api/v1/lookup/translation', user.access, 'POST', { word: 'synthetic', target: 'zh-CN' });
  expect(await reply.json()).toEqual({ translation: { text: '合成释义', source: 'hermes', target: 'zh-CN' } });
  for (const source of ['mymemory', 'hermes']) {
    const operation = create(source, source);
    operation.payload.definition = { word: source, phonetics: [], meanings: [], translation: { text: '合成释义', source, target: 'zh-CN' } };
    expect((await send(user.access, operation)).status).toBe(200);
  }
});
it('coalesces private requests, caches successful results and checks enabled tools before inference', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(response([])).mockResolvedValue(completion());
  const translator = new HermesTranslator({ baseURL: 'http://127.0.0.1:8642/v1', key: 'synthetic', model: 'translation', fetch });
  const results = await Promise.all([translator.translate('synthetic'), translator.translate('synthetic')]);
  expect(results[0]).toEqual(results[1]); expect(fetch).toHaveBeenCalledTimes(2);
  expect(String(fetch.mock.calls[0][0])).toBe('http://127.0.0.1:8642/v1/toolsets');
  const body = JSON.parse(String(fetch.mock.calls[1][1]?.body));
  expect(body.messages[1]).toEqual({ role: 'user', content: 'synthetic' });
  expect(await translator.translate('synthetic')).toEqual(results[0]); expect(fetch).toHaveBeenCalledTimes(2);
});
it('refuses a tool-enabled Hermes profile instead of sending webpage text to an agent', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response([{ enabled: true, tools: ['terminal'] }]));
  const translator = new HermesTranslator({ baseURL: 'http://127.0.0.1:8642/v1', key: 'synthetic', model: 'translation', fetch });
  await expect(translator.translate('synthetic')).rejects.toMatchObject({ code: 'TRANSLATION_PROFILE_NOT_ISOLATED' });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('accepts the installed Hermes API discovery envelope while rejecting unsafe or mismatched discovery', async () => {
  const disabled = { name: 'terminal', enabled: false, tools: ['terminal'] };
  const fetch = vi.fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(response({ object: 'list', platform: 'api_server', data: [disabled] }))
    .mockResolvedValue(completion());
  const translator = new HermesTranslator({ baseURL: 'http://127.0.0.1:8642/v1', key: 'synthetic', model: 'translation', fetch });
  expect((await translator.translate('synthetic')).source).toBe('hermes');
  expect(fetch).toHaveBeenCalledTimes(2);
  for (const discovery of [
    { object: 'list', platform: 'cli', data: [disabled] },
    { object: 'list', platform: 'api_server', data: [{ ...disabled, enabled: true, tools: [] }] },
    { object: 'list', platform: 'api_server', data: [{ ...disabled, enabled: undefined }] },
    { object: 'list', platform: 'api_server', data: {} },
  ]) {
    const unsafeFetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response(discovery));
    const unsafe = new HermesTranslator({ baseURL: 'http://127.0.0.1:8642/v1', key: 'synthetic', model: 'translation', fetch: unsafeFetch });
    await expect(unsafe.translate('synthetic')).rejects.toMatchObject({ code: 'TRANSLATION_PROFILE_NOT_ISOLATED' });
    expect(unsafeFetch).toHaveBeenCalledTimes(1);
  }
});
it('bounds stalled provider bodies and does not cache malformed output', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(response([]))
    .mockResolvedValueOnce(response({ choices: [{ message: { content: 'not JSON' } }] })).mockResolvedValue(completion());
  const translator = new HermesTranslator({ baseURL: 'http://127.0.0.1:8642/v1', key: 'synthetic', model: 'translation', fetch });
  await expect(translator.translate('synthetic')).rejects.toMatchObject({ code: 'TRANSLATION_INVALID_RESPONSE' });
  expect((await translator.translate('synthetic')).source).toBe('hermes');
  const stalled = new HermesTranslator({ baseURL: 'http://127.0.0.1:8642/v1', key: 'synthetic', model: 'translation', timeoutMs: 10,
    fetch: vi.fn().mockImplementation(() => new Promise(() => {})) });
  await expect(stalled.translate('synthetic')).rejects.toMatchObject({ code: 'TRANSLATION_TIMEOUT' });
});
