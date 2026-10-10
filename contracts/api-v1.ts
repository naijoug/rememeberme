/** The wire protocol is separate from native local revisions and logical outbox DTOs. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type EntryKind = 'word' | 'phrase' | 'abbreviation' | 'proper_noun';
export type OperationKind = 'create' | 'seed' | 'record' | 'importHistory' | 'edit' | 'reset' | 'delete' | 'review' | 'restore' | 'enrichSource' | 'legacyMerge';
export interface WireOperation { operationId: string; entryId: string; kind: OperationKind; baseVersion?: number; sourceRevision?: number; payload: Record<string, Json> }
export interface WireReview { algorithmVersion: 'review-v1'; step: number; dueAtMs: number }
export interface WireEntry {
  id: string; word: string; normalizedKey: string; kind: EntryKind; count: number | null;
  definition: Json; notes: string; createdAtMs: number; updatedAtMs: number;
  version: number; deleted: boolean; review: WireReview | null; reviewVersion: number;
  historyOrdering?: 'retained' | 'timestamp';
}
export interface WireEncounter { id: string; timestamp: number; definition: Json; context?: string; url?: string }
export interface OperationResult { operationId: string; status: 'applied'; entry: WireEntry; cursor: number }
export const API_VERSION = 1;
export const MAX_VERSION = Number.MAX_SAFE_INTEGER;
export const MAX_BODY_BYTES = 256 * 1024;
export const MAX_EVENTS = 25;
export const KINDS: EntryKind[] = ['word', 'phrase', 'abbreviation', 'proper_noun'];
const ACTIONS: OperationKind[] = ['create', 'seed', 'record', 'importHistory', 'edit', 'reset', 'delete', 'review', 'restore', 'enrichSource', 'legacyMerge'];

export class ApiError extends Error {
  constructor(public code: string, public status = 400, public retryable = false) { super(code); }
}
export const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export const nonnegative = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
export const version = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
export const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9:_-]{1,200}$/.test(v);
export function text(v: unknown, maximum = 16_384): v is string { return typeof v === 'string' && v.length <= maximum; }
export function json(v: unknown, depth = 0): v is Json {
  if (depth > 32) return false;
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(x => json(x, depth + 1));
  return object(v) && Object.values(v).every(x => json(x, depth + 1));
}
export function keys(v: Record<string, unknown>, allowed: string[], required: string[] = []) {
  if (Object.keys(v).some(key => !allowed.includes(key)) || required.some(key => !(key in v))) throw new ApiError('INVALID_REQUEST');
}
export function definition(v: unknown): v is Json {
  if (!object(v) || !json(v) || !text(v.word) || !Array.isArray(v.phonetics) || !Array.isArray(v.meanings)) return false;
  if (v.translation !== undefined) {
    const t = v.translation;
    if (!object(t) || t.source !== 'mymemory' || t.target !== 'zh-CN' || !text(t.text, 2000) || !t.text.trim()) return false;
  }
  return v.meanings.every(m => object(m) && typeof m.partOfSpeech === 'string' && Array.isArray(m.definitions)
    && m.definitions.every(d => object(d) && typeof d.definition === 'string'));
}
export function encounter(v: unknown): v is WireEncounter {
  if (!object(v)) return false;
  keys(v, ['id', 'timestamp', 'definition', 'context', 'url'], ['id', 'timestamp', 'definition']);
  return id(v.id) && nonnegative(v.timestamp) && definition(v.definition)
    && (v.context === undefined || text(v.context)) && (v.url === undefined || text(v.url, 8192));
}
export function review(v: unknown): v is WireReview {
  if (!object(v)) return false;
  keys(v, ['algorithmVersion', 'step', 'dueAtMs'], ['algorithmVersion', 'step', 'dueAtMs']);
  return v.algorithmVersion === 'review-v1' && typeof v.step === 'number' && Number.isInteger(v.step)
    && v.step >= 0 && v.step <= 4 && nonnegative(v.dueAtMs) && v.dueAtMs <= 8_640_000_000_000_000;
}
function seed(p: Record<string, unknown>, migration: boolean) {
  keys(p, ['word', 'kind', 'count', 'definition', 'notes', 'createdAtMs', 'updatedAtMs', ...(migration ? ['sourceDigest'] : ['allowDuplicate'])],
    ['word', 'kind', 'count', 'definition', 'notes', 'createdAtMs', 'updatedAtMs', ...(migration ? ['sourceDigest'] : [])]);
  if (!text(p.word) || !p.word.trim() || !KINDS.includes(p.kind as EntryKind) || (p.count !== null && !nonnegative(p.count))
    || !definition(p.definition) || !text(p.notes) || !nonnegative(p.createdAtMs) || !nonnegative(p.updatedAtMs)
    || (!migration && p.allowDuplicate !== undefined && typeof p.allowDuplicate !== 'boolean')
    || (migration && (typeof p.sourceDigest !== 'string' || !/^[a-f0-9]{64}$/.test(p.sourceDigest)))) throw new ApiError('INVALID_REQUEST');
}
export function parseOperation(v: unknown): WireOperation {
  if (!object(v)) throw new ApiError('INVALID_REQUEST');
  keys(v, ['operationId', 'entryId', 'kind', 'baseVersion', 'sourceRevision', 'payload'], ['operationId', 'entryId', 'kind', 'payload']);
  if (!id(v.operationId) || !id(v.entryId) || !ACTIONS.includes(v.kind as OperationKind) || !object(v.payload) || !json(v.payload)
    || (v.baseVersion !== undefined && !version(v.baseVersion)) || (v.sourceRevision !== undefined && !version(v.sourceRevision))) throw new ApiError('INVALID_REQUEST');
  const kind = v.kind as OperationKind, p = v.payload;
  if (['edit', 'reset', 'delete', 'review', 'restore', 'legacyMerge'].includes(kind) && !version(v.baseVersion)) throw new ApiError('BASE_VERSION_REQUIRED');
  switch (kind) {
    case 'create': case 'seed': seed(p, kind === 'seed'); break;
    case 'record': keys(p, ['event'], ['event']); if (!encounter(p.event)) throw new ApiError('INVALID_REQUEST'); break;
    case 'importHistory':
      keys(p, ['events'], ['events']);
      if (!Array.isArray(p.events) || p.events.length < 1 || p.events.length > MAX_EVENTS || !p.events.every(encounter)
        || new Set(p.events.map(e => object(e) ? e.id : undefined)).size !== p.events.length) throw new ApiError('INVALID_REQUEST');
      break;
    case 'edit':
      keys(p, ['word', 'kind', 'definition', 'notes']);
      if (!Object.keys(p).length || (p.word !== undefined && (!text(p.word) || !p.word.trim()))
        || (p.kind !== undefined && !KINDS.includes(p.kind as EntryKind))
        || (p.definition !== undefined && !definition(p.definition)) || (p.notes !== undefined && !text(p.notes))) throw new ApiError('INVALID_REQUEST');
      break;
    case 'reset': case 'delete': keys(p, []); break;
    case 'legacyMerge':
      keys(p, ['countDelta', 'definition'], ['countDelta', 'definition']);
      if (!nonnegative(p.countDelta) || !definition(p.definition)) throw new ApiError('INVALID_REQUEST');
      break;
    case 'review':
      keys(p, ['event'], ['event']);
      if (!object(p.event)) throw new ApiError('INVALID_REQUEST');
      keys(p.event, ['id', 'result', 'answeredAtMs', 'baseReviewVersion', 'algorithmVersion'], ['id', 'result', 'answeredAtMs', 'baseReviewVersion', 'algorithmVersion']);
      if (!id(p.event.id) || !['forgot', 'fuzzy', 'remembered'].includes(String(p.event.result))
        || !nonnegative(p.event.answeredAtMs) || p.event.answeredAtMs > 8_640_000_000_000_000
        || !version(p.event.baseReviewVersion) || p.event.algorithmVersion !== 'review-v1') throw new ApiError('INVALID_REQUEST');
      break;
    case 'restore':
      keys(p, ['count', 'definition', 'notes', 'review', 'baseReviewVersion'], ['count', 'definition', 'notes', 'review', 'baseReviewVersion']);
      if ((p.count !== null && !nonnegative(p.count)) || !definition(p.definition) || !text(p.notes)
        || !version(p.baseReviewVersion) || (p.review !== null && !review(p.review))) throw new ApiError('INVALID_REQUEST');
      break;
    case 'enrichSource':
      keys(p, ['events'], ['events']);
      if (!Array.isArray(p.events) || p.events.length < 1 || p.events.length > MAX_EVENTS) throw new ApiError('INVALID_REQUEST');
      for (const e of p.events) {
        if (!object(e)) throw new ApiError('INVALID_REQUEST');
        keys(e, ['id', 'context', 'url'], ['id']);
        if (!id(e.id) || (e.context !== undefined && !text(e.context)) || (e.url !== undefined && !text(e.url, 8192))) throw new ApiError('INVALID_REQUEST');
      }
      break;
  }
  // Validation above establishes a JSON object; preserve only typed protocol fields.
  return { operationId: v.operationId, entryId: v.entryId, kind, ...(v.baseVersion === undefined ? {} : { baseVersion: v.baseVersion }), ...(v.sourceRevision === undefined ? {} : { sourceRevision: v.sourceRevision as number }), payload: v.payload };
}
export function canonical(v: Json): string {
  const ordered = (value: Json): Json => Array.isArray(value) ? value.map(ordered)
    : value !== null && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, ordered(value[k])])) : value;
  return JSON.stringify(ordered(v));
}
export function nextVersion(value: number): number {
  if (!version(value) || value >= MAX_VERSION) throw new ApiError('VERSION_EXHAUSTED', 409);
  return value + 1;
}
export function parseEntry(v: unknown): WireEntry {
  if (!object(v) || !id(v.id) || !text(v.word) || !text(v.normalizedKey) || !KINDS.includes(v.kind as EntryKind)
    || (v.count !== null && !nonnegative(v.count)) || !definition(v.definition) || !text(v.notes)
    || !nonnegative(v.createdAtMs) || !nonnegative(v.updatedAtMs) || !version(v.version) || v.version < 1
    || typeof v.deleted !== 'boolean' || (v.review !== null && !review(v.review)) || !version(v.reviewVersion)
    || (v.historyOrdering !== undefined && !['retained', 'timestamp'].includes(String(v.historyOrdering)))) throw new ApiError('INVALID_STORED_DATA', 500);
  return { id: v.id, word: v.word, normalizedKey: v.normalizedKey, kind: v.kind as EntryKind, count: v.count,
    definition: v.definition, notes: v.notes, createdAtMs: v.createdAtMs, updatedAtMs: v.updatedAtMs,
    version: v.version, deleted: v.deleted, review: v.review, reviewVersion: v.reviewVersion,
    ...(v.historyOrdering === undefined ? {} : { historyOrdering: v.historyOrdering as 'retained' | 'timestamp' }) };
}
export function nextReview(current: WireReview | null, result: string, at: number): WireReview {
  const step = result === 'forgot' ? 0 : result === 'fuzzy' ? Math.max(current?.step ?? -1, 0) : Math.min((current?.step ?? -1) + 1, 4);
  const dueAtMs = at + [1, 3, 7, 14, 30][step] * 86_400_000;
  if (!Number.isFinite(dueAtMs) || dueAtMs <= at || dueAtMs > 8_640_000_000_000_000) throw new ApiError('INVALID_REVIEW_TIME');
  return { algorithmVersion: 'review-v1', step, dueAtMs };
}
