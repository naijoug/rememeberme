import { afterEach, expect, it, vi } from 'vitest';
import { SharedLookup } from './shared-lookup';
import { TranslationService } from './translation';
vi.mock('wxt/utils/storage', () => ({ storage: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) } }));
afterEach(() => vi.useRealTimers());
it('isolates cancellations, shares work, and aborts only after the last subscriber leaves', async () => {
  const pool = new SharedLookup<string>(1000, 'timeout');
  let resolve!: (value: string) => void;
  const load = vi.fn((_signal: AbortSignal) => new Promise<string>(r => { resolve = r; }));
  const a = new AbortController(), b = new AbortController();
  const first = pool.run('word', load, a.signal); const second = pool.run('word', load, b.signal);
  const cancelled = expect(first).rejects.toMatchObject({ name: 'AbortError' });
  await Promise.resolve(); a.abort(); await cancelled;
  expect(load).toHaveBeenCalledOnce(); expect(load.mock.calls[0][0].aborted).toBe(false);
  resolve('ok'); expect(await second).toBe('ok');
  const last = new AbortController(); const waiting = pool.run('other', load, last.signal);
  const check = expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
  await Promise.resolve(); last.abort(); await check;
  expect(load.mock.calls[1][0].aborted).toBe(true);
});
it('never starts pre-cancelled work and old completion cannot remove a newer A→B→A flight', async () => {
  const pool = new SharedLookup<string>(1000, 'timeout'); const a = new AbortController(); a.abort();
  const load = vi.fn(async () => 'unexpected'); await expect(pool.run('a', load, a.signal)).rejects.toMatchObject({ name: 'AbortError' }); expect(load).not.toHaveBeenCalled();
  const old = new AbortController(); let resolveOld!: (value: string) => void;
  const first = pool.run('a', () => new Promise(resolve => { resolveOld = resolve; }), old.signal);
  const check = expect(first).rejects.toMatchObject({ name: 'AbortError' }); await Promise.resolve(); old.abort(); await check;
  let resolveNew!: (value: string) => void;
  const nextLoad = vi.fn(() => new Promise<string>(resolve => { resolveNew = resolve; }));
  const next = pool.run('a', nextLoad); await Promise.resolve(); resolveOld('late'); await Promise.resolve();
  const joined = pool.run('a', nextLoad); resolveNew('new');
  expect(await next).toBe('new'); expect(await joined).toBe('new'); expect(nextLoad).toHaveBeenCalledOnce();
});
it('bounds a stuck loader and lets the next lookup recover', async () => {
  vi.useFakeTimers(); const pool = new SharedLookup<string>(100, 'timeout');
  const request = pool.run('a', () => new Promise(() => {})); const check = expect(request).rejects.toThrow('timeout');
  await vi.advanceTimersByTimeAsync(100); await check;
  expect(await pool.run('a', async () => 'recovered')).toBe('recovered');
});
it('keeps a background/context-menu caller alive and does not cache a fully cancelled translation', async () => {
  let resolve!: (value: unknown) => void;
  const request = vi.fn((_path, _method, _body, _signal) => new Promise(r => { resolve = r; }));
  const service = new TranslationService({ request } as any); const controller = new AbortController();
  const first = service.translate('synthetic', controller.signal); const check = expect(first).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
  const pinned = service.translate('synthetic'); await Promise.resolve(); controller.abort(); await check;
  resolve({ translation: { text: '合成', target: 'zh-CN', source: 'magpie' } }); expect((await pinned).text).toBe('合成');
  expect(request).toHaveBeenCalledOnce();
});

it('never caches or resurrects a translation when every caller cancels before a late reply', async () => {
  const replies:Array<(value:unknown)=>void>=[];
  const request=vi.fn(()=>new Promise(resolve=>replies.push(resolve)));
  const service=new TranslationService({request} as any), signal=new AbortController();
  const first=service.translate('synthetic',signal.signal);const cancelled=expect(first).rejects.toMatchObject({name:'AbortError'});
  await vi.waitFor(()=>expect(request).toHaveBeenCalledTimes(1));signal.abort();await cancelled;
  replies[0]({translation:{text:'旧结果',source:'magpie',target:'zh-CN'}});await Promise.resolve();
  const next=service.translate('synthetic');await vi.waitFor(()=>expect(request).toHaveBeenCalledTimes(2));
  replies[1]({translation:{text:'新结果',source:'magpie',target:'zh-CN'}});expect((await next).text).toBe('新结果');
});
