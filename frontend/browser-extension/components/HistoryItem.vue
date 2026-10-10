<script lang="ts" setup>
import { computed } from 'vue';
import { NavArrowDown, IconoirProvider } from '@iconoir/vue';
import type { HistoryRecord } from '~/types';
import TranslationText from './TranslationText.vue';

// Props
interface Props {
  record: HistoryRecord;
  word: string;
  showDefinition?: boolean;
  recordNumber?: number;
}

const props = defineProps<Props>();
const isoDate = computed(() => {
  const date = new Date(props.record.timestamp);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
});

// Format timestamp
function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return 'Unknown time';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
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
    <details class="record-entry">
      <summary class="record-summary">
        <span class="record-number">#{{ recordNumber ?? 1 }}</span>
        <span class="record-summary-text"><time class="timestamp" :datetime="isoDate" :title="isoDate">{{ formatTimestamp(record.timestamp) }}</time><span class="record-domain">{{ sourceUrl ? getShortUrl(record.url) : 'No webpage' }}</span></span>
        <NavArrowDown class="record-chevron" width="15" height="15" aria-hidden="true" />
      </summary>
      <div class="record-content">
    <div v-if="record.context" class="context-text"><template v-for="(part, index) in contextParts" :key="index"><mark v-if="index % 2 === 1">{{ part }}</mark><template v-else>{{ part }}</template></template></div>
    <p v-else class="context-text">Sentence unavailable for this record.</p>
    <a v-if="sourceUrl" class="url-link" :href="sourceUrl" target="_blank" rel="noopener noreferrer">{{ record.url }}</a>
    <span v-else-if="record.url" class="source-text">{{ record.url }}</span>
    <p v-else class="source-text">No webpage URL recorded.</p>
    <details v-if="showDefinition && (record.definition.meanings.length || record.definition.translation)" class="history-definition">
      <summary>Definition at the time</summary>
      <TranslationText :translation="record.definition.translation" />
      <p>{{ record.definition.meanings[0]?.definitions[0]?.definition }}</p>
    </details>
      </div>
    </details>
  </article>
  </IconoirProvider>
</template>
