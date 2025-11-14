<script lang="ts" setup>
import { ref, onMounted, computed } from 'vue';
import { storageService } from '~/services/storage';
import type { WordEntry } from '~/types';
import WordList from '~/components/WordList.vue';

// State
const words = ref<WordEntry[]>([]);
const sortBy = ref<'count' | 'updatedAt'>('count');
const loading = ref(true);
const error = ref<string | null>(null);

// Computed sorted words
const sortedWords = computed(() => {
  const wordsCopy = [...words.value];
  if (sortBy.value === 'count') {
    return wordsCopy.sort((a, b) => b.count - a.count);
  } else {
    return wordsCopy.sort((a, b) => b.updatedAt - a.updatedAt);
  }
});

// Load words on mount
onMounted(async () => {
  await loadWords();
});

// Load all words from storage
async function loadWords() {
  try {
    loading.value = true;
    error.value = null;
    words.value = await storageService.getAllWords();
  } catch (err) {
    console.error('Failed to load words:', err);
    error.value = 'Failed to load words';
  } finally {
    loading.value = false;
  }
}

// Handle sort change
function handleSortChange(event: Event) {
  const target = event.target as HTMLSelectElement;
  sortBy.value = target.value as 'count' | 'updatedAt';
}

// Handle export
async function handleExport() {
  try {
    const jsonData = await storageService.exportData();
    const blob = new Blob([jsonData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const date = new Date().toISOString().split('T')[0];
    a.download = `vocabulary-counter-${date}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Failed to export data:', err);
    error.value = 'Failed to export data';
  }
}

// Handle word deletion
async function handleDeleteWord(word: string) {
  try {
    await storageService.deleteWord(word);
    await loadWords();
  } catch (err) {
    console.error('Failed to delete word:', err);
    error.value = 'Failed to delete word';
  }
}

// Handle count reset
async function handleResetCount(word: string) {
  try {
    await storageService.resetCount(word);
    await loadWords();
  } catch (err) {
    console.error('Failed to reset count:', err);
    error.value = 'Failed to reset count';
  }
}
</script>

<template>
  <div class="vocabulary-counter">
    <header class="header">
      <h1 class="title">Vocabulary Counter</h1>
      <div class="toolbar">
        <div class="sort-control">
          <label for="sort-select">Sort by:</label>
          <select id="sort-select" :value="sortBy" @change="handleSortChange">
            <option value="count">Count</option>
            <option value="updatedAt">Last Updated</option>
          </select>
        </div>
        <button class="export-btn" @click="handleExport">Export</button>
      </div>
    </header>

    <div v-if="loading" class="loading">Loading...</div>
    <div v-else-if="error" class="error">{{ error }}</div>
    <div v-else-if="sortedWords.length === 0" class="empty">
      No words saved yet. Select words on any webpage to get started!
    </div>
    <WordList
      v-else
      :words="sortedWords"
      @delete="handleDeleteWord"
      @reset="handleResetCount"
    />
  </div>
</template>

<style scoped>
.vocabulary-counter {
  width: 400px;
  min-height: 500px;
  max-height: 600px;
  display: flex;
  flex-direction: column;
  background-color: #ffffff;
  color: #333;
}

.header {
  padding: 16px;
  border-bottom: 1px solid #e0e0e0;
  background-color: #f5f5f5;
}

.title {
  margin: 0 0 12px 0;
  font-size: 20px;
  font-weight: 600;
  color: #333;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.sort-control {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}

.sort-control label {
  color: #666;
}

.sort-control select {
  padding: 4px 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
  background-color: #fff;
  font-size: 14px;
  cursor: pointer;
}

.sort-control select:hover {
  border-color: #999;
}

.export-btn {
  padding: 6px 16px;
  background-color: #4CAF50;
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 14px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.export-btn:hover {
  background-color: #45a049;
}

.loading,
.error,
.empty {
  padding: 32px 16px;
  text-align: center;
  color: #666;
  font-size: 14px;
}

.error {
  color: #d32f2f;
}

.empty {
  color: #999;
}
</style>
