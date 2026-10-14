import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TranslationService, TRANSLATION_TIMEOUT_MS } from './translation';
import type { BackendClient, Connection } from './backend-client';

const api = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  return { values, storage: {
    getItem: vi.fn(async (key: string) => structuredClone(values.get(key) ?? null)),
    setItem: vi.fn(async (key: string, value: unknown) => { values.set(key, structuredClone(value)); }),
  } };
});
vi.mock('wxt/utils/storage', () => ({ storage: api.storage }));
const fetchMock = vi.fn<typeof fetch>();
const response = (text = '精选') => new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText: text } }));

beforeEach(() => { vi.resetAllMocks(); api.values.clear(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Chinese translation (mock provider and disposable cache)', () => {
  it('uses authenticated Hermes with provider/account-separated cache and sends only word/target', async () => {
    const connection: Connection = { origin: 'https://api.example.test', credentials: {
      userId: 'synthetic-user', deviceId: 'synthetic-device', accessToken: '', refreshToken: '',
      accessExpiresAtMs: 0, refreshExpiresAtMs: 0,
    } };
    const request = vi.fn().mockResolvedValue({ translation: { text: '精选', target: 'zh-CN', source: 'hermes' } });
    const backend = { current: async () => connection, request } as unknown as BackendClient;
    const first = new TranslationService(backend);
    expect((await first.translate(' Curated ')).source).toBe('hermes');
    expect(request).toHaveBeenCalledExactlyOnceWith('/api/v1/lookup/translation', 'POST', { word: 'curated', target: 'zh-CN' });
    await vi.waitFor(() => expect(api.storage.setItem).toHaveBeenCalled());
    expect((await new TranslationService(backend).translate('curated')).source).toBe('hermes');
    expect(request).toHaveBeenCalledTimes(1);
    connection.credentials.userId = 'another-user';
    await first.translate('curated');
    expect(request).toHaveBeenCalledTimes(2); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('keeps connected backend failures explicit without caching or switching to MyMemory', async () => {
    const backend = { current: async () => ({ origin: 'https://api.example.test', credentials: { userId: 'synthetic-user' } }),
      request: vi.fn().mockRejectedValue(new Error('TRANSLATION_NOT_CONFIGURED')) } as unknown as BackendClient;
    await expect(new TranslationService(backend).translate('curated')).rejects.toThrow('TRANSLATION_NOT_CONFIGURED');
    expect(fetchMock).not.toHaveBeenCalled(); expect(api.storage.setItem).not.toHaveBeenCalled();
  });
  it('sends only the selected word and language pair without an API key', async () => {
    fetchMock.mockResolvedValue(response());
    const result = await new TranslationService().translate(' Curated ');
    expect(result).toEqual({ text: '精选', target: 'zh-CN', source: 'mymemory' });
    const [url, options] = fetchMock.mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.origin + parsed.pathname).toBe('https://api.mymemory.translated.net/get');
    expect([...parsed.searchParams]).toEqual([['q', 'curated'], ['langpair', 'en|zh-CN']]);
    expect(options).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' });
  });

  it('coalesces requests and reuses a persisted cache after a new service instance', async () => {
    fetchMock.mockResolvedValue(response());
    const service = new TranslationService();
    const [first, second] = await Promise.all([service.translate('curated'), service.translate('CURATED')]);
    expect(first).toEqual(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(api.storage.setItem).toHaveBeenCalled());
    expect(await new TranslationService().translate('curated')).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(api.values.has('local:words')).toBe(false);
  });

  it('refreshes expired cache entries', async () => {
    api.values.set('local:translationCache', { curated: { text: '旧值', timestamp: Date.now() - 8 * 86400000 } });
    fetchMock.mockResolvedValue(response());
    expect((await new TranslationService().translate('curated')).text).toBe('精选');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([403, 429])('reports provider quota status %s without caching the error', async status => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ responseStatus: status, responseData: { translatedText: 'QUOTA EXHAUSTED' } })));
    await expect(new TranslationService().translate('curated')).rejects.toThrow(/quota/i);
    expect(api.storage.setItem).not.toHaveBeenCalled();
  });

  it('reports HTTP 429 and permits a later fresh request', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 429 })).mockResolvedValueOnce(response());
    const service = new TranslationService();
    await expect(service.translate('curated')).rejects.toThrow(/quota/i);
    expect((await service.translate('curated')).text).toBe('精选');
  });

  it('rejects unchanged text and malformed results', async () => {
    fetchMock.mockResolvedValueOnce(response('curated')).mockResolvedValueOnce(response(''));
    const service = new TranslationService();
    await expect(service.translate('curated')).rejects.toThrow(/No Chinese translation/);
    await expect(service.translate('curated')).rejects.toThrow(/No Chinese translation/);
  });

  it.each([false, true])('bounds stalled requests including response bodies (%s)', async bodyOnly => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(() => bodyOnly ? Promise.resolve({ ok: true, status: 200, json: () => new Promise(() => {}) } as Response) : new Promise(() => {}));
    const assertion = expect(new TranslationService().translate('curated')).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(TRANSLATION_TIMEOUT_MS);
    await assertion;
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it('works when cache storage fails and rejects phrase input', async () => {
    api.storage.getItem.mockRejectedValue(new Error('Storage unavailable'));
    api.storage.setItem.mockRejectedValue(new Error('Storage unavailable'));
    fetchMock.mockResolvedValue(response());
    const service = new TranslationService();
    expect((await service.translate('curated')).text).toBe('精选');
    await expect(service.translate('two words')).rejects.toThrow(/one English word/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
