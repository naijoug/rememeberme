import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { ContentScriptContext } from 'wxt/utils/content-script-context';
import type { BackgroundResponse } from '~/types';

vi.mock('wxt/browser', () => ({ browser: { runtime: { id: 'disposable-extension' } } }));
const saveWord = vi.hoisted(() => vi.fn());
vi.mock('~/services/storage-client', () => ({ storageClient: { saveWord } }));

type Lookup = { word: string; respond: (response: BackgroundResponse) => void };
let lookups: Lookup[];
let ctx: ContentScriptContext;
let eventSpy: MockInstance<Document['addEventListener']>;

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
  lookups = [];
  document.body.innerHTML = '<p>An apple and a banana.</p>';
  vi.stubGlobal('defineContentScript', (definition: unknown) => definition);
  vi.stubGlobal('browser', { runtime: {
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    sendMessage: vi.fn((message: { word: string }, respond: Lookup['respond']) => {
      lookups.push({ word: message.word, respond });
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
  it('closes and reopens the popup, then saves the second selected word', async () => {
    await select('apple');
    await resolve(lookups[0]);
    document.querySelector<HTMLButtonElement>('.btn-remember')!.click();
    await vi.advanceTimersByTimeAsync(20);
    expect(document.querySelector('.vocab-counter-popup')).toBeNull();
    expect(saveWord).not.toHaveBeenCalled();
    await select('banana');
    await resolve(lookups[1]);
    expect(document.querySelector('.word')?.textContent).toBe('banana');
    saveWord.mockResolvedValue({ word: 'banana', count: 1 });
    document.querySelector<HTMLButtonElement>('.btn-forget')!.click();
    await vi.advanceTimersByTimeAsync(20);
    expect(saveWord).toHaveBeenCalledWith('banana', expect.objectContaining({ word: 'banana' }), 'An apple and a banana.', window.location.href);
  });

  it('keeps the latest definition when an older request completes last', async () => {
    await select('apple');
    await select('banana');
    await resolve(lookups[1]);
    await resolve(lookups[0]);
    expect(document.querySelector('.word')?.textContent).toBe('banana');
  });

  it('ignores an older request failure after a newer lookup succeeds', async () => {
    await select('apple');
    await select('banana');
    await resolve(lookups[1]);
    lookups[0].respond({ success: false, error: 'Request timeout' });
    await vi.advanceTimersByTimeAsync(20);
    expect(document.querySelector('.word')?.textContent).toBe('banana');
    expect(document.querySelector('.error')).toBeNull();
  });

  it('removes listeners, popup and notifications when replaced by an update', async () => {
    await select('apple');
    await resolve(lookups[0]);
    saveWord.mockResolvedValue({ word: 'apple', count: 1 });
    document.querySelector<HTMLButtonElement>('.btn-forget')!.click();
    await vi.advanceTimersByTimeAsync(20);
    expect(document.querySelector('.vocab-counter-notification')).not.toBeNull();
    ctx.notifyInvalidated();
    expect(document.querySelector('#vocab-counter-popup-root')).toBeNull();
    expect(document.querySelector('.vocab-counter-notification')).toBeNull();
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
    document.querySelector<HTMLButtonElement>('.btn-forget')!.click();
    await vi.advanceTimersByTimeAsync(20);
    expect(saveWord).toHaveBeenCalledTimes(1);
  });

});
