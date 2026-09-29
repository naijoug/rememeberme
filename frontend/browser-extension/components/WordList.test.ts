import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, reactive, type App } from 'vue';
import WordList from './WordList.vue';
import type { WordEntry } from '~/types';

let app: App;
let container: HTMLDivElement;
const entries = (): WordEntry[] => Array.from({ length: 200 }, (_, index) => ({
  word: 'word-' + index, count: index, createdAt: 1, updatedAt: 1, history: [],
}));
async function mount() {
  const props = reactive({ words: entries(), onSelect: vi.fn() });
  app = createApp({ render: () => h(WordList, props) });
  app.mount(container);
  await nextTick();
  return props;
}
async function scroll(top: number) {
  const list = container.querySelector<HTMLElement>('.word-list')!;
  list.scrollTop = top;
  list.dispatchEvent(new Event('scroll'));
  await nextTick();
}
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); });
afterEach(() => { app?.unmount(); container.remove(); });

describe('large vocabulary list', () => {
  it('renders a bounded range and reaches the last word', async () => {
    await mount();
    expect(container.querySelectorAll('.word-item').length).toBeLessThan(30);
    await scroll(14830);
    expect([...container.querySelectorAll('.word-text')].map(item => item.textContent)).toContain('word-199');
  });
  it('opens a selected word in the reading view instead of changing virtual row height', async () => {
    const props = await mount();
    await scroll(9120);
    const button = container.querySelector<HTMLButtonElement>('[aria-label="Open word-120"]')!;
    button.click();
    expect(props.onSelect).toHaveBeenCalledWith('word-120');
    expect(container.querySelector('.word-detail')).toBeNull();
  });
  it('resets the visible range when a search or import replaces the list', async () => {
    const props = await mount();
    await scroll(14830);
    props.words = props.words.slice(0, 2);
    await nextTick();
    expect(container.querySelector('.word-list')?.scrollTop).toBe(0);
    expect(container.querySelectorAll('.word-item')).toHaveLength(2);
  });
});
