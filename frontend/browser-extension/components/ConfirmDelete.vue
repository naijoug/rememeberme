<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
defineProps<{ word: string; busy?: boolean }>();
const emit = defineEmits<{ cancel: []; confirm: [] }>();
const cancelButton = ref<HTMLButtonElement>();
const panel = ref<HTMLElement>();
const previousFocus = document.activeElement as HTMLElement | null;
onMounted(() => cancelButton.value?.focus());
onUnmounted(() => previousFocus?.isConnected && previousFocus.focus());
function handleKey(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.stopPropagation(); emit('cancel'); }
  if (event.key !== 'Tab') return;
  const buttons = panel.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
  if (!buttons?.length) return;
  if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons[buttons.length - 1].focus(); }
  else if (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]) { event.preventDefault(); buttons[0].focus(); }
}
</script>

<template>
  <div class="delete-confirm" @click.self="emit('cancel')" @keydown="handleKey">
    <div ref="panel" class="confirm-content" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-description">
      <h2 id="delete-title">Delete “{{ word }}”?</h2>
      <p id="delete-description">This removes the word and its saved history from this device.</p>
      <div class="confirm-actions">
        <button ref="cancelButton" class="rm-button rm-quiet cancel-btn" :disabled="busy" @click="emit('cancel')">Cancel</button>
        <button class="rm-button confirm-btn" :disabled="busy" @click="emit('confirm')">Delete</button>
      </div>
    </div>
  </div>
</template>
