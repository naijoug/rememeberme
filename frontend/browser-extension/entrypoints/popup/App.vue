<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import VocabularyPanel from '~/components/VocabularyPanel.vue';
import CloudConnection from '~/components/CloudConnection.vue';
import { storageClient } from '~/services/storage-client';
import { saveTheme, watchTheme } from '~/services/theme';
import type { WordEntry } from '~/types';
import type { ThemePreference, ThemeState } from '~/types/theme';

const words = ref<WordEntry[]>([]);
const loading = ref(true);
const busy = ref(false);
const error = ref('');
const success = ref('');
const theme = ref<ThemeState>({ preference: 'system', resolved: 'light' });
let stopTheme: (() => void) | undefined;
let successTimer: ReturnType<typeof setTimeout> | undefined;

onMounted(() => {
  stopTheme = watchTheme(value => { theme.value = value; });
  void loadWords();
});
onUnmounted(() => { stopTheme?.(); clearTimeout(successTimer); });

async function loadWords() {
  error.value = '';
  loading.value = true;
  try { words.value = await storageClient.getAllWords(); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'Could not open your vocabulary.'; }
  finally { loading.value = false; }
}
async function mutate(operation: () => Promise<void>, message = '') {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  success.value = '';
  try {
    await operation();
    words.value = await storageClient.getAllWords();
    if (message) {
      success.value = message;
      clearTimeout(successTimer);
      successTimer = setTimeout(() => { success.value = ''; }, 3000);
    }
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'The change could not be saved.'; }
  finally { busy.value = false; }
}
async function changeTheme(preference: ThemePreference) {
  try {
    await saveTheme(preference);
    theme.value = { preference, resolved: preference === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : preference };
  } catch { error.value = 'Could not save your appearance preference. Please try again.'; }
}
async function exportData() {
  if (busy.value) return;
  error.value = '';
  try {
    const json = await storageClient.exportData();
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'vocabulary-counter-' + new Date().toISOString().split('T')[0] + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Could not export your vocabulary.'; }
}
</script>

<template>
  <CloudConnection :data-theme="theme.resolved" @changed="loadWords" />
  <VocabularyPanel
    :words="words" :loading="loading" :busy="busy" :error="error" :success="success"
    :theme="theme.resolved"
    @retry="loadWords" @theme-change="changeTheme" @export="exportData"
    @delete="mutate(() => storageClient.deleteWord($event))"
    @reset="mutate(() => storageClient.resetCount($event))"
    @import="mutate(() => storageClient.importData($event), 'Data imported successfully!')"
  />
</template>
