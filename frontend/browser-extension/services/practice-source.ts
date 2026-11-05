import type { WordEntry } from '~/types';
import type { PracticeWord } from '~/types/practice';
import { isDefinition } from './definition-utils';
import { isEnglishWord } from './word-utils';

/** Structural view of the existing partition, not a second vocabulary schema. */
export interface PracticeVocabulary {
  schema: 2; displayName?: string; epoch?: string; snapshot: boolean; failure?: string;
  entries: Array<{ id: string; deleted: boolean; value: WordEntry; base?: { deleted: boolean; definition: unknown } }>;
  outbox: Array<{ error?: string; operation: { entryId: string; kind: string; payload: Record<string, unknown> } }>;
}
export function practiceBlock(owner: string, state: PracticeVocabulary): string | null {
  if (state.failure === 'SYNC_EPOCH_CHANGED') return 'Your account was restored. Resolve recovery in Settings before practicing.';
  if (owner !== 'anonymous' && (!state.epoch || state.snapshot)) return 'Your account vocabulary is still downloading. Return after its first download completes.';
  return null;
}
// Literal whole-term matching also protects apostrophes, hyphens and Unicode neighbours.
export function hidePracticeAnswers(text: string, answers: string[]): string {
  for (const answer of [...new Set(answers.filter(Boolean))].sort((a, b) => b.length - a.length)) {
    const escaped = answer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`(?<![\\p{L}\\p{N}'’_-])${escaped}(?![\\p{L}\\p{N}'’_-])`, 'giu'), '____');
  }
  return text;
}
export function practiceWords(state: PracticeVocabulary): { words: PracticeWord[]; excluded: number } {
  const words: PracticeWord[] = [];
  let excluded = 0;
  for (const entry of state.entries) {
    if (entry.deleted) continue;
    if (entry.base?.deleted || !isEnglishWord(entry.value.word) || entry.value.word.length > 500
      || state.outbox.some(p => p.operation.entryId === entry.id && p.error)) { excluded++; continue; }
    const pending = state.outbox.filter(p => p.operation.entryId === entry.id && ['create', 'seed', 'edit', 'legacyMerge'].includes(p.operation.kind)).at(-1);
    const definition = pending?.operation.payload.definition ?? entry.base?.definition ?? entry.value.history.at(-1)?.definition;
    let prompt = '', source = '';
    if (isDefinition(definition)) {
      const translation = definition.translation;
      const raw = translation?.text.trim() || definition.meanings.flatMap(m => m.definitions.map(d => d.definition.trim())).filter(Boolean).join('; ');
      prompt = hidePracticeAnswers(raw.slice(0, 2000), [entry.value.word, definition.word]);
      if (!/[\p{L}\p{N}]/u.test(prompt)) prompt = '';
      // Legacy imports retain optional fields verbatim; only project known labels.
      const englishSource = definition.source === 'wordnet' || definition.source === 'dictionary-api' ? definition.source : 'saved';
      source = translation?.text.trim() ? translation.source : englishSource;
    }
    const word = entry.value.word;
    words.push({ id: entry.id, word, prompt, source, fingerprint: JSON.stringify([word, prompt, source]) });
  }
  return { words, excluded };
}
