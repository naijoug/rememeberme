import { describe, expect, it } from 'vitest';
import { answerPractice, newPracticeSession, practiceSummary, reconcilePractice } from './practice-engine';
import { hidePracticeAnswers, practiceWords, type PracticeVocabulary } from './practice-source';
const words = ['apple', "can't", 'well-known'].map((word, i) => ({ id: `word-${i}`, word, prompt: 'A saved meaning', source: 'magpie', fingerprint: word }));
const session = () => newPracticeSession('anonymous', null, 'recall', words, () => .999);
describe('practice engine', () => {
  it('records corrected typos without first-pass credit and activates the next turn in the same answer', () => {
    const s = newPracticeSession('anonymous', null, 'copy', words, () => .999);
    answerPractice(s, s.queue[0].id, 'apple', false, false, 1000, 2, true);
    expect(s.queue[0].started).toBe(true); expect(s.queue[0].entryId).toBe('word-1');
    expect(s.queue.at(-1)?.entryId).toBe('word-0');
    expect(practiceSummary(s)).toMatchObject({ firstCorrect: 0, mistakes: 2, characters: 5, turnsDone: 1, turnsRemaining: 3 });
    answerPractice(s, s.queue[0].id, "can't", true, false, 1000, 0, true);
    expect(practiceSummary(s).characters).toBe(5);
  });
  it('folds only ASCII case, without accepting Unicode compatibility characters', () => {
    const s = newPracticeSession('anonymous', null, 'recall', [{ id: 'kelvin', word: 'k', prompt: 'Letter', source: 'saved', fingerprint: 'k' }]);
    answerPractice(s, s.queue[0].id, 'K', false, false, 1);
    expect(s.attempts[0].correct).toBe(false);
  });
  it('compares full words, preserves punctuation and schedules bounded spaced retries', () => {
    const s = session();
    const first = s.queue[0];
    answerPractice(s, first.id, 'applf', false, false, 12);
    expect(s.queue.map(t => t.entryId)).toEqual(['word-1', 'word-2', 'word-0']);
    let attempts = 1;
    while (s.queue.length) { s.queue[0].started = true; answerPractice(s, s.queue[0].id, '', false, true, 10); attempts++; }
    expect(attempts).toBe(9); expect(s.attempts).toHaveLength(9);
    expect(practiceSummary(s)).toMatchObject({ total: 3, firstCorrect: 0, retries: 6, skipped: 8 });
    expect(s.words.every(w => !w.prompt && !w.fingerprint)).toBe(true);
    expect(() => answerPractice(s, first.id, 'apple', false, false, 0)).toThrow();
  });
  it('accepts case and outer whitespace, but not altered apostrophes or hyphens', () => {
    const s = session();
    answerPractice(s, s.queue[0].id, ' APPLE ', false, false, 2);
    s.queue[0].started = true; answerPractice(s, s.queue[0].id, 'cant', false, false, 1);
    s.queue[0].started = true; answerPractice(s, s.queue[0].id, 'well known', false, false, 1);
    expect(s.attempts.map(a => a.correct)).toEqual([true, false, false]);
  });
  it('separates first attempts, hints, assistance and interruption from retries', () => {
    const s = session(); s.queue[0].hinted = true;
    answerPractice(s, s.queue[0].id, 'apple', false, false, 20);
    s.queue[0].started = true; answerPractice(s, s.queue[0].id, "can't", true, false, 20);
    s.queue[0].started = true; s.queue[0].interrupted = true; answerPractice(s, s.queue[0].id, 'well-known', false, false, 20);
    expect(practiceSummary(s)).toMatchObject({ firstCorrect: 0, hinted: 1, assisted: 1, interrupted: 1, elapsedMs: 60 });
  });
  it('removes deleted/changed questions, attempts and snapshots without invalidating unchanged sources', () => {
    const s = session(); answerPractice(s, s.queue[0].id, 'apple', false, false, 1);
    expect(reconcilePractice(s, words)).toBe(false);
    expect(reconcilePractice(s, [words[1], { ...words[2], fingerprint: 'changed' }])).toBe(true);
    expect(s.words.map(w => w.id)).toEqual(['word-1']); expect(s.attempts).toEqual([]);
    expect(s.invalidated).toBe(2);
    reconcilePractice(s, []); expect(practiceSummary(s).total).toBe(0);
  });
  it('caps rounds at ten words and rejects empty recall sources', () => {
    expect(newPracticeSession('a', null, 'copy', Array.from({ length: 40 }, (_, i) => ({ ...words[0], id: String(i) }))).words).toHaveLength(10);
    expect(() => newPracticeSession('a', null, 'recall', [{ ...words[0], prompt: '' }])).toThrow('No saved meanings');
  });
});
describe('practice source', () => {
  it.each(['magpie', 'hermes', 'mymemory'])('preserves %s attribution, masks original form and omits private history', source => {
    const state = { schema: 2, snapshot: true, outbox: [], entries: [{ id: 'saved', deleted: false,
      value: { word: 'having', count: 5, history: [{ context: 'private sentence', url: 'https://private.test', timestamp: 1,
        definition: { word: 'have', translation: { text: 'have; HAVING; 拥有', target: 'zh-CN', source }, phonetics: [], meanings: [] } }], createdAt: 1, updatedAt: 1 } }] } as PracticeVocabulary;
    const result = practiceWords(state);
    expect(result.words[0]).toMatchObject({ id: 'saved', word: 'having', source, prompt: '____; ____; 拥有' });
    expect(JSON.stringify(result)).not.toContain('private');
  });
  it('does not fall back to older history or independent caches, and respects pending/current definitions', () => {
    const base = { word: 'apple', phonetics: [], meanings: [] };
    const state = { schema: 2, snapshot: true, entries: [{ id: 'a', deleted: false, value: { word: 'apple', count: 0,
      history: [{ definition: { ...base, meanings: [{ partOfSpeech: 'n', definitions: [{ definition: 'old meaning' }] }] } }, { definition: base }], createdAt: 1, updatedAt: 1 } }], outbox: [] } as unknown as PracticeVocabulary;
    expect(practiceWords(state).words[0].prompt).toBe('');
    state.outbox.push({ operation: { kind: 'edit', entryId: 'a', payload: { definition: { ...base, meanings: [{ partOfSpeech: 'n', definitions: [{ definition: '<img src=x> fruit' }] }] } } } });
    expect(practiceWords(state).words[0].prompt).toBe('<img src=x> fruit');
    state.outbox[0].error = 'CONFLICT'; expect(practiceWords(state)).toEqual({ words: [], excluded: 1 });
  });
  it('uses literal whole-term boundaries', () => {
    expect(hidePracticeAnswers("can can't CAN canny well-known known", ['can', 'known'])).toBe("____ can't ____ canny well-known ____");
    expect(hidePracticeAnswers('a.* literal a.*', ['a.*'])).toBe('____ literal ____');
  });
});
