<script lang="ts" setup>
import { computed } from 'vue';
import { Circle , IconoirProvider } from '@iconoir/vue';
import type { HistoryRecord } from '~/types';

// Props
interface Props {
  record: HistoryRecord;
  word: string;
  showDefinition?: boolean;
}

const props = defineProps<Props>();
const isoDate = computed(() => {
  const date = new Date(props.record.timestamp);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
});

// Format timestamp
function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  if (date.toDateString() === new Date().toDateString()) return 'Today';
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Highlight word in context
const contextParts = computed(() => {
  const context = props.record.context;
  if (!props.word) return [context];

  // Imported words are data, not regular expressions or HTML.
  const escapedWord = props.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return context.split(new RegExp(`\\b(${escapedWord})\\b`, 'gi'));
});

const sourceUrl = computed(() => {
  try {
    const url = new URL(props.record.url);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
});

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
  <IconoirProvider :icon-props="{ color: 'currentColor', 'stroke-width': 1.5 }">
  <article class="history-item">
    <Circle class="history-dot" width="9" height="9" aria-hidden="true" />
    <div class="history-header">
      <time class="timestamp" :datetime="isoDate">{{ formatTimestamp(record.timestamp) }}</time>
      <a v-if="sourceUrl" class="url-link" :href="sourceUrl" target="_blank" rel="noopener noreferrer" :title="record.url">{{ getShortUrl(record.url) }}</a>
      <span v-else-if="record.url" class="source-text">{{ record.url }}</span>
    </div>
    <div v-if="record.context" class="context-text"><template v-for="(part, index) in contextParts" :key="index"><mark v-if="index % 2 === 1">{{ part }}</mark><template v-else>{{ part }}</template></template></div>
    <details v-if="showDefinition && record.definition.meanings.length" class="history-definition">
      <summary>Definition at the time</summary>
      <p>{{ record.definition.meanings[0]?.definitions[0]?.definition }}</p>
    </details>
  </article>
  </IconoirProvider>
</template>
