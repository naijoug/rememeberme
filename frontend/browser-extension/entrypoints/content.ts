import { createApp, h, reactive, type App as VueApp } from 'vue';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { contextExtractor } from '~/services/context-extractor';
import { storageClient } from '~/services/storage-client';
import { requestDefinition, requestTranslation } from '~/services/lookup-client';
import { isTranslation } from '~/services/definition-utils';
import { watchTheme } from '~/services/theme';
import { isEnglishWord } from '~/services/word-utils';
import type { Definition, Position, WordEntry } from '~/types';
import type { ResolvedTheme } from '~/types/theme';
import SelectionPopup from '~/components/SelectionPopup.vue';
import uiStyles from '~/assets/paper-sage.css?inline';
import '~/assets/content.css';

let context: ContentScriptContext;
let host: HTMLElement | null = null;
let popupShadow: ShadowRoot | null = null;
let popupApp: VueApp | null = null;
let debounceTimer: number | undefined;
let pendingSelection: { word: string; context: string; url: string; position: Position; range: Range } | undefined;
let selectedRange: Range | undefined;
let pointerStartedInside = false;
let activeLookup: AbortController | undefined;
let lookupVersion = 0;
let notificationId = 0;
let saveSequence = 0;
let appliedSaveSequence = 0;
const notices = reactive<{ id: number; message: string; type: 'success' | 'error' }[]>([]);
const state = reactive({
  word: '', position: { x: 12, y: 12 } as Position, visible: false,
  definition: undefined as Definition | undefined, loading: false,
  error: '', saveError: '', saving: false, context: '', theme: 'light' as ResolvedTheme,
  englishLoading: false, translationLoading: false, englishError: '', translationError: '',
  savedWord: undefined as WordEntry | null | undefined, recordsLoading: false, recordsError: '', pendingSaves: 0, url: '',
});

export default defineContentScript({
  matches: ['<all_urls>'],
  main(ctx) {
    context = ctx;
    console.log('Vocabulary Counter content script loaded');
    ctx.addEventListener(document, 'pointerdown', event => {
      pointerStartedInside = isInsidePopup(event);
      cancelPendingSelection();
    }, { capture: true });
    ctx.addEventListener(document, 'mouseup', selectText);
    ctx.addEventListener(document, 'click', event => {
      const startedInside = pointerStartedInside;
      pointerStartedInside = false;
      // Releasing a selection/scrollbar drag outside is not an outside click.
      // The click ending a new word selection must not dismiss its pending card.
      if (state.visible && host && !isInsidePopup(event) && !startedInside && !pendingSelection) hidePopup();
    });
    ctx.addEventListener(document, 'pointercancel', () => { pointerStartedInside = false; }, { capture: true });
    ctx.addEventListener(document, 'keydown', event => { if (event.key === 'Escape' && (state.visible || pendingSelection)) hidePopup(); });
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
      cancelPendingSelection();
      selectedRange = undefined;
      pointerStartedInside = false;
      stopTheme();
      popupApp?.unmount();
      popupApp = null;
      host?.remove();
      host = null;
      popupShadow = null;
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
  // Prior encounter sentences/URLs must not be exposed through the host page's
  // DOM. The extension keeps the reference privately for selection handling.
  const shadow = host.attachShadow({ mode: 'closed' });
  popupShadow = shadow;
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
        englishLoading: state.englishLoading, translationLoading: state.translationLoading,
        englishError: state.englishError, translationError: state.translationError,
        savedWord: state.savedWord, recordsLoading: state.recordsLoading, recordsError: state.recordsError, pendingSaves: state.pendingSaves,
        onRecord: recordWord, onClose: hidePopup, onRetry: lookupWord,
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
  if (!context.isValid || event.button !== 0) return;
  if (isInsidePopup(event) || pointerStartedInside) { cancelPendingSelection(); return; }
  cancelPendingSelection();
  const selection = window.getSelection();
  if (!selection?.rangeCount || !isEnglishWord(selection.toString())) return;
  const range = selection.getRangeAt(0);
  if (popupShadow && (selection.anchorNode?.getRootNode() === popupShadow || selection.focusNode?.getRootNode() === popupShadow)) return;
  if (state.visible && selectedRange && range.startContainer === selectedRange.startContainer && range.endContainer === selectedRange.endContainer &&
      range.startOffset === selectedRange.startOffset && range.endOffset === selectedRange.endOffset) return;
  const rect = range.getBoundingClientRect();
  // Snapshot at mouseup. Later focus/copy/selection changes must not dismiss or
  // replace this lookup while the debounce timer is waiting.
  const captured = {
    word: selection.toString().trim(), context: contextExtractor.extractSentence(selection).context, url: location.href,
    position: { x: rect.left + rect.width / 2, y: rect.bottom + 10, anchorTop: rect.top }, range: range.cloneRange(),
  };
  pendingSelection = captured;
  debounceTimer = context.setTimeout(() => {
    if (pendingSelection !== captured) return;
    pendingSelection = undefined;
    debounceTimer = undefined;
    selectedRange = captured.range;
    state.word = captured.word;
    state.context = captured.context;
    state.url = captured.url;
    state.position = captured.position;
    state.saving = false;
    state.pendingSaves = 0;
    state.savedWord = undefined;
    void lookupWord();
  }, 300);
}

function isInsidePopup(event: Event): boolean { return !!host && event.composedPath().includes(host); }

function cancelPendingSelection() {
  if (debounceTimer !== undefined) clearTimeout(debounceTimer);
  debounceTimer = undefined;
  pendingSelection = undefined;
}

async function lookupWord() {
  if (!context.isValid) return;
  activeLookup?.abort();
  const controller = new AbortController();
  activeLookup = controller;
  const version = ++lookupVersion;
  state.pendingSaves = 0;
  state.saving = false;
  state.visible = true;
  state.loading = true;
  state.error = '';
  state.saveError = '';
  state.definition = undefined;
  state.englishLoading = true;
  state.translationLoading = true;
  state.englishError = '';
  state.translationError = '';
  ensureUi();
  const word = state.word;
  const savesAtRead = saveSequence;
  state.recordsLoading = true;
  state.recordsError = '';
  void storageClient.getWord(word).then(entry => {
    if (version === lookupVersion && context.isValid && saveSequence === savesAtRead) state.savedWord = entry;
  }).catch(() => {
    if (version === lookupVersion && saveSequence === savesAtRead) state.recordsError = 'Could not load saved records. Recording a new entry will refresh them.';
  }).finally(() => {
    if (version === lookupVersion) state.recordsLoading = false;
  });
  const current = () => version === lookupVersion && context.isValid;
  const updateStatus = () => {
    if (!current()) return;
    state.loading = !state.definition && (state.englishLoading || state.translationLoading);
    if (!state.definition && !state.loading) state.error = [state.translationError, state.englishError].filter(Boolean).join(' ');
    if (!state.englishLoading && !state.translationLoading) activeLookup = undefined;
  };
  await Promise.all([
    requestDefinition(word, controller.signal).then(definition => {
      if (!current()) return;
      state.definition = { ...definition, ...(state.definition?.translation ? { translation: state.definition.translation } : {}) };
    }).catch(error => {
      if (current()) state.englishError = error instanceof Error ? error.message : 'English definition unavailable.';
    }).finally(() => {
      if (current()) { state.englishLoading = false; updateStatus(); }
    }),
    requestTranslation(word, controller.signal).then(translation => {
      if (!current()) return;
      if (!isTranslation(translation)) throw new Error('Chinese translation is unavailable. Please retry.');
      state.definition = { ...(state.definition ?? { word, phonetics: [], meanings: [] }), translation };
    }).catch(error => {
      if (current()) state.translationError = error instanceof Error ? error.message : 'Chinese translation unavailable.';
    }).finally(() => {
      if (current()) { state.translationLoading = false; updateStatus(); }
    }),
  ]);
}

function hidePopup() {
  cancelPendingSelection();
  selectedRange = undefined;
  lookupVersion++;
  activeLookup?.abort();
  activeLookup = undefined;
  state.visible = false;
  state.loading = false;
  state.englishLoading = false;
  state.translationLoading = false;
}

async function recordWord() {
  if (!context.isValid || !state.visible || !state.word) return;
  const version = lookupVersion;
  const sequence = ++saveSequence;
  const snapshot = { word: state.word, definition: state.definition ?? { word: state.word, phonetics: [], meanings: [] }, context: state.context, url: state.url, timestamp: Date.now() };
  state.pendingSaves++;
  state.saving = true;
  state.saveError = '';
  try {
    // Each intentional click is one distinct write. The background queue makes
    // increments atomic; do not retry ambiguous failures or close after saving.
    const entry = await storageClient.saveWord(snapshot.word, snapshot.definition, snapshot.context, snapshot.url, snapshot.timestamp);
    if (context.isInvalid || version !== lookupVersion) return;
    if (sequence > appliedSaveSequence) {
      appliedSaveSequence = sequence;
      state.savedWord = entry;
      state.recordsError = '';
    }
  } catch (error) {
    if (context.isInvalid || version !== lookupVersion) return;
    state.saveError = error instanceof Error ? error.message : 'Could not save this word. Please try again.';
  } finally {
    if (version === lookupVersion) {
      state.pendingSaves = Math.max(0, state.pendingSaves - 1);
      state.saving = state.pendingSaves > 0;
    }
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
