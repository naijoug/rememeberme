<script setup lang="ts">
import { nextTick, ref } from 'vue';
import { PracticeClient } from '~/services/practice-client';
import type { PracticeView } from '~/types/practice';
const confirm = ref(false), busy = ref(false), message = ref('');
const cancel = ref<HTMLButtonElement>();
let client: PracticeClient | undefined;
const target = ref<PracticeView>();
async function ask() {
  busy.value = true; message.value = '';
  try {
    client ??= new PracticeClient();
    if (client.pending) { await client.recover(); message.value = 'The previous request was recovered. Open confirmation again to clear records.'; return; }
    target.value = await client.get(); confirm.value = true;
  } catch (cause) { message.value = cause instanceof Error ? cause.message : 'Could not load practice records.'; }
  finally { busy.value = false; await nextTick(); if (confirm.value) cancel.value?.focus(); }
}
async function clear() {
  busy.value = true;
  try {
    if (!client || !target.value) return;
    await client.command(target.value, { kind: 'clear' });
    message.value = 'Practice records cleared for the current vocabulary.'; confirm.value = false;
  } catch (cause) { confirm.value = false; message.value = cause instanceof Error ? cause.message : 'Could not clear practice records.'; }
  finally { busy.value = false; }
}
</script>
<template>
  <section class="settings-section" aria-labelledby="practice-records-heading">
    <h3 id="practice-records-heading">Practice</h3>
    <button class="setting-row row-action" :disabled="busy" @click="ask">Clear practice records</button>
    <div v-if="confirm" role="dialog" aria-label="Clear practice records" @keydown.esc="confirm = false">
      <p>Clear local practice progress for {{ target?.label }}? Your saved words and forgotten counts stay unchanged.</p>
      <button ref="cancel" class="rm-button rm-secondary" :disabled="busy" @click="confirm = false">Cancel</button>
      <button class="rm-button" :disabled="busy" @click="clear">Clear records</button>
    </div>
    <p v-if="message" role="status" class="section-note">{{ message }}</p>
  </section>
</template>
