import { createApp, h, reactive, type App as VueApp } from 'vue';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { contextExtractor } from '~/services/context-extractor';
import { storageClient } from '~/services/storage-client';
import { requestDefinition } from '~/services/lookup-client';
import { watchTheme } from '~/services/theme';
import { getOrdinal, isEnglishWord } from '~/services/word-utils';
import type { Definition, Position } from '~/types';
import type { ResolvedTheme } from '~/types/theme';
import SelectionPopup from '~/components/SelectionPopup.vue';
import uiStyles from '~/assets/paper-sage.css?inline';
import '~/assets/content.css';

let context: ContentScriptContext;
let host: HTMLElement | null = null;
let popupApp: VueApp | null = null;
let debounceTimer: number | undefined;
let activeLookup: AbortController | undefined;
let lookupVersion = 0;
let notificationId = 0;
const notices = reactive<{ id: number; message: string; type: 'success' | 'error' }[]>([]);
const state = reactive({
  word: '', position: { x: 12, y: 12 } as Position, visible: false,
  definition: undefined as Definition | undefined, loading: false,
  error: '', saveError: '', saving: false, context: '', theme: 'light' as ResolvedTheme,
});

export default defineContentScript({
  matches: ['<all_urls>'],
  main(ctx) {
    context = ctx;
    console.log('Vocabulary Counter content script loaded');
    ctx.addEventListener(document, 'mouseup', selectText);
    ctx.addEventListener(document, 'click', event => {
      if (state.visible && host && !event.composedPath().includes(host)) hidePopup();
    });
    ctx.addEventListener(document, 'keydown', event => { if (event.key === 'Escape' && state.visible) hidePopup(); });
    ctx.addEventListener(window, 'scroll', () => { if (state.visible) hidePopup(); });
    const stopTheme = watchTheme(theme => { state.theme = theme.resolved; });
    const onMessage = (message: any, _sender: unknown, sendResponse: (response: unknown) => void) => {
      if (ctx.isInvalid) return false;
      if (message?.type === 'EXTRACT_CONTEXT') {
        const selection = window.getSelection();
        sendResponse({ success: true, context: selection?.rangeCount ? contextExtractor.extractSentence(selection).context : '' });
      } else if (message?.type === 'SHOW_NOTIFICATION') {
        showNotification(String(message.message ?? ''), message.notificationType === 'error' ? 'error' : 'success');
        sendResponse({ success: true });
      } else return false;
      return true;
    };
    browser.runtime.onMessage.addListener(onMessage);
    ctx.onInvalidated(() => {
      lookupVersion++;
      activeLookup?.abort();
      if (debounceTimer !== undefined) clearTimeout(debounceTimer);
      stopTheme();
      popupApp?.unmount();
      popupApp = null;
      host?.remove();
      host = null;
      notices.splice(0);
      state.visible = false;
      try { browser.runtime.onMessage.removeListener(onMessage); } catch { /* Context already gone. */ }
    });
  },
});

function ensureUi() {
  if (host || context.isInvalid) return;
  host = document.createElement('div');
  host.id = 'vocab-counter-popup-root';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = uiStyles;
  const mount = document.createElement('div');
  shadow.append(style, mount);
  document.body.appendChild(host);
  popupApp = createApp({
    render: () => h('div', { class: 'rm-theme', 'data-theme': state.theme }, [
      h(SelectionPopup, {
        word: state.word, position: state.position, visible: state.visible, definition: state.definition,
        loading: state.loading, error: state.error, saving: state.saving, saveError: state.saveError,
        onRemember: hidePopup, onForget: forgetWord, onClose: hidePopup, onRetry: lookupWord,
      }),
      ...notices.map(notice => h('div', {
        key: notice.id, class: ['rm-notice', 'vocab-counter-notification', { 'is-error': notice.type === 'error' }],
        role: notice.type === 'error' ? 'alert' : 'status',
      }, notice.message)),
    ]),
  });
  popupApp.mount(mount);
}

function selectText(event: MouseEvent) {
  if (!context.isValid || (host && event.composedPath().includes(host))) return;
  if (debounceTimer !== undefined) clearTimeout(debounceTimer);
  debounceTimer = context.setTimeout(() => {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !isEnglishWord(selection.toString())) { hidePopup(); return; }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    state.word = selection.toString().trim();
    state.context = contextExtractor.extractSentence(selection).context;
    state.position = { x: rect.left + rect.width / 2, y: rect.bottom + 10, anchorTop: rect.top };
    state.saving = false;
    void lookupWord();
  }, 300);
}

async function lookupWord() {
  if (!context.isValid) return;
  activeLookup?.abort();
  const controller = new AbortController();
  activeLookup = controller;
  const version = ++lookupVersion;
  state.visible = true;
  state.loading = true;
  state.error = '';
  state.saveError = '';
  state.definition = undefined;
  ensureUi();
  try {
    const definition = await requestDefinition(state.word, controller.signal);
    if (version !== lookupVersion || context.isInvalid) return;
    state.definition = definition;
  } catch (error) {
    if (version !== lookupVersion || context.isInvalid) return;
    state.error = error instanceof Error ? error.message : 'Please try again.';
  } finally {
    if (version === lookupVersion) { state.loading = false; activeLookup = undefined; }
  }
}

function hidePopup() {
  lookupVersion++;
  activeLookup?.abort();
  activeLookup = undefined;
  state.visible = false;
  state.loading = false;
}

async function forgetWord() {
  if (!context.isValid || !state.definition || state.loading || state.saving) return;
  const version = lookupVersion;
  const snapshot = { word: state.word, definition: state.definition, context: state.context, url: location.href };
  state.saving = true;
  state.saveError = '';
  try {
    const entry = await storageClient.saveWord(snapshot.word, snapshot.definition, snapshot.context, snapshot.url);
    if (context.isInvalid) return;
    showNotification('This is the ' + getOrdinal(entry.count) + ' time you forgot "' + entry.word + '"');
    if (version === lookupVersion) hidePopup();
  } catch (error) {
    if (context.isInvalid || version !== lookupVersion) return;
    state.saveError = error instanceof Error ? error.message : 'Could not save this word. Please try again.';
  } finally {
    if (version === lookupVersion || !state.visible) state.saving = false;
  }
}

function showNotification(message: string, type: 'success' | 'error' = 'success') {
  if (!context.isValid) return;
  ensureUi();
  const id = ++notificationId;
  notices.splice(0, notices.length, { id, message, type });
  context.setTimeout(() => {
    const index = notices.findIndex(notice => notice.id === id);
    if (index !== -1) notices.splice(index, 1);
  }, 3500);
}
