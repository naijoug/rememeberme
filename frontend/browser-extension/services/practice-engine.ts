import type { PracticeAttempt, PracticeMode, PracticeSession, PracticeSummary, PracticeTurn, PracticeWord } from '~/types/practice';

export const MAX_PRACTICE_WORDS = 10;
export const asciiLower = (text: string) => text.replace(/[A-Z]/g, letter => letter.toLowerCase());
export function newPracticeSession(owner: string, epoch: string | null, mode: PracticeMode, candidates: PracticeWord[], random = Math.random): PracticeSession {
  const pool = structuredClone(candidates.filter(w => mode === 'copy' || w.prompt));
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const words = pool.slice(0, MAX_PRACTICE_WORDS);
  if (!words.length) throw new Error(mode === 'recall' ? 'No saved meanings are available for spelling. Try Copy mode.' : 'No eligible words are available. Save a word or import a backup first.');
  return { id: crypto.randomUUID(), owner, epoch, mode, words, attempts: [], invalidated: 0,
    queue: words.map((w, i) => newTurn(w.id, 0, i === 0)) };
}
const newTurn = (entryId: string, round: number, started = false): PracticeTurn => ({
  id: crypto.randomUUID(), activationId: crypto.randomUUID(), entryId, round, started, hinted: false, interrupted: false,
});
export function currentTurn(session: PracticeSession, turnId: string): PracticeTurn {
  const turn = session.queue[0];
  if (!turn || turn.id !== turnId) throw new Error('The practice question changed. Reload this session.');
  return turn;
}
export function answerPractice(session: PracticeSession, turnId: string, answer: string, assisted: boolean, skipped: boolean, elapsedMs: number): void {
  const turn = currentTurn(session, turnId);
  if (!turn.started) throw new Error('Continue the session before answering.');
  const word = session.words.find(w => w.id === turn.entryId)!;
  const correct = !skipped && asciiLower(answer.trim()) === asciiLower(word.word.trim());
  const attempt: PracticeAttempt = { turnId, entryId: turn.entryId, round: turn.round, correct, assisted, skipped, elapsedMs,
    hinted: turn.hinted, interrupted: turn.interrupted };
  session.attempts.push(attempt); session.queue.shift();
  if ((!correct || turn.hinted) && turn.round < 2) session.queue.splice(Math.min(2, session.queue.length), 0, newTurn(word.id, turn.round + 1));
  if (!session.queue.length) for (const w of session.words) { w.prompt = ''; w.fingerprint = ''; w.source = ''; }
}
export function practiceSummary(session: PracticeSession): PracticeSummary {
  const first = session.attempts.filter(a => a.round === 0);
  const retries = session.attempts.filter(a => a.round > 0);
  return { total: session.words.length, answered: first.length,
    firstCorrect: first.filter(a => a.correct && !a.hinted && !a.assisted && !a.interrupted).length,
    hinted: session.attempts.filter(a => a.hinted).length, assisted: session.attempts.filter(a => a.assisted).length,
    interrupted: session.attempts.filter(a => a.interrupted).length, skipped: session.attempts.filter(a => a.skipped).length,
    retries: retries.length, retryCorrect: retries.filter(a => a.correct).length,
    elapsedMs: session.attempts.reduce((sum, a) => sum + a.elapsedMs, 0),
    needsWork: session.words.filter(w => { const last = session.attempts.filter(a => a.entryId === w.id).at(-1); return last && (!last.correct || last.hinted || last.assisted || last.interrupted); }).map(w => ({ id: w.id, word: w.word })),
  };
}
/** Remove invalid source copies and their attempts; counts/reset times aren't fingerprints. */
export function reconcilePractice(session: PracticeSession, words: PracticeWord[]): boolean {
  const active = session.queue.length > 0;
  const live = new Map(words.map(w => [w.id, w]));
  const invalid = new Set(session.words.filter(w => {
    const current = live.get(w.id);
    return !current || (active ? current.fingerprint !== w.fingerprint : current.word !== w.word);
  }).map(w => w.id));
  if (!invalid.size) return false;
  session.invalidated += invalid.size;
  session.words = session.words.filter(w => !invalid.has(w.id));
  session.attempts = session.attempts.filter(a => !invalid.has(a.entryId));
  session.queue = session.queue.filter(t => !invalid.has(t.entryId));
  if (!session.queue.length) for (const w of session.words) { w.prompt = ''; w.fingerprint = ''; w.source = ''; }
  return true;
}
