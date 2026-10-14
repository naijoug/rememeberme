import { ApiError, canonical, nextReview, nextVersion, parseEntry, type Json, type WireEntry, type WireEncounter, type WireOperation, type WireReview, type OperationResult, object, definition, review } from '../../contracts/api-v1';
import type { Identity } from './auth';
import { sha, token } from './http';
import type { Database, DatabaseStatement } from './runtime';

interface EntryRow {
  id: string; word: string; normalized_key: string; kind: WireEntry['kind']; count: number | null;
  definition_json: string; notes: string; created_at: number; updated_at: number; version: number;
  deleted: number; review_json: string | null; review_version: number; history_ordering: 'retained' | 'timestamp';
}
interface EventRow { id: string; entry_id: string; timestamp: number; definition_json: string; context: string; url: string; immutable_hash: string; position: number }
interface Receipt { request_hash: string; response_json: string }
function entryJSON(entry: WireEntry): Json { return { ...entry, review: entry.review ? { ...entry.review } : null }; }
function decode(row: EntryRow): WireEntry {
  const meanings: unknown = JSON.parse(row.definition_json), schedule: unknown = row.review_json ? JSON.parse(row.review_json) : null;
  if (!definition(meanings) || (schedule !== null && !review(schedule))) throw new ApiError('INVALID_STORED_DATA', 500);
  return { id: row.id, word: row.word, normalizedKey: row.normalized_key, kind: row.kind, count: row.count,
    definition: meanings, notes: row.notes, createdAtMs: row.created_at, updatedAtMs: row.updated_at,
    version: row.version, deleted: !!row.deleted, review: schedule, reviewVersion: row.review_version, historyOrdering: row.history_ordering };
}
export async function getEntry(db: Database, user: string, id: string): Promise<WireEntry | null> {
  const row = await db.prepare('SELECT * FROM vocabulary_entries WHERE user_id=? AND id=?').bind(user, id).first<EntryRow>();
  return row ? decode(row) : null;
}
async function result(db: Database, user: string, op: WireOperation, hash: string): Promise<OperationResult | null> {
  const receipt = await db.prepare('SELECT request_hash,response_json FROM sync_operations WHERE user_id=? AND id=?').bind(user, op.operationId).first<Receipt>();
  if (!receipt) return null;
  if (receipt.request_hash !== hash) throw new ApiError('OPERATION_ID_REUSED', 409);
  const value: unknown = JSON.parse(receipt.response_json);
  if (object(value) && object(value.error) && typeof value.error.code === 'string' && typeof value.error.status === 'number') {
    throw new ApiError(value.error.code, value.error.status, false);
  }
  if (!object(value) || value.status !== 'applied' || value.operationId !== op.operationId || !object(value.entry) || typeof value.cursor !== 'number') throw new ApiError('INVALID_STORED_DATA', 500);
  return { operationId: value.operationId, status: 'applied', entry: parseEntry(value.entry), cursor: value.cursor };
}
export async function rememberConflict(db: Database, who: Identity, op: WireOperation, failure: ApiError): Promise<OperationResult | null> {
  const hash = await sha(canonical({ ...op }));
  await db.prepare(`INSERT INTO sync_operations(user_id,id,request_hash,response_json,committed_at)
    SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM sessions s JOIN devices d ON d.user_id=s.user_id AND d.id=s.device_id
      JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.access_expires_at>?
      AND d.revoked_at IS NULL AND u.deleted_at IS NULL) ON CONFLICT(user_id,id) DO NOTHING`)
    .bind(who.userId, op.operationId, hash, JSON.stringify({ error: { code: failure.code, status: failure.status } }), Date.now(), who.sessionHash, Date.now()).run();
  return result(db, who.userId, op, hash);
}
function sourcePrivacy(who: Identity, revision: number | undefined, context: Json | undefined, url: Json | undefined) {
  if (((typeof context === 'string' && context) || (typeof url === 'string' && url)) && (revision ?? 0) !== who.sourceRevision) throw new ApiError('SOURCE_REVISION_CHANGED', 409);
  if (typeof context === 'string' && context && !who.syncContext) throw new ApiError('CONTEXT_SYNC_NOT_ENABLED');
  if (typeof url === 'string' && url && !who.syncURLs) throw new ApiError('URL_SYNC_NOT_ENABLED');
}
const fields = 'user_id,id,normalized_key,word,kind,count,definition_json,notes,created_at,updated_at,version,deleted,review_json,review_version,history_ordering';
function saveEntry(db: Database, user: string, entry: WireEntry, create: boolean) {
  const values = [entry.normalizedKey, entry.word, entry.kind, entry.count, canonical(entry.definition), entry.notes,
    entry.createdAtMs, entry.updatedAtMs, entry.version, Number(entry.deleted), entry.review ? JSON.stringify(entry.review) : null, entry.reviewVersion, entry.historyOrdering ?? 'retained'];
  return create ? db.prepare(`INSERT INTO vocabulary_entries(${fields}) VALUES(${Array(15).fill('?').join(',')})`).bind(user, entry.id, ...values)
    : db.prepare('UPDATE vocabulary_entries SET normalized_key=?,word=?,kind=?,count=?,definition_json=?,notes=?,created_at=?,updated_at=?,version=?,deleted=?,review_json=?,review_version=?,history_ordering=? WHERE user_id=? AND id=?')
      .bind(...values, user, entry.id);
}
function eventInput(v: Json): WireEncounter {
  if (!object(v) || typeof v.id !== 'string' || typeof v.timestamp !== 'number' || !definition(v.definition)) throw new ApiError('INVALID_REQUEST');
  return { id: v.id, timestamp: v.timestamp, definition: v.definition,
    ...(typeof v.context === 'string' ? { context: v.context } : {}), ...(typeof v.url === 'string' ? { url: v.url } : {}) };
}
function localDay(time: number, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(time));
  const field = (name: string) => parts.find(p => p.type === name)?.value;
  return `${field('year')}-${field('month')}-${field('day')}`;
}
export async function reviewAdmissions(db: Database, who: Identity) {
  const reviewDay = localDay(Date.now(), who.timezone);
  const rows = await db.prepare('SELECT event_id FROM review_admissions WHERE user_id=? AND local_day=? ORDER BY event_id LIMIT 20')
    .bind(who.userId, reviewDay).all<{ event_id: string }>();
  return { reviewDay, reviewAdmissionIds: rows.results.map(row => row.event_id) };
}
export async function applyOperation(db: Database, who: Identity, op: WireOperation): Promise<OperationResult> {
  const hash = await sha(canonical({ ...op }));
  const cached = await result(db, who.userId, op, hash); if (cached) return cached;
  for (let attempt = 0; attempt < 4; attempt++) {
    const old = await getEntry(db, who.userId, op.entryId), now = Date.now(), nonce = token();
    const creating = op.kind === 'create' || op.kind === 'seed';
    if (old?.deleted) throw new ApiError('ENTRY_DELETED', 409);
    if (creating && old) throw new ApiError('ENTRY_EXISTS', 409);
    if (!creating && !old) throw new ApiError('ENTRY_NOT_FOUND', 404);
    if (['edit', 'reset', 'delete', 'review', 'restore', 'legacyMerge'].includes(op.kind) && op.baseVersion !== old?.version) throw new ApiError('VERSION_CONFLICT', 409);
    const p = op.payload;
    const duplicates = op.kind === 'create' && p.allowDuplicate === true;
    let current: WireEntry;
    if (creating) {
      const word = String(p.word).trim(), normalizedKey = word.toLowerCase();
      if (op.kind === 'seed') {
        const expected = 'seed:' + await sha(JSON.stringify(['legacy-seed-v1', p.sourceDigest, normalizedKey]));
        if (op.operationId !== expected) throw new ApiError('INVALID_SEED_ID');
      }
      current = { id: op.entryId, word, normalizedKey, kind: p.kind as WireEntry['kind'], count: p.count as number | null,
        definition: p.definition, notes: String(p.notes), createdAtMs: Number(p.createdAtMs), updatedAtMs: Number(p.updatedAtMs),
        version: 1, deleted: false, review: null, reviewVersion: 0, historyOrdering: 'retained' };
    } else { current = { ...old! }; }
    const mutations: DatabaseStatement[] = [];
    let changed = creating, quotaDay: string | undefined;
    if (op.kind === 'record' || op.kind === 'importHistory') {
      const events = op.kind === 'record' ? [eventInput(p.event)] : (p.events as Json[]).map(eventInput);
      const existing = await db.prepare(`SELECT * FROM encounters WHERE user_id=? AND id IN (${events.map(() => '?').join(',')})`)
        .bind(who.userId, ...events.map(e => e.id)).all<EventRow>();
      for (const event of events) {
        sourcePrivacy(who, op.sourceRevision, event.context, event.url);
        const immutable = await sha(canonical({ entryId: op.entryId, id: event.id, timestamp: event.timestamp, definition: event.definition }));
        const prior = existing.results.find(e => e.id === event.id);
        if (prior) {
          if (prior.immutable_hash !== immutable || prior.entry_id !== op.entryId) throw new ApiError('EVENT_ID_REUSED', 409);
          continue;
        }
        mutations.push(db.prepare(`INSERT INTO encounters(user_id,id,entry_id,timestamp,definition_json,context,url,immutable_hash,entry_version,position)
          VALUES(?,?,?,?,?,?,?,?,?,COALESCE((SELECT max(position)+1 FROM encounters WHERE user_id=? AND entry_id=?),1))`)
          .bind(who.userId, event.id, op.entryId, event.timestamp, canonical(event.definition), event.context ?? '', event.url ?? '', immutable,
            old ? nextVersion(old.version) : 1, who.userId, op.entryId));
        changed = true;
      }
      if (op.kind === 'record' && changed) {
        const next = (current.count ?? 0) + 1;
        if (!Number.isFinite(next) || next <= (current.count ?? 0)) throw new ApiError('COUNT_PRECISION_EXHAUSTED', 409);
        current.count = next; current.updatedAtMs = events[0].timestamp;
      }
    } else if (op.kind === 'edit') {
      if (typeof p.word === 'string') { current.word = p.word.trim(); current.normalizedKey = current.word.toLowerCase(); }
      if (typeof p.kind === 'string') current.kind = p.kind as WireEntry['kind'];
      if (p.definition !== undefined) current.definition = p.definition;
      if (typeof p.notes === 'string') current.notes = p.notes;
      current.updatedAtMs = now; changed = true;
    } else if (op.kind === 'legacyMerge') {
      const count = (current.count ?? 0) + Number(p.countDelta);
      if (!Number.isFinite(count)) throw new ApiError('COUNT_PRECISION_EXHAUSTED', 409);
      current.count = count; current.definition = p.definition; current.historyOrdering = 'timestamp'; current.updatedAtMs = now; changed = true;
    } else if (op.kind === 'reset') { current.count = 0; current.updatedAtMs = now; changed = true; }
    else if (op.kind === 'delete') { current.deleted = true; current.updatedAtMs = now; changed = true; }
    else if (op.kind === 'review') {
      if (!object(p.event)) throw new ApiError('INVALID_REQUEST');
      const event = p.event;
      if (event.baseReviewVersion !== current.reviewVersion) throw new ApiError('REVIEW_VERSION_CONFLICT', 409);
      const at = Number(event.answeredAtMs);
      if (at > now + 300_000 || (current.review && current.review.dueAtMs > at)) throw new ApiError('REVIEW_NOT_DUE', 409);
      const prior = await db.prepare('SELECT event_json FROM review_events WHERE user_id=? AND id=?').bind(who.userId, event.id).first<{ event_json: string }>();
      if (prior) throw new ApiError('REVIEW_EVENT_EXISTS', 409);
      if (!current.review) {
        quotaDay = localDay(at, who.timezone);
        mutations.push(db.prepare('INSERT INTO review_admissions(user_id,local_day,event_id) VALUES(?,?,?)').bind(who.userId, quotaDay, event.id));
      }
      current.review = nextReview(current.review, String(event.result), at); current.reviewVersion = nextVersion(current.reviewVersion);
      current.updatedAtMs = at; changed = true;
      mutations.push(db.prepare('INSERT INTO review_events(user_id,id,entry_id,event_json) VALUES(?,?,?,?)').bind(who.userId, event.id, op.entryId, canonical(event)));
    } else if (op.kind === 'restore') {
      if (p.baseReviewVersion !== current.reviewVersion) throw new ApiError('REVIEW_VERSION_CONFLICT', 409);
      current.count = p.count as number | null; current.definition = p.definition; current.notes = String(p.notes);
      if (p.review !== null && !review(p.review)) throw new ApiError('INVALID_REQUEST');
      current.review = p.review as WireReview | null; current.reviewVersion = nextVersion(current.reviewVersion);
      current.updatedAtMs = now; changed = true;
    } else if (op.kind === 'enrichSource') {
      const ids = (p.events as Json[]).map(value => { if (!object(value)) throw new ApiError('INVALID_REQUEST'); return value.id; });
      const existing = await db.prepare(`SELECT * FROM encounters WHERE user_id=? AND entry_id=? AND id IN (${ids.map(() => '?').join(',')})`)
        .bind(who.userId, op.entryId, ...ids).all<EventRow>();
      for (const value of p.events as Json[]) {
        if (!object(value)) throw new ApiError('INVALID_REQUEST'); sourcePrivacy(who, op.sourceRevision, value.context, value.url);
        const prior = existing.results.find(row => row.id === value.id);
        if (!prior) throw new ApiError('EVENT_NOT_FOUND', 404);
        mutations.push(db.prepare('UPDATE encounters SET context=?,url=? WHERE user_id=? AND id=? AND entry_id=?')
          .bind(value.context ?? prior.context, value.url ?? prior.url, who.userId, value.id, op.entryId)); changed = true;
      }
    }
    if (changed && !creating) current.version = nextVersion(current.version);
    const checkSource = !current.deleted && !duplicates && (creating || current.normalizedKey !== old?.normalizedKey);
    if (checkSource) {
      const same = await db.prepare('SELECT id FROM vocabulary_entries WHERE user_id=? AND normalized_key=? AND deleted=0 AND id<>?')
        .bind(who.userId, current.normalizedKey, current.id).first<{ id: string }>();
      if (same) throw new ApiError('SOURCE_CONFLICT', 409);
    }
    const response = { operationId: op.operationId, status: 'applied', entry: entryJSON(current), cursor: 0 };
    const checks = old ? 'EXISTS(SELECT 1 FROM vocabulary_entries WHERE user_id=? AND id=? AND version=? AND deleted=0)'
      : 'NOT EXISTS(SELECT 1 FROM vocabulary_entries WHERE user_id=? AND id=?)';
    const guardValues = old ? [who.userId, op.entryId, old.version] : [who.userId, op.entryId];
    const quotaCheck = quotaDay ? ' AND (SELECT count(*) FROM review_admissions WHERE user_id=? AND local_day=?)<20' : '';
    const sourceCheck = checkSource ? ' AND NOT EXISTS(SELECT 1 FROM vocabulary_entries WHERE user_id=? AND normalized_key=? AND id<>? AND deleted=0)' : '';
    const authorized = `EXISTS(SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id JOIN devices d ON d.user_id=s.user_id AND d.id=s.device_id
      WHERE s.token_hash=? AND s.user_id=? AND s.device_id=? AND s.revoked_at IS NULL AND s.access_expires_at>?
      AND d.revoked_at IS NULL AND u.deleted_at IS NULL AND u.timezone=? AND u.sync_context=? AND u.sync_urls=? AND u.sync_epoch=? AND u.source_revision=?)`;
    const statements = [
      db.prepare('INSERT INTO sync_operations(user_id,id,request_hash,response_json,committed_at) VALUES(?,?,?,?,?)')
        .bind(who.userId, op.operationId, hash, JSON.stringify(response), now),
      db.prepare(`INSERT INTO write_guards(nonce,allowed) SELECT ?,CASE WHEN ${authorized} AND ${checks}${quotaCheck}${sourceCheck} THEN 1 ELSE 0 END`)
        .bind(nonce, who.sessionHash, who.userId, who.deviceId, Date.now(), who.timezone, Number(who.syncContext), Number(who.syncURLs), who.epoch, who.sourceRevision,
          ...guardValues, ...(quotaDay ? [who.userId, quotaDay] : []), ...(checkSource ? [who.userId, current.normalizedKey, current.id] : [])),
      ...(changed ? [saveEntry(db, who.userId, current, creating)] : []), ...mutations,
      ...(changed ? [db.prepare('INSERT INTO sync_changes(user_id,entry_id,version,entry_json) VALUES(?,?,?,?)')
        .bind(who.userId, op.entryId, current.version, JSON.stringify(entryJSON(current)))] : []),
      db.prepare(`UPDATE sync_operations SET response_json=json_set(?, '$.cursor', COALESCE((SELECT max(sequence) FROM sync_changes WHERE user_id=?),0)) WHERE user_id=? AND id=?`)
        .bind(JSON.stringify(response), who.userId, who.userId, op.operationId),
      db.prepare('DELETE FROM write_guards WHERE nonce=?').bind(nonce)
    ];
    try { await db.batch(statements); return (await result(db, who.userId, op, hash))!; }
    catch (error) {
      const replay = await result(db, who.userId, op, hash); if (replay) return replay;
      const authorization = await db.prepare(`SELECT u.timezone,u.sync_context,u.sync_urls,u.sync_epoch,u.source_revision FROM sessions s JOIN users u ON u.id=s.user_id
        JOIN devices d ON d.user_id=s.user_id AND d.id=s.device_id WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.access_expires_at>?
        AND d.revoked_at IS NULL AND u.deleted_at IS NULL`).bind(who.sessionHash, Date.now()).first<{ timezone: string; sync_context: number; sync_urls: number; sync_epoch: string; source_revision: number }>();
      if (!authorization) throw new ApiError('UNAUTHENTICATED', 401);
      if (authorization.sync_epoch !== who.epoch) throw new ApiError('SYNC_EPOCH_CHANGED', 409);
      if (authorization.source_revision !== who.sourceRevision) throw new ApiError('SOURCE_REVISION_CHANGED', 409);
      if (authorization.timezone !== who.timezone || !!authorization.sync_context !== who.syncContext || !!authorization.sync_urls !== who.syncURLs) throw new ApiError('PREFERENCES_CHANGED', 409);
      if (quotaDay) {
        const count = await db.prepare('SELECT count(*) AS n FROM review_admissions WHERE user_id=? AND local_day=?').bind(who.userId, quotaDay).first<{ n: number }>();
        if ((count?.n ?? 0) >= 20) throw new ApiError('DAILY_NEW_LIMIT', 409);
      }
      const latest = await getEntry(db, who.userId, op.entryId);
      if (latest?.deleted) throw new ApiError('ENTRY_DELETED', 409);
      if (latest?.version !== old?.version) {
        if (['record', 'importHistory', 'enrichSource'].includes(op.kind)) continue;
        throw new ApiError('VERSION_CONFLICT', 409);
      }
      if (creating) {
        const collision = await db.prepare('SELECT id FROM vocabulary_entries WHERE user_id=? AND normalized_key=? AND deleted=0').bind(who.userId, current.normalizedKey).first<{ id: string }>();
        if (collision) throw new ApiError('SOURCE_CONFLICT', 409);
      }
      throw error;
    }
  }
  throw new ApiError('RETRY_LATER', 503, true);
}

export async function changes(db: Database, who: Identity, cursor: number, limit: number, boundary?: number, snapshot = false) {
  const maximum = (await db.prepare('SELECT COALESCE(max(sequence),0) AS n FROM sync_changes WHERE user_id=?').bind(who.userId).first<{ n: number }>())!.n;
  const upper = boundary ?? maximum;
  if (upper > maximum) throw new ApiError('CURSOR_REJECTED', 409);
  if (cursor > upper) throw new ApiError('CURSOR_REJECTED', 409);
  const rows = snapshot
    ? await db.prepare(`SELECT c.sequence,c.entry_json FROM sync_changes c WHERE c.user_id=? AND c.sequence>? AND c.sequence<=?
        AND c.sequence=(SELECT max(s.sequence) FROM sync_changes s WHERE s.user_id=c.user_id AND s.entry_id=c.entry_id AND s.sequence<=?) ORDER BY c.sequence LIMIT ?`)
      .bind(who.userId, cursor, upper, upper, limit + 1).all<{ sequence: number; entry_json: string }>()
    : await db.prepare('SELECT sequence,entry_json FROM sync_changes WHERE user_id=? AND sequence>? AND sequence<=? ORDER BY sequence LIMIT ?')
      .bind(who.userId, cursor, upper, limit + 1).all<{ sequence: number; entry_json: string }>();
  const page = rows.results.slice(0, limit);
  return { epoch: who.epoch, boundary: upper, nextCursor: page.at(-1)?.sequence ?? cursor,
    hasMore: rows.results.length > limit, changes: page.map(row => ({ sequence: row.sequence, entry: parseEntry(JSON.parse(row.entry_json)) })) };
}
export async function entryHistory(db: Database, who: Identity, entryId: string, after: string, limit: number, entryVersion: number) {
  const rows = await db.prepare('SELECT * FROM encounters WHERE user_id=? AND entry_id=? AND entry_version<=? AND id>? ORDER BY id LIMIT ?')
    .bind(who.userId, entryId, entryVersion, after, limit + 1).all<EventRow>();
  const page = rows.results.slice(0, limit);
  return { entryVersion, nextCursor: page.at(-1)?.id ?? after, hasMore: rows.results.length > limit,
    events: page.map(row => ({ id: row.id, timestamp: row.timestamp, position: row.position, definition: JSON.parse(row.definition_json) as Json,
      ...(who.syncContext ? { context: row.context } : {}), ...(who.syncURLs ? { url: row.url } : {}) })) };
}
