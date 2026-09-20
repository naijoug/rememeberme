import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { BackgroundResponse } from '~/types';

const saveWord = vi.hoisted(() => vi.fn());
vi.mock('~/services/storage', () => ({ storageService: { saveWord } }));

type Lookup = { word: string; respond: (response: BackgroundResponse) => void };
let lookups: Lookup[];
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
    onMessage: { addListener: vi.fn() },
    sendMessage: vi.fn((message: { word: string }, respond: Lookup['respond']) => {
      lookups.push({ word: message.word, respond });
    }),
  } });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  eventSpy = vi.spyOn(document, 'addEventListener');
  const content = (await import('../entrypoints/content')).default as { main: () => void };
  content.main();
});

afterEach(() => {
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
});
