import { expect, it, vi } from 'vitest';
import { ApiError } from '../../contracts/api-v1';
import { ServerDictionary, ServerTranslator, MyMemoryTranslator } from '../src/lookup';
import { env } from './node-bindings';
import { account, request } from './helpers';
import { ServerWordNet } from '../src/wordnet';
import { WindowLimiter } from '../src/node-runtime';
import { app } from '../src/index';
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const english = { word: 'synthetic', phonetics: [], meanings: [{ partOfSpeech: 'adjective', definitions: [{ definition: '<b>Artificial</b>' }] }] };
const chinese = { text: '合成释义', target: 'zh-CN' as const, source: 'mymemory' as const };

it('allows anonymous word-only lookups with exact CORS and IP limits while keeping vocabulary protected', async () => {
  const origin = 'chrome-extension://synthetic-extension';
  env.CLIENT_ORIGINS = origin; env.LOOKUP_LIMIT = new WindowLimiter(2); env.CLIENT_IP = 'synthetic-public-ip';
  const translate = vi.fn().mockResolvedValue(chinese);
  env.TRANSLATOR = { translate }; env.DICTIONARY = { getDefinition: async () => english };
  const post = (input: unknown, caller = origin) => app.request('https://api.example.test/api/v1/public/lookup/translation', {
    method: 'POST', headers: { Origin: caller, 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  }, env);
  expect((await post({ word: 'synthetic', target: 'zh-CN' }, origin + '-other')).status).toBe(403);
  expect((await post({ word: 'synthetic', target: 'zh-CN', context: 'private' })).status).toBe(400);
  const reply = await post({ word: ' Synthetic ', target: 'zh-CN' });
  expect(reply.status).toBe(200); expect(reply.headers.get('Access-Control-Allow-Origin')).toBe(origin);
  expect(await reply.json()).toEqual({ translation: chinese });
  expect((await post({ word: 'synthetic', target: 'zh-CN' })).status).toBe(429);
  expect(translate).toHaveBeenCalledExactlyOnceWith('synthetic');
  expect((await request('/api/v1/me')).status).toBe(401);
  for (const table of ['users', 'sessions', 'vocabulary_entries']) expect((await env.DB.prepare('SELECT count(*) AS n FROM ' + table).first<{ n: number }>())?.n).toBe(0);
});

it('reads exact and verified word forms from real server WordNet assets without external network', async () => {
  const fetcher = vi.fn<typeof fetch>();
  const dictionary = new ServerDictionary(fetcher, 6000, new ServerWordNet('../frontend/browser-extension/public/dictionary/wordnet'));
  expect(await dictionary.getDefinition('synthetic')).toMatchObject({ word: 'synthetic', source: 'wordnet' });
  expect(await dictionary.getDefinition('having')).toMatchObject({ word: 'have', source: 'wordnet' });
  expect(fetcher).not.toHaveBeenCalled();
});

it('authenticates both lookup routes and rejects context, URL, phrase and provider parameters before provider calls', async () => {
  const user = await account();
  const getDefinition = vi.fn().mockResolvedValue(english), translate = vi.fn().mockResolvedValue(chinese);
  env.DICTIONARY = { getDefinition }; env.TRANSLATOR = { translate };
  for (const [path, input] of [
    ['/api/v1/lookup/dictionary', { word: ' Synthetic ' }],
    ['/api/v1/lookup/translation', { word: ' Synthetic ', target: 'zh-CN' }],
  ] as const) {
    expect((await request(path, undefined, 'POST', input)).status).toBe(401);
    for (const bad of [{ ...input, context: 'private' }, { ...input, url: 'https://example.test' },
      { ...input, model: 'client-selected' }, { ...input, word: 'two words' }]) {
      expect((await request(path, user.access, 'POST', bad)).status).toBe(400);
    }
    expect((await request(path, user.access, 'POST', input)).status).toBe(200);
  }
  expect(getDefinition).toHaveBeenCalledExactlyOnceWith('synthetic');
  expect(translate).toHaveBeenCalledExactlyOnceWith('synthetic');
});

it('coalesces and caches English results, preserving literal untrusted text and provider attribution', async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response([english]));
  const dictionary = new ServerDictionary(fetcher);
  const replies = await Promise.all([dictionary.getDefinition('synthetic'), dictionary.getDefinition('synthetic')]);
  expect(replies[0]).toEqual({ ...english, source: 'dictionary-api' }); expect(replies[0]).toEqual(replies[1]);
  expect(await dictionary.getDefinition('synthetic')).toEqual(replies[0]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(String(fetcher.mock.calls[0][0])).toBe('https://api.dictionaryapi.dev/api/v2/entries/en/synthetic');
  expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer' });
});

it('rejects malformed/oversized dictionary responses without caching and preserves not-found errors', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response([{ word: 'synthetic' }]))
    .mockResolvedValueOnce(response([{ ...english, padding: 'x'.repeat(256 * 1024) }]))
    .mockResolvedValueOnce(response({}, 404)).mockResolvedValueOnce(response([english]));
  const dictionary = new ServerDictionary(fetcher);
  await expect(dictionary.getDefinition('synthetic')).rejects.toMatchObject({ code: 'DICTIONARY_INVALID_RESPONSE' });
  await expect(dictionary.getDefinition('synthetic')).rejects.toMatchObject({ code: 'DICTIONARY_UNAVAILABLE' });
  await expect(dictionary.getDefinition('synthetic')).rejects.toMatchObject({ code: 'DICTIONARY_NOT_FOUND', status: 404 });
  await expect(dictionary.getDefinition('synthetic')).resolves.toMatchObject({ source: 'dictionary-api' });
});

it('uses Hermes first and shares/caches MyMemory fallback briefly before retrying Hermes', async () => {
  vi.useFakeTimers();
  try {
    const hermes = { translate: vi.fn().mockRejectedValueOnce(new ApiError('TRANSLATION_TIMEOUT', 504, true))
      .mockResolvedValue({ ...chinese, source: 'hermes' }) };
    const fallback = { translate: vi.fn().mockResolvedValue(chinese) };
    const translator = new ServerTranslator(hermes, fallback);
    const replies = await Promise.all([translator.translate('synthetic'), translator.translate('synthetic')]);
    expect(replies[0]).toEqual(chinese); expect(replies[1]).toEqual(chinese);
    expect(await translator.translate('synthetic')).toEqual(chinese);
    expect(hermes.translate).toHaveBeenCalledTimes(1); expect(fallback.translate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3_600_001);
    expect((await translator.translate('synthetic')).source).toBe('hermes');
    expect(fallback.translate).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); }
});

it('keeps isolation failures explicit and supports MyMemory-only or Hermes-only configurations', async () => {
  const fallback = { translate: vi.fn().mockResolvedValue(chinese) };
  const hermes = { translate: vi.fn().mockRejectedValue(new ApiError('TRANSLATION_PROFILE_NOT_ISOLATED', 503)) };
  await expect(new ServerTranslator(hermes, fallback).translate('synthetic')).rejects.toMatchObject({ code: 'TRANSLATION_PROFILE_NOT_ISOLATED' });
  expect(fallback.translate).not.toHaveBeenCalled();
  expect(await new ServerTranslator(undefined, fallback).translate('synthetic')).toEqual(chinese);
  await expect(new ServerTranslator().translate('synthetic')).rejects.toMatchObject({ code: 'TRANSLATION_NOT_CONFIGURED' });
  hermes.translate.mockRejectedValue(new ApiError('TRANSLATION_UNAVAILABLE', 503, true));
  await expect(new ServerTranslator(hermes).translate('synthetic')).rejects.toMatchObject({ code: 'TRANSLATION_UNAVAILABLE' });
});

it('sends only the MyMemory word/language pair and rejects quota, unchanged and non-Chinese results', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ responseStatus: 200, responseData: { translatedText: '合成释义' } }))
    .mockResolvedValueOnce(response({ responseStatus: 403 }))
    .mockResolvedValueOnce(response({ responseStatus: 200, responseData: { translatedText: 'synthetic' } }))
    .mockResolvedValueOnce(response({ responseStatus: 200, responseData: { translatedText: 'Wrong language' } }));
  const translator = new MyMemoryTranslator(fetcher);
  expect(await translator.translate('synthetic')).toEqual(chinese);
  const url = new URL(String(fetcher.mock.calls[0][0]));
  expect([...url.searchParams]).toEqual([['q', 'synthetic'], ['langpair', 'en|zh-CN']]);
  expect(fetcher.mock.calls[0][1]?.headers).toEqual({ Accept: 'application/json' });
  await expect(translator.translate('synthetic')).rejects.toMatchObject({ code: 'TRANSLATION_QUOTA' });
  await expect(translator.translate('synthetic')).rejects.toMatchObject({ code: 'TRANSLATION_INVALID_RESPONSE' });
  await expect(translator.translate('synthetic')).rejects.toMatchObject({ code: 'TRANSLATION_INVALID_RESPONSE' });
});

it.each([false, true])('bounds stalled provider headers and bodies (%s) and aborts the request', async bodyOnly => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => bodyOnly
    ? new Response(new ReadableStream({ start() {} }), { headers: { 'Content-Type': 'application/json' } })
    : new Promise(() => {}));
  await expect(new ServerDictionary(fetcher, 10).getDefinition('synthetic')).rejects.toMatchObject({ code: 'DICTIONARY_TIMEOUT' });
  expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
});
