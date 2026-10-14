import { storage } from 'wxt/utils/storage';
import { BackendError, backendClient, type BackendClient } from './backend-client';
import { VocabularyDB } from './vocabulary-db';
import { StorageService } from './storage';
import { isDefinition } from './definition-utils';
import type { Definition, WordEntry } from '~/types';
import { MAX_BODY_BYTES, MAX_EVENTS, parseEntry, type WireEntry, type WireOperation, type WireEncounter, type OperationResult, type Json } from '../../../contracts/api-v1';

interface Entry { id: string; value: WordEntry; events: string[]; deleted: boolean; base?: WireEntry }
interface Pending {
  operation: WireOperation; dependsOn?: string; observedVersion?: number; versionFloor?: number;
  body?: string; epoch?: string; error?: string; retryAt?: number;
}
interface Partition {
  schema: 2; entries: Entry[]; outbox: Pending[]; enabled: boolean; epoch?: string;
  cursor: number; boundary?: number; snapshot: boolean; history: string[]; failure?: string;
  original?: { json: string; digest: string };
  historyScan?: { entryId: string; version: number; after: string; events: RemoteEvent[] };
  archives?: { key: string; createdAt: number }[];
}
interface RemoteEvent { id: string; timestamp: number; definition: Definition; position: number; context?: string; url?: string }
interface Account { userId: string; deviceId: string; epoch: string; syncCapabilities: string[]; sourceRevision: number; syncContext: boolean; syncURLs: boolean }
interface VocabularyScope { owner: string; generation: number }
export interface CloudStatus {
  connected: boolean; origin?: string; owner: string; enabled: boolean; pending: number; conflicts: number;
  failure?: string; localWords: number; archives: { key: string; createdAt: number }[];
}
const parser = new StorageService();
const emptyDefinition = (word: string): Definition => ({ word, phonetics: [], meanings: [] });
const normalized = (word: string) => word.trim().toLowerCase();
async function sha(value: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map(value => value.toString(16).padStart(2, '0')).join(''); }
const json = (value: unknown) => value as Json;
const fresh = (): Partition => ({ schema: 2, entries: [], outbox: [], enabled: false, cursor: 0, snapshot: true, history: [] });
const encoder = new TextEncoder();
const operationBytes = (operation: WireOperation) => encoder.encode(JSON.stringify(operation)).byteLength;
function requireUploadSize(operation: WireOperation) {
  if (operationBytes(operation) > MAX_BODY_BYTES) throw new Error('This entry or history record is too large to sync. Keep it in local vocabulary or reduce its definition before copying or importing it into an account.');
}

export class CloudVocabulary {
  private queue: Promise<unknown> = Promise.resolve();
  private owner = 'anonymous';
  private generation = 0;
  private ready?: Promise<void>;
  private flight?: Promise<void>;
  constructor(private database = new VocabularyDB(), private client: BackendClient = backendClient) {}
  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action);
    this.queue = result.catch(() => {}); return result;
  }
  private async initialize() {
    await (this.ready ??= (async () => {
      if (!(await this.database.read('anonymous'))) {
        const words = await storage.getItem<WordEntry[]>('local:words') ?? [];
        const original = JSON.stringify(words), digest = await sha(original);
        const validated = parser.parseImportedWords(original);
        const state = fresh(); state.original = { json: original, digest };
        for (const [index, value] of validated.entries()) state.entries.push({
          id: 'entry:' + await sha(JSON.stringify(['legacy-entry-v1', digest, index])), value, deleted: false,
          events: await Promise.all(value.history.map((_, position) => sha(JSON.stringify(['legacy-encounter-v1', digest, index, position])).then(value => 'encounter:' + value))),
        });
        await this.database.initialize('anonymous', state);
      }
      const selected = await this.database.read<string>('selected');
      const connection = await this.client.current();
      const expected = connection ? 'account:' + await sha(connection.origin) + ':' + connection.credentials.userId : undefined;
      if (selected && selected === expected) this.owner = selected;
    })());
  }
  private async state(owner?: string): Promise<Partition> {
    await this.initialize();
    const state = await this.database.read<Partition>(owner ?? this.owner) ?? fresh();
    if (state.schema !== 2 || !Array.isArray(state.entries) || !Array.isArray(state.outbox)
      || !Array.isArray(state.history) || typeof state.enabled !== 'boolean' || typeof state.snapshot !== 'boolean'
      || !Number.isSafeInteger(state.cursor) || state.cursor < 0) throw new Error('Unsupported or damaged vocabulary partition. The original data was retained.');
    return state;
  }
  private add(state: Partition, operation: WireOperation) {
    if (this.owner === 'anonymous') return;
    const predecessor = state.outbox.filter(item => item.operation.entryId === operation.entryId).at(-1);
    const versionFloor = predecessor?.versionFloor ?? state.entries.find(entry => entry.id === operation.entryId)?.base?.version ?? 0;
    const observedVersion = predecessor ? (predecessor.observedVersion ?? versionFloor) + 1 : versionFloor;
    if (['reset', 'delete', 'legacyMerge', 'edit'].includes(operation.kind)) operation.baseVersion = observedVersion;
    requireUploadSize(operation);
    state.outbox.push({ operation, observedVersion, versionFloor,
      ...(predecessor ? { dependsOn: predecessor.operation.operationId } : {}) });
  }
  private addHistory(state: Partition, entryId: string, events: WireEncounter[]) {
    if (this.owner === 'anonymous') return;
    const chunk = (values: WireEncounter[]): WireOperation => ({ operationId: crypto.randomUUID(), entryId, kind: 'importHistory', payload: { events: json(values) } });
    let operation = chunk([]), values: WireEncounter[] = [];
    for (const event of events) {
      const candidate = { ...operation, payload: { events: json([...values, event]) } };
      if (values.length === MAX_EVENTS || operationBytes(candidate) > MAX_BODY_BYTES) {
        if (values.length) this.add(state, operation);
        values = [event]; operation = chunk(values);
        // Reject a single oversize event before any entries/outbox are published.
        requireUploadSize(operation);
      } else { values.push(event); operation = candidate; }
    }
    if (values.length) this.add(state, operation);
  }
  async getAllWords(): Promise<WordEntry[]> {
    return this.serialize(async () => {
      const state = await this.state();
      return state.entries.filter(entry => !entry.deleted).map(entry => ({
        ...structuredClone(entry.value), id: entry.id,
          currentDefinition: state.outbox.filter(item => item.operation.entryId === entry.id
            && ['create', 'seed', 'edit', 'legacyMerge'].includes(item.operation.kind))
            .at(-1)?.operation.payload.definition ?? entry.base?.definition,
          countKnown: entry.base?.count !== null || entry.value.count !== 0
            || state.outbox.some(item => item.operation.entryId === entry.id && ['reset', 'legacyMerge'].includes(item.operation.kind)),
      } as WordEntry));
    });
  }
  async getWord(word: string): Promise<WordEntry | null> {
    const words = await this.getAllWords();
    const exact = words.find(entry => entry.id === word); if (exact) return exact;
    const matches = words.filter(entry => entry.word.toLowerCase() === word.trim().toLowerCase());
    if (matches.length > 1) throw new Error('This account has separate copies of this word. Choose one in the vocabulary popup.');
    return matches[0] ?? null;
  }
  async captureWriter(): Promise<Pick<CloudVocabulary, 'saveWord'>> {
    return this.serialize(async () => {
      await this.initialize();
      const scope = { owner: this.owner, generation: this.generation };
      return { saveWord: (word, definition, context, url, recordedAt = Date.now()) => this.saveScopedWord(word, definition, context, url, recordedAt, scope) };
    });
  }
  async saveWord(word: string, definition: Definition, context: string, url: string, recordedAt = Date.now()): Promise<WordEntry> {
    return this.saveScopedWord(word, definition, context, url, recordedAt);
  }
  private async saveScopedWord(word: string, definition: Definition, context: string, url: string, recordedAt: number, scope?: VocabularyScope): Promise<WordEntry> {
    return this.serialize(async () => {
      const state = await this.state(); const key = normalized(word);
      if (scope && (scope.owner !== this.owner || scope.generation !== this.generation)) throw new Error('The selected vocabulary changed. Please record the word again.');
      if (state.entries.filter(entry => !entry.deleted && normalized(entry.value.word) === key).length > 1) {
        throw new Error('This account has separate copies of this word. Choose a copy in the macOS client before recording.');
      }
      let entry = state.entries.find(entry => !entry.deleted && normalized(entry.value.word) === key);
      if (!entry) {
        entry = { id: crypto.randomUUID(), events: [], deleted: false, value: { word: key, count: 0, history: [], createdAt: recordedAt, updatedAt: recordedAt } };
        state.entries.push(entry);
        this.add(state, { operationId: crypto.randomUUID(), entryId: entry.id, kind: 'create',
          payload: { word: key, kind: 'word', count: 0, definition: json(definition), notes: '', createdAtMs: recordedAt, updatedAtMs: recordedAt } });
      }
      const count = entry.value.count + 1;
      if (!Number.isFinite(count) || count <= entry.value.count) throw new Error('This count cannot be incremented without losing precision.');
      const event = crypto.randomUUID();
      entry.value.count = count; entry.value.updatedAt = recordedAt;
      entry.value.history.push({ timestamp: recordedAt, definition, context, url }); entry.events.push(event);
      this.add(state, { operationId: crypto.randomUUID(), entryId: entry.id, kind: 'record',
        payload: { event: { id: event, timestamp: recordedAt, definition: json(definition) } } });
      await this.database.write(this.owner, state);
      return structuredClone(entry.value);
    });
  }
  async deleteWord(word: string) { return this.mutate(word, 'delete'); }
  async resetCount(word: string) { return this.mutate(word, 'reset'); }
  private async mutate(word: string, kind: 'delete' | 'reset') {
    return this.serialize(async () => {
      const state = await this.state();
      const matches = state.entries.filter(entry => !entry.deleted && (entry.id === word || normalized(entry.value.word) === normalized(word)));
      if (matches.length > 1) throw new Error('Choose the specific word copy in the vocabulary popup.');
      const entry = matches[0];
      if (!entry) throw new Error('Word not found.');
      if (kind === 'delete') entry.deleted = true; else entry.value.count = 0;
      entry.value.updatedAt = Date.now();
      this.add(state, { operationId: crypto.randomUUID(), entryId: entry.id, kind, payload: {} });
      await this.database.write(this.owner, state);
    });
  }
  async exportData(): Promise<string> {
    return this.serialize(async () => JSON.stringify((await this.state()).entries.filter(entry => !entry.deleted).map(entry => entry.value), null, 2));
  }
  async importData(data: string): Promise<void> {
    const imported = parser.parseImportedWords(data);
    return this.serialize(async () => {
      const state = await this.state();
      for (const value of imported) {
        if (state.entries.filter(entry => !entry.deleted && normalized(entry.value.word) === value.word).length > 1) throw new Error('Import has multiple account word copies; resolve them in the macOS client first.');
        let entry = state.entries.find(entry => !entry.deleted && normalized(entry.value.word) === value.word);
        const merging = Boolean(entry);
        if (entry) {
          const count = entry.value.count + value.count;
          if (!Number.isFinite(count)) throw new Error('Imported count exceeds the supported range.');
          entry.value.count = count; entry.value.updatedAt = Date.now();
          this.add(state, { operationId: crypto.randomUUID(), entryId: entry.id, kind: 'legacyMerge',
            payload: { countDelta: value.count, definition: json(value.history.at(-1)?.definition ?? emptyDefinition(value.word)) } });
        } else {
          entry = { id: crypto.randomUUID(), events: [], deleted: false, value: { ...value, history: [] } };
          state.entries.push(entry);
          this.add(state, { operationId: crypto.randomUUID(), entryId: entry.id, kind: 'create', payload: {
            word: value.word, kind: 'word', count: value.count, definition: json(value.history.at(-1)?.definition ?? emptyDefinition(value.word)),
            notes: '', createdAtMs: value.createdAt, updatedAtMs: value.updatedAt,
          } });
        }
        const events = value.history.map(record => {
          const id = crypto.randomUUID(); entry!.events.push(id); entry!.value.history.push(record);
          return { id, timestamp: record.timestamp, definition: json(record.definition) };
        });
        this.addHistory(state, entry.id, events);
        if (merging) {
          const retained = entry.value.history.map((record, index) => ({ record, event: entry!.events[index] })).sort((a, b) => a.record.timestamp - b.record.timestamp);
          entry.value.history = retained.map(value => value.record); entry.events = retained.map(value => value.event);
        }
      }
      await this.database.write(this.owner, state);
    });
  }
  async status(): Promise<CloudStatus> {
    return this.serialize(async () => {
      const state = await this.state(), connection = await this.client.current();
      return { connected: Boolean(connection), origin: connection?.origin, owner: this.owner, enabled: state.enabled,
        pending: state.outbox.length, conflicts: state.outbox.filter(item => item.error).length, failure: state.failure,
        localWords: (await this.state('anonymous')).entries.filter(entry => !entry.deleted).length, archives: state.archives ?? [] };
    });
  }
  async connect(origin: string): Promise<void> {
    await this.pause(); await this.serialize(async () => { this.generation++; }); await this.client.signIn(origin);
  }
  async pause(): Promise<void> {
    await this.serialize(async () => { const state = await this.state(); state.enabled = false; await this.database.write(this.owner, state); });
  }
  async disconnect(): Promise<void> {
    await this.pause(); await this.serialize(async () => { this.generation++; }); await this.client.disconnect();
    await this.serialize(async () => { await this.database.write('selected', 'anonymous'); this.owner = 'anonymous'; });
  }
  async openAccount(copyLocal = false): Promise<void> {
    const connection = await this.client.current(); if (!connection) throw new Error('Connect an account first.');
    const owner = 'account:' + await sha(connection.origin) + ':' + connection.credentials.userId;
    await this.serialize(async () => {
      await this.initialize();
      if (this.owner !== owner) {
        const previous = await this.state(); previous.enabled = false; await this.database.write(this.owner, previous);
      }
      await this.database.initialize(owner, fresh()); await this.database.write('selected', owner);
      if (this.owner !== owner) { this.owner = owner; this.generation++; }
    });
    await this.synchronize(true);
    if (copyLocal) await this.serialize(async () => {
      const state = await this.state(), local = await this.state('anonymous');
      if (state.snapshot || state.boundary !== undefined || state.history.length) throw new Error('The account is still downloading. Open the account again to continue before copying local vocabulary.');
      if (state.outbox.length) throw new Error('Complete or resolve pending account changes before copying local vocabulary.');
      const collisions = local.entries.filter(entry => !entry.deleted && state.entries.some(remote => remote.id === entry.id || (!remote.deleted && normalized(remote.value.word) === normalized(entry.value.word))));
      if (collisions.length) throw new Error(`${collisions.length} local words already exist in this account. Export the local vocabulary and use an explicit import to add its counts.`);
      const currentJSON = JSON.stringify(local.entries.filter(entry => !entry.deleted).map(entry => entry.value));
      const baseline = local.original && JSON.stringify(parser.parseImportedWords(local.original.json)) === currentJSON;
      const digest = baseline ? local.original!.digest : await sha(currentJSON);
      for (const source of local.entries.filter(entry => !entry.deleted)) {
        const entry = structuredClone(source); delete entry.base; state.entries.push(entry);
        this.add(state, { operationId: baseline ? 'seed:' + await sha(JSON.stringify(['legacy-seed-v1', digest, entry.value.word])) : crypto.randomUUID(),
          entryId: entry.id, kind: baseline ? 'seed' : 'create', payload: { word: entry.value.word, kind: 'word', count: entry.value.count,
            definition: json(entry.value.history.at(-1)?.definition ?? emptyDefinition(entry.value.word)), notes: '',
            createdAtMs: entry.value.createdAt, updatedAtMs: entry.value.updatedAt, ...(baseline ? { sourceDigest: digest } : {}) } });
        const events = entry.value.history.map((record, index) => ({ id: entry.events[index], timestamp: record.timestamp, definition: json(record.definition) }));
        this.addHistory(state, entry.id, events);
      }
      await this.database.write(this.owner, state);
    });
  }
  async useLocal(): Promise<void> {
    await this.pause();
    await this.serialize(async () => {
      await this.database.write('selected', 'anonymous');
      if (this.owner !== 'anonymous') { this.owner = 'anonymous'; this.generation++; }
    });
  }
  async archiveAndReloadCloud(): Promise<void> {
    await this.pause();
    if (this.flight) await this.flight.catch(() => {});
    const connection = await this.client.current();
    if (!connection) throw new Error('Connect your backend account first.');
    const owner = 'account:' + await sha(connection.origin) + ':' + connection.credentials.userId;
    const account = await this.client.request<Account>('/api/v1/me');
    if (account.userId !== connection.credentials.userId || account.deviceId !== connection.credentials.deviceId
      || typeof account.epoch !== 'string' || !account.epoch) throw new Error('Invalid account identity.');
    await this.serialize(async () => {
      if (this.owner !== owner) throw new Error('Open the connected account before recovery.');
      const previous = await this.state(owner), next = fresh();
      const archive = { key: 'recovery:' + owner + ':' + crypto.randomUUID(), createdAt: Date.now() };
      next.epoch = account.epoch; next.archives = [...previous.archives ?? [], archive];
      // Preserve vocabulary and frozen requests in the same commit as the new checkpoint.
      await this.database.writeMany([[archive.key, previous], [owner, next]]);
      this.generation++;
    });
    await this.synchronize(true);
  }
  async exportArchive(key: string): Promise<string> {
    return this.serialize(async () => {
      const current = await this.state();
      if (!current.archives?.some(archive => archive.key === key)) throw new Error('This recovery copy belongs to a different account.');
      const archived = await this.database.read<Partition>(key);
      if (!archived) throw new Error('Recovery copy is unavailable.');
      return JSON.stringify(archived.entries.filter(entry => !entry.deleted).map(entry => entry.value), null, 2);
    });
  }
  async setEnabled(enabled: boolean): Promise<void> {
    const connection = await this.client.current();
    const expected = connection ? 'account:' + await sha(connection.origin) + ':' + connection.credentials.userId : '';
    await this.serialize(async () => {
      const state = await this.state();
      if (enabled && (this.owner !== expected || state.failure === 'SYNC_EPOCH_CHANGED' || state.outbox.some(item => item.error))) throw new Error('Open your account and resolve conflicts before enabling sync.');
      state.enabled = enabled; await this.database.write(this.owner, state);
    });
    if (enabled) await this.synchronize();
  }
  async synchronize(readOnly = false): Promise<void> {
    if (this.flight) return this.flight;
    this.flight = this.perform(readOnly).finally(() => { this.flight = undefined; });
    return this.flight;
  }
  private async perform(readOnly: boolean): Promise<void> {
    await this.initialize();
    const owner = this.owner, connection = await this.client.current();
    if (!connection || owner === 'anonymous' || owner !== 'account:' + await sha(connection.origin) + ':' + connection.credentials.userId) return;
    if (!readOnly && !(await this.serialize(() => this.state(owner))).enabled) return;
    const account = await this.client.request<Account>('/api/v1/me');
    if (account.userId !== connection.credentials.userId || account.deviceId !== connection.credentials.deviceId
      || !Array.isArray(account.syncCapabilities) || !['history-order-v1', 'history-version-v1', 'explicit-lifecycles-v1', 'translation-source-v2'].every(value => account.syncCapabilities.includes(value))) throw new Error('Update the backend to support this client.');
    await this.serialize(async () => {
      const state = await this.state(owner);
      if (state.epoch && state.epoch !== account.epoch) {
        state.enabled = false; state.failure = 'SYNC_EPOCH_CHANGED'; await this.database.write(owner, state);
        throw new Error('The server was restored. Your local data and queue are retained; restore requires review.');
      }
      state.epoch = account.epoch; state.failure = undefined; await this.database.write(owner, state);
    });
    try {
      for (let index = 0; index < 20 && this.owner === owner; index++) {
        const state = await this.serialize(() => this.state(owner));
        const path = `/api/v1/sync/${state.snapshot ? 'snapshot' : 'changes'}?epoch=${encodeURIComponent(account.epoch)}&after=${state.cursor}&limit=50`
          + (state.boundary !== undefined ? '&boundary=' + state.boundary : '');
        const page = await this.client.request<{ epoch: string; boundary: number; nextCursor: number; hasMore: boolean; changes: { entry: WireEntry; sequence: number }[] }>(path);
        if (page.epoch !== account.epoch || !Number.isSafeInteger(page.boundary) || page.boundary < state.cursor
          || !Number.isSafeInteger(page.nextCursor) || page.nextCursor < state.cursor || page.nextCursor > page.boundary
          || (state.boundary !== undefined && page.boundary !== state.boundary) || !Array.isArray(page.changes) || page.changes.length > 50
          || (page.hasMore && page.nextCursor <= state.cursor)) throw new Error('Invalid synchronization page.');
        let previousSequence = state.cursor;
        for (const change of page.changes) {
          if (!change || !Number.isSafeInteger(change.sequence) || change.sequence <= previousSequence
            || change.sequence > page.nextCursor) throw new Error('Invalid synchronization sequence.');
          previousSequence = change.sequence;
        }
        const entries = page.changes.map(change => parseEntry(change.entry));
        await this.serialize(async () => {
          if (this.owner !== owner) return;
          const latest = await this.state(owner);
          for (const remote of entries) {
            let entry = latest.entries.find(entry => entry.id === remote.id);
            if (!entry) { entry = { id: remote.id, deleted: remote.deleted, events: [], value: {
              word: remote.word, count: remote.count ?? 0, history: [], createdAt: remote.createdAtMs, updatedAt: remote.updatedAtMs,
            } }; latest.entries.push(entry); }
            const pending = latest.outbox.some(item => item.operation.entryId === remote.id);
            entry.base = remote;
            if (!pending) { entry.deleted = remote.deleted; entry.value.word = remote.word; entry.value.count = remote.count ?? 0; entry.value.updatedAt = remote.updatedAtMs; }
            if (!latest.history.includes(remote.id)) latest.history.push(remote.id);
          }
          latest.cursor = page.nextCursor; latest.boundary = page.hasMore ? page.boundary : undefined;
          if (!page.hasMore) latest.snapshot = false;
          await this.database.write(owner, latest);
        });
        if (!page.hasMore) break;
      }
      for (let index = 0; index < 10 && this.owner === owner; index++) {
        const state = await this.serialize(() => this.state(owner));
        const id = state.history[0]; if (!id) break;
        const entry = state.entries.find(entry => entry.id === id)!;
        if (!entry.base) throw new Error('Missing synchronization history base.');
        const scan = state.historyScan?.entryId === id && state.historyScan.version === entry.base.version ? state.historyScan
          : { entryId: id, version: entry.base.version, after: '', events: [] as RemoteEvent[] };
        const path = `/api/v1/entries/${encodeURIComponent(id)}/history?version=${entry.base.version}&limit=25&after=${encodeURIComponent(scan.after)}`;
        const page = await this.client.request<{ entryVersion: number; events: RemoteEvent[]; hasMore: boolean; nextCursor: string }>(path, 'GET', undefined, account.epoch);
          if (page.entryVersion !== entry.base.version || !Array.isArray(page.events) || page.events.length > 25
            || page.events.some(event => !event || typeof event.id !== 'string' || !Number.isSafeInteger(event.position) || event.position < 1
              || !Number.isFinite(event.timestamp) || event.timestamp < 0 || !isDefinition(event.definition))
            || page.events.some(event => (event.context != null && typeof event.context !== 'string')
              || (event.url != null && typeof event.url !== 'string'))
            || (page.hasMore && (!page.nextCursor || page.nextCursor === scan.after))) throw new Error('Invalid history page.');
        const events = [...scan.events, ...page.events];
        if (new Set(events.map(event => event.id)).size !== events.length || new Set(events.map(event => event.position)).size !== events.length) throw new Error('Duplicate history identity.');
        if (page.hasMore) {
          await this.serialize(async () => {
            const current = await this.state(owner);
            current.historyScan = { ...scan, after: page.nextCursor, events };
            await this.database.write(owner, current);
          });
          continue;
        }
        events.sort(entry.base.historyOrdering === 'timestamp' ? (a, b) => a.timestamp - b.timestamp || a.position - b.position : (a, b) => a.position - b.position);
        await this.serialize(async () => {
          if (this.owner !== owner) return;
          const state = await this.state(owner), current = state.entries.find(entry => entry.id === id)!;
          const byID = new Map(current.events.map((id, index) => [id, current.value.history[index]]));
          const records = events.map(event => {
            const local = byID.get(event.id);
            return local ?? { timestamp: event.timestamp, definition: event.definition, context: event.context ?? '', url: event.url ?? '' };
          });
          const remoteIDs = new Set(events.map(event => event.id));
          for (const [id, record] of byID) if (!remoteIDs.has(id)) { events.push({ id, ...record, position: 0 }); records.push(record); }
          current.events = events.map(event => event.id); current.value.history = records; state.history = state.history.filter(value => value !== id);
          delete state.historyScan;
          await this.database.write(owner, state);
        });
      }
      if (readOnly) return;
      for (let index = 0; index < 50 && this.owner === owner; index++) {
        const item = await this.serialize(async () => {
          const state = await this.state(owner);
          if (!state.enabled || state.snapshot || state.boundary !== undefined || state.history.length) return undefined;
          const item = state.outbox[0]; if (!item || item.error || (item.retryAt ?? 0) > Date.now()) return undefined;
          if (!item.body) {
            const operation = structuredClone(item.operation);
            if (['reset', 'delete', 'legacyMerge', 'edit'].includes(operation.kind)) {
              if (item.dependsOn || operation.baseVersion === undefined) throw new Error('The predecessor has not established this change’s version.');
            }
            item.body = JSON.stringify(operation); item.epoch = account.epoch;
            await this.database.write(owner, state);
          }
          return structuredClone(item);
        });
        if (!item) break;
        let result: OperationResult;
        try { result = await this.client.request<OperationResult>('/api/v1/sync/operations', 'POST', undefined, item.epoch, item.body); }
        catch (error) {
          await this.serialize(async () => {
            const state = await this.state(owner), current = state.outbox.find(value => value.operation.operationId === item.operation.operationId);
            if (current) {
              if (error instanceof BackendError && !error.retryable) { current.error = error.code; state.enabled = false; }
              else current.retryAt = Date.now() + 30_000;
            }
            state.failure = error instanceof Error ? error.message : 'Synchronization failed.';
            await this.database.write(owner, state);
          });
          throw error;
        }
        const remote = parseEntry(result.entry);
        if (result.operationId !== item.operation.operationId || remote.id !== item.operation.entryId || result.status !== 'applied') throw new Error('Invalid operation acknowledgment.');
        await this.serialize(async () => {
          const state = await this.state(owner), entry = state.entries.find(entry => entry.id === remote.id)!;
          state.outbox = state.outbox.filter(value => value.operation.operationId !== result.operationId); entry.base = remote;
          const descendants = new Set([result.operationId]), predicted = (item.observedVersion ?? 0) + 1;
          for (const pending of state.outbox) if (pending.dependsOn && descendants.has(pending.dependsOn)) {
            descendants.add(pending.operation.operationId);
            // Shift the entire causal chain for a no-op, never upward over unseen edits.
            if (remote.version <= predicted) {
              pending.observedVersion = Math.max(pending.versionFloor ?? 0, (pending.observedVersion ?? predicted) + remote.version - predicted);
              if (['reset', 'delete', 'legacyMerge', 'edit'].includes(pending.operation.kind)) pending.operation.baseVersion = pending.observedVersion;
            }
            if (pending.dependsOn === result.operationId) delete pending.dependsOn;
          }
          if (!state.outbox.some(value => value.operation.entryId === remote.id)) {
            entry.value.count = remote.count ?? 0; entry.value.word = remote.word; entry.value.updatedAt = remote.updatedAtMs; entry.deleted = remote.deleted;
          }
          await this.database.write(owner, state);
        });
      }
    } catch (error) {
      await this.serialize(async () => {
        const state = await this.state(owner); state.failure = error instanceof Error ? error.message : 'Synchronization failed.';
        if (error instanceof BackendError && error.code === 'SYNC_EPOCH_CHANGED') { state.enabled = false; state.failure = error.code; }
        await this.database.write(owner, state);
      });
      throw error;
    }
  }
}
export const cloudVocabulary = new CloudVocabulary();
