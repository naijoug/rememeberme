import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, reactive, type App } from 'vue';
import PracticeMeaning from './PracticeMeaning.vue';
const { get, close } = vi.hoisted(() => ({ get: vi.fn(), close: vi.fn(async () => {}) }));
vi.mock('~/services/translation-cache', () => ({ TranslationCache: class { get = get; close = close; } }));
let app: App, root: HTMLElement;
beforeEach(() => { get.mockReset().mockResolvedValue(undefined); root = document.createElement('div'); document.body.append(root); });
afterEach(() => { app?.unmount(); root.remove(); });
async function mount(word: string | undefined, source = 'wordnet') {
  const props = reactive({ word, source, meaning: 'To stop an action' });
  app = createApp({ render: () => h(PracticeMeaning, props) }); app.mount(root); await nextTick(); await nextTick(); return props;
}
it('uses an existing local Chinese result and renders it as literal text', async () => {
  get.mockResolvedValue({ translation: { text: '<img src=x> 取消，撤销' } }); await mount('cancel');
  expect(get).toHaveBeenCalledWith('cancel'); expect(root.textContent).toContain('取消，撤销'); expect(root.querySelector('img')).toBeNull();
});
it('does not read a hidden spelling answer or replace a saved Chinese prompt', async () => {
  await mount(undefined); expect(get).not.toHaveBeenCalled(); app.unmount();
  await mount('cancel', 'magpie'); expect(get).not.toHaveBeenCalled();
});
it('ignores an old cached result when the word changes', async () => {
  let resolve!: (value: unknown) => void;
  get.mockReturnValueOnce(new Promise(r => { resolve = r; })).mockResolvedValue({ translation: { text: '新释义' } });
  const props = await mount('cancel'); props.word = 'apple'; await nextTick(); await nextTick();
  resolve({ translation: { text: '旧释义' } }); await nextTick();
  expect(root.textContent).toContain('新释义'); expect(root.textContent).not.toContain('旧释义');
});
