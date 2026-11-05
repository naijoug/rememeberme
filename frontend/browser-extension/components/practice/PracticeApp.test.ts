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
const messages: any[] = [];
const listeners: Array<(message: unknown) => void> = [];
let repo: CloudVocabulary;
beforeEach(() => {
  state.values.clear(); sessionStorage.clear(); messages.length = 0; listeners.length = 0;
  state.values.set('local:words', [{ word: 'apple', count: 4, createdAt: 1, updatedAt: 1, history: [{ timestamp: 1, context: 'private', url: 'https://private.test',
    definition: { word: 'apple', phonetics: [], meanings: [{ partOfSpeech: 'n', definitions: [{ definition: '<img src=x> A fruit' }] }] } }] }]);
  state.values.set('local:contextExplanationConsent', { version: 1, enabled: true });
  repo = new CloudVocabulary(new VocabularyDB('ui-' + crypto.randomUUID()), { current: async () => null } as unknown as BackendClient);
  vi.stubGlobal('browser', { runtime: { onMessage: { addListener: (fn: (message: unknown) => void) => listeners.push(fn), removeListener: vi.fn() }, sendMessage: async (message: unknown) => {
    messages.push(message); return handlePracticeMessage(message, { url: 'chrome-extension://fixture/practice.html', frameId: 0 }, 'chrome-extension://fixture/', repo);
  } } });
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  root = document.createElement('div'); document.body.append(root);
});
afterEach(() => { app?.unmount(); root.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mount(available = 1) { app = createApp(PracticeApp); app.mount(root); await vi.waitFor(() => expect(root.textContent).toContain(`${available} available`)); }
async function click(text: string) { const b = [...root.querySelectorAll('button')].find(b => b.textContent?.trim() === text); expect(b, text).toBeTruthy(); b!.click(); await nextTick(); }
it('completes local spelling, renders untrusted meanings literally and makes no lookup/consent calls', async () => {
  const before = await repo.exportData(); await mount(); await click('Start a new round');
  await vi.waitFor(() => expect(root.querySelector('input')).not.toBeNull());
  expect(root.querySelector('img')).toBeNull(); expect(root.textContent).toContain('<img src=x> A fruit');
  expect(root.querySelector('.practice-letters')).toBeNull();
  const input = root.querySelector('input')!;
  input.value = ' APPLE '; input.dispatchEvent(new Event('input', { bubbles: true })); await nextTick();
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true }));
  await vi.waitFor(() => expect(root.textContent).toContain('Round complete'));
  expect(root.textContent).toContain('100%');
  expect(messages.filter(m => m.action?.kind === 'answer')).toHaveLength(1);
  expect(messages.every(m => m.type.startsWith('PRACTICE_'))).toBe(true);
  expect(await repo.exportData()).toBe(before);
});
it('pauses on blur, resumes without regrading, and confirms record deletion', async () => {
  await mount(); const select = root.querySelector('select')!; select.value = 'copy'; select.dispatchEvent(new Event('change', { bubbles: true }));
  await click('Start a new round'); await vi.waitFor(() => expect(root.querySelector('input')).not.toBeNull());
  window.dispatchEvent(new Event('blur')); await nextTick(); expect(root.querySelector('input')).toBeNull();
  await click('Resume practice'); await vi.waitFor(() => expect(root.querySelector('input')).not.toBeNull());
  expect(messages.filter(m => m.action?.kind === 'resume')).toHaveLength(0);
  await click('Clear practice records'); expect(root.querySelector('[role=dialog]')).not.toBeNull();
  await click('Cancel'); expect((await repo.practice({ type: 'PRACTICE_GET' })).session).not.toBeNull();
  await click('Clear practice records'); await click('Clear records');
  await vi.waitFor(async () => expect((await repo.practice({ type: 'PRACTICE_GET' })).session).toBeNull());
  await vi.waitFor(() => expect(root.querySelector('.practice-card')).toBeNull());
});
it('does not let a delayed change-notification read undo a newer committed answer', async () => {
  await mount(); await click('Start a new round'); await vi.waitFor(() => expect(root.querySelector('input')).not.toBeNull());
  const original = browser.runtime.sendMessage;
  let deliver: (() => void) | undefined, delayed = false;
  browser.runtime.sendMessage = (async (message: any) => {
    const reply = await original(message);
    if (message.type === 'PRACTICE_GET' && !delayed) { delayed = true; return new Promise(resolve => { deliver = () => resolve(reply); }); }
    return reply;
  }) as typeof original;
  listeners[0]({ type: 'PRACTICE_CHANGED' }); await vi.waitFor(() => expect(deliver).toBeDefined());
  const input = root.querySelector('input')!; input.value = 'apple'; input.dispatchEvent(new Event('input', { bubbles: true })); await nextTick();
  await click('Check spelling'); await vi.waitFor(() => expect(root.textContent).toContain('Round complete'));
  deliver!(); await new Promise(resolve => setTimeout(resolve, 10)); await nextTick();
  expect(root.textContent).toContain('Round complete'); expect(root.textContent).toContain('100%');
});
it('restores the mode selector to the retained session after reopening', async () => {
  const view = await repo.practice({ type: 'PRACTICE_GET' });
  await repo.practice({ type: 'PRACTICE_COMMAND', owner: view.owner, scope: view.scope, revision: view.revision,
    requestId: crypto.randomUUID(), action: { kind: 'start', mode: 'copy', replace: false } });
  await mount(); expect(root.querySelector('select')!.value).toBe('copy');
});
it('keeps an unchanged current answer when another question is deleted, but detects repeated tab takeovers', async () => {
  await repo.importData(JSON.stringify([{ word: 'banana', count: 1, createdAt: 1, updatedAt: 1, history: [{ timestamp: 1, context: '', url: '',
    definition: { word: 'banana', phonetics: [], meanings: [{ partOfSpeech: 'n', definitions: [{ definition: 'A yellow snack' }] }] } }] }]));
  await mount(2); await click('Start a new round'); await vi.waitFor(() => expect(root.querySelector('input')).not.toBeNull());
  const view = await repo.practice({ type: 'PRACTICE_GET' });
  const currentWord = view.session!.current!.prompt.includes('yellow') ? 'banana' : 'apple';
  const other = (await repo.getAllWords()).find(w => w.word !== currentWord)!;
  const input = root.querySelector('input')!; input.value = 'partial'; input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('paste', { bubbles: true })); await nextTick();
  await repo.deleteWord(other.id!); listeners[0]({ type: 'PRACTICE_CHANGED' });
  await vi.waitFor(() => expect(root.textContent).toContain('1 changed or removed words'));
  expect(root.querySelector('input')?.value).toBe('partial'); expect(root.textContent).toContain('Assisted input');
  async function takeOver() {
    const latest = await repo.practice({ type: 'PRACTICE_GET' });
    await repo.practice({ type: 'PRACTICE_COMMAND', requestId: crypto.randomUUID(), owner: latest.owner, scope: latest.scope,
      revision: latest.revision, action: { kind: 'resume', sessionId: latest.session!.id } });
    listeners[0]({ type: 'PRACTICE_CHANGED' });
    await vi.waitFor(() => expect(root.querySelector('input')).toBeNull());
  }
  await takeOver(); await click('Resume practice'); await vi.waitFor(() => expect(root.querySelector('input')).not.toBeNull());
  await takeOver();
});
it('disables mouse submission while IME composition is active', async () => {
  await mount(); await click('Start a new round'); await vi.waitFor(() => expect(root.querySelector('input')).not.toBeNull());
  root.querySelector('input')!.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); await nextTick();
  const check = [...root.querySelectorAll('button')].find(b => b.textContent === 'Check spelling')!;
  expect(check.disabled).toBe(true); check.click(); await nextTick();
  expect(messages.filter(m => m.action?.kind === 'answer')).toHaveLength(0);
});
