<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { Bookmark, BookmarkSolid, Refresh, WarningTriangle, Xmark, IconoirProvider } from '@iconoir/vue';
import type { Definition, Position, WordEntry } from '~/types';
import HighlightedText from './HighlightedText.vue';
import DefinitionSource from './DefinitionSource.vue';
import TranslationText from './TranslationText.vue';
import WordHistory from './WordHistory.vue';
import WordPronunciation from './WordPronunciation.vue';
import ContextExplanation from './ContextExplanation.vue';
import { CONTEXT_EXPLANATION_ENABLED } from '~/config/backend';
import { coordinateSpace, positionPopup, visibleViewport } from '~/services/popup-position';

const props = defineProps<{
  word: string; context?: string; position: Position; visible: boolean; definition?: Definition;
  loading?: boolean; error?: string; saving?: boolean; recorded?: boolean; saveError?: string; inline?: boolean;
  englishLoading?: boolean; translationLoading?: boolean; englishError?: string; translationError?: string;
  savedWord?: WordEntry | null; recordsLoading?: boolean; recordsError?: string;
}>();
const emit = defineEmits<{ record: []; close: []; retry: [] }>();
const card = ref<HTMLElement>();
const coords = ref({ left: 12, top: 12 });
const probe = ref<HTMLElement>();
const maxWidth = ref(420);
let frame: number | undefined;
let viewport: VisualViewport | null;
let listening = false;
let observer: ResizeObserver | undefined;
const interacted = ref(false);
const maxHeight = ref(480);
const displayedCount = computed(() => props.savedWord?.count ?? (props.recordsLoading || props.recordsError ? '—' : 0));
const popupStyle = computed(() => props.inline
  ? { position: 'relative' as const, left: 'auto', top: 'auto' }
  : { left: coords.value.left + 'px', top: coords.value.top + 'px', maxHeight: maxHeight.value + 'px', maxWidth: maxWidth.value + 'px' });

function positionCard() {
  if (!props.visible || !card.value || props.inline) return;
  const box = card.value.getBoundingClientRect();
  const view = visibleViewport();
  const space = coordinateSpace(probe.value);
  const result = positionPopup(props.position, { width: box.width || Math.min(420, view.width - 24), height: box.height || 220 },
    view, space, interacted.value ? coords.value : undefined);
  coords.value = { left: result.left, top: result.top };
  maxHeight.value = result.maxHeight;
  maxWidth.value = result.maxWidth;
}
function schedulePosition() {
  if (!props.visible || props.inline || frame !== undefined) return;
  frame = requestAnimationFrame(() => { frame = undefined; positionCard(); });
}
function cancelPosition() { if (frame !== undefined) cancelAnimationFrame(frame); frame = undefined; }

watch(() => [props.visible, props.word, props.position.x, props.position.y], () => { interacted.value = false; }, { flush: 'sync' });
watch(card, value => { observer?.disconnect(); if (value) observer?.observe(value); positionCard(); }, { flush: 'post' });
watch(() => [props.visible, props.position.x, props.position.y, props.loading, props.error], async () => { await nextTick(); positionCard(); });
function startGeometry() {
  if (listening || !props.visible || props.inline) return;
  listening = true;
  observer ??= new ResizeObserver(schedulePosition);
  if (card.value) observer.observe(card.value);
  window.addEventListener('resize', schedulePosition);
  window.addEventListener('scroll', schedulePosition, true);
  viewport = window.visualViewport;
  viewport?.addEventListener('resize', schedulePosition);
  viewport?.addEventListener('scroll', schedulePosition);
  positionCard();
}
function stopGeometry() {
  cancelPosition(); observer?.disconnect(); listening = false;
  window.removeEventListener('resize', schedulePosition);
  window.removeEventListener('scroll', schedulePosition, true);
  viewport?.removeEventListener('resize', schedulePosition);
  viewport?.removeEventListener('scroll', schedulePosition);
  viewport = null;
}
watch(() => props.visible, visible => { if (visible) startGeometry(); else stopGeometry(); }, { flush: 'post' });
onMounted(startGeometry);
onUnmounted(stopGeometry);

</script>

<template>
  <IconoirProvider :icon-props="{ color: 'currentColor', 'stroke-width': 1.5 }">
  <div v-if="visible && !inline" ref="probe" aria-hidden="true" style="position: fixed; left: 0; top: 0; width: 100px; height: 100px; visibility: hidden; pointer-events: none;"></div>
  <section v-if="visible" ref="card" class="vocab-counter-popup" :style="popupStyle" role="dialog" :aria-label="'Definition of ' + word" :aria-busy="loading || saving" @pointerenter="interacted = true" @focusin="interacted = true" @pointerdown.stop="interacted = true" @click.stop @dblclick.stop @mouseup.stop @keydown.esc.stop="emit('close')">
    <div class="lookup-header">
      <div class="lookup-heading">
        <h2 class="word rm-word">{{ word }}</h2>
        <WordPronunciation :word="word" :definition="definition" />
      </div>
      <div class="lookup-actions" role="group" aria-label="Word actions">
        <button class="record-button" :class="{ 'is-recorded': recorded }" :disabled="saving || recorded" :aria-label="(saving ? 'Saving a record for ' : recorded ? 'Recorded ' : 'Add a record for ') + word + ', count ' + displayedCount" :title="recorded ? 'Recorded for this popup' : saving ? 'Saving this encounter…' : 'Add to vocabulary and record this encounter (+1)'" :aria-busy="saving" @click="!saving && !recorded && emit('record')">
          <Refresh v-if="saving" class="record-icon rm-spinner" width="18" height="18" aria-hidden="true" />
          <BookmarkSolid v-else-if="recorded" class="record-icon" width="18" height="18" aria-hidden="true" />
          <Bookmark v-else class="record-icon" width="18" height="18" aria-hidden="true" />
          <span class="record-count" aria-live="polite">{{ displayedCount }}</span>
        </button>
        <button class="rm-icon-btn" aria-label="Close definition" @click="emit('close')"><Xmark width="18" height="18" aria-hidden="true" /></button>
      </div>
    </div>
    <div class="lookup-body" tabindex="0" role="region" aria-label="Translation and definitions">
    <ContextExplanation v-if="CONTEXT_EXPLANATION_ENABLED && context !== undefined" :word="word" :context="context ?? ''" />
    <div v-if="definition && definition.word.toLowerCase() !== word.toLowerCase()" class="phonetic base-form">Base form: {{ definition.word }}</div>
    <div v-if="loading" class="lookup-status loading" role="status">
      <Refresh class="rm-spinner" width="18" height="18" aria-hidden="true" />
      <div><h3>Looking up this word…</h3><p>Loading Chinese translation and English definitions.</p></div>
    </div>
    <div v-else-if="error" class="lookup-status is-error" role="alert">
      <WarningTriangle width="18" height="18" aria-hidden="true" />
      <div><h3>We couldn't load this word</h3><p>{{ error }}</p></div>
    </div>
    <button v-if="error" class="rm-text-action retry-btn" @click="emit('retry')">Try again</button>
    <div v-else-if="definition" class="definition">
      <TranslationText :translation="definition.translation" />
      <p v-if="translationLoading && !definition.translation" class="lookup-note" role="status">Translating to Chinese…</p>
      <p v-else-if="translationError && !definition.translation" class="lookup-note">{{ translationError }} <button class="rm-text-action" @click="emit('retry')">Retry</button></p>
      <p v-if="englishLoading && !definition.meanings.length" class="lookup-note" role="status">Loading English definition…</p>
      <p v-else-if="englishError && !definition.meanings.length" class="lookup-note">English definition unavailable. The translation can still be saved.</p>
      <div v-for="(meaning, index) in (definition.source === 'rememberme-dict' ? definition.meanings : definition.meanings.slice(0, 2))" :key="index" class="lookup-meaning">
        <div class="part-of-speech">{{ meaning.partOfSpeech }}</div>
        <div v-for="(item, itemIndex) in (definition.source === 'rememberme-dict' ? meaning.definitions : meaning.definitions.slice(0, 2))" :key="itemIndex" class="definition-item">
          <p class="definition-text">{{ item.definition }}</p>
          <p v-if="item.example" class="example"><HighlightedText :text="item.example" :word="word" /></p>
          <p v-if="typeof item.exampleTranslation === 'string'" class="example-translation" lang="zh-CN">{{ item.exampleTranslation }}</p>
        </div>
      </div>
      <DefinitionSource :source="definition.source" />
    </div>
    <details v-if="savedWord?.history.length" class="lookup-records">
      <summary class="records-toggle">Records · {{ savedWord.history.length }}</summary>
      <WordHistory :word="word" :history="savedWord.history" :heading="false" />
    </details>
    <p v-if="saveError" class="save-error" role="alert">{{ saveError }}</p>
    <p v-if="saving" class="lookup-note" role="status">Saving this encounter…</p>
    <p v-if="recordsError" class="lookup-note" role="alert">{{ recordsError }}</p>
    </div>
  </section>
  </IconoirProvider>
</template>
