import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { TranslationService, TRANSLATION_TIMEOUT_MS } from './translation';
import { TranslationCache, TRANSLATION_CACHE_MAX_AGE_MS } from './translation-cache';

const api = vi.hoisted(() => ({ getItem: vi.fn(async (): Promise<unknown> => null), setItem: vi.fn() }));
vi.mock('wxt/utils/storage', () => ({ storage: api }));
const caches: TranslationCache[] = [];
const cache = () => { const value = new TranslationCache(); caches.push(value); return value; };
const result = (text = '合成释义', source: 'magpie' | 'mymemory' = 'magpie') => ({ translation: { text, source, target: 'zh-CN' as const } });
beforeEach(() => { vi.clearAllMocks(); api.getItem.mockResolvedValue(null); vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('IDBKeyRange', IDBKeyRange); });
afterEach(async () => { vi.useRealTimers(); for (const value of caches.splice(0)) await value.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('prefers a reviewed local edition over an older online cache without rewriting that cache', async () => {
  const store = cache(); store.put('synthetic', result('旧在线释义').translation); await store.flush();
  const get = vi.spyOn(store, 'get'), put = vi.spyOn(store, 'put'), request = vi.fn();
  const local = { ...result('审核后的本地释义').translation, dictionary: {
    id: 'rememberme-dict' as const, version: 'b'.repeat(24), entryHash: 'a'.repeat(64), review: 'ai-assisted-v1' as const,
  } };
  const service = new TranslationService({ request }, store, async () => local);
  expect(await service.translate('synthetic')).toEqual(local);
  expect(get).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled();
  expect((await store.get('synthetic'))?.translation.text).toBe('旧在线释义');
});

it('retains the existing online recovery path if a local learner shard fails', async () => {
  const request = vi.fn().mockResolvedValue(result());
  const service = new TranslationService({ request }, cache(), async () => { throw new Error('corrupt local shard'); });
  expect((await service.translate('synthetic')).text).toBe('合成释义'); expect(request).toHaveBeenCalledTimes(1);
});

it('coalesces network recovery and persists successes independently of vocabulary across service restarts', async () => {
  const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('network'))
    .mockImplementation(async () => new Response(JSON.stringify(result()), { headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetcher);
  const firstCache = cache(); const service = new TranslationService(undefined, firstCache);
  const [a, b] = await Promise.all([service.translate('synthetic'), service.translate('SYNTHETIC')]);
  expect(a).toEqual(b); expect(fetcher).toHaveBeenCalledTimes(2);
  await firstCache.flush(); await firstCache.close();
  expect(await new TranslationService(undefined, cache()).translate('synthetic')).toEqual(a);
  expect(fetcher).toHaveBeenCalledTimes(2); expect(api.setItem).not.toHaveBeenCalled();
  const options = fetcher.mock.calls[0][1]!;
  expect(options.credentials).toBe('omit'); expect(options.headers).not.toHaveProperty('Authorization');
  expect(JSON.parse(String(options.body))).toEqual({ word: 'synthetic', target: 'zh-CN' });
});

it('migrates current public and legacy anonymous successes without accepting older public/account namespaces', async () => {
  api.getItem.mockResolvedValue({
    'public:v1:synthetic': { text: '旧命名空间', timestamp: Date.now(), source: 'hermes' },
    'account:private': { text: '私人', timestamp: Date.now(), source: 'magpie' },
    curated: { text: '旧值', timestamp: Date.now() - 2 * 86_400_000 },
    'public:v3:bank': { text: '银行', timestamp: Date.now(), source: 'magpie' },
  });
  const request = vi.fn().mockResolvedValue(result()); const service = new TranslationService({ request }, cache());
  expect((await service.translate('curated')).text).toBe('旧值');
  expect((await service.translate('bank')).text).toBe('银行'); expect(request).not.toHaveBeenCalled();
  expect((await service.translate('synthetic')).source).toBe('magpie'); expect(request).toHaveBeenCalledOnce();
  expect(api.setItem).not.toHaveBeenCalled();
});

it('immediately publishes stale translations, coalesces refresh and retains the old result on failure with backoff', async () => {
  const now = Date.now(); const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  const request = vi.fn().mockResolvedValue(result('旧值')); const service = new TranslationService({ request }, cache());
  await service.translate('synthetic'); clock.mockReturnValue(now + 8 * 86_400_000);
  let finish!: (value: unknown) => void; request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const a = vi.fn(), b = vi.fn();
  const first = service.translate('synthetic', undefined, a), second = service.translate('synthetic', undefined, b);
  await vi.waitFor(() => expect(a).toHaveBeenCalledWith(result('旧值').translation));
  expect(b).toHaveBeenCalledWith(result('旧值').translation); expect(request).toHaveBeenCalledTimes(2);
  finish(result('新值')); expect((await first).text).toBe('新值'); expect(await second).toEqual(await first);
  clock.mockReturnValue(now + 16 * 86_400_000); request.mockRejectedValue(new Error('offline'));
  expect((await service.translate('synthetic', undefined, a)).text).toBe('新值');
  expect((await service.translate('synthetic', undefined, a)).text).toBe('新值'); expect(request).toHaveBeenCalledTimes(3);
  clock.mockReturnValue(now + 16 * 86_400_000 + 60_001);
  await service.translate('synthetic', undefined, a); expect(request).toHaveBeenCalledTimes(4);
});

it('retains MyMemory attribution and refreshes it after one hour without blocking its cached preview', async () => {
  const now = Date.now(); const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  const request = vi.fn().mockResolvedValueOnce(result('备用', 'mymemory')).mockResolvedValue(result('主译文'));
  const service = new TranslationService({ request }, cache()); await service.translate('synthetic');
  clock.mockReturnValue(now + 3_600_001); const cached = vi.fn();
  expect((await service.translate('synthetic', undefined, cached)).source).toBe('magpie');
  expect(cached).toHaveBeenCalledWith(result('备用', 'mymemory').translation);
});

it('serves stale data to one-shot callers without detached network work and never serves data older than 30 days', async () => {
  const now = Date.now(); const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  const request = vi.fn().mockResolvedValueOnce(result('旧值')).mockResolvedValue(result('新值'));
  const service = new TranslationService({ request }, cache()); await service.translate('synthetic');
  clock.mockReturnValue(now + 8 * 86_400_000);
  expect((await service.translate('synthetic')).text).toBe('旧值'); expect(request).toHaveBeenCalledOnce();
  clock.mockReturnValue(now + TRANSLATION_CACHE_MAX_AGE_MS + 1);
  const cached = vi.fn(); expect((await service.translate('synthetic', undefined, cached)).text).toBe('新值');
  expect(cached).not.toHaveBeenCalled(); expect(request).toHaveBeenCalledTimes(2);
});

it('cancels refresh without replacing stale data or swallowing cancellation', async () => {
  const now = Date.now(); const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  const request = vi.fn().mockResolvedValue(result('旧值')); const service = new TranslationService({ request }, cache());
  await service.translate('synthetic'); clock.mockReturnValue(now + 8 * 86_400_000);
  let finish!: (value: unknown) => void; request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const controller = new AbortController(), preview = vi.fn();
  const pending = service.translate('synthetic', controller.signal, preview);
  const check = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2)); controller.abort(); await check;
  finish(result('不应保存')); await Promise.resolve();
  expect((await service.translate('synthetic')).text).toBe('旧值');
});

it('bounds stalled network work and rejects malformed results and phrases even when storage is unavailable', async () => {
  vi.stubGlobal('indexedDB', { open() { throw new Error('Unavailable'); } });
  const request = vi.fn().mockResolvedValueOnce(result('')).mockResolvedValue(result());
  const service = new TranslationService({ request }, cache());
  await expect(service.translate('synthetic')).rejects.toThrow(/invalid translation/);
  expect((await service.translate('synthetic')).text).toBe('合成释义');
  await expect(service.translate('two words')).rejects.toThrow(/one English word/);
  request.mockImplementation(() => new Promise(() => {})); vi.useFakeTimers();
  const pending = service.translate('timeout'); const check = expect(pending).rejects.toThrow(/timed out/);
  await vi.advanceTimersByTimeAsync(TRANSLATION_TIMEOUT_MS + 500); await check;
});
