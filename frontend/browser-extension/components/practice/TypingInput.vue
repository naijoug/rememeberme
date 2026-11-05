<script setup lang="ts">
import { ref } from 'vue';
import { asciiLower } from '~/services/practice-engine';
const props = defineProps<{ modelValue: string; target?: string; disabled: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: string]; submit: []; assisted: []; composing: [value: boolean] }>();
const composing = ref(false);
const input = ref<HTMLInputElement>();
defineExpose({ focus: () => input.value?.focus() });
function update(event: Event) { emit('update:modelValue', (event.target as HTMLInputElement).value); }
function composition(value: boolean) { composing.value = value; emit('composing', value); }
function keydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    if (composing.value || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    if (!props.disabled && !event.repeat) emit('submit');
  }
}
</script>
<template>
  <div>
    <span v-if="target" class="practice-sr-only">Saved spelling: {{ target }}</span>
    <div v-if="target" class="practice-letters" aria-hidden="true"><span v-for="(letter, index) in [...target]" :key="index"
      :class="index < modelValue.trim().length ? (asciiLower(modelValue.trim()[index] ?? '') === asciiLower(letter) ? 'letter-correct' : 'letter-wrong') : ''">{{ letter }}</span></div>
    <label class="practice-label" for="practice-answer">Your spelling</label>
    <input id="practice-answer" ref="input" type="text" :value="modelValue" :disabled="disabled" maxlength="500"
      autocomplete="off" autocapitalize="off" autocorrect="off" :spellcheck="false" aria-describedby="practice-input-help"
      @input="update" @compositionstart="composition(true)" @compositionend="composition(false); update($event)"
      @paste="emit('assisted')" @drop="emit('assisted')" @keydown="keydown" />
    <p id="practice-input-help" class="practice-note">Type the word you saved. Press Enter to check. Letter case does not matter.</p>
  </div>
</template>
