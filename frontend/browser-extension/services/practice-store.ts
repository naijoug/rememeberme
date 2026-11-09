import type { PracticeCommand, PracticeRecord, PracticeSession, PracticeView } from '~/types/practice';
import { answerPractice, currentTurn, newPracticeSession, practiceSummary, reconcilePractice } from './practice-engine';
import { practiceBlock, practiceWords, type PracticeVocabulary } from './practice-source';

export const practiceKey = (owner: string) => 'practice:v1:' + owner;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;
const id = (v: unknown) => typeof v === 'string' && /^[a-zA-Z0-9:_-]{1,200}$/.test(v);
const integer = (v: unknown, max = Number.MAX_SAFE_INTEGER) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max;
function validSession(value: unknown): value is PracticeSession {
  if (!object(value) || !id(value.id) || !text(value.owner, 500) || !value.owner
    || !(value.epoch === null || id(value.epoch)) || !['copy', 'recall'].includes(String(value.mode))
    || !integer(value.invalidated, 10) || !Array.isArray(value.words) || value.words.length > 10
    || !Array.isArray(value.queue) || !Array.isArray(value.attempts) || value.queue.length + value.attempts.length > 30) return false;
  if (!value.words.every(w => object(w) && id(w.id) && text(w.word, 500) && !!w.word
    && text(w.prompt, 8000) && text(w.source, 50) && text(w.fingerprint, 16000))) return false;
  const words = new Set(value.words.map(w => w.id));
  if (words.size !== value.words.length || value.words.length + Number(value.invalidated) > 10) return false;
  if (!value.queue.every(t => object(t) && id(t.id) && words.has(t.entryId) && integer(t.round, 2)
    && typeof t.started === 'boolean' && typeof t.hinted === 'boolean' && typeof t.interrupted === 'boolean'
    && (t.activationId === undefined || id(t.activationId)))) return false;
  if (!value.attempts.every(a => object(a) && id(a.turnId) && words.has(a.entryId) && integer(a.round, 2)
    && (a.mistakes === undefined || integer(a.mistakes, 10_000))
    && ['correct', 'hinted', 'assisted', 'interrupted', 'skipped'].every(k => typeof a[k] === 'boolean')
    && typeof a.elapsedMs === 'number' && Number.isFinite(a.elapsedMs) && a.elapsedMs >= 0 && a.elapsedMs <= 3_600_000)) return false;
  const turns = [...value.queue.map(t => t.id), ...value.attempts.map(a => a.turnId)];
  const rounds = [...value.queue, ...value.attempts].map(t => `${t.entryId}:${t.round}`);
  return new Set(turns).size === turns.length && new Set(rounds).size === rounds.length;
}
export function readPractice(value: unknown): PracticeRecord {
  if (value == null) return { schema: 1, revision: 0, session: null, receipts: [] };
  if (!object(value) || value.schema !== 1 || !integer(value.revision) || !Array.isArray(value.receipts) || value.receipts.length > 256
    || !value.receipts.every(r => object(r) && id(r.id) && typeof r.digest === 'string' && /^[a-f0-9]{64}$/.test(r.digest))
    || new Set(value.receipts.map(r => r.id)).size !== value.receipts.length
    || (value.session !== null && !validSession(value.session))) {
    throw new Error('Unsupported practice data. Your vocabulary has not changed.');
  }
  return structuredClone(value) as unknown as PracticeRecord;
}
/** Preserve a readable revision when dropping a damaged optional practice copy. */
export function discardCorruptPractice(value: unknown): PracticeRecord {
  const previous = object(value) && integer(value.revision) ? value.revision as number : 0;
  return { schema: 1, revision: Math.min(previous + 1, Number.MAX_SAFE_INTEGER), session: null, receipts: [] };
}
export function bumpPractice(r: PracticeRecord) {
  if (!Number.isSafeInteger(r.revision + 1)) throw new Error('Practice revision limit reached.');
  r.revision++;
}
export function reconcileRecord(r: PracticeRecord, owner: string, state: PracticeVocabulary): boolean {
  if (!r.session) return false;
  if (r.session.owner !== owner || r.session.epoch !== (state.epoch ?? null) || state.failure === 'SYNC_EPOCH_CHANGED') {
    r.session = null; bumpPractice(r); return true;
  }
  if (reconcilePractice(r.session, practiceWords(state).words)) { bumpPractice(r); return true; }
  return false;
}
export function applyPractice(r: PracticeRecord, owner: string, state: PracticeVocabulary, command: PracticeCommand, digest: string) {
  const receipt = r.receipts.find(v => v.id === command.requestId);
  if (receipt) {
    if (receipt.digest !== digest) throw new Error('This practice request ID was reused with different content.');
    return;
  }
  if (command.revision !== r.revision) throw new Error('Practice changed in another tab or during sync. Reload this session.');
  const action = command.action;
  const blocked = practiceBlock(owner, state);
  if (blocked && action.kind !== 'clear') throw new Error(blocked);
  switch (action.kind) {
    case 'clear': r.session = null; break;
    case 'start': {
      if (r.session?.queue.length && !action.replace) throw new Error('Confirm before replacing an unfinished session.');
      let words = practiceWords(state).words;
      if (action.entryIds) words = words.filter(w => action.entryIds!.includes(w.id));
      r.session = newPracticeSession(owner, state.epoch ?? null, action.mode, words);
      break;
    }
    case 'resume': {
      if (!r.session || r.session.id !== action.sessionId) throw new Error('This session is no longer available.');
      const turn = r.session.queue[0];
      if (turn) { if (turn.started) turn.interrupted = true; turn.started = true; turn.activationId = crypto.randomUUID(); }
      break;
    }
    case 'reveal': {
      if (!r.session) throw new Error('Start a session first.');
      const turn = currentTurn(r.session, action.turnId);
      if (!turn.started) throw new Error('Continue before revealing the answer.');
      turn.hinted = true; break;
    }
    case 'answer': {
      if (!r.session) throw new Error('Start a session first.');
      answerPractice(r.session, action.turnId, action.answer, action.assisted, action.skipped, action.elapsedMs, action.mistakes ?? 0, action.advance ?? false); break;
    }
  }
  bumpPractice(r);
  // Bounded receipts contain no answer/meaning. Older requests fail their revision check.
  r.receipts.push({ id: command.requestId, digest }); r.receipts = r.receipts.slice(-256);
}
export function practiceView(r: PracticeRecord, owner: string, scope: string, state: PracticeVocabulary): PracticeView {
  const projected = practiceWords(state), blocked = practiceBlock(owner, state);
  const s = r.session, turn = s?.queue[0], word = s?.words.find(w => w.id === turn?.entryId);
  const last = s?.attempts.at(-1), lastWord = s?.words.find(w => w.id === last?.entryId);
  return { owner, scope, revision: r.revision, label: owner === 'anonymous' ? 'On this device' : state.displayName ? `GitHub · ${state.displayName}` : 'Account vocabulary', blocked,
    available: { copy: projected.words.length, recall: projected.words.length, excluded: projected.excluded },
    session: !s || blocked ? null : { id: s.id, mode: s.mode, completed: s.queue.length === 0, invalidated: s.invalidated,
      current: !turn || !word ? null : { turnId: turn.id, activationId: turn.activationId ?? turn.id, round: turn.round, prompt: word.prompt, source: word.source,
        // Both modes need the word for device speech and the in-place reference layer.
        // Recall obscures that layer in the UI; this is not an answer-security boundary.
        meaning: projected.words.find(w => w.id === word.id)?.meaning ?? word.prompt,
        word: word.word, started: turn.started, hinted: turn.hinted, interrupted: turn.interrupted },
      last: last && lastWord ? { word: lastWord.word, correct: last.correct, skipped: last.skipped } : null,
      summary: practiceSummary(s),
    },
  };
}
