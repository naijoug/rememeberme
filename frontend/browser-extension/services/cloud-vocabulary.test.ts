import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { VocabularyDB } from './vocabulary-db';
import { CloudVocabulary } from './cloud-vocabulary';
import type { BackendClient, Connection } from './backend-client';
import { BackendError } from './backend-client';
import type { WireOperation, WireEntry } from '../../../contracts/api-v1';
const local = vi.hoisted(() => ({ values: new Map<string, unknown>() }));
vi.mock('wxt/utils/storage', () => ({ storage: {
  getItem: async (key: string) => structuredClone(local.values.get(key) ?? null),
  setItem: async (key: string, value: unknown) => { local.values.set(key, structuredClone(value)); },
} }));
const definition = { word: 'synthetic', phonetics: [], meanings: [] };
const legacy = [{ word: 'synthetic', count: 0.5, createdAt: 1, updatedAt: 2,
  history: [{ timestamp: 2, context: '<script>literal</script>', url: 'https://example.test/private', definition }] }];
beforeEach(() => local.values.clear());
function fixture() {
  const states = new Map<string, WireEntry>(), events = new Map<string, unknown[]>(), receipts = new Map<string, unknown>();
  const calls: string[] = []; let drop = false, expose = false, noOpHistory = false, epoch = 'synthetic-epoch';
  const connection: Connection = { origin: 'https://api.example.test', credentials: { userId: 'synthetic-user', deviceId: 'synthetic-device', accessToken: '', refreshToken: '', accessExpiresAtMs: 0, refreshExpiresAtMs: 0 } };
  const client = {
    current: async () => connection,
    request: async (path: string, _method?: string, _body?: unknown, _epoch?: string, frozen?: string) => {
      if (path === '/api/v1/me') return { userId: connection.credentials.userId, deviceId: connection.credentials.deviceId, epoch,
        sourceRevision: 0, syncContext: false, syncURLs: false, syncCapabilities: ['history-order-v1', 'history-version-v1', 'explicit-lifecycles-v1', 'translation-source-v2'] };
      if (path.includes('/sync/snapshot') || path.includes('/sync/changes')) {
        const boundary = expose ? [...states.values()].reduce((sum, entry) => sum + entry.version, 0) : 0;
        const after = Number(new URL('https://example.test' + path).searchParams.get('after'));
        return { epoch, boundary, nextCursor: boundary, hasMore: false,
          changes: expose ? [...states.values()].map((entry, index) => ({ entry: structuredClone(entry), sequence: boundary - states.size + index + 1 }))
            .filter(change => change.sequence > after) : [] };
      }
      if (path.includes('/history')) {
        const url = new URL('https://example.test' + path), id = decodeURIComponent(url.pathname.split('/')[4]);
        const all = events.get(id) ?? [], after = Number(url.searchParams.get('after')) || 0;
        return { entryVersion: states.get(id)?.version ?? 1, events: all.slice(after, after + 25),
          hasMore: after + 25 < all.length, nextCursor: String(Math.min(after + 25, all.length)) };
      }
      if (path === '/api/v1/sync/operations') {
        calls.push(frozen!);
        const op = JSON.parse(frozen!) as WireOperation;
        if (receipts.has(op.operationId)) return receipts.get(op.operationId);
        let entry = states.get(op.entryId);
        if (entry && ['reset', 'delete', 'legacyMerge'].includes(op.kind) && op.baseVersion !== entry.version) throw new BackendError(409, 'VERSION_CONFLICT');
        if (!entry) {
          entry = { id: op.entryId, word: String(op.payload.word), normalizedKey: String(op.payload.word), kind: 'word',
            count: op.payload.count as number, definition: op.payload.definition, notes: '', createdAtMs: 1, updatedAtMs: 2,
            version: 1, deleted: false, review: null, reviewVersion: 0, historyOrdering: 'retained' };
          states.set(op.entryId, entry);
        } else {
          if (!(op.kind === 'importHistory' && noOpHistory)) entry.version++;
          if (op.kind === 'record') {
            entry.count = (entry.count ?? 0) + 1;
            events.set(entry.id, [...events.get(entry.id) ?? [], op.payload.event]);
          }
          if (op.kind === 'legacyMerge') entry.count = (entry.count ?? 0) + Number(op.payload.countDelta);
          if (op.kind === 'reset') entry.count = 0;
          if (op.kind === 'delete') entry.deleted = true;
        }
        const result = structuredClone({ status: 'applied', operationId: op.operationId, cursor: 0, entry });
        receipts.set(op.operationId, result);
        if (drop) { drop = false; throw new TypeError('Synthetic committed response lost'); }
        return result;
      }
      throw new Error('Unexpected fixture request: ' + path);
    },
  } as unknown as BackendClient;
  return { client, calls, states, events, connection, drop: () => { drop = true; },
    expose: () => { expose = true; }, noOpHistory: () => { noOpHistory = true; },
    restore: () => { epoch = 'restored-epoch'; states.clear(); events.clear(); receipts.clear(); } };
}
it('retains the original local store and preserves legacy JSON, literal source data and reset semantics across restart', async () => {
  local.values.set('local:words', legacy);
  const name = 'fixture-' + crypto.randomUUID(), first = new CloudVocabulary(new VocabularyDB(name), fixture().client);
  expect(JSON.parse(await first.exportData())).toEqual(legacy);
  await first.resetCount('synthetic');
  const second = new CloudVocabulary(new VocabularyDB(name), fixture().client);
  expect((await second.getWord('synthetic'))?.count).toBe(0);
  expect((await second.getWord('synthetic'))?.history).toEqual(legacy[0].history);
  expect(local.values.get('local:words')).toEqual(legacy);
  await second.importData(JSON.stringify(legacy));
  expect((await second.getWord('synthetic'))?.count).toBe(0.5);
  expect((await second.getWord('synthetic'))?.history).toHaveLength(2);
});
it('freezes one request, retries it after reopening without another count increment and excludes source fields', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    local.values.set('local:words', legacy);
    const name = 'fixture-' + crypto.randomUUID(), api = fixture();
    let repository = new CloudVocabulary(new VocabularyDB(name), api.client);
    await repository.openAccount(true);
    expect(api.calls).toHaveLength(0);
    api.drop();
    await expect(repository.setEnabled(true)).rejects.toThrow(/response lost/);
    const frozen = api.calls[0];
    repository = new CloudVocabulary(new VocabularyDB(name), api.client);
    expect((await repository.status()).pending).toBe(2);
    vi.setSystemTime(Date.now() + 31_000);
    await repository.synchronize();
    expect(api.calls[1]).toBe(frozen);
    expect([...api.states.values()][0].count).toBe(0.5);
    await repository.saveWord('synthetic', definition, 'private context', 'https://example.test/private', 3);
    await repository.synchronize();
    expect([...api.states.values()][0].count).toBe(1.5);
    const record = JSON.parse(api.calls.at(-1)!);
    expect(record.payload.event).not.toHaveProperty('context'); expect(record.payload.event).not.toHaveProperty('url');
    await repository.resetCount('synthetic'); await repository.synchronize();
    expect([...api.states.values()][0].count).toBe(0);
    expect((await repository.getWord('synthetic'))?.history).toHaveLength(2);
    expect((await repository.status()).pending).toBe(0);
    await repository.useLocal();
    expect(JSON.parse(await repository.exportData())).toEqual(legacy);
  } finally { vi.useRealTimers(); }
});
it('rejects an invalid import before publishing any vocabulary change', async () => {
  local.values.set('local:words', legacy);
  const repository = new CloudVocabulary(new VocabularyDB('fixture-' + crypto.randomUUID()), fixture().client);
  await expect(repository.importData(JSON.stringify([...legacy, { word: 'bad', count: -1 }]))).rejects.toThrow();
  expect(JSON.parse(await repository.exportData())).toEqual(legacy);
});

it('retains the offline reset version through pull instead of overwriting another device count', async () => {
  local.values.set('local:words', legacy);
  const api = fixture(), repository = new CloudVocabulary(new VocabularyDB('fixture-' + crypto.randomUUID()), api.client);
  await repository.openAccount(true); await repository.setEnabled(true);
  const cloud = [...api.states.values()][0], observed = cloud.version;
  await repository.resetCount('synthetic');
  cloud.version++; cloud.count = 7; api.expose();
  await expect(repository.synchronize()).rejects.toThrow('VERSION_CONFLICT');
  expect(JSON.parse(api.calls.at(-1)!).baseVersion).toBe(observed);
  expect(cloud.count).toBe(7);
  expect((await repository.getWord('synthetic'))?.count).toBe(0);
  expect(await repository.status()).toMatchObject({ enabled: false, conflicts: 1 });
});

it('does not rebase a dependent reset over unseen changes acknowledged by an additive record', async () => {
  local.values.set('local:words', legacy);
  const api = fixture(), repository = new CloudVocabulary(new VocabularyDB('fixture-' + crypto.randomUUID()), api.client);
  await repository.openAccount(true); await repository.setEnabled(true);
  const cloud = [...api.states.values()][0], observed = cloud.version;
  await repository.saveWord('synthetic', definition, 'private', '', 3);
  await repository.resetCount('synthetic');
  cloud.version += 2; cloud.count = 7; api.expose();
  await expect(repository.synchronize()).rejects.toThrow('VERSION_CONFLICT');
  expect(JSON.parse(api.calls.at(-1)!).baseVersion).toBe(observed + 1);
  expect(cloud.count).toBe(8);
  expect((await repository.getWord('synthetic'))?.count).toBe(0);
});

it('archives the old epoch and exact queue before cloud recovery and retains exportable local sources', async () => {
  local.values.set('local:words', legacy);
  const name = 'fixture-' + crypto.randomUUID(), api = fixture();
  let repository = new CloudVocabulary(new VocabularyDB(name), api.client);
  await repository.openAccount(true);
  const original = await repository.exportData();
  api.restore();
  await expect(repository.setEnabled(true)).rejects.toThrow('server was restored');
  expect(await repository.status()).toMatchObject({ enabled: false, pending: 2, failure: 'SYNC_EPOCH_CHANGED' });
  await repository.archiveAndReloadCloud();
  const status = await repository.status();
  expect(status).toMatchObject({ enabled: false, pending: 0 });
  expect(status.archives).toHaveLength(1);
  expect(await repository.getAllWords()).toEqual([]);
  repository = new CloudVocabulary(new VocabularyDB(name), api.client);
  expect(await repository.exportArchive(status.archives[0].key)).toBe(original);
  expect(api.calls).toHaveLength(0);
  await repository.useLocal();
  expect(JSON.parse(await repository.exportData())).toEqual(legacy);
  await expect(repository.exportArchive(status.archives[0].key)).rejects.toThrow('different account');
});

it('stages paginated history across reopening and restores retained position independently of ID order', async () => {
  const api = fixture(), name = 'fixture-' + crypto.randomUUID();
  const remote: WireEntry = { id: 'remote', word: 'synthetic', normalizedKey: 'synthetic', kind: 'word',
    count: 0.5, definition, notes: '', createdAtMs: 1, updatedAtMs: 2, version: 1, deleted: false,
    review: null, reviewVersion: 0, historyOrdering: 'retained' };
  api.states.set(remote.id, remote); api.expose();
  const history = Array.from({ length: 275 }, (_, index) => ({ id: String(index).padStart(4, '0'),
    timestamp: 275 - index, definition, position: 275 - index }));
  api.events.set(remote.id, history);
  let repository = new CloudVocabulary(new VocabularyDB(name), api.client);
  await repository.openAccount();
  expect((await repository.getWord('synthetic'))?.history).toHaveLength(0);
  repository = new CloudVocabulary(new VocabularyDB(name), api.client);
  await repository.openAccount();
  const word = await repository.getWord('synthetic');
  expect(word?.history).toHaveLength(275); expect(word?.count).toBe(0.5);
  expect(word?.history.map(record => record.timestamp)).toEqual(Array.from({ length: 275 }, (_, index) => index + 1));
});

it('keeps two account partitions and anonymous vocabulary isolated without automatic upload', async () => {
  local.values.set('local:words', legacy);
  const api = fixture(), repository = new CloudVocabulary(new VocabularyDB('fixture-' + crypto.randomUUID()), api.client);
  await repository.openAccount();
  await repository.saveWord('first', { ...definition, word: 'first' }, '', '', 3);
  api.connection.credentials.userId = 'another-user';
  await repository.openAccount();
  expect(await repository.getAllWords()).toEqual([]);
  await repository.saveWord('second', { ...definition, word: 'second' }, '', '', 4);
  api.connection.credentials.userId = 'synthetic-user';
  await repository.openAccount();
  expect((await repository.getAllWords()).map(entry => entry.word)).toEqual(['first']);
  expect(api.calls).toHaveLength(0);
  await repository.useLocal(); expect(JSON.parse(await repository.exportData())).toEqual(legacy);
});

it('preserves new import history order and unknown legacy fields without trusting presentation metadata', async () => {
  const api = fixture(), repository = new CloudVocabulary(new VocabularyDB('fixture-' + crypto.randomUUID()), api.client);
  const imported = [{ ...legacy[0], id: 'legacy-extra-id', currentDefinition: 'untrusted extra field', countKnown: false,
    history: [{ ...legacy[0].history[0], timestamp: 10 }, { ...legacy[0].history[0], timestamp: 1 }] }];
  await repository.importData(JSON.stringify(imported));
  expect(JSON.parse(await repository.exportData())).toEqual(imported);
  const entry = (await repository.getAllWords())[0];
  expect(entry.id).not.toBe('legacy-extra-id'); expect(entry.currentDefinition).toBeUndefined(); expect(entry.countKnown).toBe(true);
  await repository.resetCount(entry.id!);
  expect((await repository.getWord(entry.id!))?.history.map(event => event.timestamp)).toEqual([10, 1]);
});

it('records against the existing normalized cloud spelling instead of creating a duplicate', async () => {
  const api = fixture(), repository = new CloudVocabulary(new VocabularyDB('fixture-' + crypto.randomUUID()), api.client);
  api.states.set('remote', { id: 'remote', word: 'Synthetic', normalizedKey: 'synthetic', kind: 'proper_noun',
    count: 0.5, definition, notes: '', createdAtMs: 1, updatedAtMs: 2, version: 1, deleted: false,
    review: null, reviewVersion: 0, historyOrdering: 'retained' });
  api.expose(); await repository.openAccount();
  await repository.saveWord('synthetic', definition, '', '', 3);
  await repository.setEnabled(true);
  expect(JSON.parse(api.calls.at(-1)!)).toMatchObject({ entryId: 'remote', kind: 'record' });
  expect(api.states.size).toBe(1);
});

it('propagates a no-op version adjustment through the whole causal queue before freezing later requests', async () => {
  local.values.set('local:words', legacy);
  const api = fixture(), repository = new CloudVocabulary(new VocabularyDB('fixture-' + crypto.randomUUID()), api.client);
  await repository.openAccount(true);
  await repository.resetCount('synthetic'); await repository.deleteWord('synthetic');
  api.noOpHistory();
  await repository.setEnabled(true);
  const reset = api.calls.map(body => JSON.parse(body)).find(op => op.kind === 'reset');
  const deletion = api.calls.map(body => JSON.parse(body)).find(op => op.kind === 'delete');
  expect(reset.baseVersion).toBe(1); expect(deletion.baseVersion).toBe(2);
  expect(await repository.status()).toMatchObject({ pending: 0, conflicts: 0 });
});
