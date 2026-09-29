<script setup lang="ts">
import { computed } from 'vue';
const props = defineProps<{ text: unknown; word: string }>();
const parts = computed(() => {
  const text = typeof props.text === 'string' ? props.text : typeof props.text === 'number' || typeof props.text === 'boolean' ? String(props.text) : '';
  if (!props.word) return [text];
  const literal = props.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.split(new RegExp('\\b(' + literal + ')\\b', 'gi'));
});
</script>
<template><template v-for="(part, index) in parts" :key="index"><mark v-if="index % 2 === 1">{{ part }}</mark><template v-else>{{ part }}</template></template></template>
