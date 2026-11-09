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
async function mount() { app = createApp(PracticeApp); app.mount(root); await vi.waitFor(() => expect(root.textContent).toContain('我的单词')); }
async function click(text: string) { const b = [...root.querySelectorAll('button')].find(b => b.textContent?.trim() === text || b.getAttribute('aria-label') === text); expect(b, text).toBeTruthy(); b!.click(); await nextTick(); }
async function ready() { await vi.waitFor(() => expect(root.querySelector<HTMLInputElement>('input')?.disabled).toBe(false)); }
async function type(value: string) { const input = root.querySelector('input')!; input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); await nextTick(); }
it('defaults to copy and completes without Enter, Check or Next buttons; preserves vocabulary', async () => {
  const before = await repo.exportData(); await mount();
  expect([...root.querySelectorAll('button')].find(b => b.textContent === '看词跟写')?.getAttribute('aria-pressed')).toBe('true');
  await click('开始新一轮'); await ready();
  expect(root.querySelector('img[src=x]')).toBeNull(); expect(root.textContent).toContain('<img src=x> A fruit');
  await type('ap'); expect(root.querySelectorAll('.letter-correct')).toHaveLength(2);
  await type('APPLE'); await vi.waitFor(() => expect(root.textContent).toContain('本轮完成'));
  expect(root.textContent).toContain('1 个单词中，1 个一次写对');
  expect(root.textContent).not.toContain('Check spelling'); expect(root.textContent).not.toContain('Next word');
  expect(messages.filter(m => m.action?.kind === 'answer')).toHaveLength(1);
  expect(messages.find(m => m.action?.kind === 'answer').action).toMatchObject({ advance: true, mistakes: 0 });
  expect(messages.every(m => m.type.startsWith('PRACTICE_'))).toBe(true); expect(await repo.exportData()).toBe(before);
});
it('restarts a mistyped copy word and persists the typo before automatic retry progression', async () => {
  await mount(); await click('开始新一轮'); await ready(); await type('az');
  expect(root.querySelector('.typing-error')).not.toBeNull();
  expect(messages.filter(m => m.action?.kind === 'answer')).toHaveLength(0);
  await vi.waitFor(() => expect(root.querySelector('input')!.value).toBe(''));
  await type('apple'); await vi.waitFor(() => expect(messages.filter(m => m.action?.kind === 'answer')).toHaveLength(1));
  await ready(); expect(messages.find(m => m.action?.kind === 'answer').action.mistakes).toBe(1);
  const view = await repo.practice({ type: 'PRACTICE_GET' }); expect(view.session!.summary.firstCorrect).toBe(0); expect(view.session!.current!.started).toBe(true);
});
it('dictates with frosted references and sharp entered letters, then advances automatically', async () => {
  await mount(); await click('模糊听写'); await click('开始新一轮'); await ready();
  expect(root.querySelectorAll('.letter-reference.is-frosted')).toHaveLength(5);
  expect(root.querySelector('#practice-target')).toBeNull();
  expect(root.querySelector('.practice-meaning')?.getAttribute('aria-hidden')).toBe('true');
  expect(root.querySelector('.practice-meaning')?.hasAttribute('title')).toBe(false);
  expect(root.querySelector('.practice-ipa')?.getAttribute('aria-hidden')).toBe('true');
  expect(root.querySelector('.speaker-button')).not.toBeNull();
  await type('ap');
  expect([...root.querySelectorAll('.letter-entered')].map(el => el.textContent).join('')).toBe('ap');
  expect(root.querySelector('.letter-entered.is-frosted')).toBeNull();
  expect(messages.filter(m => m.action?.kind === 'answer')).toHaveLength(0);
  await type('apple'); await vi.waitFor(() => expect(root.textContent).toContain('本轮完成'));
  expect(messages.find(m => m.action?.kind === 'answer').action.advance).toBe(true);
});
it('pauses on blur, resumes without regrading, and keeps clearing behind Settings confirmation', async () => {
  await mount(); await click('开始新一轮'); await ready(); await type('ap');
  window.dispatchEvent(new Event('blur')); await nextTick(); expect(root.querySelector<HTMLInputElement>('input')!.disabled).toBe(true);
  await click('继续'); await ready(); expect(root.querySelector('input')!.value).toBe('ap');
  expect(messages.filter(m => m.action?.kind === 'resume')).toHaveLength(0);
  await click('听写设置'); await click('清除练习记录'); expect(root.querySelector('[role=dialog]')).not.toBeNull();
  await click('取消'); expect((await repo.practice({ type: 'PRACTICE_GET' })).session).not.toBeNull();
  await click('听写设置'); await click('清除练习记录'); await click('清除记录');
  await vi.waitFor(async () => expect((await repo.practice({ type: 'PRACTICE_GET' })).session).toBeNull());
  await vi.waitFor(() => expect(root.textContent).toContain('准备好听写了吗？'));
});
it('does not let a delayed read undo an automatically committed answer', async () => {
  await mount(); await click('开始新一轮'); await ready();
  const original = browser.runtime.sendMessage; let deliver: (() => void) | undefined, delayed = false;
  browser.runtime.sendMessage = (async (message: any) => {
    const reply = await original(message);
    if (message.type === 'PRACTICE_GET' && !delayed) { delayed = true; return new Promise(resolve => { deliver = () => resolve(reply); }); }
    return reply;
  }) as typeof original;
  listeners[0]({ type: 'PRACTICE_CHANGED' }); await vi.waitFor(() => expect(deliver).toBeDefined());
  await type('apple'); await vi.waitFor(() => expect(root.textContent).toContain('本轮完成'));
  deliver!(); await new Promise(resolve => setTimeout(resolve, 10)); await nextTick(); expect(root.textContent).toContain('本轮完成');
});
it('preserves an existing spelling round instead of silently replacing user progress', async () => {
  const view = await repo.practice({ type: 'PRACTICE_GET' });
  await repo.practice({ type: 'PRACTICE_COMMAND', owner: view.owner, scope: view.scope, revision: view.revision,
    requestId: crypto.randomUUID(), action: { kind: 'start', mode: 'recall', replace: false } });
  await mount(); expect([...root.querySelectorAll('button')].find(b => b.textContent === '模糊听写')?.getAttribute('aria-pressed')).toBe('true');
  await click('看词跟写'); expect(root.querySelector('[role=dialog]')).not.toBeNull(); await click('取消');
  expect((await repo.practice({ type: 'PRACTICE_GET' })).session!.mode).toBe('recall');
});
it('keeps current input when another question is deleted, but detects repeated tab takeovers', async () => {
  await repo.importData(JSON.stringify([{ word: 'banana', count: 1, createdAt: 1, updatedAt: 1, history: [{ timestamp: 1, context: '', url: '',
    definition: { word: 'banana', phonetics: [], meanings: [{ partOfSpeech: 'n', definitions: [{ definition: 'A yellow snack' }] }] } }] }]));
  await mount(); await click('开始新一轮'); await ready();
  const view = await repo.practice({ type: 'PRACTICE_GET' }), currentWord = view.session!.current!.word!;
  const other = (await repo.getAllWords()).find(w => w.word !== currentWord)!;
  await type(currentWord.slice(0, 2)); await repo.deleteWord(other.id!); listeners[0]({ type: 'PRACTICE_CHANGED' });
  await vi.waitFor(() => expect(root.textContent).toContain('已排除 1 个已更改或删除的单词'));
  expect(root.querySelector('input')?.value).toBe(currentWord.slice(0, 2));
  async function takeOver() {
    const latest = await repo.practice({ type: 'PRACTICE_GET' });
    await repo.practice({ type: 'PRACTICE_COMMAND', requestId: crypto.randomUUID(), owner: latest.owner, scope: latest.scope,
      revision: latest.revision, action: { kind: 'resume', sessionId: latest.session!.id } });
    listeners[0]({ type: 'PRACTICE_CHANGED' }); await vi.waitFor(() => expect(root.querySelector<HTMLInputElement>('input')!.disabled).toBe(true));
  }
  await takeOver(); await click('继续'); await ready(); await takeOver();
});
it('does not auto-complete or skip during composition; completes only after the committed text', async () => {
  await mount(); await click('开始新一轮'); await ready(); const input = root.querySelector('input')!;
  input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); await type('apple');
  const skip = [...root.querySelectorAll('button')].find(b => b.textContent?.includes('跳过'))!; expect(skip.disabled).toBe(true);
  expect(messages.filter(m => m.action?.kind === 'answer')).toHaveLength(0);
  input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  await vi.waitFor(() => expect(root.textContent).toContain('本轮完成'));
  expect(messages.filter(m => m.action?.kind === 'answer')).toHaveLength(1);
});
it('keeps the first typed character after focus moves to noninteractive page content', async () => {
  await mount(); await click('开始新一轮'); await ready();
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
  await click('开始新一轮'); await vi.waitFor(() => expect(deliver).toBeDefined());
  if (trigger === 'escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  else if (trigger === 'blur') window.dispatchEvent(new Event('blur'));
  else await click('听写设置');
  deliver!();
  await vi.waitFor(() => expect(root.querySelector('input')).not.toBeNull());
  expect(root.querySelector('input')!.disabled).toBe(true);
  if (trigger === 'settings') await click('关闭设置');
  await click('继续'); await ready();
});
it('persists explicit hints and automatically retries dictation without revealing the next target', async () => {
  await mount(); await click('模糊听写'); await click('开始新一轮'); await ready();
  await type('a'); await click('显示提示'); await ready();
  expect(root.querySelector('input')!.value).toBe('a');
  expect(root.querySelectorAll('.letter-reference.is-frosted')).toHaveLength(0);
  expect((await repo.practice({ type: 'PRACTICE_GET' })).session!.current!.hinted).toBe(true);
  await type('apple');
  await vi.waitFor(() => expect(messages.filter(m => m.action?.kind === 'answer')).toHaveLength(1)); await ready();
  expect(root.querySelectorAll('.letter-reference.is-frosted')).toHaveLength(5);
  expect(root.querySelector('input')!.value).toBe('');
  await click('跳过'); await vi.waitFor(() => expect(messages.filter(m => m.action?.kind === 'answer')).toHaveLength(2)); await ready();
  await click('跳过'); await vi.waitFor(() => expect(root.textContent).toContain('本轮完成'));
  expect(root.querySelector('[aria-label="需要巩固的单词"]')?.textContent).toContain('apple');
  expect(root.textContent).toContain('提示 1');
});
it('shares theme preferences and preserves input while toggling themes', async () => {
  const setItem = vi.fn(async (key: string, value: unknown) => { state.values.set(key, value); });
  const { storage } = await import('wxt/utils/storage');
  storage.setItem = setItem;
  await mount(); await click('开始新一轮'); await ready(); await type('ap');
  await click('切换深色主题'); await vi.waitFor(() => expect(root.querySelector('main')?.dataset.theme).toBe('dark'));
  expect(setItem).toHaveBeenCalledWith('local:appearance', 'dark');
  expect(root.querySelector('input')!.value).toBe('ap');
  await click('切换浅色主题'); await vi.waitFor(() => expect(root.querySelector('main')?.dataset.theme).toBe('light'));
  expect(root.querySelector('input')!.value).toBe('ap');
});
