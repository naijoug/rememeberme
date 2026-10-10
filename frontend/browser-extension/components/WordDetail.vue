<script lang="ts" setup>
import { computed } from 'vue';
import type { WordEntry } from '~/types';
import WordHistory from './WordHistory.vue';
import HighlightedText from './HighlightedText.vue';
import DefinitionSource from './DefinitionSource.vue';
import TranslationText from './TranslationText.vue';
import WordPronunciation from './WordPronunciation.vue';

const props = defineProps<{ wordEntry: WordEntry }>();
const latestDefinition = computed(() => props.wordEntry.history.at(-1)?.definition);
</script>

<template>
  <div class="word-detail">
    <h2 class="word-title rm-word">{{ wordEntry.word }}</h2>
    <div class="word-meta">
      <span class="count">Forgotten {{ wordEntry.count }} {{ wordEntry.count === 1 ? 'time' : 'times' }}</span>
    </div>
    <WordPronunciation :word="wordEntry.word" :definition="latestDefinition" />
    <p v-if="latestDefinition && latestDefinition.word.toLowerCase() !== wordEntry.word.toLowerCase()" class="phonetic base-form">Base form: {{ latestDefinition.word }}</p>
    <div class="definition-section">
      <TranslationText :translation="latestDefinition?.translation" />
      <template v-if="latestDefinition?.meanings.length">
        <div v-for="(meaning, index) in latestDefinition.meanings" :key="index" class="meaning">
          <div class="part-of-speech">{{ meaning.partOfSpeech }}</div>
          <div v-for="(item, itemIndex) in meaning.definitions" :key="itemIndex" class="definition-item">
            <p class="definition-text">{{ item.definition }}</p>
            <p v-if="item.example" class="example"><HighlightedText :text="item.example" :word="wordEntry.word" /></p>
          </div>
        </div>
      </template>
      <p v-else class="definition-text">{{ latestDefinition?.translation ? 'No English definition saved for this word.' : 'No definition saved for this word.' }}</p>
      <DefinitionSource :source="latestDefinition?.source" />
    </div>
    <WordHistory :word="wordEntry.word" :history="wordEntry.history" />
  </div>
</template>
