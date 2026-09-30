import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { ContentScriptContext } from 'wxt/utils/content-script-context';
import type { BackgroundResponse, Translation } from '~/types';

vi.mock('wxt/browser', () => ({ browser: { runtime: { id: 'disposable-extension' } } }));
const { saveWord, stopTheme, themeCallbacks } = vi.hoisted(() => ({
  saveWord: vi.fn(), stopTheme: vi.fn(), themeCallbacks: [] as Array<(theme: { preference: 'system' | 'dark'; resolved: 'light' | 'dark' }) => void>,
}));
vi.mock('~/services/theme', () => ({ watchTheme: (callback: (theme: { preference: 'system' | 'dark'; resolved: 'light' | 'dark' }) => void) => {
  themeCallbacks.push(callback);
  callback({ preference: 'system', resolved: 'light' });
  return stopTheme;
} }));
vi.mock('~/services/storage-client', () => ({ storageClient: { saveWord } }));

type Lookup = { word: string; respond: (response: BackgroundResponse) => void };
let lookups: Lookup[];
let translations: Array<{ word: string; respond: (response: BackgroundResponse<Translation>) => void }>;
let deferTranslation = false;
let ctx: ContentScriptContext;
let eventSpy: MockInstance<Document['addEventListener']>;

function ui<T extends Element = HTMLElement>(selector: string): T | null {
  return document.querySelector('#vocab-counter-popup-root')?.shadowRoot?.querySelector<T>(selector) ?? null;
}

function startSelection(word: string) {
  const paragraph = document.querySelector('p')!;
  const offset = paragraph.textContent!.indexOf(word);
  const range = document.createRange();
  range.setStart(paragraph.firstChild!, offset);
  range.setEnd(paragraph.firstChild!, offset + word.length);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
}

async function select(word: string) {
  startSelection(word);
  await vi.advanceTimersByTimeAsync(300);
}

async function resolve(lookup: Lookup) {
  lookup.respond({ success: true, data: { word: lookup.word, phonetics: [], meanings: [] } });
  await vi.advanceTimersByTimeAsync(20);
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  saveWord.mockReset();
  stopTheme.mockReset();
  themeCallbacks.length = 0;
  lookups = [];
  translations = [];
  deferTranslation = false;
  document.body.innerHTML = '<p>An apple and a banana.</p>';
  vi.stubGlobal('defineContentScript', (definition: unknown) => definition);
  vi.stubGlobal('browser', { runtime: {
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    sendMessage: vi.fn((message: { type: string; word: string }) => {
      if (message.type === 'GET_TRANSLATION') {
        if (!deferTranslation) return Promise.resolve({ success: false, error: 'Chinese translation unavailable.' });
        return new Promise<BackgroundResponse<Translation>>(respond => translations.push({ word: message.word, respond }));
      }
      return new Promise<BackgroundResponse>(respond => lookups.push({ word: message.word, respond }));
    }),
  } });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  // Deliver WXT's replacement notification deterministically in happy-dom.
  vi.spyOn(window, 'postMessage').mockImplementation(message => {
    window.dispatchEvent(new MessageEvent('message', { data: message }));
  });
  eventSpy = vi.spyOn(document, 'addEventListener');
  const content = (await import('../entrypoints/content')).default as { main: (ctx: ContentScriptContext) => void };
  ctx = new ContentScriptContext('content');
  content.main(ctx);
});

afterEach(() => {
  ctx.notifyInvalidated();
  for (const [type, listener, options] of eventSpy.mock.calls) {
    document.removeEventListener(type, listener, options);
  }
  document.body.replaceChildren();
  window.getSelection()?.removeAllRanges();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('content selection flow (mock browser runtime)', () => {
  it('keeps the card open when its body or the page scrolls', async () => {
    await select('apple');
    await resolve(lookups[0]);
    ui('.lookup-body')!.dispatchEvent(new Event('scroll', { bubbles: true, composed: true }));
    window.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(400);
    expect(ui('.word')?.textContent).toBe('apple');
    expect(lookups).toHaveLength(1);
  });

  it('does not dismiss a drag that starts inside the card and ends outside', async () => {
    await select('apple');
    await resolve(lookups[0]);
    ui('.lookup-body')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }));
    window.getSelection()?.removeAllRanges();
    document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    await vi.advanceTimersByTimeAsync(400);
    expect(ui('.word')?.textContent).toBe('apple');
    expect(saveWord).not.toHaveBeenCalled();
  });

  it('still dismisses a deliberate outside click', async () => {
    await select('apple');
    await resolve(lookups[0]);
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }));
    window.getSelection()?.removeAllRanges();
    document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    await vi.advanceTimersByTimeAsync(400);
    expect(ui('.vocab-counter-popup')).toBeNull();
    expect(lookups).toHaveLength(1);
  });

  it('uses the completed selection snapshot if the page later clears selection', async () => {
    startSelection('apple');
    window.getSelection()?.removeAllRanges();
    await vi.advanceTimersByTimeAsync(300);
    expect(lookups).toHaveLength(1);
    expect(lookups[0].word).toBe('apple');
  });

  it('does not treat the click completing a new selection as dismissal', async () => {
    await select('apple');
    await resolve(lookups[0]);
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }));
    startSelection('banana');
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
    expect(ui('.word')?.textContent).toBe('apple');
    await vi.advanceTimersByTimeAsync(300);
    expect(ui('.word')?.textContent).toBe('banana');
    expect(lookups).toHaveLength(2);
  });

  it('cancels a pending selection on Escape instead of reopening after dismissal', async () => {
    startSelection('apple');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await vi.advanceTimersByTimeAsync(400);
    expect(lookups).toHaveLength(0);
    expect(ui('.vocab-counter-popup')).toBeNull();
    await select('apple');
    await resolve(lookups[0]);
    startSelection('banana');
    ui<HTMLButtonElement>('[aria-label="Close definition"]')!.click();
    await vi.advanceTimersByTimeAsync(400);
    expect(ui('.vocab-counter-popup')).toBeNull();
    expect(lookups).toHaveLength(1);
  });

  it('shows and saves curated Chinese translation even when the English dictionary fails', async () => {
    deferTranslation = true;
    document.body.innerHTML = '<p>A curated collection.</p>';
    await select('curated');
    translations[0].respond({ success: true, data: { text: '精选', target: 'zh-CN', source: 'mymemory' } });
    await vi.advanceTimersByTimeAsync(20);
    expect(ui('.translation-text')?.textContent).toBe('精选');
    expect(ui<HTMLButtonElement>('.btn-forget')?.disabled).toBe(false);
    lookups[0].respond({ success: false, error: 'No local verb definition; online dictionary timed out.' });
    await vi.advanceTimersByTimeAsync(20);
    expect(ui('[role=alert]')).toBeNull();
    expect(ui('.translation-text')?.textContent).toBe('精选');
    saveWord.mockResolvedValue({ word: 'curated', count: 1 });
    ui<HTMLButtonElement>('.btn-forget')!.click();
    await vi.advanceTimersByTimeAsync(20);
    expect(saveWord).toHaveBeenCalledWith('curated', expect.objectContaining({ word: 'curated', translation: { text: '精选', target: 'zh-CN', source: 'mymemory' } }), 'A curated collection.', window.location.href);
  });

  it('keeps an English result usable while Chinese translation fails', async () => {
    deferTranslation = true;
    await select('apple');
    await resolve(lookups[0]);
    expect(ui('.loading')).toBeNull();
    expect(ui<HTMLButtonElement>('.btn-forget')?.disabled).toBe(false);
    translations[0].respond({ success: false, error: 'Free translation quota exhausted.' });
    await vi.advanceTimersByTimeAsync(20);
    expect(ui('[role=alert]')).toBeNull();
    expect(ui('.word')?.textContent).toBe('apple');
    expect(ui('.lookup-note')?.textContent).toContain('quota');
  });

  it('ignores a previous word’s Chinese result and renders remote markup literally', async () => {
    deferTranslation = true;
    await select('apple');
    await select('banana');
    translations[1].respond({ success: true, data: { text: '<img src=x onerror=alert(1)> 香蕉', target: 'zh-CN', source: 'mymemory' } });
    translations[0].respond({ success: true, data: { text: '苹果', target: 'zh-CN', source: 'mymemory' } });
    await vi.advanceTimersByTimeAsync(20);
    expect(ui('.translation-text')?.textContent).toContain('<img src=x');
    expect(ui('.translation-text img')).toBeNull();
    expect(ui('.word')?.textContent).toBe('banana');
  });

  it('renders lookup and theme changes without leaking state as component attributes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    document.body.innerHTML = '<p>Having trouble?</p>';
    await select('Having');
    lookups[0].respond({ success: true, data: { word: 'have', source: 'wordnet', phonetics: [], meanings: [{ partOfSpeech: 'verb', definitions: [{ definition: 'have or possess' }] }] } });
    themeCallbacks[0]({ preference: 'dark', resolved: 'dark' });
    await vi.advanceTimersByTimeAsync(20);
    expect(ui('.rm-theme')?.getAttribute('data-theme')).toBe('dark');
    expect(ui('.vocab-counter-popup')?.hasAttribute('context')).toBe(false);
    expect(ui('.vocab-counter-popup')?.hasAttribute('theme')).toBe(false);
    expect(ui('.word')?.textContent).toBe('Having');
    expect(ui('.base-form')?.textContent).toBe('Base form: have');
    expect(warn).not.toHaveBeenCalled();
    saveWord.mockResolvedValue({ word: 'having', count: 1 });
    ui<HTMLButtonElement>('.btn-forget')!.click();
    await vi.advanceTimersByTimeAsync(20);
    expect(saveWord).toHaveBeenCalledWith('Having', expect.objectContaining({ word: 'have' }), 'Having trouble?', window.location.href);
  });

  it('closes and reopens the popup, then saves the second selected word', async () => {
    await select('apple');
    await resolve(lookups[0]);
    ui<HTMLButtonElement>('.btn-remember')!.click();
    await vi.advanceTimersByTimeAsync(20);
    expect(ui('.vocab-counter-popup')).toBeNull();
    expect(saveWord).not.toHaveBeenCalled();
    await select('banana');
    await resolve(lookups[1]);
    expect(ui('.word')?.textContent).toBe('banana');
    saveWord.mockResolvedValue({ word: 'banana', count: 1 });
    ui<HTMLButtonElement>('.btn-forget')!.click();
    await vi.advanceTimersByTimeAsync(20);
    expect(saveWord).toHaveBeenCalledWith('banana', expect.objectContaining({ word: 'banana' }), 'An apple and a banana.', window.location.href);
  });

  it('keeps the latest definition when an older request completes last', async () => {
    await select('apple');
    await select('banana');
    await resolve(lookups[1]);
    await resolve(lookups[0]);
    expect(ui('.word')?.textContent).toBe('banana');
  });

  it('ignores an older request failure after a newer lookup succeeds', async () => {
    await select('apple');
    await select('banana');
    await resolve(lookups[1]);
    lookups[0].respond({ success: false, error: 'Request timeout' });
    await vi.advanceTimersByTimeAsync(20);
    expect(ui('.word')?.textContent).toBe('banana');
    expect(ui('.error')).toBeNull();
  });

  it('removes listeners, popup and notifications when replaced by an update', async () => {
    await select('apple');
    await resolve(lookups[0]);
    saveWord.mockResolvedValue({ word: 'apple', count: 1 });
    ui<HTMLButtonElement>('.btn-forget')!.click();
    await vi.advanceTimersByTimeAsync(20);
    expect(ui('.vocab-counter-notification')).not.toBeNull();
    ctx.notifyInvalidated();
    expect(document.querySelector('#vocab-counter-popup-root')).toBeNull();
    expect(ui('.vocab-counter-notification')).toBeNull();
    expect(browser.runtime.onMessage.removeListener).toHaveBeenCalled();
    await select('banana');
    expect(lookups).toHaveLength(1);
  });

  it('ignores lookup completion and pending selection after invalidation', async () => {
    await select('apple');
    document.querySelector('p')!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    ctx.notifyInvalidated();
    await resolve(lookups[0]);
    await vi.advanceTimersByTimeAsync(300);
    expect(document.querySelector('#vocab-counter-popup-root')).toBeNull();
    expect(lookups).toHaveLength(1);
  });

  it('registers only one selection/save handler after reinjection', async () => {
    await select('apple');
    await resolve(lookups[0]);
    vi.resetModules();
    const replacement = (await import('../entrypoints/content')).default as { main: (ctx: ContentScriptContext) => void };
    const previous = ctx;
    ctx = new ContentScriptContext('content');
    replacement.main(ctx);
    await vi.advanceTimersByTimeAsync(20);
    expect(previous.isInvalid).toBe(true);
    await select('banana');
    expect(lookups).toHaveLength(2);
    await resolve(lookups[1]);
    expect(document.querySelectorAll('#vocab-counter-popup-root')).toHaveLength(1);
    saveWord.mockResolvedValue({ word: 'banana', count: 1 });
    ui<HTMLButtonElement>('.btn-forget')!.click();
    await vi.advanceTimersByTimeAsync(20);
    expect(saveWord).toHaveBeenCalledTimes(1);
  });

  it('ends loading without a background response and can retry', async () => {
    await select('apple');
    expect(ui('.word')?.textContent).toBe('apple');
    expect(ui<HTMLButtonElement>('.btn-forget')?.disabled).toBe(true);
    expect(document.querySelector('.vocab-counter-popup')).toBeNull();
    await vi.advanceTimersByTimeAsync(10000);
    expect(ui('[role=alert]')?.textContent).toContain('taking too long');
    expect(ui('.loading')).toBeNull();
    ui<HTMLButtonElement>('.retry-btn')!.click();
    await vi.advanceTimersByTimeAsync(20);
    await resolve(lookups[1]);
    expect(ui<HTMLButtonElement>('.btn-forget')?.disabled).toBe(false);
  });

  it('closes on Escape and ignores the late response', async () => {
    await select('apple');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await resolve(lookups[0]);
    expect(ui('.vocab-counter-popup')).toBeNull();
    expect(saveWord).not.toHaveBeenCalled();
  });

  it('prevents duplicate saves while a write is pending', async () => {
    await select('apple');
    await resolve(lookups[0]);
    let complete!: (value: unknown) => void;
    saveWord.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const button = ui<HTMLButtonElement>('.btn-forget')!;
    button.click();
    button.click();
    await vi.advanceTimersByTimeAsync(20);
    expect(saveWord).toHaveBeenCalledTimes(1);
    expect(ui<HTMLButtonElement>('.btn-forget')?.disabled).toBe(true);
    complete({ word: 'apple', count: 1 });
    await vi.advanceTimersByTimeAsync(20);
    expect(ui('.vocab-counter-popup')).toBeNull();
  });

  it('updates the isolated card theme without changing page styles', async () => {
    await select('apple');
    themeCallbacks[0]({ preference: 'dark', resolved: 'dark' });
    await vi.advanceTimersByTimeAsync(20);
    expect(ui('.rm-theme')?.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
  });

});
