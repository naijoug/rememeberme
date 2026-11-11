import manifest from '../public/dictionary/rememberme/manifest.json';
import { isEnglishWord } from './word-utils';

export const CATEGORY_LABELS = { ket: 'KET', cet4: '四级', cet6: '六级', tem8: '专八', toefl: '托福', ielts: '雅思' } as const;
export type DictionaryCategory = keyof typeof CATEGORY_LABELS;
export interface CategorySummary { category: DictionaryCategory; label: string; target: number; covered: number; excluded: number; sourceUrl: string }

/** Categories describe the bundled word lists; they never mutate saved vocabulary or imports. */
export function createCategoryIndex(input: unknown, packagedWords: Record<string, unknown>) {
  const categories: CategorySummary[] = [], membership = new Map<string, Set<DictionaryCategory>>();
  if (Array.isArray(input) && input.length <= 100) for (const item of input) {
    if (!item || !Object.hasOwn(CATEGORY_LABELS, item.category) || categories.some(c => c.category === item.category)
      || !Array.isArray(item.words) || !Number.isSafeInteger(item.target) || item.target < 1 || item.target > 100000
      || !Number.isSafeInteger(item.covered) || item.covered < 0 || item.covered > item.target
      || item.words.length !== item.covered || new Set(item.words).size !== item.words.length
      || item.words.some((w: unknown) => typeof w !== 'string' || w.length > 80 || w !== w.toLowerCase() || !isEnglishWord(w) || !Object.hasOwn(packagedWords, w))
      || !Number.isSafeInteger(item.excluded) || item.excluded < 0) continue;
    let url: URL;
    try { url = new URL(item.source?.url); } catch { continue; }
    if (url.protocol !== 'https:' || url.username || url.password) continue;
    const category = item.category as DictionaryCategory;
    let sourceUrl = url.href;
    const [, owner, repository, revision, ...file] = url.pathname.split('/');
    if (url.hostname === 'raw.githubusercontent.com' && owner && repository && /^[a-f0-9]{40}$/.test(revision ?? '') && file.length) {
      sourceUrl = `https://github.com/${owner}/${repository}/blob/${revision}/${file.join('/')}`;
    }
    categories.push({ category, label: CATEGORY_LABELS[category], target: item.target, covered: item.covered, excluded: item.excluded, sourceUrl });
    for (const word of item.words) {
      const group = membership.get(word) ?? new Set<DictionaryCategory>(); group.add(category); membership.set(word, group);
    }
  }
  categories.sort((a, b) => Object.keys(CATEGORY_LABELS).indexOf(a.category) - Object.keys(CATEGORY_LABELS).indexOf(b.category));
  return {
    categories,
    forWord(input: string) {
      const word = input.trim().toLowerCase();
      return categories.filter(c => membership.get(word)?.has(c.category));
    },
    matches(input: string, category: string) { return category === '' || membership.get(input.trim().toLowerCase())?.has(category as DictionaryCategory) === true; },
  };
}
export const dictionaryCategories = createCategoryIndex((manifest as { categories?: unknown }).categories, manifest.words);
