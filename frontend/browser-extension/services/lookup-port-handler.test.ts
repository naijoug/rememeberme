import { afterEach, expect, it, vi } from 'vitest';
import { handleLookupPort, type LookupPort } from './lookup-port-handler';
import { LOOKUP_PORT } from './lookup-port-client';
const tick = async () => { for (let i=0; i<8; i++) await Promise.resolve(); };
function fixture() {
  const messages = new Set<(message: any) => void>(), disconnects = new Set<() => void>();
  const port: LookupPort = { name: LOOKUP_PORT, sender: { tab: { id: 7 }, frameId: 2 },
    onMessage: { addListener: fn => { messages.add(fn); }, removeListener: fn => { messages.delete(fn); } },
    onDisconnect: { addListener: fn => { disconnects.add(fn); }, removeListener: fn => { disconnects.delete(fn); } },
    postMessage: vi.fn(), disconnect: vi.fn() };
  const start = { type: 'start', requestId: 'request-a', sessionId: 'session-a', operation: 'GET_TRANSLATION', payload: { word: 'bank' } };
  return { port, start, send: (message: any) => { for (const fn of [...messages]) fn(message); }, disconnect: () => { for (const fn of [...disconnects]) fn(); }, messages, disconnects };
}
afterEach(() => vi.useRealTimers());
it('handles cancel-before-authorization and disconnect without starting provider work', async () => {
  const f = fixture(); let authorize!: () => void;
  const run = vi.fn(); const stop = vi.fn();
  handleLookupPort(f.port, { authorize: () => new Promise(resolve => { authorize = resolve; }), run, subscribePolicy: () => stop });
  f.send(f.start); f.send({ ...f.start, type: 'cancel' }); authorize(); await tick();
  expect(run).not.toHaveBeenCalled(); expect(stop).toHaveBeenCalledOnce(); expect(f.messages.size).toBe(0);
  expect(f.port.postMessage).not.toHaveBeenCalled();
});
it('does not accept foreign cancellation IDs and cleans up after a completed response', async () => {
  const f = fixture(); let resolve!: (value: unknown) => void;
  handleLookupPort(f.port, { authorize: async () => {}, run: () => new Promise(r => { resolve = r; }), subscribePolicy: () => () => {} });
  f.send(f.start); await tick(); f.send({ type: 'cancel', requestId: 'other', sessionId: 'other' });
  resolve('result'); await tick();
  expect(f.port.postMessage).toHaveBeenCalledWith({ type: 'result', requestId: 'request-a', sessionId: 'session-a', data: 'result' });
  expect(f.port.disconnect).toHaveBeenCalledOnce(); expect(f.disconnects.size).toBe(0);
});
it('aborts ongoing work on policy change, ignores its late completion and bounds abandoned ports', async () => {
  vi.useFakeTimers(); const f = fixture(); let recheck!: () => void, signal!: AbortSignal;
  const authorize = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new Error('disabled'));
  handleLookupPort(f.port, { authorize, run: async (_op, _payload, s) => { signal=s; return new Promise(() => {}); }, subscribePolicy: fn => { recheck=fn; return () => {}; } });
  f.send(f.start); await tick(); recheck(); await tick(); expect(signal.aborted).toBe(true);
  expect(f.port.postMessage).toHaveBeenCalledTimes(1);
  const idle=fixture(); handleLookupPort(idle.port, { authorize, run: vi.fn(), subscribePolicy: () => () => {} });
  await vi.advanceTimersByTimeAsync(22000); expect(idle.port.disconnect).toHaveBeenCalledOnce();
});
it('rejects duplicate starts and vocabulary writes on lookup ports', async () => {
  const f=fixture(), run=vi.fn(); handleLookupPort(f.port,{ authorize: async()=>{}, run, subscribePolicy:()=>()=>{} });
  f.send({ ...f.start, operation:'SAVE_WORD' }); await tick(); expect(run).not.toHaveBeenCalled(); expect(f.port.disconnect).toHaveBeenCalledOnce();
});

it('keeps cached previews subscribed until refresh completes and cancels refresh on disconnect', async () => {
  const f = fixture(); let publish!: (data: unknown) => void, signal!: AbortSignal, finish!: (data: unknown) => void;
  handleLookupPort(f.port, { authorize: async () => {}, subscribePolicy: () => () => {},
    run: async (_operation, _payload, s, cached) => { signal = s; publish = cached; return new Promise(resolve => { finish = resolve; }); } });
  f.send(f.start); await tick(); publish({ text: '缓存', source: 'magpie', target: 'zh-CN' });
  expect(f.port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'cached' }));
  expect(f.port.disconnect).not.toHaveBeenCalled(); expect(signal.aborted).toBe(false);
  f.disconnect(); expect(signal.aborted).toBe(true);
  publish({ text: '晚到' }); finish({ text: '晚到' }); await tick(); expect(f.port.postMessage).toHaveBeenCalledTimes(1);
});
