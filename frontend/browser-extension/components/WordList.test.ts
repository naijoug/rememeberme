import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, reactive, type App } from 'vue';
import WordList from './WordList.vue';
import type { WordEntry } from '~/types';

let app: App;
let container: HTMLDivElement;
let expandedHeight: number;
const observers = new Set<{ targets: Set<Element>; callback: ResizeObserverCallback }>();

function entries(): WordEntry[] {
  return Array.from({ length: 200 }, (_, index) => ({
    word: `word-${index}`, count: 1, createdAt: 1, updatedAt: 1,
    history: [{ timestamp: 1, context: 'Fixture context', url: 'https://example.com',
      definition: { word: `word-${index}`, phonetics: [], meanings: [] } }],
  }));
}

async function mount() {
  const props = reactive({ words: entries(), onDelete: vi.fn() });
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
  await nextTick();
}

async function expand(word: string) {
  const row = [...container.querySelectorAll<HTMLElement>('.word-item')]
    .find(row => row.querySelector('.word-text')?.textContent === word)!;
  row.querySelector<HTMLElement>('.word-header')!.click();
  await nextTick();
  await nextTick();
}

beforeEach(() => {
  expandedHeight = 1470;
  observers.clear();
  vi.stubGlobal('ResizeObserver', class {
    targets = new Set<Element>();
    constructor(public callback: ResizeObserverCallback) { observers.add(this); }
    observe(target: Element) { this.targets.add(target); }
    unobserve(target: Element) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); observers.delete(this); }
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(280);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { height: this.classList.contains('expanded') ? expandedHeight : 70 } as DOMRect;
  });
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  app?.unmount();
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('large vocabulary list (mocked layout measurements)', () => {
  it('keeps long expanded history mounted while scrolling inside it', async () => {
    await mount();
    await expand('word-0');
    await scroll(1050);
    expect(container.querySelector('.expanded .word-text')?.textContent).toBe('word-0');
    expect(container.querySelector('.context-text')?.textContent).toBe('Fixture context');
    expect(container.querySelectorAll('.word-item').length).toBeLessThan(30);
  });

  it('accounts for expansion in the middle, collapse, and the last rows', async () => {
    await mount();
    await scroll(8400);
    await expand('word-120');
    await scroll(9100);
    expect(container.querySelector('.expanded .word-text')?.textContent).toBe('word-120');
    await scroll(8400);
    await expand('word-120');
    expect(container.querySelector('.word-detail')).toBeNull();
    await scroll(13720);
    const words = [...container.querySelectorAll('.word-text')].map(node => node.textContent);
    expect(words).toContain('word-199');
  });

  it('updates the range when expanded content grows after rendering', async () => {
    await mount();
    await expand('word-0');
    expandedHeight = 2870;
    for (const observer of observers) {
      observer.callback([], observer as unknown as ResizeObserver);
    }
    await nextTick();
    await scroll(2100);
    expect(container.querySelector('.expanded .word-text')?.textContent).toBe('word-0');
  });

  it('keeps a replacement expansion at the same scroll position on screen', async () => {
    await mount();
    await expand('word-0');
    await scroll(1470);
    await expand('word-1');
    expect(container.querySelector('.expanded .word-text')?.textContent).toBe('word-1');
    expect(container.querySelector('.word-list')?.scrollTop).toBe(70);
  });

  it('shows the updated list after deleting many rows or sorting while scrolled', async () => {
    const props = await mount();
    await scroll(13720);
    props.words = props.words.slice(0, 110).reverse();
    await nextTick();
    await nextTick();
    expect(container.querySelector('.word-list')?.scrollTop).toBe(0);
    expect(container.querySelector('.word-text')?.textContent).toBe('word-109');
    props.words = props.words.slice(0, 2);
    await nextTick();
    expect(container.querySelectorAll('.word-item')).toHaveLength(2);
  });

  it('keeps deletion confirmation outside transformed rows and requires confirmation', async () => {
    const props = await mount();
    await scroll(8400);
    await expand('word-120');
    container.querySelector<HTMLElement>('.delete-btn')!.click();
    await nextTick();
    const dialog = container.querySelector('.delete-confirm')!;
    expect(dialog).not.toBeNull();
    expect(dialog.closest('.virtual-scroll-content')).toBeNull();
    expect(props.onDelete).not.toHaveBeenCalled();
    container.querySelector<HTMLElement>('.cancel-btn')!.click();
    await nextTick();
    expect(container.querySelector('.delete-confirm')).toBeNull();
    expect(props.onDelete).not.toHaveBeenCalled();
    container.querySelector<HTMLElement>('.delete-btn')!.click();
    await nextTick();
    container.querySelector<HTMLElement>('.confirm-btn')!.click();
    expect(props.onDelete).toHaveBeenCalledWith('word-120');
  });
});
