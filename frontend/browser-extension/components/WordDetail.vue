<script lang="ts" setup>
import type { WordEntry } from '~/types';
import HistoryItem from './HistoryItem.vue';

// Props
interface Props {
  wordEntry: WordEntry;
}

const props = defineProps<Props>();

// Get the most recent definition for display
const latestDefinition = props.wordEntry.history.length > 0
  ? props.wordEntry.history[props.wordEntry.history.length - 1].definition
  : null;
</script>

<template>
  <div class="word-detail">
    <!-- Definition Section -->
    <div v-if="latestDefinition" class="definition-section">
      <h3 class="section-title">Definition</h3>
      <div class="definition-content">
        <div v-if="latestDefinition.phonetic" class="phonetic">
          {{ latestDefinition.phonetic }}
        </div>

        <div
          v-for="(meaning, index) in latestDefinition.meanings"
          :key="index"
          class="meaning"
        >
          <div class="part-of-speech">{{ meaning.partOfSpeech }}</div>
          <ol class="definitions-list">
            <li
              v-for="(def, defIndex) in meaning.definitions"
              :key="defIndex"
              class="definition-item"
            >
              <div class="definition-text">{{ def.definition }}</div>
              <div v-if="def.example" class="example">
                <em>"{{ def.example }}"</em>
              </div>
            </li>
          </ol>
        </div>
      </div>
    </div>

    <!-- History Section -->
    <div class="history-section">
      <h3 class="section-title">
        History ({{ wordEntry.history.length }} record{{ wordEntry.history.length !== 1 ? 's' : '' }})
      </h3>
      <div class="history-list">
        <HistoryItem
          v-for="(record, index) in wordEntry.history"
          :key="index"
          :record="record"
          :word="wordEntry.word"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.word-detail {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section-title {
  margin: 0 0 8px 0;
  font-size: 14px;
  font-weight: 600;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* Definition Section */
.definition-section {
  padding: 12px;
  background-color: #f9f9f9;
  border-radius: 4px;
  border: 1px solid #e0e0e0;
}

.definition-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.phonetic {
  font-size: 14px;
  color: #666;
  font-style: italic;
}

.meaning {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.part-of-speech {
  font-size: 13px;
  font-weight: 600;
  color: #2196F3;
  font-style: italic;
}

.definitions-list {
  margin: 0;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.definition-item {
  font-size: 13px;
  line-height: 1.5;
}

.definition-text {
  color: #333;
}

.example {
  margin-top: 4px;
  font-size: 12px;
  color: #666;
  padding-left: 8px;
  border-left: 2px solid #e0e0e0;
}

/* History Section */
.history-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
