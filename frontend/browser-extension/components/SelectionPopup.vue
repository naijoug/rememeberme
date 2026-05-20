<template>
  <div
    v-if="visible"
    class="vocab-counter-popup"
    :style="popupStyle"
    @click.stop
  >
    <div class="popup-content">
      <div v-if="loading" class="loading">Loading...</div>
      <div v-else-if="error" class="error">{{ error }}</div>
      <div v-else-if="definition" class="definition">
        <div class="word-header">
          <span class="word">{{ definition.word }}</span>
          <span v-if="definition.phonetic" class="phonetic">{{ definition.phonetic }}</span>
        </div>
        <div class="meanings">
          <div v-for="(meaning, idx) in definition.meanings.slice(0, 2)" :key="idx" class="meaning">
            <span class="part-of-speech">{{ meaning.partOfSpeech }}</span>
            <ol class="definitions-list">
              <li v-for="(def, defIdx) in meaning.definitions.slice(0, 2)" :key="defIdx">
                <span class="definition-text">{{ def.definition }}</span>
                <span v-if="def.example" class="example">"{{ def.example }}"</span>
              </li>
            </ol>
          </div>
        </div>
      </div>
      <div class="actions">
        <button @click="$emit('remember')" class="btn btn-remember">Remember</button>
        <button @click="$emit('forget')" class="btn btn-forget">Forget</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Definition, Position } from '~/types';

interface Props {
  word: string;
  position: Position;
  visible: boolean;
  definition?: Definition;
  loading?: boolean;
  error?: string;
}

const props = defineProps<Props>();

defineEmits<{
  remember: [];
  forget: [];
  close: [];
}>();

const popupStyle = computed(() => {
  // Calculate popup position with viewport boundary detection
  const x = props.position.x;
  const y = props.position.y;
  
  // Add offset below the selected text
  const offsetY = 10;
  
  return {
    left: `${x}px`,
    top: `${y + offsetY}px`,
  };
});
</script>

<style scoped>
.vocab-counter-popup {
  position: absolute;
  z-index: 2147483647;
  background: white;
  border: 1px solid #ddd;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 16px;
  min-width: 300px;
  max-width: 400px;
  transform: translateX(-50%);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  animation: fadeIn 0.2s ease-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}

.popup-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.loading,
.error {
  padding: 8px;
  text-align: center;
  color: #666;
}

.error {
  color: #d32f2f;
}

.word-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
}

.word {
  font-size: 18px;
  font-weight: 600;
  color: #1a1a1a;
}

.phonetic {
  font-size: 14px;
  color: #666;
  font-style: italic;
}

.meanings {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.meaning {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.part-of-speech {
  font-size: 12px;
  font-style: italic;
  color: #1976d2;
  font-weight: 500;
}

.definitions-list {
  margin: 0;
  padding-left: 20px;
  color: #333;
}

.definitions-list li {
  margin: 4px 0;
}

.definition-text {
  display: block;
}

.example {
  display: block;
  font-size: 12px;
  color: #666;
  font-style: italic;
  margin-top: 4px;
}

.actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 8px;
}

.btn {
  padding: 6px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.2s ease;
}

.btn:active {
  transform: scale(0.95);
}

.btn-remember {
  background: #e0e0e0;
  color: #333;
}

.btn-remember:hover {
  background: #d0d0d0;
}

.btn-forget {
  background: #1976d2;
  color: white;
}

.btn-forget:hover {
  background: #1565c0;
}
</style>
