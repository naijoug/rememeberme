<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { Bookmark, Download, HalfMoon, MoreVert, NavArrowLeft, Refresh, Search, SunLight, Trash, Upload , IconoirProvider } from '@iconoir/vue';
import type { WordEntry } from '~/types';
import type { ResolvedTheme, ThemePreference } from '~/types/theme';
import WordList from './WordList.vue';
import WordDetail from './WordDetail.vue';
import ConfirmDelete from './ConfirmDelete.vue';

const props = withDefaults(defineProps<{
  words: WordEntry[]; loading?: boolean; busy?: boolean; error?: string; success?: string;
  theme?: ResolvedTheme; initialWord?: string; logoUrl?: string;
}>(), { theme: 'light', logoUrl: '/icon/48.png' });
const emit = defineEmits<{
  delete: [word: string]; reset: [word: string]; import: [text: string]; export: [];
  'theme-change': [theme: ThemePreference]; retry: [];
}>();
const selected = ref<string | null>(props.initialWord || null);
const query = ref('');
const listScrollTop = ref(0);
const sortBy = ref<'count' | 'updatedAt'>('count');
const menuOpen = ref(false);
const confirmWord = ref<string | null>(null);
const fileInput = ref<HTMLInputElement>();
const menu = ref<HTMLElement>();
const menuButton = ref<HTMLButtonElement>();
const backButton = ref<HTMLButtonElement>();
const importError = ref('');
const selectedEntry = computed(() => props.words.find(entry => (entry.id ?? entry.word) === selected.value));
const displayedWords = computed(() => props.words.filter(entry => entry.word.toLowerCase().includes(query.value.trim().toLowerCase()))
  .slice().sort((a, b) => sortBy.value === 'count' ? b.count - a.count : b.updatedAt - a.updatedAt));
watch(selectedEntry, entry => { if (!entry) { selected.value = null; confirmWord.value = null; listScrollTop.value = 0; } });
async function openWord(word: string) { selected.value = word; await nextTick(); backButton.value?.focus(); }
async function openMenu() { menuOpen.value = !menuOpen.value; await nextTick(); if (menuOpen.value) menu.value?.querySelector('button')?.focus(); }
function closeMenu() { menuOpen.value = false; menuButton.value?.focus(); }
function menuKeys(event: KeyboardEvent) {
  const buttons = [...(menu.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (!buttons.length) return;
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
  }
}
function outsideMenu(event: MouseEvent) { if (!menu.value?.contains(event.target as Node) && event.target !== menuButton.value && !menuButton.value?.contains(event.target as Node)) menuOpen.value = false; }
function keydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || confirmWord.value) return;
  if (menuOpen.value) closeMenu(); else selected.value = null;
}
onMounted(() => document.addEventListener('click', outsideMenu));
onUnmounted(() => document.removeEventListener('click', outsideMenu));
function triggerImport() { menuOpen.value = false; fileInput.value?.click(); }
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
        <button class="rm-icon-btn" :aria-label="theme === 'dark' ? 'Use light theme' : 'Use dark theme'" :title="theme === 'dark' ? 'Use light theme' : 'Use dark theme'" @click="emit('theme-change', theme === 'dark' ? 'light' : 'dark')">
          <HalfMoon v-if="theme === 'dark'" width="21" height="21" aria-hidden="true" /><SunLight v-else width="23" height="23" aria-hidden="true" />
        </button>
        <button ref="menuButton" class="rm-icon-btn" aria-label="More options" aria-haspopup="menu" :aria-expanded="menuOpen" @click.stop="openMenu"><MoreVert width="21" height="21" aria-hidden="true" /></button>
        <div v-if="menuOpen" ref="menu" class="rm-menu" role="menu" aria-label="Vocabulary options" @keydown="menuKeys">
          <button role="menuitem" :disabled="busy" @click="triggerImport"><Upload width="17" height="17" aria-hidden="true" />Import backup</button>
          <button role="menuitem" :disabled="busy || loading" @click="emit('export'); closeMenu()"><Download width="17" height="17" aria-hidden="true" />Export vocabulary</button>
        </div>
      </div>
      <input ref="fileInput" type="file" accept=".json,application/json" hidden @change="importFile" />
    </header>

    <div v-if="success" class="rm-banner success" role="status">{{ success }}</div>
    <div v-if="error || importError" class="rm-banner error" role="alert">{{ error || importError }} <button v-if="!words.length && !importError" class="rm-text-action" @click="emit('retry')">Try again</button></div>

    <main class="vocabulary-main" :aria-busy="loading || busy">
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
