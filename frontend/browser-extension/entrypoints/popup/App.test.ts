import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, type App as VueApp } from 'vue';
import { storageService } from '~/services/storage';
import { handleBackgroundRequest } from '~/services/background-handler';
import type { WordEntry } from '~/types';
import App from './App.vue';

const storageApiMock = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  return {
    values,
    storage: {
      getItem: vi.fn(async (key: string) => structuredClone(values.get(key) ?? null)),
      setItem: vi.fn(async (key: string, value: unknown) => { values.set(key, structuredClone(value)); }),
      watch: vi.fn(() => () => {}),
    },
  };
});
vi.mock('wxt/utils/storage', () => ({ storage: storageApiMock.storage }));

function entry(word: string, count: number, updatedAt: number): WordEntry {
  return {
    word, count, createdAt: 1, updatedAt,
    history: [{
      timestamp: updatedAt,
      context: `An ${word} in context.`,
      url: 'https://example.com/article',
      definition: { word, phonetics: [], meanings: [] },
    }],
  };
}

let app: VueApp;
let container: HTMLDivElement;

async function mount(words: WordEntry[] = []) {
  storageApiMock.values.set('local:words', words);
  app = createApp(App);
  app.mount(container);
  await vi.waitFor(() => expect(container.querySelector('.loading')).toBeNull());
  expect(container.querySelector('.cloud-connection')).toBeNull();
  expect(container.querySelector('[aria-label="HTTPS API address"]')).toBeNull();
}

function click(selector: string) {
  const element = container.querySelector<HTMLElement>(selector);
  expect(element, selector).not.toBeNull();
  element!.click();
}

function importFile(text: string) {
  const input = container.querySelector<HTMLInputElement>('input[type=file]')!;
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [new File([text], 'vocabulary.json', { type: 'application/json' })],
  });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal('browser', { runtime: {
    sendMessage: (message: unknown) => handleBackgroundRequest(message, { getDefinition: vi.fn() }, storageService),
  } });
  storageApiMock.values.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  app?.unmount();
  container.remove();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('mounted vocabulary popup', () => {
  it('shows saved Chinese-only translations in the list and reading view', async () => {
    const word = entry('curated', 1, 1);
    word.history[0].definition.translation = { text: '精选', target: 'zh-CN', source: 'mymemory' };
    await mount([word]);
    expect(container.querySelector('.word-summary')?.textContent).toBe('精选');
    click('.word-header');
    await vi.waitFor(() => expect(container.querySelector('.translation-text')?.textContent).toBe('精选'));
    expect(container.querySelector('.definition-section')?.textContent).toContain('No English definition saved');
  });

  it('shows the empty state when no words are saved', async () => {
    await mount();
    expect(container.querySelector('.empty')?.textContent).toContain('No words saved yet');
  });

  it('renders saved words and changes their order through the sort control', async () => {
    await mount([entry('apple', 3, 1), entry('banana', 1, 2)]);
    const displayedWords = () => [...container.querySelectorAll('.word-text')].map(node => node.textContent);
    expect(displayedWords()).toEqual(['apple', 'banana']);
    const select = container.querySelector<HTMLSelectElement>('select')!;
    select.value = 'updatedAt';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(displayedWords()).toEqual(['banana', 'apple']));
  });

  it('requires confirmation to delete and supports cancelling', async () => {
    await mount([entry('apple', 1, 1)]);
    click('.word-header');
    await vi.waitFor(() => expect(container.querySelector('.delete-btn')).not.toBeNull());
    click('.delete-btn');
    await vi.waitFor(() => expect(container.querySelector('.delete-confirm')).not.toBeNull());
    expect(await storageService.getWord('apple')).not.toBeNull();
    click('.cancel-btn');
    await vi.waitFor(() => expect(container.querySelector('.delete-confirm')).toBeNull());
    expect(await storageService.getWord('apple')).not.toBeNull();
    click('.delete-btn');
    await vi.waitFor(() => expect(container.querySelector('.confirm-btn')).not.toBeNull());
    click('.confirm-btn');
    await vi.waitFor(() => expect(container.querySelector('.empty')).not.toBeNull());
    expect(await storageService.getWord('apple')).toBeNull();
  });

  it('resets the displayed count while retaining history', async () => {
    await mount([entry('apple', 3, 1)]);
    click('.word-header');
    await vi.waitFor(() => expect(container.querySelector('.reset-btn')).not.toBeNull());
    click('.reset-btn');
    await vi.waitFor(() => expect(container.querySelector('.count')?.textContent).toBe('Forgotten 0 times'));
    expect((await storageService.getWord('apple'))?.history).toHaveLength(1);
    await vi.waitFor(() => expect(container.querySelector('.context-text')?.textContent).toBe('An apple in context.'));
  });

  it('imports through the file control and renders imported HTML as text', async () => {
    await mount();
    const imported = entry('apple', 1, 1);
    imported.history[0].context = '<img src=x onerror="alert(1)"> apple';
    importFile(JSON.stringify([imported]));
    await vi.waitFor(() => expect(container.querySelector('.success')).not.toBeNull());
    expect(container.querySelector('.word-text')?.textContent).toBe('apple');
    click('.word-header');
    await vi.waitFor(() => expect(container.querySelector('.context-text')?.textContent).toBe(imported.history[0].context));
    expect(container.querySelector('.context-text img')).toBeNull();
    expect(container.querySelector('mark')?.textContent).toBe('apple');
  });

  it('reports invalid imports without altering existing vocabulary', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await mount([entry('apple', 1, 1)]);
    importFile('{invalid json');
    await vi.waitFor(() => expect(container.querySelector('.error')?.textContent?.trim()).toBe('Invalid JSON format'));
    expect((await storageService.getAllWords()).map(word => word.word)).toEqual(['apple']);
  });

  it('searches the vocabulary and opens a word in its reading view', async () => {
    await mount([entry('apple', 3, 1), entry('banana', 1, 2)]);
    const input = container.querySelector<HTMLInputElement>('input[type=search]')!;
    input.value = 'BAN';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(container.querySelectorAll('.word-item')).toHaveLength(1));
    click('.word-header');
    await vi.waitFor(() => expect(container.querySelector('.word-title')?.textContent).toBe('banana'));
    expect(container.querySelector('.word-list')).toBeNull();
    click('.back-link');
    await vi.waitFor(() => expect(container.querySelector('.word-text')?.textContent).toBe('banana'));
  });

  it('persists the theme separately without changing vocabulary', async () => {
    await mount([entry('apple', 3, 1)]);
    click('[aria-label="Use dark theme"]');
    await vi.waitFor(() => expect(container.querySelector('.rm-theme')?.getAttribute('data-theme')).toBe('dark'));
    expect(storageApiMock.values.get('local:appearance')).toBe('dark');
    expect((await storageService.getWord('apple'))?.count).toBe(3);
  });
});
