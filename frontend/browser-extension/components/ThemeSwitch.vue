<script setup lang="ts">
import type { ThemePreference } from '~/types/theme';
defineProps<{ modelValue: ThemePreference }>();
const emit = defineEmits<{ 'update:modelValue': [value: ThemePreference] }>();
const choices: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' },
];
</script>

<template>
  <div class="theme-switch" role="group" aria-label="Appearance">
    <span class="theme-label">Theme:</span>
    <button v-for="choice in choices" :key="choice.value" class="theme-option" :aria-pressed="modelValue === choice.value" @click="emit('update:modelValue', choice.value)">{{ choice.label }}</button>
  </div>
</template>
