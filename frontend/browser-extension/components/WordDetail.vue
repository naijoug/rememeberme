<script lang="ts" setup>
import { computed } from 'vue';
import type { WordEntry } from '~/types';
import HistoryItem from './HistoryItem.vue';
import HighlightedText from './HighlightedText.vue';
import DefinitionSource from './DefinitionSource.vue';

const props = defineProps<{ wordEntry: WordEntry }>();
const latestDefinition = computed(() => props.wordEntry.history.at(-1)?.definition);
const history = computed(() => [...props.wordEntry.history].reverse());
</script>

<template>
  <div class="word-detail">
    <h2 class="word-title rm-word">{{ wordEntry.word }}</h2>
    <div class="word-meta">
      <span class="phonetic">{{ latestDefinition?.phonetic || latestDefinition?.phonetics.find(item => item?.text)?.text || '' }}</span>
      <span class="count">Forgotten {{ wordEntry.count }} {{ wordEntry.count === 1 ? 'time' : 'times' }}</span>
    </div>
    <p v-if="latestDefinition && latestDefinition.word.toLowerCase() !== wordEntry.word.toLowerCase()" class="phonetic base-form">Base form: {{ latestDefinition.word }}</p>
    <div class="definition-section">
      <template v-if="latestDefinition?.meanings.length">
        <div v-for="(meaning, index) in latestDefinition.meanings" :key="index" class="meaning">
          <div class="part-of-speech">{{ meaning.partOfSpeech }}</div>
          <div v-for="(item, itemIndex) in meaning.definitions" :key="itemIndex" class="definition-item">
            <p class="definition-text">{{ item.definition }}</p>
            <p v-if="item.example" class="example"><HighlightedText :text="item.example" :word="wordEntry.word" /></p>
          </div>
        </div>
      </template>
      <p v-else class="definition-text">No definition saved for this word.</p>
      <DefinitionSource :source="latestDefinition?.source" />
    </div>
    <section class="history-section" aria-label="Word history">
      <h3 class="section-title">Where you found it <span v-if="history.length > 1">· {{ history.length }} records</span></h3>
      <HistoryItem v-for="(record, index) in history" :key="index" :record="record" :word="wordEntry.word" :show-definition="index > 0" />
      <p v-if="!history.length" class="context-text">No saved context yet.</p>
    </section>
  </div>
</template>
