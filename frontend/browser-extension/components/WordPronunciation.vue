<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { SoundHigh, Square } from '@iconoir/vue';
import type { Definition, PhoneticTranscriptions } from '~/types';
import { isEnglishWord } from '~/services/word-utils';
import { requestPhonetics } from '~/services/lookup-client';
import { phoneticsLookupKey } from '~/services/phonetics';
import AccentFlag from './AccentFlag.vue';

const props = defineProps<{ word: string; definition?: Definition }>();
const lookupPhonetics = inject(phoneticsLookupKey, requestPhonetics);
const accents = [
  { id: 'US', lang: 'en-US', label: 'American' },
  { id: 'UK', lang: 'en-GB', label: 'British' },
] as const;
type Accent = typeof accents[number];
const voices = shallowRef<SpeechSynthesisVoice[]>([]);
const supported = ref(false);
const playing = ref('');
const error = ref('');
const transcriptions = ref<PhoneticTranscriptions>({});
const phoneticsLoading = ref(false);
const phoneticsError = ref('');
const retryVersion = ref(0);
let synth: SpeechSynthesis | undefined;
let current: SpeechSynthesisUtterance | undefined;
let deadline: ReturnType<typeof setTimeout> | undefined;

// Imported/remote optional phonetics can be malformed; display only actual text.
const phonetic = computed(() => {
  const definition = props.definition;
  if (definition?.word.toLowerCase() !== props.word.toLowerCase()) return undefined;
  if (typeof definition?.phonetic === 'string' && definition.phonetic.trim()) return definition.phonetic;
  return definition?.phonetics?.find(item => typeof item?.text === 'string' && item.text.trim())?.text;
});
const validWord = computed(() => isEnglishWord(props.word));
watch(() => [props.word, retryVersion.value] as const, async ([word], _, cleanup) => {
  transcriptions.value = {};
  phoneticsError.value = '';
  phoneticsLoading.value = false;
  if (!isEnglishWord(word)) return;
  const controller = new AbortController();
  cleanup(() => controller.abort());
  phoneticsLoading.value = true;
  try {
    const data = await lookupPhonetics(word, controller.signal);
    if (!controller.signal.aborted) transcriptions.value = data;
  } catch {
    if (!controller.signal.aborted) phoneticsError.value = 'Phonetics unavailable.';
  } finally {
    if (!controller.signal.aborted) phoneticsLoading.value = false;
  }
}, { immediate: true });
function voiceFor(accent: Accent) {
  const matches = voices.value.filter(voice => voice.lang.replaceAll('_', '-').toLowerCase() === accent.lang.toLowerCase());
  // Prefer a device voice; never substitute a different accent for a missing one.
  return matches.find(voice => voice.localService) ?? matches[0];
}
const unavailable = computed(() => {
  if (!supported.value) return 'Pronunciation is unavailable in this browser.';
  if (!validWord.value) return 'Pronunciation is available for single English words.';
  const missing = accents.filter(accent => !voiceFor(accent));
  if (missing.length === 2) return 'No US or UK voice available. Add English voices in your system speech settings.';
  if (missing.length) return `${missing[0]!.label} voice unavailable. Add an ${missing[0]!.lang} voice in your system speech settings.`;
  return '';
});
function clearPlayback() {
  clearTimeout(deadline);
  deadline = undefined;
  if (current) { current.onend = null; current.onerror = null; }
  current = undefined;
  playing.value = '';
}
function stop() {
  const owned = current;
  clearPlayback();
  if (owned) synth?.cancel();
}
function play(accent: Accent) {
  if (playing.value === accent.id) { stop(); return; }
  stop();
  error.value = '';
  const voice = voiceFor(accent);
  if (!synth || !voice || !validWord.value) return;
  try {
    const utterance = new SpeechSynthesisUtterance(props.word.trim());
    utterance.lang = accent.lang;
    utterance.voice = voice;
    utterance.rate = 0.85;
    current = utterance;
    playing.value = accent.id;
    utterance.onend = () => { if (current === utterance) clearPlayback(); };
    utterance.onerror = () => {
      if (current !== utterance) return;
      clearPlayback();
      error.value = 'Could not play pronunciation. Try again.';
    };
    // Bound stalled browser/voice services as well as normal playback errors.
    deadline = setTimeout(() => {
      if (current !== utterance) return;
      stop();
      error.value = 'Pronunciation timed out. Try again.';
    }, 8000);
    synth.speak(utterance);
  } catch {
    stop();
    error.value = 'Could not play pronunciation. Try again.';
  }
}
function updateVoices() { voices.value = synth?.getVoices() ?? []; }
watch(() => props.word, () => { stop(); error.value = ''; });
onMounted(() => {
  supported.value = typeof window.speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
  if (!supported.value) return;
  synth = window.speechSynthesis;
  updateVoices();
  synth.addEventListener('voiceschanged', updateVoices);
});
onUnmounted(() => { stop(); synth?.removeEventListener('voiceschanged', updateVoices); });
</script>

<template>
  <div class="word-pronunciation">
    <div class="pronunciation-row" role="group" :aria-label="'Pronunciation of ' + word">
      <span v-if="!transcriptions.us && !transcriptions.uk && phonetic" class="phonetic">{{ phonetic }}</span>
      <div v-for="accent in accents" :key="accent.id" class="pronunciation-accent">
        <AccentFlag :accent="accent.id" />
        <span v-if="transcriptions[accent.id === 'US' ? 'us' : 'uk']" class="phonetic">{{ transcriptions[accent.id === 'US' ? 'us' : 'uk'] }}</span>
        <button type="button" class="pronunciation-button" :data-accent="accent.id"
          :class="{ 'is-playing': playing === accent.id }" :disabled="!supported || !validWord || !voiceFor(accent)"
          :aria-label="(playing === accent.id ? 'Stop' : 'Play') + ' ' + accent.label + ' pronunciation of ' + word"
          :aria-pressed="playing === accent.id" :title="voiceFor(accent) ? accent.label + ' pronunciation' : accent.label + ' voice unavailable on this device'"
          @click="play(accent)">
          <Square v-if="playing === accent.id" width="12" height="12" aria-hidden="true" />
          <SoundHigh v-else width="14" height="14" aria-hidden="true" />
        </button>
      </div>
    </div>
    <template v-if="!phonetic && !transcriptions.us && !transcriptions.uk && validWord">
      <p v-if="phoneticsLoading" class="pronunciation-note" role="status">Loading phonetics…</p>
      <p v-else-if="phoneticsError" class="pronunciation-note" role="status">{{ phoneticsError }} <button class="rm-text-action" @click="retryVersion++">Retry</button></p>
      <p v-else class="pronunciation-note">No phonetic transcription available.</p>
    </template>
    <p v-if="error || unavailable" class="pronunciation-note" :class="{ 'is-error': error }" role="status">{{ error || unavailable }}</p>
  </div>
</template>
