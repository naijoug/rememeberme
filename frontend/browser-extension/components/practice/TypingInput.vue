<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { asciiLower } from '~/services/practice-engine';
const props = withDefaults(defineProps<{ modelValue: string; target?: string; disabled: boolean; auto?: boolean }>(), { auto: false });
const emit = defineEmits<{
  'update:modelValue': [value: string]; submit: []; complete: []; mistake: []; assisted: []; composing: [value: boolean];
}>();
const composing = ref(false), failed = ref(false);
const input = ref<HTMLInputElement>();
let reset: ReturnType<typeof setTimeout> | undefined, completing = false;
const typed = computed(() => props.modelValue.trim());
const letters = computed(() => [...(props.target || typed.value)]);
defineExpose({ focus: () => input.value?.focus(), insert });
function insert(character: string) {
  const element = input.value;
  if (!element || props.disabled || composing.value || failed.value || completing) return;
  element.setRangeText(character, element.selectionStart ?? element.value.length, element.selectionEnd ?? element.value.length, 'end');
  update({ target: element } as unknown as Event);
}
function composition(value: boolean) { composing.value = value; emit('composing', value); }
function update(event: Event) {
  const element = event.target as HTMLInputElement;
  if (props.disabled || failed.value || completing) { element.value = props.modelValue; return; }
  const value = element.value; emit('update:modelValue', value);
  if (composing.value || (event as InputEvent).isComposing || !props.auto || !props.target) return;
  const entered = asciiLower(value.trim()), expected = asciiLower(props.target.trim());
  if (!expected.startsWith(entered)) {
    failed.value = true; emit('mistake');
    reset = setTimeout(() => {
      failed.value = false; emit('update:modelValue', '');
      if (input.value) input.value.value = '';
    }, 260);
  } else if (entered === expected) { completing = true; emit('complete'); }
}
function keydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || composing.value || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  if (!props.disabled && !props.auto && !event.repeat && typed.value) emit('submit');
}
watch(() => props.target, () => { clearTimeout(reset); failed.value = false; completing = false; });
onUnmounted(() => clearTimeout(reset));
</script>
<template>
  <div class="typing-surface" :class="{ 'typing-error': failed, 'typing-disabled': disabled }" @click="input?.focus()">
    <span v-if="target" id="practice-target" class="practice-sr-only">Saved spelling: {{ target }}</span>
    <div class="typing-word" aria-hidden="true">
      <span v-if="!target && !typed" class="typing-placeholder">Type the word</span>
      <span v-for="(letter, index) in letters" :key="index" :class="{
        'letter-correct': !!target && index < typed.length && asciiLower(typed[index] ?? '') === asciiLower(letter),
        'letter-wrong': !!target && index < typed.length && asciiLower(typed[index] ?? '') !== asciiLower(letter),
        'letter-cursor': !disabled && !failed && index === typed.length,
      }">{{ letter }}</span>
    </div>
    <label for="practice-answer" class="practice-sr-only">Your spelling</label>
    <input id="practice-answer" ref="input" class="typing-capture" type="text" :value="modelValue" :disabled="disabled" maxlength="500"
      autocomplete="off" autocapitalize="off" autocorrect="off" :spellcheck="false" :aria-describedby="target ? 'practice-target practice-input-help' : 'practice-input-help'"
      @input="update" @compositionstart="composition(true)" @compositionend="composition(false); update($event)"
      @paste="emit('assisted')" @drop="emit('assisted')" @keydown="keydown" />
    <span id="practice-input-help" class="practice-sr-only">{{ auto ? 'Type the displayed word. Correct words advance automatically. A typo resets this word.' : 'Type the saved word from memory, then press Enter.' }}</span>
  </div>
</template>
