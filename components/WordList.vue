<script lang="ts" setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import type { WordEntry } from '~/types';
import WordDetail from './WordDetail.vue';

// Props
interface Props {
  words: WordEntry[];
}

const props = defineProps<Props>();

// Emits
const emit = defineEmits<{
  delete: [word: string];
  reset: [word: string];
}>();

// State
const expandedWord = ref<string | null>(null);
const showDeleteConfirm = ref<string | null>(null);

// Virtual scrolling state
const ITEM_HEIGHT = 70; // Approximate height of collapsed item
const BUFFER_SIZE = 5; // Number of items to render outside viewport
const scrollTop = ref(0);
const containerHeight = ref(500);
const scrollContainer = ref<HTMLElement | null>(null);

// Enable virtual scrolling only when there are more than 100 words
const useVirtualScroll = computed(() => props.words.length > 100);

// Calculate visible range for virtual scrolling
const visibleRange = computed(() => {
  if (!useVirtualScroll.value) {
    return { start: 0, end: props.words.length };
  }

  const start = Math.max(0, Math.floor(scrollTop.value / ITEM_HEIGHT) - BUFFER_SIZE);
  const visibleCount = Math.ceil(containerHeight.value / ITEM_HEIGHT);
  const end = Math.min(props.words.length, start + visibleCount + BUFFER_SIZE * 2);

  return { start, end };
});

// Visible words for virtual scrolling
const visibleWords = computed(() => {
  if (!useVirtualScroll.value) {
    return props.words;
  }
  return props.words.slice(visibleRange.value.start, visibleRange.value.end);
});

// Total height for virtual scrolling
const totalHeight = computed(() => {
  if (!useVirtualScroll.value) return 'auto';
  return `${props.words.length * ITEM_HEIGHT}px`;
});

// Offset for virtual scrolling
const offsetY = computed(() => {
  if (!useVirtualScroll.value) return 0;
  return visibleRange.value.start * ITEM_HEIGHT;
});

// Handle scroll event
function handleScroll(event: Event) {
  const target = event.target as HTMLElement;
  scrollTop.value = target.scrollTop;
}

// Update container height
function updateContainerHeight() {
  if (scrollContainer.value) {
    containerHeight.value = scrollContainer.value.clientHeight;
  }
}

// Setup scroll listener
onMounted(() => {
  updateContainerHeight();
  window.addEventListener('resize', updateContainerHeight);
});

onUnmounted(() => {
  window.removeEventListener('resize', updateContainerHeight);
});

// Toggle word detail expansion
function toggleExpand(word: string) {
  if (expandedWord.value === word) {
    expandedWord.value = null;
  } else {
    expandedWord.value = word;
  }
}

// Show delete confirmation
function confirmDelete(word: string) {
  showDeleteConfirm.value = word;
}

// Cancel delete
function cancelDelete() {
  showDeleteConfirm.value = null;
}

// Handle delete
function handleDelete(word: string) {
  emit('delete', word);
  showDeleteConfirm.value = null;
  if (expandedWord.value === word) {
    expandedWord.value = null;
  }
}

// Handle reset
function handleReset(word: string) {
  emit('reset', word);
}

// Format date
function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
</script>

<template>
  <div ref="scrollContainer" class="word-list" @scroll="handleScroll">
    <div v-if="useVirtualScroll" class="virtual-scroll-spacer" :style="{ height: totalHeight }">
      <div class="virtual-scroll-content" :style="{ transform: `translateY(${offsetY}px)` }">
        <div
          v-for="wordEntry in visibleWords"
          :key="wordEntry.word"
          class="word-item"
          :class="{ expanded: expandedWord === wordEntry.word }"
        >
      <div class="word-header" @click="toggleExpand(wordEntry.word)">
        <div class="word-info">
          <span class="word-text">{{ wordEntry.word }}</span>
          <div class="word-meta">
            <span class="count">Count: {{ wordEntry.count }}</span>
            <span class="date">Last: {{ formatDate(wordEntry.updatedAt) }}</span>
          </div>
        </div>
        <div class="expand-icon">
          {{ expandedWord === wordEntry.word ? '▼' : '▶' }}
        </div>
      </div>

      <div v-if="expandedWord === wordEntry.word" class="word-content">
        <div class="word-actions">
          <button class="reset-btn" @click.stop="handleReset(wordEntry.word)">
            Reset Count
          </button>
          <button class="delete-btn" @click.stop="confirmDelete(wordEntry.word)">
            Delete
          </button>
        </div>

        <WordDetail :word-entry="wordEntry" />
      </div>

      <!-- Delete confirmation dialog -->
      <div
        v-if="showDeleteConfirm === wordEntry.word"
        class="delete-confirm"
        @click.stop
      >
        <div class="confirm-content">
          <p>Delete "{{ wordEntry.word }}"?</p>
          <div class="confirm-actions">
            <button class="cancel-btn" @click="cancelDelete">Cancel</button>
            <button class="confirm-btn" @click="handleDelete(wordEntry.word)">
              Delete
            </button>
          </div>
        </div>
      </div>
      </div>
    </div>
    <div v-else>
      <div
        v-for="wordEntry in words"
        :key="wordEntry.word"
        class="word-item"
        :class="{ expanded: expandedWord === wordEntry.word }"
      >
        <div class="word-header" @click="toggleExpand(wordEntry.word)">
          <div class="word-info">
            <span class="word-text">{{ wordEntry.word }}</span>
            <div class="word-meta">
              <span class="count">Count: {{ wordEntry.count }}</span>
              <span class="date">Last: {{ formatDate(wordEntry.updatedAt) }}</span>
            </div>
          </div>
          <div class="expand-icon">
            {{ expandedWord === wordEntry.word ? '▼' : '▶' }}
          </div>
        </div>

        <div v-if="expandedWord === wordEntry.word" class="word-content">
          <div class="word-actions">
            <button class="reset-btn" @click.stop="handleReset(wordEntry.word)">
              Reset Count
            </button>
            <button class="delete-btn" @click.stop="confirmDelete(wordEntry.word)">
              Delete
            </button>
          </div>

          <WordDetail :word-entry="wordEntry" />
        </div>

        <!-- Delete confirmation dialog -->
        <div
          v-if="showDeleteConfirm === wordEntry.word"
          class="delete-confirm"
          @click.stop
        >
          <div class="confirm-content">
            <p>Delete "{{ wordEntry.word }}"?</p>
            <div class="confirm-actions">
              <button class="cancel-btn" @click="cancelDelete">Cancel</button>
              <button class="confirm-btn" @click="handleDelete(wordEntry.word)">
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.word-list {
  flex: 1;
  overflow-y: auto;
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
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  cursor: pointer;
  user-select: none;
}

.word-info {
  flex: 1;
}

.word-text {
  display: block;
  font-size: 16px;
  font-weight: 500;
  color: #333;
  margin-bottom: 4px;
}

.word-meta {
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
