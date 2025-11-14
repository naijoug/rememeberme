<script lang="ts" setup>
import { ref } from 'vue';
import type { WordEntry } from '~/types';
import WordDetail from './WordDetail.vue';

// Props
interface Props {
  words: WordEntry[];
}

defineProps<Props>();

// Emits
const emit = defineEmits<{
  delete: [word: string];
  reset: [word: string];
}>();

// State
const expandedWord = ref<string | null>(null);
const showDeleteConfirm = ref<string | null>(null);

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
  <div class="word-list">
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
</template>

<style scoped>
.word-list {
  flex: 1;
  overflow-y: auto;
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
