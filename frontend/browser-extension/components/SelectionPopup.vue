<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { Refresh, WarningTriangle, Xmark , IconoirProvider } from '@iconoir/vue';
import type { Definition, Position } from '~/types';
import HighlightedText from './HighlightedText.vue';
import DefinitionSource from './DefinitionSource.vue';

const props = defineProps<{
  word: string; position: Position; visible: boolean; definition?: Definition;
  loading?: boolean; error?: string; saving?: boolean; saveError?: string; inline?: boolean;
}>();
const emit = defineEmits<{ remember: []; forget: []; close: []; retry: [] }>();
const card = ref<HTMLElement>();
const coords = ref({ left: 12, top: 12 });
let observer: ResizeObserver | undefined;
const phonetic = computed(() => props.definition?.phonetic || props.definition?.phonetics.find(item => item?.text)?.text);
const popupStyle = computed(() => props.inline
  ? { position: 'relative' as const, left: 'auto', top: 'auto' }
  : { left: coords.value.left + 'px', top: coords.value.top + 'px' });

function positionCard() {
  if (!props.visible || !card.value || props.inline) return;
  const box = card.value.getBoundingClientRect();
  const width = box.width || Math.min(340, innerWidth - 24);
  const height = box.height || 220;
  const left = Math.max(12, Math.min(props.position.x - width / 2, innerWidth - width - 12));
  let top = props.position.y;
  if (top + height > innerHeight - 12) top = (props.position.anchorTop ?? props.position.y) - height - 10;
  coords.value = { left, top: Math.max(12, Math.min(top, innerHeight - height - 12)) };
}
watch(card, value => { observer?.disconnect(); if (value) observer?.observe(value); positionCard(); }, { flush: 'post' });
watch(() => [props.visible, props.position.x, props.position.y, props.loading, props.error], async () => { await nextTick(); positionCard(); });
onMounted(() => {
  observer = new ResizeObserver(positionCard);
  if (card.value) observer.observe(card.value);
  window.addEventListener('resize', positionCard);
  positionCard();
});
onUnmounted(() => { observer?.disconnect(); window.removeEventListener('resize', positionCard); });
</script>

<template>
  <IconoirProvider :icon-props="{ color: 'currentColor', 'stroke-width': 1.5 }">
  <section v-if="visible" ref="card" class="vocab-counter-popup" :style="popupStyle" role="dialog" :aria-label="'Definition of ' + word" :aria-busy="loading || saving" @click.stop @mouseup.stop @keydown.esc.stop="emit('close')">
    <div class="lookup-header">
      <h2 class="word rm-word">{{ word }}</h2>
      <button class="rm-icon-btn" aria-label="Close definition" @click="emit('close')"><Xmark width="20" height="20" aria-hidden="true" /></button>
    </div>
    <div v-if="phonetic" class="phonetic">{{ phonetic }}</div>
    <div v-if="definition && definition.word.toLowerCase() !== word.toLowerCase()" class="phonetic base-form">Base form: {{ definition.word }}</div>
    <div v-if="loading" class="lookup-status loading" role="status">
      <Refresh class="rm-spinner" width="18" height="18" aria-hidden="true" />
      <div><h3>Looking up this word…</h3><p>Checking the dictionary. You can close this at any time.</p></div>
    </div>
    <div v-else-if="error" class="lookup-status is-error" role="alert">
      <WarningTriangle width="18" height="18" aria-hidden="true" />
      <div><h3>We couldn't load this word</h3><p>{{ error }}</p></div>
    </div>
    <div v-else-if="definition" class="definition">
      <div v-for="(meaning, index) in definition.meanings.slice(0, 2)" :key="index" class="lookup-meaning">
        <div class="part-of-speech">{{ meaning.partOfSpeech }}</div>
        <div v-for="(item, itemIndex) in meaning.definitions.slice(0, 2)" :key="itemIndex" class="definition-item">
          <p class="definition-text">{{ item.definition }}</p>
          <p v-if="item.example" class="example"><HighlightedText :text="item.example" :word="word" /></p>
        </div>
      </div>
      <DefinitionSource :source="definition.source" />
    </div>
    <p v-if="saveError" class="save-error" role="alert">{{ saveError }}</p>
    <div class="lookup-actions">
      <template v-if="error">
        <button class="rm-button rm-secondary" @click="emit('close')">Close</button>
        <button class="rm-button rm-primary retry-btn" @click="emit('retry')">Try again</button>
      </template>
      <template v-else>
        <button class="rm-button rm-secondary btn-remember" :disabled="saving" @click="loading ? emit('close') : emit('remember')">{{ loading ? 'Cancel' : 'Remember' }}</button>
        <button class="rm-button rm-primary btn-forget" :disabled="loading || saving || !definition" @click="emit('forget')">{{ saving ? 'Saving…' : 'Forget' }}</button>
      </template>
    </div>
  </section>
  </IconoirProvider>
</template>
