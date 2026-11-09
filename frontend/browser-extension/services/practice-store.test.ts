import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { VocabularyDB } from './vocabulary-db';
import { CloudVocabulary } from './cloud-vocabulary';
import type { BackendClient } from './backend-client';
import type { PracticeAction, PracticeCommand, PracticeRecord, PracticeView } from '~/types/practice';
import { practiceKey } from './practice-store';
import { handlePracticeMessage, parsePracticeMessage } from './practice-handler';
import type { WireEntry } from '../../../contracts/api-v1';
const local = vi.hoisted(() => ({ values: new Map<string, unknown>() }));
vi.mock('wxt/utils/storage', () => ({ storage: { getItem: async (key: string) => structuredClone(local.values.get(key) ?? null) } }));
const definition = (word: string) => ({ word, phonetics: [], meanings: [], translation: { text: '合成测试释义', source: 'magpie', target: 'zh-CN' } });
const fixtureWords = ['apple', "can't", 'well-known'].map(word => ({ word, count: 3, createdAt: 1, updatedAt: 2,
  history: [{ timestamp: 2, context: 'Private source', url: 'https://private.test', definition: definition(word) }] }));
beforeEach(() => { local.values.clear(); local.values.set('local:words', fixtureWords); });
function fixture() {
  const db = new VocabularyDB('practice-test-' + crypto.randomUUID());
  const client = { current: vi.fn(async () => null), request: vi.fn(async () => { throw new Error('Network must not run'); }) };
  return { db, client, repo: new CloudVocabulary(db, client as unknown as BackendClient) };
}
const get = (repo: CloudVocabulary) => repo.practice({ type: 'PRACTICE_GET' });
const command = (v: PracticeView, action: PracticeAction): PracticeCommand => ({ type: 'PRACTICE_COMMAND', requestId: crypto.randomUUID(), owner: v.owner, scope: v.scope, revision: v.revision, action });
const start = (v: PracticeView) => command(v, { kind: 'start', mode: 'recall', replace: false });
it('commits a practice receipt and cursor exactly once while preserving vocabulary JSON/outbox', async () => {
  const { repo, db, client } = fixture();
  const before = await repo.exportData(), partition = await db.read('anonymous');
  let view = await get(repo); const create = start(view);
  view = await repo.practice(create); expect(await repo.practice(create)).toEqual(view);
  const turn = view.session!.current!;
  expect(fixtureWords.map(w => w.word)).toContain(turn.word); expect(turn.meaning).toBe('合成测试释义'); expect(JSON.stringify(view)).not.toContain('private.test');
  const answer = command(view, { kind: 'answer', turnId: turn.turnId, answer: 'wrong', assisted: false, skipped: false, elapsedMs: 20 });
  view = await repo.practice(answer); expect(await repo.practice(answer)).toEqual(view);
  await expect(repo.practice({ ...answer, action: { ...answer.action, answer: 'different' } as PracticeAction })).rejects.toThrow('reused');
  expect(view.session!.summary.answered).toBe(1);
  expect(await repo.exportData()).toBe(before); expect(await db.read('anonymous')).toEqual(partition);
  expect(client.request).not.toHaveBeenCalled();
});
it('keeps hints and marks unfinished questions interrupted across worker restart', async () => {
  const { repo, db, client } = fixture(); let view = await repo.practice(start(await get(repo)));
  view = await repo.practice(command(view, { kind: 'reveal', turnId: view.session!.current!.turnId }));
  const old = command(view, { kind: 'resume', sessionId: view.session!.id });
  const reopened = new CloudVocabulary(db, client as unknown as BackendClient);
  await expect(reopened.practice(old)).rejects.toThrow('background changed');
  const fresh = await get(reopened); expect(fresh.session!.current!.hinted).toBe(true);
  const resumed = await reopened.practice({ ...old, scope: fresh.scope });
  expect(resumed.session!.current!.interrupted).toBe(true);
});
it('rejects stale tabs, retains reset questions, atomically removes deleted words and never inherits a recreated ID', async () => {
  const { repo, db } = fixture(); let view = await repo.practice(start(await get(repo)));
  // Inspect the durable entry ID to verify lifecycle fencing.
  const record = await db.read<PracticeRecord>(practiceKey('anonymous'));
  const current = record!.session!.queue[0].entryId, word = record!.session!.words.find(w => w.id === current)!.word;
  await repo.resetCount(current); expect((await get(repo)).revision).toBe(view.revision);
  const stale = command(view, { kind: 'answer', turnId: view.session!.current!.turnId, answer: word, assisted: false, skipped: false, elapsedMs: 0 });
  await repo.deleteWord(current); await expect(repo.practice(stale)).rejects.toThrow('changed');
  const after = await db.read<PracticeRecord>(practiceKey('anonymous'));
  expect(JSON.stringify(after)).not.toContain(current); expect(after!.session!.invalidated).toBe(1);
  await repo.saveWord(word, definition(word) as any, '', '');
  expect((await get(repo)).session!.summary.total).toBe(2);
});
it('rolls back all transaction writes on validation failure', async () => {
  const { db } = fixture(); await db.writeMany([['a', 1], ['b', 2]]);
  await expect(db.update(['a', 'b'], values => { values.set('a', 9); throw new Error('synthetic abort'); })).rejects.toThrow('synthetic abort');
  expect(await db.read('a')).toBe(1); expect(await db.read('b')).toBe(2);
});
it.each(['word', 'queue', 'receipt', 'attempt'])('a malformed nested %s cannot block vocabulary deletion', async kind => {
  const { repo, db } = fixture(); const view = await repo.practice(start(await get(repo)));
  const record = await db.read<any>(practiceKey(view.owner));
  if (kind === 'word') record.session.words[0] = null;
  if (kind === 'queue') record.session.queue[0] = null;
  if (kind === 'receipt') record.receipts[0] = null;
  if (kind === 'attempt') record.session.attempts = [null];
  await db.write(practiceKey(view.owner), record);
  const word = (await repo.getAllWords())[0];
  await expect(repo.deleteWord(word.id!)).resolves.toBeUndefined();
  expect(await repo.getWord(word.id!)).toBeNull();
  expect((await get(repo)).session).toBeNull();
  expect((await get(repo)).revision).toBeGreaterThan(view.revision);
});
it('accepts early records without activation IDs and fences old requests after corrupted-copy cleanup', async () => {
  const { repo, db } = fixture(); const create = start(await get(repo));
  const view = await repo.practice(create);
  const record = await db.read<any>(practiceKey(view.owner));
  for (const turn of record.session.queue) delete turn.activationId;
  await db.write(practiceKey(view.owner), record);
  const legacy = await get(repo); expect(legacy.session!.current!.activationId).toBe(legacy.session!.current!.turnId);
  record.session.words[0] = null; await db.write(practiceKey(view.owner), record);
  await repo.resetCount((await repo.getAllWords())[0].id!);
  await expect(repo.practice(create)).rejects.toThrow('changed');
});
it('offers confirmed repair for damaged progress without mutating it on read or changing vocabulary', async () => {
  const { repo, db } = fixture(); const view = await repo.practice(start(await get(repo)));
  const raw = await db.read<any>(practiceKey(view.owner)); raw.session.words[0] = null;
  await db.write(practiceKey(view.owner), raw); const original = await repo.exportData();
  const damaged = await get(repo); expect(damaged.corrupt).toBe(true); expect(damaged.blocked).toContain('Clear practice records');
  expect(await db.read(practiceKey(view.owner))).toEqual(raw);
  await expect(repo.practice(start(damaged))).rejects.toThrow('damaged');
  const cleared = await repo.practice(command(damaged, { kind: 'clear' }));
  expect(cleared.session).toBeNull(); expect(cleared.corrupt).toBeUndefined();
  await expect(repo.practice(start(cleared))).resolves.toBeTruthy(); expect(await repo.exportData()).toBe(original);
});
it.each([{ unexpected: 'legacy metadata' }, 'x'.repeat(100), 42])('keeps legacy source metadata in exports but normalizes the practice label (%j)', async source => {
  const { repo } = fixture();
  await repo.importData(JSON.stringify([{ word: 'legacyword', count: 0, createdAt: 1, updatedAt: 1, history: [{ timestamp: 1, context: '', url: '',
    definition: { word: 'legacyword', source, phonetics: [], meanings: [{ partOfSpeech: 'n', definitions: [{ definition: 'A saved meaning' }] }] } }] }]));
  const before = await repo.exportData(), entry = (await repo.getAllWords()).find(w => w.word === 'legacyword')!;
  const view = await repo.practice(command(await get(repo), { kind: 'start', mode: 'recall', replace: false, entryIds: [entry.id!] }));
  expect(view.session!.current!.source).toBe('saved');
  expect((await get(repo)).session!.id).toBe(view.session!.id); expect(await repo.exportData()).toBe(before);
});
it('does not allow content frames, nested extension frames or malformed commands', async () => {
  const { repo } = fixture(), root = 'chrome-extension://fixture/';
  for (const sender of [{ url: 'https://example.test/' }, { url: root + 'practice.html', frameId: 1 }, { url: root + 'practice.html.evil' }]) {
    expect((await handlePracticeMessage({ type: 'PRACTICE_GET' }, sender, root, repo))?.success).toBe(false);
  }
  expect((await handlePracticeMessage({ type: 'PRACTICE_GET' }, { url: root + 'practice.html', frameId: 0 }, root, repo))?.success).toBe(true);
  const v = await get(repo);
  expect(parsePracticeMessage(command(v, { kind: 'start', mode: 'copy', replace: false, entryIds: ['remote_entry', 'x'.repeat(200)] }))).toBeTruthy();
  for (const action of [{ kind: 'answer', elapsedMs: Infinity }, { kind: 'start', mode: 'recall', replace: false, url: 'https://private.test' }]) {
    expect(() => parsePracticeMessage(command(v, action as PracticeAction))).toThrow('Invalid');
  }
});

async function accountFixture() {
  const db = new VocabularyDB('practice-account-' + crypto.randomUUID());
  let epoch = 'epoch-one';
  const connection = { origin: 'https://fixture.test', credentials: { userId: 'fixture-user', deviceId: 'fixture-device' } };
  let remote: WireEntry = { id: 'remote-word', word: 'apple', normalizedKey: 'apple', kind: 'word', count: 1,
    definition: definition('apple'), notes: '', createdAtMs: 1, updatedAtMs: 1, version: 1, deleted: false, review: null, reviewVersion: 0 };
  const client = { current: async () => connection, request: vi.fn(async (path: string) => {
    if (path === '/api/v1/me') return { userId: connection.credentials.userId, deviceId: connection.credentials.deviceId,
      displayName: 'fixture-user', epoch, syncCapabilities: ['history-order-v1', 'history-version-v1', 'explicit-lifecycles-v1', 'translation-source-v2'] };
    if (path.includes('/sync/')) {
      const after = Number(new URL('https://fixture.test' + path).searchParams.get('after'));
      return { epoch, boundary: remote.version, nextCursor: remote.version, hasMore: false,
        changes: after < remote.version ? [{ sequence: remote.version, entry: structuredClone(remote) }] : [] };
    }
    if (path.includes('/history')) return { entryVersion: remote.version, events: [], hasMore: false, nextCursor: '0' };
    throw new Error('Unexpected request: ' + path);
  }) } as unknown as BackendClient;
  const repo = new CloudVocabulary(db, client);
  await repo.openAccount(false); // Completed read-only download; no mutation endpoint.
  return { repo, db, client, connection, remote: () => remote,
    change: (patch: Partial<WireEntry>) => { remote = { ...remote, ...patch, version: remote.version + 1 }; },
    restore: () => { epoch = 'epoch-two'; } };
}
it('practices account data locally and invalidates remote edits/deletes even with pending operations', async () => {
  const f = await accountFixture(); let view = await f.repo.practice(start(await get(f.repo)));
  expect(view.label).toContain('fixture-user'); const initialRequests = (f.client.request as any).mock.calls.length;
  const before = await f.repo.exportData();
  view = await f.repo.practice(command(view, { kind: 'reveal', turnId: view.session!.current!.turnId }));
  expect(await f.repo.exportData()).toBe(before); expect((f.client.request as any).mock.calls).toHaveLength(initialRequests);
  // A pending local record prevents entry.deleted from directly reflecting the tombstone.
  await f.repo.saveWord('apple', definition('apple') as any, '', '');
  f.change({ deleted: true }); await f.repo.synchronize(true);
  const partition = await f.db.read<any>(view.owner);
  expect(partition.entries[0].deleted).toBe(false); expect(partition.entries[0].base.deleted).toBe(true);
  const next = await get(f.repo); expect(next.session!.summary.total).toBe(0);
  expect(JSON.stringify(await f.db.read(practiceKey(view.owner)))).not.toContain('apple');
});
it('isolates owners, rejects stale scope after a switch back, and clears old-epoch sessions', async () => {
  const f = await accountFixture(); const account = await f.repo.practice(start(await get(f.repo)));
  const stale = command(account, { kind: 'resume', sessionId: account.session!.id });
  await f.repo.useLocal(); const localView = await get(f.repo);
  expect(localView.owner).toBe('anonymous'); expect(localView.session).toBeNull();
  const localSession = await f.repo.practice(start(localView));
  await f.repo.openAccount(false); await expect(f.repo.practice(stale)).rejects.toThrow('changed');
  expect((await get(f.repo)).session!.id).toBe(account.session!.id);
  f.restore(); await expect(f.repo.synchronize(true)).rejects.toThrow('restored');
  expect((await get(f.repo)).blocked).toContain('restored'); expect((await get(f.repo)).session).toBeNull();
  await f.repo.useLocal(); expect((await get(f.repo)).session!.id).toBe(localSession.session!.id);
});
it('does not invalidate a question for count-only sync, but removes changed meanings', async () => {
  const f = await accountFixture(); const first = await f.repo.practice(start(await get(f.repo)));
  f.change({ count: 9, updatedAtMs: 3 }); await f.repo.synchronize(true);
  expect((await get(f.repo)).revision).toBe(first.revision);
  f.change({ definition: { ...definition('apple'), translation: { text: 'Changed meaning', source: 'magpie', target: 'zh-CN' } } });
  await f.repo.synchronize(true); expect((await get(f.repo)).session!.invalidated).toBe(1);
});
it('blocks incomplete snapshots, permits cached offline practice, and keeps same-ID owners separate', async () => {
  const f = await accountFixture(); const initial = await get(f.repo), owner = initial.owner;
  const state = await f.db.read<any>(owner);
  await f.db.write(owner, { ...state, snapshot: true });
  const downloading = await get(f.repo); expect(downloading.blocked).toContain('downloading');
  await expect(f.repo.practice(start(downloading))).rejects.toThrow('downloading');
  await f.db.write(owner, { ...state, failure: 'Network disconnected' });
  const offline = await get(f.repo); expect(offline.blocked).toBeNull();
  const account = await f.repo.practice(start(offline));
  await f.repo.useLocal();
  const local = await f.db.read<any>('anonymous'); local.entries[0].id = f.remote().id; await f.db.write('anonymous', local);
  const separate = await f.repo.practice(start(await get(f.repo)));
  expect(separate.session!.id).not.toBe(account.session!.id);
  await f.repo.openAccount(false); expect((await get(f.repo)).session!.id).toBe(account.session!.id);
});
it('leaves no partial answer after a storage failure and permits the same request to recover', async () => {
  const { repo, db } = fixture(); const view = await repo.practice(start(await get(repo)));
  const answer = command(view, { kind: 'answer', turnId: view.session!.current!.turnId, answer: '', skipped: true, assisted: false, elapsedMs: 2 });
  const before = await db.read(practiceKey(view.owner));
  const fault = vi.spyOn(db, 'update').mockRejectedValueOnce(new Error('Synthetic quota failure'));
  await expect(repo.practice(answer)).rejects.toThrow('quota'); expect(await db.read(practiceKey(view.owner))).toEqual(before);
  fault.mockRestore(); expect((await repo.practice(answer)).session!.summary.answered).toBe(1);
});
