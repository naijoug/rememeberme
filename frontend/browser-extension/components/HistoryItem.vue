<script lang="ts" setup>
import { computed } from 'vue';
import type { HistoryRecord } from '~/types';

// Props
interface Props {
  record: HistoryRecord;
  word: string;
}

const props = defineProps<Props>();

// Format timestamp
function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Highlight word in context
const highlightedContext = computed(() => {
  if (!props.record.context) {
    return '';
  }

  const context = props.record.context;
  const word = props.word;
  
  // Create a case-insensitive regex to find the word
  const regex = new RegExp(`\\b(${word})\\b`, 'gi');
  
  // Replace with highlighted version
  return context.replace(regex, '<mark>$1</mark>');
});

// Open URL in new tab
function openUrl() {
  if (props.record.url) {
    window.open(props.record.url, '_blank');
  }
}

// Get short URL for display
function getShortUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return url;
  }
}
</script>

<template>
  <div class="history-item">
    <div class="history-header">
      <span class="timestamp">{{ formatTimestamp(record.timestamp) }}</span>
      <a
        v-if="record.url"
        class="url-link"
        @click.prevent="openUrl"
        :title="record.url"
      >
        {{ getShortUrl(record.url) }}
      </a>
    </div>

    <div v-if="record.context" class="context">
      <div class="context-label">Context:</div>
      <div class="context-text" v-html="highlightedContext"></div>
    </div>

    <div v-if="record.definition" class="definition-summary">
      <div
        v-for="(meaning, index) in record.definition.meanings.slice(0, 1)"
        :key="index"
        class="meaning-summary"
      >
        <span class="part-of-speech">{{ meaning.partOfSpeech }}</span>
        <span class="definition-text">
          {{ meaning.definitions[0]?.definition }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.history-item {
  padding: 12px;
  background-color: #ffffff;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: box-shadow 0.2s;
}

.history-item:hover {
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.timestamp {
  font-size: 12px;
  color: #666;
  font-weight: 500;
}

.url-link {
  font-size: 12px;
  color: #2196F3;
  text-decoration: none;
  cursor: pointer;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.url-link:hover {
  text-decoration: underline;
}

.context {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.context-label {
  font-size: 11px;
  color: #999;
  text-transform: uppercase;
  font-weight: 600;
  letter-spacing: 0.5px;
}

.context-text {
  font-size: 13px;
  line-height: 1.5;
  color: #333;
  padding: 8px;
  background-color: #f9f9f9;
  border-radius: 4px;
  border-left: 3px solid #4CAF50;
}

.context-text :deep(mark) {
  background-color: #ffeb3b;
  padding: 2px 4px;
  border-radius: 2px;
  font-weight: 600;
}

.definition-summary {
  font-size: 12px;
  color: #666;
  padding-top: 4px;
  border-top: 1px solid #f0f0f0;
}

.meaning-summary {
  display: flex;
  gap: 8px;
}

.part-of-speech {
  font-style: italic;
  color: #2196F3;
  font-weight: 500;
  flex-shrink: 0;
}

.definition-text {
  color: #555;
  line-height: 1.4;
}
</style>
