import { afterEach, expect, it, vi } from 'vitest';
import gateway from '../lookup-gateway';
const extension = 'chrome-extension://' + 'a'.repeat(32);
afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ translation: { text: '合成释义', target: 'zh-CN', source: 'hermes' } }),
    { headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'private' } }));
  const limit = vi.fn().mockResolvedValue({ success: true });
  const env = { LOOKUP_SERVICE: { fetch }, LOOKUP_RATE: { limit }, ASSETS: { fetch: vi.fn() } } as unknown as Env;
  const call = (path: string, body: unknown = { word: 'synthetic', target: 'zh-CN' }, origin: string | undefined = extension) => gateway.fetch(new Request('https://lookup.example.test' + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}),
      Authorization: 'Bearer synthetic-private', Cookie: 'private', 'CF-Connecting-IP': '192.0.2.1', 'X-Forwarded-For': 'spoof' }, body: JSON.stringify(body),
  }), env);
  return { fetch, limit, env, call };
}
it('accepts public extension lookups across installation identities while excluding credentials and private paths', async () => {
  const { fetch, limit, call } = fixture();
  const response = await call('/api/v1/public/lookup/translation');
  expect(response.status).toBe(200); expect(response.headers.get('Access-Control-Allow-Origin')).toBe(extension);
  expect(response.headers.get('Set-Cookie')).toBeNull();
  expect(limit).toHaveBeenCalledExactlyOnceWith({ key: '192.0.2.1' });
  const [url, init] = fetch.mock.calls[0];
  expect(url).toBe('http://rememberme-lookup.internal:8788/api/v1/public/lookup/translation');
  expect(init.headers).toEqual({ Accept: 'application/json', 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1' });
  expect(init.redirect).toBe('manual');
  for (const path of ['/api/v1/me', '/api/v1/sync/operations', '/auth/github/callback', '/api/v1/public/lookup/translation?url=private']) expect((await call(path)).status).toBe(404);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('validates word-only payloads, origin syntax, request size and edge quota before using the private service', async () => {
  const { fetch, limit, call } = fixture();
  expect((await call('/api/v1/public/lookup/translation', { word: 'synthetic', target: 'zh-CN', context: 'private' })).status).toBe(400);
  expect((await call('/api/v1/public/lookup/translation', { word: 'two words', target: 'zh-CN' })).status).toBe(400);
  expect((await call('/api/v1/public/lookup/translation', { word: 'synthetic', target: 'zh-CN' }, 'https://untrusted.example.test')).status).toBe(403);
  expect((await call('/api/v1/public/lookup/translation', { word: 'x'.repeat(4096), target: 'zh-CN' })).status).toBe(413);
  limit.mockResolvedValue({ success: false });
  expect((await call('/api/v1/public/lookup/translation')).status).toBe(429);
  expect(fetch).not.toHaveBeenCalled();
});
it('preserves public failure CORS and excludes authorization from preflight', async () => {
  const { fetch, env } = fixture();
  fetch.mockRejectedValue(new Error('private transport detail'));
  const request = new Request('https://lookup.example.test/api/v1/public/lookup/translation', { method: 'OPTIONS', headers: {
    Origin: extension, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Authorization',
  } });
  expect((await gateway.fetch(request, env)).status).toBe(403); expect(fetch).not.toHaveBeenCalled();
  request.headers.set('Access-Control-Request-Headers', 'Content-Type');
  expect((await gateway.fetch(request, env)).status).toBe(204);
});
it('uses fixed edge dictionary egress and validates data before recovering through the private service', async () => {
  const { fetch: privateFetch, call } = fixture();
  const definition = { word: 'curated', phonetics: [], meanings: [{ partOfSpeech: 'verb', definitions: [{ definition: '<b>Select</b> carefully.' }] }] };
  const remote = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify([definition]), { headers: { 'Content-Type': 'application/json' } }))
    .mockResolvedValueOnce(new Response('[]', { headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', remote);
  const response = await call('/api/v1/public/lookup/dictionary', { word: ' Curated ' });
  expect(await response.json()).toEqual({ definition: { ...definition, source: 'dictionary-api' } });
  expect(remote.mock.calls[0][0]).toBe('https://api.dictionaryapi.dev/api/v2/entries/en/curated');
  expect(remote.mock.calls[0][1].redirect).toBe('manual');
  expect(privateFetch).not.toHaveBeenCalled();
  await call('/api/v1/public/lookup/dictionary', { word: 'curated' });
  expect(privateFetch).toHaveBeenCalledTimes(1);
});
