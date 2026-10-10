<script setup lang="ts">
import { computed, onUnmounted, provide, ref } from 'vue';
import VocabularyPanel from '../components/VocabularyPanel.vue';
import SelectionPopup from '../components/SelectionPopup.vue';
import type { Definition, WordEntry } from '../types';
import type { ThemePreference } from '../types/theme';
import { isDefinition } from '../services/definition-utils';
import { PhoneticsService, phoneticsLookupKey } from '../services/phonetics';
import referenceImage from '../../designs/rememberme-extension/paper-sage-reference.png';
import darkPaletteImage from '../../designs/rememberme-extension/codex-dark-reference.png';

// Read packaged IPA directly in the preview; no extension messages or vocabulary.
const previewPhonetics = new PhoneticsService(path => path);
provide(phoneticsLookupKey, word => previewPhonetics.getPhonetics(word));

const params = new URLSearchParams(location.search);
const sampleWord = params.get('word') === 'trick' ? 'trick' : 'multiple';
const sampleContext = sampleWord === 'trick' ? 'He played a trick on me.' : 'She compared multiple sources.';
const definition: Definition = sampleWord === 'trick'
  ? { word: 'trick', source: 'wordnet', phonetics: [], translation: { text: '哄騙 哄骗 [hong3 pian4]', target: 'zh-CN', source: 'mymemory' }, meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A cunning or deceitful action or device.', example: sampleContext }] }] }
  : { word: 'multiple', phonetic: '/ˈmʌltɪpəl/', phonetics: [], meanings: [{ partOfSpeech: 'adjective', definitions: [{ definition: 'More than one; consisting of several parts.', example: sampleContext }] }] };
const initial: WordEntry[] = [
  { word: sampleWord, count: 2, createdAt: Date.now() - 86400000, updatedAt: Date.now() - 3600000, history: [
    { timestamp: Date.now() - 86400000, context: sampleWord === 'trick' ? sampleContext : 'Multiple examples helped explain the idea.', url: 'https://example.com/first-reading', definition },
    { timestamp: Date.now() - 3600000, context: sampleWord === 'trick' ? sampleContext : 'This article draws on multiple sources.', url: 'https://example.com/article', definition },
  ] },
  { word: 'serendipity', count: 4, createdAt: 1, updatedAt: 1, history: [{ timestamp: Date.now() - 86400000, context: 'A moment of serendipity.', url: 'https://example.com/reading', definition: { word: 'serendipity', phonetics: [], meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A fortunate discovery.' }] }] } }] },
  { word: 'meticulous', count: 1, createdAt: 1, updatedAt: 2, history: [] },
];
const initialMode = params.get('state');
const mode = ref(initialMode === 'empty' || initialMode === 'list' ? initialMode : 'detail');
const words = ref<WordEntry[]>(mode.value === 'empty' ? [] : structuredClone(initial));
const version = ref(0);
const initialLookup = params.get('lookup');
const cardState = ref(initialLookup === 'error' || initialLookup === 'loading' ? initialLookup : 'ready');
const cardVisible = ref(true);
const preference = ref<ThemePreference>('system');
const feedback = ref('');
const compare = params.get('compare');
const themes = computed(() => compare ? [compare === 'dark' || compare === 'codex' ? 'dark' : 'light'] as const : ['light', 'dark'] as const);
let retryTimer: ReturnType<typeof setTimeout> | undefined;
onUnmounted(() => clearTimeout(retryTimer));
function setMode(value: string) {
  mode.value = value;
  words.value = value === 'empty' ? [] : structuredClone(initial);
  version.value++;
  feedback.value = '';
}
function reset(word: string) { const entry = words.value.find(item => item.word === word); if (entry) entry.count = 0; }
function remove(word: string) { words.value = words.value.filter(item => item.word !== word); }
function recordWord() {
  const entry = words.value.find(item => item.word === sampleWord);
  const history = { timestamp: Date.now(), context: sampleContext, url: 'https://example.com/article', definition };
  if (entry) { entry.count++; entry.history.push(history); }
  else words.value.push({ word: sampleWord, count: 1, history: [history], createdAt: Date.now(), updatedAt: Date.now() });
  feedback.value = 'Saved in this preview only.';
}
function retry() { cardState.value = 'loading'; retryTimer = setTimeout(() => { cardState.value = 'ready'; }, 600); }
function exportData() {
  const url = URL.createObjectURL(new Blob([JSON.stringify(words.value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'remember-me-preview.json'; link.click(); URL.revokeObjectURL(url);
}
function importData(text: string) {
  try {
    const data = JSON.parse(text);
    if (!Array.isArray(data) || !data.every(entry => typeof entry.word === 'string' && Number.isFinite(entry.count) && Array.isArray(entry.history) && entry.history.every((item: any) => Number.isFinite(item.timestamp) && typeof item.context === 'string' && typeof item.url === 'string' && isDefinition(item.definition)))) throw new Error();
    words.value = data;
    feedback.value = 'Backup imported into this preview only.';
  } catch { feedback.value = 'Invalid preview backup. Your browser vocabulary is unchanged.'; }
}
</script>

<template>
  <div class="preview-page">
    <header class="preview-header"><div><p class="eyebrow">REMEMBER ME · INTERACTIVE PREVIEW</p><h1>Paper &amp; Sage</h1><p>Sample vocabulary only. This page does not access your extension data.</p></div>
      <div class="preview-tools">
        <label>Popup <select :value="mode" @change="setMode(($event.target as HTMLSelectElement).value)"><option value="detail">Word detail</option><option value="list">Vocabulary list</option><option value="empty">Empty state</option></select></label>
        <label>Lookup <select v-model="cardState" @change="cardVisible = true"><option value="ready">Definition</option><option value="loading">Loading</option><option value="error">Error</option></select></label>
        <button @click="cardVisible = true">Show lookup card</button>
      </div>
    </header>
    <p v-if="feedback" class="preview-feedback" role="status">{{ feedback }}</p>
    <main class="preview-grid" :class="{ comparison: compare }">
      <section v-if="compare === 'codex'" class="reference-column">
        <h2>Selected dark palette · Codex</h2>
        <img class="palette-reference" :src="darkPaletteImage" alt="User-provided Codex palette reference: charcoal background, gray-white text and gray selections" />
        <p class="palette-note">Palette reference only. The extension keeps its selected layout and typography.</p>
      </section>
      <section v-else-if="compare" class="reference-column"><h2>Original layout reference · {{ compare }}</h2>
        <div class="reference-popup"><div class="reference-crop"><img :src="referenceImage" alt="Selected Paper and Sage design" :style="{ left: compare === 'dark' ? '-831px' : '-258px' }" /></div></div>
        <h2>Selected lookup reference</h2>
        <div class="reference-lookup"><div class="reference-lookup-crop"><img :src="referenceImage" alt="Selected lookup card design" :style="{ left: compare === 'dark' ? '-845px' : '-272px' }" /></div></div>
      </section>
      <section v-for="theme in themes" :key="theme" class="preview-column">
        <h2>{{ compare ? 'Implementation' : theme === 'light' ? 'Light mode' : 'Dark mode' }}</h2>
        <div class="popup-stage">
          <VocabularyPanel :key="version" :words="words" :theme="preference === 'system' ? theme : preference" :initial-word="mode === 'detail' ? sampleWord : undefined"
            @theme-change="preference = $event" @reset="reset" @delete="remove" @import="importData" @export="exportData" />
        </div>
        <h2>In-page lookup</h2>
        <div class="lookup-stage rm-theme" :data-theme="preference === 'system' ? theme : preference">
          <SelectionPopup :word="sampleWord" :position="{ x: 0, y: 0 }" :visible="cardVisible" :definition="cardState === 'ready' ? definition : undefined" :loading="cardState === 'loading'" :error="cardState === 'error' ? 'The dictionary is taking too long. Please try again.' : ''" inline
            :saved-word="words.find(entry => entry.word === sampleWord) ?? null" @close="cardVisible = false" @record="recordWord" @retry="retry" />
        </div>
      </section>
    </main>
    <footer class="preview-footer">Theme controls, search, sorting, details, reset and deletion work with disposable sample data. Lookup states here are simulated.</footer>
  </div>
</template>

<style>
body { margin: 0; background: #eef2ed; color: #28372e; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
.preview-page { max-width: 960px; margin: 0 auto; padding: 32px 28px; }
.preview-header { display: flex; justify-content: space-between; gap: 28px; margin-bottom: 26px; }
.preview-header h1 { font: 600 34px Georgia, serif; margin: 8px 0; }
.preview-header p { margin: 0; font-size: 13px; color: #626f65; line-height: 1.5; }
.preview-header .eyebrow { font-size: 10px; letter-spacing: 1.5px; }
.preview-tools { display: flex; gap: 8px; align-items: end; flex-wrap: wrap; max-width: 280px; }
.preview-tools label { display: grid; gap: 4px; color: #526356; font-size: 11px; }
.preview-tools select, .preview-tools button { border: 1px solid #ccd6cb; border-radius: 6px; background: #fafbf8; padding: 7px 9px; color: #304a39; font: 12px system-ui; }
.preview-grid { display: grid; grid-template-columns: repeat(2, 400px); gap: 56px; justify-content: center; }
.preview-column > h2, .reference-column > h2 { margin: 0 0 12px; color: #68776b; font-size: 12px; font-weight: 500; }
.popup-stage { border: 1px solid #dce3d9; border-radius: 11px; overflow: hidden; width: 400px; box-shadow: 0 3px 14px rgb(23 45 30 / 5%); margin-bottom: 24px; }
.lookup-stage { width: 420px; max-width: calc(100vw - 56px); min-height: 180px; }
.preview-footer { color: #68776b; font-size: 12px; line-height: 1.6; margin-top: 28px; max-width: 740px; }
.preview-feedback { font-size: 13px; color: #3e775e; }
.reference-popup { width: 400px; height: 498px; margin-bottom: 24px; }
.palette-reference { display: block; width: 400px; height: auto; border-radius: 11px; }
.palette-note { margin-top: 16px; color: #68776b; font-size: 13px; line-height: 1.6; }
.reference-crop { position: relative; width: 447px; height: 556px; overflow: hidden; transform: scale(.895); transform-origin: top left; }
.reference-crop img { position: absolute; top: -138px; width: 1536px; height: 1024px; max-width: none; }
.reference-lookup { width: 340px; height: 202px; margin-left: 20px; }
.reference-lookup-crop { position: relative; width: 420px; height: 250px; overflow: hidden; transform: scale(.81); transform-origin: top left; }
.reference-lookup-crop img { position: absolute; top: -721px; width: 1536px; height: 1024px; max-width: none; }
.preview-page:has(.comparison) { max-width: 740px; padding: 18px 20px; }
.preview-page:has(.comparison) .preview-header, .preview-page:has(.comparison) .preview-footer { display: none; }
.preview-grid.comparison { grid-template-columns: repeat(2, 400px); gap: 32px; width: 832px; transform: scale(.82); transform-origin: top left; }
@media(max-width:900px) { .preview-grid { grid-template-columns: 400px; } .preview-header { display: block; } .preview-tools { margin-top: 16px; max-width: 100%; } }
</style>
