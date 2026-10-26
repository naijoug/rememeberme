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

beforeEach(() => { vi.resetAllMocks(); api.values.clear(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Chinese translation (mock provider and disposable cache)', () => {
  it('uses the new cache namespace for Magpie and persists the actual source across restarts', async () => {
    api.values.set('local:translationCache', { 'public:v1:synthetic': { text: '旧服务结果', source: 'hermes', timestamp: Date.now() } });
    const request = vi.fn().mockResolvedValue({ translation: { text: '合成', target: 'zh-CN', source: 'magpie' } });
    expect((await new TranslationService({ request }).translate('synthetic')).source).toBe('magpie');
    await vi.waitFor(() => expect(api.storage.setItem).toHaveBeenCalled());
    expect((await new TranslationService({ request }).translate('synthetic')).source).toBe('magpie');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('accepts server-side MyMemory fallback and retries the server after its shorter cache expires', async () => {
    const request = vi.fn().mockResolvedValueOnce({ translation: { text: '精选', target: 'zh-CN', source: 'mymemory' } })
      .mockResolvedValue({ translation: { text: '人工释义', target: 'zh-CN', source: 'hermes' } });
    const backend = { current: async () => ({ origin: 'https://api.example.test', credentials: { userId: 'fixture' } }), request } as unknown as BackendClient;
    const service = new TranslationService(backend);
    expect((await service.translate('curated')).source).toBe('mymemory');
    await service.translate('curated'); expect(request).toHaveBeenCalledTimes(1);
    vi.useFakeTimers(); await vi.advanceTimersByTimeAsync(3_600_001);
    expect((await service.translate('curated')).source).toBe('hermes');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('uses public Hermes with persisted cache and sends only word/target', async () => {
    const connection: Connection = { origin: 'https://api.example.test', credentials: {
      userId: 'synthetic-user', deviceId: 'synthetic-device', accessToken: '', refreshToken: '',
      accessExpiresAtMs: 0, refreshExpiresAtMs: 0,
    } };
    const request = vi.fn().mockResolvedValue({ translation: { text: '精选', target: 'zh-CN', source: 'hermes' } });
    const backend = { current: async () => connection, request } as unknown as BackendClient;
    const first = new TranslationService(backend);
    expect((await first.translate(' Curated ')).source).toBe('hermes');
    expect(request).toHaveBeenCalledExactlyOnceWith('/api/v1/public/lookup/translation', 'POST', { word: 'curated', target: 'zh-CN' });
    await vi.waitFor(() => expect(api.storage.setItem).toHaveBeenCalled());
    expect((await new TranslationService(backend).translate('curated')).source).toBe('hermes');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('keeps connected backend failures explicit without caching or switching to MyMemory', async () => {
    const backend = { current: async () => ({ origin: 'https://api.example.test', credentials: { userId: 'synthetic-user' } }),
      request: vi.fn().mockRejectedValue(new Error('TRANSLATION_NOT_CONFIGURED')) } as unknown as BackendClient;
    await expect(new TranslationService(backend).translate('curated')).rejects.toThrow('TRANSLATION_NOT_CONFIGURED');
    expect(fetchMock).not.toHaveBeenCalled(); expect(api.storage.setItem).not.toHaveBeenCalled();
  });
  it('uses the built-in service without login and retains legacy anonymous cached translations', async () => {
    api.values.set('local:translationCache', { curated: { text: '旧值', timestamp: Date.now() - 2 * 86_400_000 } });
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ translation: { text: '合成释义', target: 'zh-CN', source: 'hermes' } }), { headers: { 'Content-Type': 'application/json' } }));
    const service = new TranslationService();
    expect(await service.translate('curated')).toEqual({ text: '旧值', target: 'zh-CN', source: 'mymemory' });
    const [a, b] = await Promise.all([service.translate('synthetic'), service.translate('SYNTHETIC')]);
    expect(a.source).toBe('hermes'); expect(a).toEqual(b); expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://lookup.couplelabs.cn/api/v1/public/lookup/translation');
    const init = fetchMock.mock.calls[0][1]!;
    expect(init.credentials).toBe('omit'); expect(init.headers).not.toHaveProperty('Authorization');
    expect(JSON.parse(String(init.body))).toEqual({ word: 'synthetic', target: 'zh-CN' });
    expect(api.values.has('local:backendConnection')).toBe(false); expect(api.values.has('local:words')).toBe(false);
  });

  it('bounds stalled backend requests and permits later retries', async () => {
    vi.useFakeTimers();
    const request = vi.fn().mockImplementation(() => new Promise(() => {}));
    const backend = { current: async () => ({ origin: 'https://api.example.test', credentials: { userId: 'fixture' } }), request } as unknown as BackendClient;
    const service = new TranslationService(backend);
    const assertion = expect(service.translate('curated')).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(TRANSLATION_TIMEOUT_MS); await assertion;
    request.mockResolvedValue({ translation: { text: '合成释义', source: 'hermes', target: 'zh-CN' } });
    expect((await service.translate('curated')).source).toBe('hermes');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects malformed server results and phrases, and works when cache storage fails', async () => {
    api.storage.getItem.mockRejectedValue(new Error('Storage unavailable'));
    api.storage.setItem.mockRejectedValue(new Error('Storage unavailable'));
    const request = vi.fn().mockResolvedValueOnce({ translation: { text: '', source: 'hermes', target: 'zh-CN' } })
      .mockResolvedValue({ translation: { text: '合成释义', source: 'hermes', target: 'zh-CN' } });
    const backend = { current: async () => ({ origin: 'https://api.example.test', credentials: { userId: 'fixture' } }), request } as unknown as BackendClient;
    const service = new TranslationService(backend);
    await expect(service.translate('curated')).rejects.toThrow(/invalid translation/);
    expect((await service.translate('curated')).text).toBe('合成释义');
    await expect(service.translate('two words')).rejects.toThrow(/one English word/);
    expect(request).toHaveBeenCalledTimes(2); expect(fetchMock).not.toHaveBeenCalled();
  });
});
