<script lang="ts" setup>
import { ref, computed, nextTick, onMounted, onUpdated, onUnmounted, watch } from 'vue';
import type { WordEntry } from '~/types';
import WordDetail from './WordDetail.vue';

const props = defineProps<{ words: WordEntry[] }>();
const emit = defineEmits<{ delete: [word: string]; reset: [word: string] }>();
const expandedWord = ref<string | null>(null);
const showDeleteConfirm = ref<string | null>(null);

// Collapsed headers have an exact height; the single open row is measured.
const ITEM_HEIGHT = 70;
const BUFFER_SIZE = 5;
const scrollTop = ref(0);
const containerHeight = ref(500);
const scrollContainer = ref<HTMLElement | null>(null);
const expandedHeight = ref(ITEM_HEIGHT);
const expandedIndex = computed(() => props.words.findIndex(entry => entry.word === expandedWord.value));
const extraHeight = computed(() => expandedIndex.value < 0 ? 0 : Math.max(0, expandedHeight.value - ITEM_HEIGHT));
const useVirtualScroll = computed(() => props.words.length > 100);
const totalHeight = computed(() => props.words.length * ITEM_HEIGHT + extraHeight.value);

function offsetFor(index: number): number {
  return index * ITEM_HEIGHT + (expandedIndex.value >= 0 && index > expandedIndex.value ? extraHeight.value : 0);
}

function indexAt(offset: number): number {
  const openIndex = expandedIndex.value;
  const openTop = openIndex * ITEM_HEIGHT;
  if (openIndex >= 0 && offset >= openTop) {
    if (offset < openTop + ITEM_HEIGHT + extraHeight.value) return openIndex;
    offset -= extraHeight.value;
  }
  return Math.max(0, Math.min(props.words.length - 1, Math.floor(offset / ITEM_HEIGHT)));
}

const visibleRange = computed(() => useVirtualScroll.value ? {
  start: Math.max(0, indexAt(scrollTop.value) - BUFFER_SIZE),
  end: Math.min(props.words.length, indexAt(scrollTop.value + containerHeight.value) + BUFFER_SIZE + 1),
} : { start: 0, end: props.words.length });
const visibleWords = computed(() => props.words.slice(visibleRange.value.start, visibleRange.value.end));
const offsetY = computed(() => useVirtualScroll.value ? offsetFor(visibleRange.value.start) : 0);

function handleScroll(event: Event) {
  scrollTop.value = (event.target as HTMLElement).scrollTop;
}

function setScrollTop(top: number) {
  const clamped = Math.max(0, Math.min(top, totalHeight.value - containerHeight.value));
  scrollTop.value = clamped;
  if (scrollContainer.value) scrollContainer.value.scrollTop = clamped;
}

let resizeObserver: ResizeObserver | undefined;
let measuredRow: HTMLElement | null = null;
function measure() {
  if (scrollContainer.value) containerHeight.value = scrollContainer.value.clientHeight;
  if (measuredRow) {
    const height = measuredRow.getBoundingClientRect().height;
    if (height > 0) expandedHeight.value = Math.max(ITEM_HEIGHT, height);
  }
}

function observeExpandedRow() {
  const row = scrollContainer.value?.querySelector<HTMLElement>('.word-item.expanded') ?? null;
  if (row === measuredRow) return;
  if (measuredRow) resizeObserver?.unobserve(measuredRow);
  measuredRow = row;
  if (row) {
    resizeObserver?.observe(row);
    measure();
  }
}

onMounted(() => {
  resizeObserver = new ResizeObserver(measure);
  if (scrollContainer.value) resizeObserver.observe(scrollContainer.value);
  measure();
  observeExpandedRow();
});
onUpdated(observeExpandedRow);
onUnmounted(() => resizeObserver?.disconnect());

async function toggleExpand(word: string) {
  const index = props.words.findIndex(entry => entry.word === word);
  const headerTop = offsetFor(index) - scrollTop.value;
  expandedWord.value = expandedWord.value === word ? null : word;
  expandedHeight.value = ITEM_HEIGHT;
  // Keep the clicked header in place when an earlier expanded row collapses.
  const nextTop = Math.max(0, offsetFor(index) - headerTop);
  scrollTop.value = nextTop;
  await nextTick();
  setScrollTop(nextTop);
}

// Sorting or replacing the list starts at the top and cannot leave an empty range.
watch(() => [props.words, props.words.length], async () => {
  if (expandedIndex.value < 0) {
    expandedWord.value = null;
    expandedHeight.value = ITEM_HEIGHT;
  }
  showDeleteConfirm.value = null;
  scrollTop.value = 0;
  await nextTick();
  setScrollTop(0);
});

function handleDelete(word: string) {
  showDeleteConfirm.value = null;
  emit('delete', word);
  if (expandedWord.value === word) {
    expandedWord.value = null;
    expandedHeight.value = ITEM_HEIGHT;
  }
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
</script>

<template>
  <div ref="scrollContainer" class="word-list" :style="{ '--word-row-height': `${ITEM_HEIGHT}px` }" @scroll="handleScroll">
    <div :class="{ 'virtual-scroll-spacer': useVirtualScroll }" :style="useVirtualScroll ? { height: `${totalHeight}px` } : undefined">
      <div :class="{ 'virtual-scroll-content': useVirtualScroll }" :style="useVirtualScroll ? { transform: `translateY(${offsetY}px)` } : undefined">
        <div
          v-for="wordEntry in visibleWords"
          :key="wordEntry.word"
          class="word-item"
          :class="{ expanded: expandedWord === wordEntry.word }"
        >
          <div class="word-header" @click="toggleExpand(wordEntry.word)">
            <div class="word-info">
              <span class="word-text" :title="wordEntry.word">{{ wordEntry.word }}</span>
              <div class="word-meta">
                <span class="count">Count: {{ wordEntry.count }}</span>
                <span class="date">Last: {{ formatDate(wordEntry.updatedAt) }}</span>
              </div>
            </div>
            <div class="expand-icon">{{ expandedWord === wordEntry.word ? '▼' : '▶' }}</div>
          </div>
          <div v-if="expandedWord === wordEntry.word" class="word-content">
            <div class="word-actions">
              <button class="reset-btn" @click.stop="emit('reset', wordEntry.word)">Reset Count</button>
              <button class="delete-btn" @click.stop="showDeleteConfirm = wordEntry.word">Delete</button>
            </div>
            <WordDetail :word-entry="wordEntry" />
          </div>
        </div>
      </div>
    </div>
    <!-- Keep this viewport overlay outside the translated virtual rows. -->
    <div v-if="showDeleteConfirm !== null" class="delete-confirm" @click.stop>
      <div class="confirm-content">
        <p>Delete "{{ showDeleteConfirm }}"?</p>
        <div class="confirm-actions">
          <button class="cancel-btn" @click="showDeleteConfirm = null">Cancel</button>
          <button class="confirm-btn" @click="handleDelete(showDeleteConfirm)">Delete</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.word-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-anchor: none;
  position: relative;
}

.virtual-scroll-spacer {
  position: relative;
  width: 100%;
}

.virtual-scroll-content {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  will-change: transform;
}

.word-item {
  border-bottom: 1px solid #e0e0e0;
  transition: background-color 0.2s;
}

.word-item:hover {
  background-color: #f9f9f9;
}

.word-item.expanded {
  background-color: #f5f5f5;
}

.word-header {
  height: calc(var(--word-row-height) - 1px);
  box-sizing: border-box;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  cursor: pointer;
  user-select: none;
}

.word-info {
  flex: 1;
  min-width: 0;
}

.word-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: block;
  font-size: 16px;
  font-weight: 500;
  color: #333;
  margin-bottom: 4px;
}

.word-meta {
  white-space: nowrap;
  overflow: hidden;
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: #666;
}

.count {
  font-weight: 500;
  color: #4CAF50;
}

.expand-icon {
  color: #999;
  font-size: 12px;
  margin-left: 8px;
}

.word-content {
  padding: 0 16px 16px 16px;
  border-top: 1px solid #e0e0e0;
}

.word-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  padding-top: 12px;
}

.reset-btn,
.delete-btn {
  padding: 6px 12px;
  border: none;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.reset-btn {
  background-color: #2196F3;
  color: white;
}

.reset-btn:hover {
  background-color: #1976D2;
}

.delete-btn {
  background-color: #f44336;
  color: white;
}

.delete-btn:hover {
  background-color: #d32f2f;
}

.delete-confirm {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.confirm-content {
  background-color: white;
  padding: 24px;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  min-width: 280px;
}

.confirm-content p {
  margin: 0 0 16px 0;
  font-size: 16px;
  color: #333;
}

.confirm-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.cancel-btn,
.confirm-btn {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  font-size: 14px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.cancel-btn {
  background-color: #e0e0e0;
  color: #333;
}

.cancel-btn:hover {
  background-color: #d0d0d0;
}

.confirm-btn {
  background-color: #f44336;
  color: white;
}

.confirm-btn:hover {
  background-color: #d32f2f;
}
</style>
