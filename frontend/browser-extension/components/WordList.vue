<script lang="ts" setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { NavArrowRight , IconoirProvider } from '@iconoir/vue';
import type { WordEntry } from '~/types';
import { isTranslation } from '~/services/definition-utils';

const props = defineProps<{ words: WordEntry[]; initialScrollTop?: number }>();
const emit = defineEmits<{ select: [word: string]; 'scroll-position': [top: number] }>();
const ROW_HEIGHT = 76;
const BUFFER = 5;
const scrollTop = ref(props.initialScrollTop ?? 0);
const viewportHeight = ref(370);
const scrollContainer = ref<HTMLElement>();
const virtual = computed(() => props.words.length > 100);
const start = computed(() => virtual.value ? Math.max(0, Math.floor(scrollTop.value / ROW_HEIGHT) - BUFFER) : 0);
const end = computed(() => virtual.value ? Math.min(props.words.length, Math.ceil((scrollTop.value + viewportHeight.value) / ROW_HEIGHT) + BUFFER) : props.words.length);
const visibleWords = computed(() => props.words.slice(start.value, end.value));
let observer: ResizeObserver | undefined;
onMounted(() => {
  if (scrollContainer.value) scrollContainer.value.scrollTop = scrollTop.value;
  observer = new ResizeObserver(() => { viewportHeight.value = scrollContainer.value?.clientHeight || 370; });
  if (scrollContainer.value) observer.observe(scrollContainer.value);
});
onUnmounted(() => observer?.disconnect());
watch(() => props.words, () => {
  scrollTop.value = 0;
  emit('scroll-position', 0);
  if (scrollContainer.value) scrollContainer.value.scrollTop = 0;
});
function handleScroll(event: Event) {
  scrollTop.value = (event.target as HTMLElement).scrollTop;
  emit('scroll-position', scrollTop.value);
}
function summary(entry: WordEntry): string {
  const definition = entry.history.at(-1)?.definition;
  if (isTranslation(definition?.translation)) return definition.translation.text;
  const latest = definition?.meanings[0];
  return latest ? [latest.partOfSpeech, latest.definitions[0]?.definition].filter(Boolean).join(' · ') : 'No definition saved';
}
</script>

<template>
  <IconoirProvider :icon-props="{ color: 'currentColor', 'stroke-width': 1.5 }">
  <div ref="scrollContainer" class="word-list" aria-label="Saved vocabulary" @scroll="handleScroll">
    <div :class="{ 'virtual-scroll-spacer': virtual }" :style="virtual ? { height: words.length * ROW_HEIGHT + 'px' } : undefined">
      <div :class="{ 'virtual-scroll-content': virtual }" :style="virtual ? { transform: 'translateY(' + start * ROW_HEIGHT + 'px)' } : undefined">
        <div v-for="entry in visibleWords" :key="entry.word" class="word-item">
          <button class="word-header" :aria-label="'Open ' + entry.word" @click="emit('select', entry.word)">
            <span class="word-info"><span class="word-text">{{ entry.word }}</span><span class="word-summary">{{ summary(entry) }}</span></span>
            <span class="row-count" :title="'Forgotten ' + entry.count + ' times'">{{ entry.count }}</span>
            <NavArrowRight class="row-chevron" width="16" height="16" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  </div>
  </IconoirProvider>
</template>
