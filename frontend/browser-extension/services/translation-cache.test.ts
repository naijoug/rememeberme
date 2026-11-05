import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { TranslationCache, TRANSLATION_CACHE_MAX_AGE_MS, translationCacheKey } from './translation-cache';
vi.mock('wxt/utils/storage', () => ({ storage: { getItem: async () => null } }));
const caches: TranslationCache[] = [];
const create = (limit = 10_000, legacy: () => Promise<unknown> = async () => null) => {
  const value = new TranslationCache('fixture-cache', limit, legacy); caches.push(value); return value;
};
const translation = { text: '测试', source: 'magpie' as const, target: 'zh-CN' as const };
beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('IDBKeyRange', IDBKeyRange); });
afterEach(async () => { for (const c of caches.splice(0)) await c.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('persists more than the old 500-entry limit and survives a memory-cache eviction and restart', async () => {
  const c = create();
  for (let n = 0; n < 520; n++) c.put('fixture' + String.fromCharCode(97 + Math.floor(n / 26), 97 + n % 26), translation);
  await c.flush(); await c.close();
  const reopened = create(); expect((await reopened.get('fixtureaa'))?.translation).toEqual(translation);
  expect((await reopened.get('fixturetz'))?.translation).toEqual(translation);
});

it('evicts least recently used entries transactionally and retains recently touched words', async () => {
  let now = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => now);
  const c = create(2); c.put('first', translation); now++; c.put('second', translation); await c.flush();
  now++; await c.get('first'); await c.flush(); now++; c.put('third', translation); await c.flush(); await c.close();
  const reopened = create(2);
  expect(await reopened.get('second')).toBeUndefined(); expect(await reopened.get('first')).toBeDefined(); expect(await reopened.get('third')).toBeDefined();
});

it('cleans expired disk results on writes and ignores future or wrong-version migration entries', async () => {
  const start = Date.now(); let now = start; vi.spyOn(Date, 'now').mockImplementation(() => now);
  const legacy = vi.fn(async () => ({
    'public:v3:future': { text: '未来', source: 'magpie', timestamp: start + 1_000_000 },
    'public:v2:older': { text: '旧版本', source: 'magpie', timestamp: start },
    'public:v3:valid': { text: '有效', source: 'magpie', timestamp: start },
  }));
  const c = create(10_000, legacy); expect(await c.get('valid')).toBeDefined();
  expect(await c.get('future')).toBeUndefined(); expect(await c.get('older')).toBeUndefined();
  now += TRANSLATION_CACHE_MAX_AGE_MS + 1; c.put('new', translation); await c.flush(); await c.close();
  const reopened = create(10_000, legacy); expect(await reopened.get('valid')).toBeUndefined(); expect(await reopened.get('new')).toBeDefined();
  expect(legacy).toHaveBeenCalledOnce();
});

it('bounds stalled legacy storage and retains a live result even when migration fails', async () => {
  const c = create(10_000, () => new Promise(() => {}));
  const start = performance.now(); expect(await c.get('test')).toBeUndefined();
  expect(performance.now() - start).toBeLessThan(600);
  c.put('test', translation); await c.flush(); expect((await c.get('test'))?.translation).toEqual(translation);
});

it('keeps translation keys scoped to the origin and format and never opens the vocabulary database', async () => {
  const open = vi.spyOn(indexedDB, 'open'); const c = create(); c.put('test', translation); await c.flush();
  expect(JSON.parse(translationCacheKey('test'))).toEqual(['https://rememberme-lookup.couplelabs.workers.dev', 'public:v3', 'zh-CN', 'test']);
  expect(open.mock.calls.every(([name]) => name === 'fixture-cache')).toBe(true);
});

it('recovers from storage errors while keeping the latest successful result in memory', async () => {
  const factory = indexedDB; const c = create();
  vi.stubGlobal('indexedDB', { open() { throw new Error('Quota or storage unavailable'); } });
  c.put('test', translation); await c.flush(); expect((await c.get('test'))?.translation).toEqual(translation);
  vi.stubGlobal('indexedDB', factory); c.put('another', translation); await c.flush(); await c.close();
  expect((await create().get('another'))?.translation).toEqual(translation);
});
