import { afterEach, expect, it, vi } from 'vitest';
import { PracticeClient } from './practice-client';
import type { PracticeView } from '~/types/practice';
import type { PracticeAction } from '~/types/practice';
afterEach(() => vi.useRealTimers());
const view = { owner: 'anonymous', scope: 'boot:0', revision: 1, label: 'Device', session: null, blocked: null, available: { copy: 1, recall: 1, excluded: 0 } } as PracticeView;
function memory() {
  const values = new Map<string, string>();
  return { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } };
}
it('retains the frozen request across a lost response and restart; rebinds only scope', async () => {
  const persistence = memory(); const transport = vi.fn(async (_m: any): Promise<any> => { throw new Error('lost reply after commit'); });
  const first = new PracticeClient(transport, persistence);
  await expect(first.command(view, { kind: 'start', mode: 'recall', replace: false })).rejects.toThrow('lost reply');
  const original = structuredClone(first.pending!);
  const messages: any[] = [];
  const recovery = new PracticeClient(async m => { messages.push(m); return { success: true, data: { ...view, scope: 'new-boot:0', revision: 2 } }; }, persistence);
  await recovery.recover();
  expect(messages[1]).toEqual({ ...original, scope: 'new-boot:0' }); expect(recovery.pending).toBeNull();
  expect(new PracticeClient(transport, persistence).pending).toBeNull();
});
it('treats a timeout as unknown and does not retry or accept a late response', async () => {
  vi.useFakeTimers(); let resolve!: (v: any) => void;
  const transport = vi.fn(() => new Promise<any>(r => { resolve = r; }));
  const client = new PracticeClient(transport, memory());
  const result = client.command(view, { kind: 'clear' }); const failure = expect(result).rejects.toThrow('unknown');
  await vi.advanceTimersByTimeAsync(10_000); await failure;
  const frozen = client.pending; resolve({ success: true, data: view }); await Promise.resolve();
  expect(client.pending).toEqual(frozen); expect(transport).toHaveBeenCalledTimes(1);
});
it('never replays an old owner request into another account', async () => {
  const persistence = memory();
  const first = new PracticeClient(async () => undefined, persistence);
  await expect(first.command(view, { kind: 'clear' })).rejects.toThrow();
  const transport = vi.fn(async () => ({ success: true as const, data: { ...view, owner: 'account:other' } }));
  const next = new PracticeClient(transport, persistence); await next.recover();
  expect(transport).toHaveBeenCalledTimes(1); expect(next.pending).toBeNull();
});
it('freezes the action independently of caller mutations while the reply is unknown', async () => {
  const persistence = memory();
  let reject!: (error: Error) => void;
  const sent: any[] = [];
  let first = true;
  const client = new PracticeClient(async message => {
    sent.push(structuredClone(message));
    if (message.type === 'PRACTICE_COMMAND' && first) { first = false; return new Promise((_r, fail) => { reject = fail; }); }
    return { success: true, data: view };
  }, persistence);
  const action: PracticeAction = { kind: 'start', mode: 'recall', replace: false, entryIds: ['word-one'] };
  const save = client.command(view, action); const failure = expect(save).rejects.toThrow('lost');
  action.mode = 'copy'; action.entryIds![0] = 'word-two';
  reject(new Error('lost')); await failure; await client.recover();
  expect(sent[2]).toEqual(sent[0]);
});
