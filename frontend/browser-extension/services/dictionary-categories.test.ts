import { expect, it } from 'vitest';
import { createCategoryIndex } from './dictionary-categories';
const list = (category: string, words: string[]) => ({ category, words, target: words.length + 1, covered: words.length, excluded: 2, source: { url: 'https://example.com/list' } });
it('allows overlapping classifications and keeps legacy words available under all lists', () => {
  const categories = createCategoryIndex([list('ket', ['apple']), list('cet4', ['apple', 'book'])], { apple: 'ab', book: 'cd' });
  expect(categories.forWord(' APPLE ').map(c => c.category)).toEqual(['ket', 'cet4']);
  expect(categories.matches('book', 'ket')).toBe(false);
  expect(categories.matches('old-import', '')).toBe(true);
  expect(categories.matches('old-import', 'cet4')).toBe(false);
  expect(categories.categories[0]).toMatchObject({ target: 2, covered: 1, excluded: 2 });
});
it('does not invent level inheritance, trust unsafe links, or classify unpublished words', () => {
  const categories = createCategoryIndex([list('tem8', ['advanced']), list('ielts', ['unpublished']),
    { ...list('ket', ['advanced']), source: { url: 'javascript:alert(1)' } }, list('unknown', ['advanced'])], { advanced: 'ab' });
  expect(categories.forWord('advanced').map(c => c.category)).toEqual(['tem8']);
  expect(categories.matches('advanced', 'cet4')).toBe(false);
  expect(categories.categories).toHaveLength(1);
  expect(createCategoryIndex(undefined, {}).categories).toEqual([]);
});
it('opens a readable pinned source page instead of automatically downloading a large raw dataset', () => {
  const revision = 'a'.repeat(40);
  const index = createCategoryIndex([{ ...list('cet4', ['apple']), source: { url: `https://raw.githubusercontent.com/example/dictionary/${revision}/words.csv` } }], { apple: 'ab' });
  expect(index.categories[0].sourceUrl).toBe(`https://github.com/example/dictionary/blob/${revision}/words.csv`);
});
