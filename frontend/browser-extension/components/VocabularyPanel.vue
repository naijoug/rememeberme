<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { Bookmark, Download, Settings, NavArrowLeft, NavArrowRight, Refresh, Search, Trash, Upload, IconoirProvider } from '@iconoir/vue';
import type { WordEntry } from '~/types';
import type { ResolvedTheme, ThemePreference } from '~/types/theme';
import WordList from './WordList.vue';
import WordDetail from './WordDetail.vue';
import ConfirmDelete from './ConfirmDelete.vue';
import { PRIVACY_POLICY_URL } from '~/config/backend';

const props = withDefaults(defineProps<{
  words: WordEntry[]; loading?: boolean; busy?: boolean; error?: string; success?: string;
  theme?: ResolvedTheme; themePreference?: ThemePreference; initialWord?: string; logoUrl?: string;
}>(), { theme: 'light', themePreference: 'system', logoUrl: '/icon/48.png' });
const emit = defineEmits<{
  delete: [word: string]; reset: [word: string]; import: [text: string]; export: [];
  'theme-change': [theme: ThemePreference]; retry: [];
}>();
const selected = ref<string | null>(props.initialWord || null);
const query = ref('');
const listScrollTop = ref(0);
const sortBy = ref<'count' | 'updatedAt'>('count');
const settingsOpen = ref(false);
const confirmWord = ref<string | null>(null);
const fileInput = ref<HTMLInputElement>();
const settingsButton = ref<HTMLButtonElement>();
const settingsHeading = ref<HTMLHeadingElement>();
const backButton = ref<HTMLButtonElement>();
const importError = ref('');
const selectedEntry = computed(() => props.words.find(entry => (entry.id ?? entry.word) === selected.value));
const displayedWords = computed(() => props.words.filter(entry => entry.word.toLowerCase().includes(query.value.trim().toLowerCase()))
  .slice().sort((a, b) => sortBy.value === 'count' ? b.count - a.count : b.updatedAt - a.updatedAt));
watch(selectedEntry, entry => { if (!entry) { selected.value = null; confirmWord.value = null; listScrollTop.value = 0; } });
async function openWord(word: string) { selected.value = word; await nextTick(); backButton.value?.focus(); }
async function openSettings() {
  if (settingsOpen.value) return;
  settingsOpen.value = true;
  await nextTick(); settingsHeading.value?.focus();
}
async function closeSettings() {
  settingsOpen.value = false;
  await nextTick(); settingsButton.value?.focus();
}
function keydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || confirmWord.value) return;
  if (settingsOpen.value) { event.preventDefault(); void closeSettings(); }
  else selected.value = null;
}
function triggerImport() { fileInput.value?.click(); }
function changeAppearance(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  if (value === 'system' || value === 'light' || value === 'dark') emit('theme-change', value);
}
async function importFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  importError.value = '';
  try { emit('import', await file.text()); } catch { importError.value = 'Could not read this file. Please try another backup.'; }
  finally { input.value = ''; }
}
</script>

<template>
  <IconoirProvider :icon-props="{ color: 'currentColor', 'stroke-width': 1.5 }">
  <div class="vocabulary-counter rm-theme" :data-theme="theme" @keydown="keydown">
    <header class="rm-header">
      <img class="brand-mark" :src="logoUrl" width="30" height="30" alt="" />
      <h1 class="rm-brand">Remember Me</h1>
      <div class="rm-header-actions">
        <button ref="settingsButton" class="rm-icon-btn" aria-label="Settings" title="Settings"
          aria-controls="vocabulary-settings" :aria-expanded="settingsOpen" @click="openSettings">
          <Settings width="21" height="21" aria-hidden="true" />
        </button>
      </div>
      <input ref="fileInput" type="file" accept=".json,application/json" hidden @change="importFile" />
    </header>

    <div v-if="success" class="rm-banner success" role="status">{{ success }}</div>
    <div v-if="error || importError" class="rm-banner error" role="alert">{{ error || importError }} <button v-if="!words.length && !importError" class="rm-text-action" @click="emit('retry')">Try again</button></div>

    <section v-if="settingsOpen" id="vocabulary-settings" class="settings-page" aria-labelledby="settings-title">
      <button class="back-link" @click="closeSettings"><NavArrowLeft width="17" height="17" aria-hidden="true" />Vocabulary</button>
      <h2 id="settings-title" ref="settingsHeading" class="settings-title" tabindex="-1">Settings</h2>

      <section class="settings-section" aria-labelledby="appearance-heading">
        <h3 id="appearance-heading">Appearance</h3>
        <div class="settings-group">
          <label class="setting-row" for="appearance-preference">
            <span>Theme</span>
            <select id="appearance-preference" class="settings-select" aria-label="Theme" :value="themePreference" @change="changeAppearance">
              <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
            </select>
          </label>
        </div>
      </section>

      <slot name="account" />

      <section class="settings-section" aria-labelledby="backups-heading">
        <h3 id="backups-heading">Backups</h3>
        <div class="settings-group">
          <button class="setting-row row-action" :disabled="busy" @click="triggerImport">
            <span>Import backup</span><Upload class="row-chevron" width="17" height="17" aria-hidden="true" />
          </button>
          <button class="setting-row row-action" :disabled="busy || loading" @click="emit('export')">
            <span>Export vocabulary</span><Download class="row-chevron" width="17" height="17" aria-hidden="true" />
          </button>
        </div>
        <p class="section-note">Imports add to the current vocabulary. Backups include saved sentences and source links.</p>
      </section>

      <section class="settings-section" aria-labelledby="support-heading">
        <h3 id="support-heading">Support</h3>
        <div class="settings-group">
          <a class="setting-row row-action" :href="PRIVACY_POLICY_URL" target="_blank" rel="noopener noreferrer">
            <span>Privacy &amp; support</span><NavArrowRight class="row-chevron" width="16" height="16" aria-hidden="true" />
          </a>
        </div>
      </section>
    </section>
    <main v-else class="vocabulary-main" :aria-busy="loading || busy">
      <div v-if="loading && !words.length" class="loading" role="status">Opening your vocabulary…</div>
      <div v-else-if="selectedEntry" class="detail-view">
        <button ref="backButton" class="back-link" @click="selected = null"><NavArrowLeft width="17" height="17" aria-hidden="true" /><span>Vocabulary</span><span aria-hidden="true">/</span><span>{{ selectedEntry.word }}</span></button>
        <WordDetail :word-entry="selectedEntry" />
        <div class="word-actions">
          <button class="rm-text-action reset-btn" :disabled="busy" @click="emit('reset', selectedEntry.id ?? selectedEntry.word)"><Refresh width="18" height="18" aria-hidden="true" />Reset count</button>
          <button class="rm-text-action delete-btn" :disabled="busy" @click="confirmWord = selectedEntry.word"><Trash width="17" height="17" aria-hidden="true" />Delete</button>
        </div>
      </div>
      <template v-else-if="words.length">
        <div class="list-tools">
          <label class="search-field"><Search width="17" height="17" aria-hidden="true" /><input v-model="query" type="search" aria-label="Search vocabulary" placeholder="Find a word" /></label>
          <div class="list-heading"><div><strong>Vocabulary</strong><span class="word-total">{{ words.length }} {{ words.length === 1 ? 'word' : 'words' }}</span></div>
            <label class="sort-control"><select v-model="sortBy" aria-label="Sort vocabulary"><option value="count">Most forgotten</option><option value="updatedAt">Last updated</option></select></label>
          </div>
        </div>
        <WordList v-if="displayedWords.length" :words="displayedWords" :initial-scroll-top="listScrollTop" @scroll-position="listScrollTop = $event" @select="openWord" />
        <div v-else class="empty"><h2>No matching words</h2><p>Try a different word or clear your search.</p><button class="rm-button rm-secondary" @click="query = ''">Clear search</button></div>
      </template>
      <div v-else class="empty">
        <Bookmark width="32" height="32" stroke-width="1.3" aria-hidden="true" />
        <h2>Your words start here</h2>
        <p>No words saved yet. Select an English word on a webpage, then click the bookmark counter to record it here.</p>
        <button class="rm-button rm-secondary" @click="triggerImport">Import a backup</button>
      </div>
    </main>
    <ConfirmDelete v-if="confirmWord" :word="confirmWord" :busy="busy" @cancel="confirmWord = null" @confirm="emit('delete', selectedEntry?.id ?? confirmWord); confirmWord = null" />
  </div>
  </IconoirProvider>
</template>
