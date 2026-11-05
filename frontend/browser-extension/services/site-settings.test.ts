import { beforeEach, expect, it, vi } from 'vitest';
import { parseSiteSettings, siteHostname, SiteSettingsStore, watchSiteAccess } from './site-settings';
import { checkPageSitePolicy, handleSiteMessage } from './site-messages';
const storageMock = vi.hoisted(() => ({ watch: vi.fn() }));
vi.mock('wxt/utils/storage', () => ({ storage: storageMock }));
function fixture(raw: unknown = null) {
  let value = structuredClone(raw);
  const write = vi.fn(async (next: unknown) => { value = structuredClone(next); });
  return { store: new SiteSettingsStore({ read: async () => structuredClone(value), write }), write, value: () => value };
}
const sender = { url: 'chrome-extension://fixture/popup.html' };
const extension = 'chrome-extension://fixture/';
const tabs = { get: vi.fn(async () => ({ id: 2, url: 'https://example.test/page' })), query: vi.fn(async () => [{ id: 2, url: 'https://example.test/page' }]) };
beforeEach(() => { vi.clearAllMocks(); });

it('normalizes exact hostnames and keeps ports and subdomains semantics explicit', async () => {
  expect(siteHostname('https://EXAMPLE.test.:8443/path?q=x')).toBe('example.test');
  expect(siteHostname('https://例子.test')).toBe('xn--fsqu00a.test');
  expect(siteHostname('file:///tmp/test')).toBeNull();
  const { store } = fixture();
  await store.setEnabled('example.test', false);
  expect((await store.access('https://example.test:8443/')).enabled).toBe(false);
  expect((await store.access('https://sub.example.test/')).enabled).toBe(true);
  expect((await store.access('file:///tmp/fixture.html')).enabled).toBe(true);
  expect((await store.access(undefined)).enabled).toBe(false);
});
it('serializes edits, survives recreation, and keeps settings outside vocabulary', async () => {
  const f = fixture();
  await Promise.all([f.store.setEnabled('a.test', false), f.store.setEnabled('b.test', false)]);
  expect((await f.store.read()).disabledHosts).toEqual(['a.test', 'b.test']);
  expect((await fixture(f.value()).store.read()).disabledHosts).toEqual(['a.test', 'b.test']);
  await f.store.setEnabled('a.test', true);
  expect((await f.store.read()).disabledHosts).toEqual(['b.test']);
  expect(Object.keys(f.value() as object).sort()).toEqual(['disabledHosts', 'schemaVersion']);
});
it('migrates v0 in memory without rewriting data and rejects future/corrupt schemas until explicit restore', async () => {
  expect(parseSiteSettings({ schemaVersion: 0, disabledHosts: ['EXAMPLE.test', 'example.test'] })).toEqual({ schemaVersion: 1, disabledHosts: ['example.test'] });
  for (const raw of [{ schemaVersion: 99, disabledHosts: [] }, { schemaVersion: 1, disabledHosts: ['https://evil.test/path'] }, { schemaVersion: 1, disabledHosts: 'oops' }]) {
    const f = fixture(raw);
    expect((await f.store.access('https://example.test')).enabled).toBe(false);
    await expect(f.store.setEnabled('example.test', true)).rejects.toThrow();
    expect(f.value()).toEqual(raw); expect(f.write).not.toHaveBeenCalled();
    await f.store.reset(); expect((await f.store.access('https://example.test')).enabled).toBe(true);
  }
});
it('recovers after a failed settings write without losing existing rules', async () => {
  const f = fixture({ schemaVersion: 1, disabledHosts: ['kept.test'] });
  f.write.mockRejectedValueOnce(new Error('disk'));
  await expect(f.store.setEnabled('a.test', false)).rejects.toThrow('disk');
  expect((await f.store.read()).disabledHosts).toEqual(['kept.test']);
  await f.store.setEnabled('b.test', false);
  expect((await f.store.read()).disabledHosts).toEqual(['b.test', 'kept.test']);
});
it('resolves top-level site from trusted tabs metadata and rejects webpage setting mutations', async () => {
  const f = fixture({ schemaVersion: 1, disabledHosts: ['example.test'] });
  const child = { url: 'https://allowed-child.test', tab: { id: 2 }, frameId: 7 };
  expect(await handleSiteMessage({ type: 'SITE_ACCESS', url: 'https://allowed.test' }, child, f.store, tabs, extension))
    .toMatchObject({ success: true, data: { enabled: false, hostname: 'example.test' } });
  expect(await handleSiteMessage({ type: 'SITE_RESET' }, child, f.store, tabs, extension)).toMatchObject({ success: false });
  await expect(checkPageSitePolicy({ type: 'GET_TRANSLATION' }, child, f.store, tabs)).rejects.toThrow('disabled');
  await expect(checkPageSitePolicy({ type: 'SAVE_WORD' }, child, f.store, tabs)).rejects.toThrow('disabled');
  await expect(checkPageSitePolicy({ type: 'GET_WORDS' }, child, f.store, tabs)).resolves.toBeUndefined();
  await expect(checkPageSitePolicy({ type: 'GET_TRANSLATION' }, sender, f.store, tabs)).resolves.toBeUndefined();
  await expect(checkPageSitePolicy({ type: 'GET_TRANSLATION' }, { ...sender, tab: { id: 2 } }, f.store, tabs, extension)).resolves.toBeUndefined();
});
it('checks active-tab identity before writes and permits explicit restore from extension UI', async () => {
  const f = fixture();
  expect(await handleSiteMessage({ type: 'SITE_STATUS' }, sender, f.store, tabs, extension)).toMatchObject({ success: true, data: { enabled: true, tabId: 2 } });
  expect(await handleSiteMessage({ type: 'SITE_STATUS' }, { ...sender, tab: { id: 9 } }, f.store, tabs, extension)).toMatchObject({ success: true });
  expect(await handleSiteMessage({ type: 'SITE_SET_CURRENT', tabId: 3, hostname: 'example.test', enabled: false }, sender, f.store, tabs, extension)).toMatchObject({ success: false });
  expect(await handleSiteMessage({ type: 'SITE_SET_CURRENT', tabId: 2, hostname: 'other.test', enabled: false }, sender, f.store, tabs, extension)).toMatchObject({ success: false });
  expect(f.write).not.toHaveBeenCalled();
  expect(await handleSiteMessage({ type: 'SITE_SET_CURRENT', tabId: 2, hostname: 'example.test', enabled: false }, sender, f.store, tabs, extension)).toMatchObject({ success: true });
  expect(await handleSiteMessage({ type: 'SITE_ENABLE_HOST', hostname: 'example.test' }, sender, f.store, tabs, extension)).toMatchObject({ success: true });
  const corrupt = fixture({ schemaVersion: 99 });
  expect(await handleSiteMessage({ type: 'SITE_STATUS' }, sender, corrupt.store, tabs, extension)).toMatchObject({ success: true, data: { settings: null, enabled: false, error: expect.any(String) } });
  expect(await handleSiteMessage({ type: 'SITE_RESET' }, sender, corrupt.store, tabs, extension)).toMatchObject({ success: true });
});
it('ignores stale initial policy replies and removes its storage watcher on disposal', async () => {
  let refresh!: () => void;
  const stop = vi.fn(); storageMock.watch.mockImplementation((_key, callback) => { refresh = callback; return stop; });
  const replies: Array<(value: unknown) => void> = [];
  vi.stubGlobal('browser', { runtime: { sendMessage: vi.fn(() => new Promise(resolve => replies.push(resolve))) } });
  const listener = vi.fn(); const unwatch = watchSiteAccess(listener);
  refresh();
  replies[1]({ success: true, data: { enabled: false, hostname: 'example.test' } }); await Promise.resolve();
  replies[0]({ success: true, data: { enabled: true, hostname: 'example.test' } }); await Promise.resolve();
  expect(listener).toHaveBeenLastCalledWith({ enabled: false, hostname: 'example.test' });
  unwatch(); expect(stop).toHaveBeenCalledOnce();
  vi.unstubAllGlobals();
});

it('does not transiently disable an enabled page when a different site rule changes', async () => {
  let refresh!:()=>void;storageMock.watch.mockImplementation((_key,callback)=>{refresh=callback;return ()=>{};});
  const replies:Array<(value:unknown)=>void>=[];
  vi.stubGlobal('browser',{runtime:{sendMessage:vi.fn(()=>new Promise(resolve=>replies.push(resolve)))}});
  const listener=vi.fn();const stop=watchSiteAccess(listener);
  replies[0]({success:true,data:{enabled:true,hostname:'kept.test'}});await Promise.resolve();listener.mockClear();
  refresh();expect(listener).not.toHaveBeenCalled();
  replies[1]({success:true,data:{enabled:true,hostname:'kept.test'}});await Promise.resolve();
  expect(listener).toHaveBeenCalledExactlyOnceWith({enabled:true,hostname:'kept.test'});
  stop();vi.unstubAllGlobals();
});
