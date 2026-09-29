import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { ContentScriptContext } from 'wxt/utils/content-script-context';
import type { BackgroundResponse } from '~/types';

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
let ctx: ContentScriptContext;
let eventSpy: MockInstance<Document['addEventListener']>;

function ui<T extends Element = HTMLElement>(selector: string): T | null {
  return document.querySelector('#vocab-counter-popup-root')?.shadowRoot?.querySelector<T>(selector) ?? null;
}

async function select(word: string) {
  const paragraph = document.querySelector('p')!;
  const offset = paragraph.textContent!.indexOf(word);
  const range = document.createRange();
  range.setStart(paragraph.firstChild!, offset);
  range.setEnd(paragraph.firstChild!, offset + word.length);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
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
  document.body.innerHTML = '<p>An apple and a banana.</p>';
  vi.stubGlobal('defineContentScript', (definition: unknown) => definition);
  vi.stubGlobal('browser', { runtime: {
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    sendMessage: vi.fn((message: { word: string }) => new Promise<BackgroundResponse>(respond => {
      lookups.push({ word: message.word, respond });
    })),
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
