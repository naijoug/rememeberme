import { WORD, hash } from './model';

export const CATEGORY_IDS = ['ket', 'cet4', 'cet6', 'tem8', 'toefl', 'ielts'] as const;
export type CategoryId = typeof CATEGORY_IDS[number];
export interface Wordlist {
  id: string; category: CategoryId; title: string; version: string;
  source: { url: string; revision: string; sha256: string; license: string; note: string };
  words: string[]; excluded: { text: string; reason: string }[];
}
const plain = (s: unknown, max: number): s is string => typeof s === 'string' && s.trim().length > 0 && s.length <= max && !/[<>\u0000-\u001f]/u.test(s);
export function parseWordlists(value: unknown): Wordlist[] {
  const data = value as { schemaVersion?: number; lists?: Wordlist[] };
  if (!data || data.schemaVersion !== 1 || !Array.isArray(data.lists) || !data.lists.length || data.lists.length > 100) throw new Error('Invalid wordlists');
  const ids = new Set<string>();
  for (const list of data.lists) {
    if (!list || !/^[a-z0-9-]{1,100}$/.test(list.id) || ids.has(list.id) || !CATEGORY_IDS.includes(list.category)
      || !plain(list.title, 100) || !plain(list.version, 100) || !list.source || !plain(list.source.url, 1000)
      || !plain(list.source.revision, 100) || !/^[a-f0-9]{64}$/.test(list.source.sha256) || !plain(list.source.license, 100)
      || !plain(list.source.note, 2000) || !Array.isArray(list.words) || !list.words.length || list.words.length > 100000
      || list.words.some(w => typeof w !== 'string' || w.length > 80 || !WORD.test(w)) || new Set(list.words).size !== list.words.length
      || !Array.isArray(list.excluded) || list.excluded.length > 10000 || list.excluded.some(e => !e || !plain(e.text, 200) || !plain(e.reason, 200))) throw new Error('Invalid wordlist');
    const url = new URL(list.source.url);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Unsafe wordlist source URL');
    ids.add(list.id);
  }
  return data.lists;
}
export const wordlistDigest = (list: Wordlist) => hash(JSON.stringify(list));
