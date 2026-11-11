import { afterEach, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import VocabularyPanel from './VocabularyPanel.vue';
import DictionaryCategoryBadges from './DictionaryCategoryBadges.vue';
import type { WordEntry } from '~/types';

vi.mock('~/services/dictionary-categories', () => {
  const ket = { category: 'ket', label: 'KET', target: 10, covered: 2, excluded: 3, sourceUrl: 'https://example.com/ket' };
  const cet4 = { category: 'cet4', label: '四级', target: 20, covered: 1, excluded: 0, sourceUrl: 'https://example.com/cet4' };
  return { dictionaryCategories: { categories: [ket, cet4], forWord: (word: string) => word === 'apple' ? [ket, cet4] : [],
    matches: (word: string, category: string) => !category || word === 'apple' } };
});
vi.mock('./practice/PracticeRecords.vue', () => ({ default: { template: '<div />' } }));
let app: App | undefined, host: HTMLDivElement;
afterEach(() => { app?.unmount(); host?.remove(); });
it('shows all matching word-list badges', async () => {
  host = document.createElement('div'); document.body.append(host);
  app = createApp(DictionaryCategoryBadges, { word: 'apple' }); app.mount(host);
  expect([...host.querySelectorAll('.dictionary-category')].map(e => e.textContent)).toEqual(['KET', '四级']);
});
it('filters only the saved-word view and clears both filters without changing vocabulary', async () => {
  const words = ['apple', 'legacy'].map(word => ({ word, count: 1, createdAt: 1, updatedAt: 1, history: [] } satisfies WordEntry));
  const before = JSON.stringify(words);
  host = document.createElement('div'); document.body.append(host);
  app = createApp(VocabularyPanel, { words }); app.mount(host); await nextTick();
  const filter = host.querySelector<HTMLSelectElement>('[aria-label="Filter vocabulary by word list"]')!;
  filter.value = 'ket'; filter.dispatchEvent(new Event('change', { bubbles: true })); await nextTick();
  expect(host.querySelector('[aria-label="Open apple"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="Open legacy"]')).toBeNull();
  const search = host.querySelector<HTMLInputElement>('[aria-label="Search vocabulary"]')!;
  search.value = 'no-match'; search.dispatchEvent(new Event('input', { bubbles: true })); await nextTick();
  [...host.querySelectorAll('button')].find(e => e.textContent === 'Clear filters')!.click(); await nextTick();
  expect(host.querySelector('[aria-label="Open legacy"]')).not.toBeNull();
  expect(JSON.stringify(words)).toBe(before);
  host.querySelector<HTMLButtonElement>('[aria-label="Settings"]')!.click(); await nextTick();
  expect(host.querySelector('#dictionary-coverage-heading')?.textContent).toBe('Local word lists');
  expect(host.textContent).toContain('2 / 10'); expect(host.textContent).toContain('3 other source entries excluded');
});
