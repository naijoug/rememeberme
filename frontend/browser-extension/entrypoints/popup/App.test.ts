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
    sendMessage: (message: unknown) => ['CLOUD_STATUS', 'CLOUD_RESTORE'].includes((message as { type?: string }).type ?? '')
      ? Promise.resolve({ success: true, data: { connected: false, owner: 'anonymous', enabled: false, pending: 0, conflicts: 0, localWords: 0, archives: [] } })
      : handleBackgroundRequest(message, { getDefinition: vi.fn() }, storageService),
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
  it('opens one settings page directly from the gear with appearance, account, backups and privacy', async () => {
    const original = [entry('local-word', 2, 1)];
    await mount(original);
    expect(container.textContent).toContain('local-word');
    expect(container.querySelector('[aria-label="More options"]')).toBeNull();
    expect(container.querySelector('[aria-label="Use dark theme"]')).toBeNull();
    click('[aria-label="Settings"]');
    await vi.waitFor(() => expect(container.textContent).toContain('Sign in with GitHub'));
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(container.querySelectorAll('h2')).toHaveLength(0);
    expect(container.querySelector('.rm-header h1')?.textContent).toBe('Setting');
    expect(container.querySelector('.settings-page .back-link')).toBeNull();
    expect(container.querySelector('[aria-label="Theme"]')).not.toBeNull();
    expect(container.textContent).toContain('Import backup');
    expect(container.textContent).toContain('Export vocabulary');
    const privacy = container.querySelector<HTMLAnchorElement>('a[target="_blank"]')!;
    expect(privacy.textContent).toContain('Privacy & support');
    expect(privacy.href).toBe('https://lookup.couplelabs.cn/privacy');
    expect(privacy.rel).toBe('noopener noreferrer');
    expect(document.activeElement).toBe(container.querySelector('[aria-label="Back to vocabulary"]'));
    expect(storageApiMock.values.get('local:words')).toEqual(original);
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await vi.waitFor(() => expect(container.querySelector('.settings-page')).toBeNull());
    expect(document.activeElement).toBe(container.querySelector('[aria-label="Settings"]'));
    expect(container.textContent).toContain('local-word');
  });

  it('returns from settings to the same reading view without changing its saved count', async () => {
    await mount([entry('apple', 3, 1)]);
    click('.word-header'); await vi.waitFor(() => expect(container.querySelector('.word-title')?.textContent).toBe('apple'));
    click('[aria-label="Settings"]');
    await vi.waitFor(() => expect(container.querySelector('.settings-page')).not.toBeNull());
    click('[aria-label="Back to vocabulary"]');
    await vi.waitFor(() => expect(container.querySelector('.word-title')?.textContent).toBe('apple'));
    expect((await storageService.getWord('apple'))?.count).toBe(3);
  });

  it('imports and exports from the unified settings without navigating away', async () => {
    const original = entry('apple', 3, 1);
    await mount([original]); click('[aria-label="Settings"]');
    await vi.waitFor(() => expect(container.querySelector('.settings-page')).not.toBeNull());
    const input = container.querySelector<HTMLInputElement>('input[type=file]')!;
    const choose = vi.spyOn(input, 'click').mockImplementation(() => {});
    [...container.querySelectorAll<HTMLButtonElement>('.settings-page button')].find(button => button.textContent?.includes('Import backup'))!.click();
    expect(choose).toHaveBeenCalledOnce();
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const createURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic-backup');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    [...container.querySelectorAll<HTMLButtonElement>('.settings-page button')].find(button => button.textContent?.includes('Export vocabulary'))!.click();
    await vi.waitFor(() => expect(download).toHaveBeenCalledOnce());
    expect(JSON.parse(await (createURL.mock.calls[0][0] as Blob).text())).toEqual([original]);
    importFile(JSON.stringify([entry('banana', 1, 2)]));
    await vi.waitFor(() => expect(container.querySelector('.success')).not.toBeNull());
    expect(container.querySelector('.settings-page')).not.toBeNull();
    expect((await storageService.getAllWords()).map(word => word.word).sort()).toEqual(['apple', 'banana']);
    expect((await storageService.getWord('apple'))?.count).toBe(3);
  });
  it('displays account words as soon as opening-time sync completes', async () => {
    let finish!: () => void;
    const ready = new Promise<void>(resolve => { finish = resolve; });
    vi.stubGlobal('browser', { runtime: { sendMessage: async (message: { type: string }) => {
      if (message.type === 'CLOUD_RESTORE') {
        await ready; storageApiMock.values.set('local:words', [entry('synced', 2, 1)]);
        return { success: true };
      }
      return handleBackgroundRequest(message, { getDefinition: vi.fn() }, storageService);
    } } });
    await mount();
    expect(container.textContent).not.toContain('synced');
    finish();
    await vi.waitFor(() => expect(container.querySelector('.word-text')?.textContent).toBe('synced'));
  });

  it('opens all account words from settings even when the previous list was filtered', async () => {
    const cloudStatus = { connected: true, owner: 'account:fixture', enabled: true, pending: 0,
      conflicts: 0, localWords: 0, accountWords: 2, archives: [], displayName: 'synthetic-reader' };
    vi.stubGlobal('browser', { runtime: { sendMessage: (message: { type: string }) =>
      message.type.startsWith('CLOUD_') ? Promise.resolve({ success: true, data: cloudStatus })
        : handleBackgroundRequest(message, { getDefinition: vi.fn() }, storageService),
    } });
    await mount([entry('apple', 1, 1), entry('banana', 2, 2)]);
    const search = container.querySelector<HTMLInputElement>('[aria-label="Search vocabulary"]')!;
    search.value = 'missing'; search.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(container.textContent).toContain('No matching words'));
    click('[aria-label="Settings"]');
    await vi.waitFor(() => expect(container.textContent).toContain('View account words'));
    [...container.querySelectorAll('button')].find(button => button.textContent?.includes('View account words'))!.click();
    await vi.waitFor(() => expect(container.querySelector('.settings-page')).toBeNull());
    expect([...container.querySelectorAll('.word-text')].map(node => node.textContent)).toEqual(['banana', 'apple']);
    expect(document.activeElement).toBe(container.querySelector('[aria-label="Settings"]'));
  });

  it('keeps list scroll position when background refresh finds no changed words', async () => {
    await mount(Array.from({ length: 20 }, (_, index) => entry(`word${index}`, 1, index)));
    const list = container.querySelector<HTMLElement>('.word-list')!;
    list.scrollTop = 152; list.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(list.scrollTop).toBe(152);
  });

  it('refreshes downloaded words while the popup stays open and stops polling on unmount', async () => {
    await mount([entry('original', 1, 1)]);
    storageApiMock.values.set('local:words', [entry('downloaded', 2, 2)]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(container.querySelector('.word-text')?.textContent).toBe('downloaded');
    app.unmount();
    const reads = storageApiMock.storage.getItem.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(storageApiMock.storage.getItem.mock.calls.length).toBe(reads);
  });

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
    click('[aria-label="Settings"]');
    await vi.waitFor(() => expect(container.querySelector('[aria-label="Theme"]')).not.toBeNull());
    const theme = container.querySelector<HTMLSelectElement>('[aria-label="Theme"]')!;
    expect(theme.value).toBe('system');
    theme.value = 'dark'; theme.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(container.querySelector('.rm-theme')?.getAttribute('data-theme')).toBe('dark'));
    expect(storageApiMock.values.get('local:appearance')).toBe('dark');
    theme.value = 'light'; theme.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(storageApiMock.values.get('local:appearance')).toBe('light'));
    theme.value = 'system'; theme.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(storageApiMock.values.get('local:appearance')).toBe('system'));
    expect((await storageService.getWord('apple'))?.count).toBe(3);
  });
});
