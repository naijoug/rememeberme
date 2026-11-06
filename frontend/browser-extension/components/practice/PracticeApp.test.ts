import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import PracticeApp from './PracticeApp.vue';
import { CloudVocabulary } from '~/services/cloud-vocabulary';
import { VocabularyDB } from '~/services/vocabulary-db';
import { handlePracticeMessage } from '~/services/practice-handler';
import type { BackendClient } from '~/services/backend-client';
const state = vi.hoisted(() => ({ values: new Map<string, unknown>() }));
vi.mock('wxt/utils/storage', () => ({ storage: { getItem: async (k: string) => structuredClone(state.values.get(k) ?? null), watch: () => () => {} } }));
let app: App, root: HTMLElement;
const messages: any[] = [], listeners: Array<(message: unknown) => void> = [];
let repo: CloudVocabulary;
beforeEach(() => {
  state.values.clear(); sessionStorage.clear(); messages.length = 0; listeners.length = 0;
  state.values.set('local:words', [{ word: 'apple', count: 4, createdAt: 1, updatedAt: 1, history: [{ timestamp: 1, context: 'private', url: 'https://private.test',
    definition: { word: 'apple', phonetics: [], meanings: [{ partOfSpeech: 'n', definitions: [{ definition: '<img src=x> A fruit' }] }] } }] }]);
  state.values.set('local:contextExplanationConsent', { version: 1, enabled: true });
  repo = new CloudVocabulary(new VocabularyDB('ui-' + crypto.randomUUID()), { current: async () => null } as unknown as BackendClient);
  vi.stubGlobal('browser', { runtime: { getURL: (path: string) => 'chrome-extension://fixture' + path,
    onMessage: { addListener: (fn: (message: unknown) => void) => listeners.push(fn), removeListener: vi.fn() }, sendMessage: async (message: unknown) => {
    messages.push(message); return handlePracticeMessage(message, { url: 'chrome-extension://fixture/practice.html', frameId: 0 }, 'chrome-extension://fixture/', repo);
  } } });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { if (!url.startsWith('chrome-extension://fixture/dictionary/ipa/')) throw new Error('Unexpected external request'); return new Response('{}'); }));
  vi.spyOn(document, 'hasFocus').mockReturnValue(true); vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  root = document.createElement('div'); document.body.append(root);
});
afterEach(() => { app?.unmount(); root.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mount() { app = createApp(PracticeApp); app.mount(root); await vi.waitFor(() => expect(root.textContent).toContain('On this device')); }
async function click(text: string) { const b = [...root.querySelectorAll('button')].find(b => b.textContent?.trim() === text || b.getAttribute('aria-label') === text); expect(b, text).toBeTruthy(); b!.click(); await nextTick(); }
async function ready() { await vi.waitFor(() => expect(root.querySelector<HTMLInputElement>('input')?.disabled).toBe(false)); }
async function type(value: string) { const input = root.querySelector('input')!; input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); await nextTick(); }
it('defaults to copy and completes without Enter, Check or Next buttons; preserves vocabulary', async () => {
  const before = await repo.exportData(); await mount();
  expect([...root.querySelectorAll('button')].find(b => b.textContent === 'Copy')?.getAttribute('aria-pressed')).toBe('true');
  await click('New round'); await ready();
  expect(root.querySelector('img[src=x]')).toBeNull(); expect(root.textContent).toContain('<img src=x> A fruit');
  await type('ap'); expect(root.querySelectorAll('.letter-correct')).toHaveLength(2);
  await type('APPLE'); await vi.waitFor(() => expect(root.textContent).toContain('Round complete'));
  expect(root.textContent).toContain('1 of 1 words on the first try');
  expect(root.textContent).not.toContain('Check spelling'); expect(root.textContent).not.toContain('Next word');
  expect(messages.filter(m => m.action?.kind === 'answer')).toHaveLength(1);
  expect(messages.find(m => m.action?.kind === 'answer').action).toMatchObject({ advance: true, mistakes: 0 });
  expect(messages.every(m => m.type.startsWith('PRACTICE_'))).toBe(true); expect(await repo.exportData()).toBe(before);
});
it('restarts a mistyped copy word and persists the typo before automatic retry progression', async () => {
  await mount(); await click('New round'); await ready(); await type('az');
  expect(root.querySelector('.typing-error')).not.toBeNull();
  expect(messages.filter(m => m.action?.kind === 'answer')).toHaveLength(0);
  await vi.waitFor(() => expect(root.querySelector('input')!.value).toBe(''));
  await type('apple'); await vi.waitFor(() => expect(messages.filter(m => m.action?.kind === 'answer')).toHaveLength(1));
  await ready(); expect(messages.find(m => m.action?.kind === 'answer').action.mistakes).toBe(1);
  const view = await repo.practice({ type: 'PRACTICE_GET' }); expect(view.session!.summary.firstCorrect).toBe(0); expect(view.session!.current!.started).toBe(true);
});
it('keeps spelling optional with hidden target and Enter submission', async () => {
  await mount(); await click('Spelling'); await click('New round'); await ready();
  expect(root.querySelector('.typing-placeholder')?.textContent).toBe('Type the word');
  await type('apple'); expect(messages.filter(m => m.action?.kind === 'answer')).toHaveLength(0);
  root.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await vi.waitFor(() => expect(root.textContent).toContain('Round complete'));
});
it('pauses on blur, resumes without regrading, and keeps clearing behind Settings confirmation', async () => {
  await mount(); await click('New round'); await ready(); await type('ap');
  window.dispatchEvent(new Event('blur')); await nextTick(); expect(root.querySelector<HTMLInputElement>('input')!.disabled).toBe(true);
  await click('Resume'); await ready(); expect(root.querySelector('input')!.value).toBe('ap');
  expect(messages.filter(m => m.action?.kind === 'resume')).toHaveLength(0);
  await click('Practice settings'); await click('Clear practice records'); expect(root.querySelector('[role=dialog]')).not.toBeNull();
  await click('Cancel'); expect((await repo.practice({ type: 'PRACTICE_GET' })).session).not.toBeNull();
  await click('Practice settings'); await click('Clear practice records'); await click('Clear records');
  await vi.waitFor(async () => expect((await repo.practice({ type: 'PRACTICE_GET' })).session).toBeNull());
  await vi.waitFor(() => expect(root.textContent).toContain('Ready to type?'));
});
it('does not let a delayed read undo an automatically committed answer', async () => {
  await mount(); await click('New round'); await ready();
  const original = browser.runtime.sendMessage; let deliver: (() => void) | undefined, delayed = false;
  browser.runtime.sendMessage = (async (message: any) => {
    const reply = await original(message);
    if (message.type === 'PRACTICE_GET' && !delayed) { delayed = true; return new Promise(resolve => { deliver = () => resolve(reply); }); }
    return reply;
  }) as typeof original;
  listeners[0]({ type: 'PRACTICE_CHANGED' }); await vi.waitFor(() => expect(deliver).toBeDefined());
  await type('apple'); await vi.waitFor(() => expect(root.textContent).toContain('Round complete'));
  deliver!(); await new Promise(resolve => setTimeout(resolve, 10)); await nextTick(); expect(root.textContent).toContain('Round complete');
});
it('preserves an existing spelling round instead of silently replacing user progress', async () => {
  const view = await repo.practice({ type: 'PRACTICE_GET' });
  await repo.practice({ type: 'PRACTICE_COMMAND', owner: view.owner, scope: view.scope, revision: view.revision,
    requestId: crypto.randomUUID(), action: { kind: 'start', mode: 'recall', replace: false } });
  await mount(); expect([...root.querySelectorAll('button')].find(b => b.textContent === 'Spelling')?.getAttribute('aria-pressed')).toBe('true');
  await click('Copy'); expect(root.querySelector('[role=dialog]')).not.toBeNull(); await click('Cancel');
  expect((await repo.practice({ type: 'PRACTICE_GET' })).session!.mode).toBe('recall');
});
it('keeps current input when another question is deleted, but detects repeated tab takeovers', async () => {
  await repo.importData(JSON.stringify([{ word: 'banana', count: 1, createdAt: 1, updatedAt: 1, history: [{ timestamp: 1, context: '', url: '',
    definition: { word: 'banana', phonetics: [], meanings: [{ partOfSpeech: 'n', definitions: [{ definition: 'A yellow snack' }] }] } }] }]));
  await mount(); await click('New round'); await ready();
  const view = await repo.practice({ type: 'PRACTICE_GET' }), currentWord = view.session!.current!.word!;
  const other = (await repo.getAllWords()).find(w => w.word !== currentWord)!;
  await type(currentWord.slice(0, 2)); await repo.deleteWord(other.id!); listeners[0]({ type: 'PRACTICE_CHANGED' });
  await vi.waitFor(() => expect(root.textContent).toContain('1 changed or removed words'));
  expect(root.querySelector('input')?.value).toBe(currentWord.slice(0, 2));
  async function takeOver() {
    const latest = await repo.practice({ type: 'PRACTICE_GET' });
    await repo.practice({ type: 'PRACTICE_COMMAND', requestId: crypto.randomUUID(), owner: latest.owner, scope: latest.scope,
      revision: latest.revision, action: { kind: 'resume', sessionId: latest.session!.id } });
    listeners[0]({ type: 'PRACTICE_CHANGED' }); await vi.waitFor(() => expect(root.querySelector<HTMLInputElement>('input')!.disabled).toBe(true));
  }
  await takeOver(); await click('Resume'); await ready(); await takeOver();
});
it('does not auto-complete or skip during composition; completes only after the committed text', async () => {
  await mount(); await click('New round'); await ready(); const input = root.querySelector('input')!;
  input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); await type('apple');
  const skip = [...root.querySelectorAll('button')].find(b => b.textContent?.includes('Skip word'))!; expect(skip.disabled).toBe(true);
  expect(messages.filter(m => m.action?.kind === 'answer')).toHaveLength(0);
  input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  await vi.waitFor(() => expect(root.textContent).toContain('Round complete'));
  expect(messages.filter(m => m.action?.kind === 'answer')).toHaveLength(1);
});
it('keeps the first typed character after focus moves to noninteractive page content', async () => {
  await mount(); await click('New round'); await ready();
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true })); await nextTick();
  expect(root.querySelector('input')!.value).toBe('a'); expect(root.querySelectorAll('.letter-correct')).toHaveLength(1);
});

it.each(['escape', 'blur', 'settings'])('keeps a %s pause made while a save response is pending', async (trigger) => {
  await mount();
  const original = browser.runtime.sendMessage;
  let deliver: (() => void) | undefined;
  browser.runtime.sendMessage = (async (message: any) => {
    const reply = await original(message);
    if (message.action?.kind === 'start') return new Promise(resolve => { deliver = () => resolve(reply); });
    return reply;
  }) as typeof original;
  await click('New round'); await vi.waitFor(() => expect(deliver).toBeDefined());
  if (trigger === 'escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  else if (trigger === 'blur') window.dispatchEvent(new Event('blur'));
  else await click('Practice settings');
  deliver!();
  await vi.waitFor(() => expect(root.querySelector('input')).not.toBeNull());
  expect(root.querySelector('input')!.disabled).toBe(true);
  if (trigger === 'settings') await click('Close settings');
  await click('Resume'); await ready();
});
it('shows spelling feedback before the next hidden target and lists difficult words at completion', async () => {
  await mount(); await click('Spelling'); await click('New round'); await ready();
  for (let attempt = 0; attempt < 3; attempt++) {
    await type('wrong'); root.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(root.querySelector('.practice-answer-feedback')?.textContent).toContain('Incorrect'));
    expect(root.querySelector('.practice-answer-feedback')?.textContent).toContain('apple');
    if (attempt < 2) {
      expect(root.querySelector('input')).toBeNull();
      await click('Continue'); await ready();
      expect(root.querySelector('.practice-answer-feedback')).toBeNull();
      expect(root.querySelector('.typing-word')!.textContent).not.toContain('apple');
    }
  }
  expect(root.textContent).toContain('Round complete');
  expect(root.querySelector('[aria-label="Words to practice again"]')?.textContent).toContain('apple');
  expect(root.textContent).toContain('Retries 0 / 2 · Hints 0 · Assisted 0 · Interrupted 0 · Skipped 0');
});
