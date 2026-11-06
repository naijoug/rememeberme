<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { SoundHigh, Square } from '@iconoir/vue';
import { PhoneticsService } from '~/services/phonetics';
import type { PhoneticTranscriptions } from '~/types';
const props = defineProps<{ word: string }>();
const emit = defineEmits<{ played: [] }>();
const phonetics = new PhoneticsService();
const ipa = ref<PhoneticTranscriptions>({}), voices = shallowRef<SpeechSynthesisVoice[]>([]);
const playing = ref(false), error = ref('');
let synth: SpeechSynthesis | undefined, utterance: SpeechSynthesisUtterance | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
const voice = computed(() => voices.value.find(v => v.localService && v.lang.replace('_', '-').toLowerCase() === 'en-us'));
function stop() {
  clearTimeout(timer);
  if (utterance) { utterance.onend = null; utterance.onerror = null; synth?.cancel(); }
  utterance = undefined; playing.value = false;
}
function play() {
  if (playing.value) { stop(); emit('played'); return; }
  if (!synth || !voice.value || typeof SpeechSynthesisUtterance === 'undefined') return;
  stop(); error.value = '';
  try {
    const next = new SpeechSynthesisUtterance(props.word);
    next.voice = voice.value; next.lang = 'en-US'; next.rate = .85;
    next.onend = () => { if (utterance === next) stop(); };
    next.onerror = () => { if (utterance === next) { stop(); error.value = 'Pronunciation unavailable'; } };
    utterance = next; playing.value = true;
    timer = setTimeout(() => { stop(); error.value = 'Pronunciation timed out'; }, 8000);
    synth.speak(next);
  } catch { stop(); error.value = 'Pronunciation unavailable'; }
  emit('played');
}
defineExpose({ play, stop });
watch(() => props.word, async (word, _, cleanup) => {
  let cancelled = false; cleanup(() => { cancelled = true; });
  stop(); ipa.value = {}; error.value = '';
  try { const value = await phonetics.getPhonetics(word); if (!cancelled) ipa.value = value; }
  catch { /* Missing packaged IPA must not block typing. */ }
}, { immediate: true });
function updateVoices() { voices.value = synth?.getVoices() ?? []; }
onMounted(() => {
  synth = window.speechSynthesis; updateVoices(); synth?.addEventListener('voiceschanged', updateVoices);
});
onUnmounted(() => { stop(); synth?.removeEventListener('voiceschanged', updateVoices); });
</script>
<template>
  <div class="practice-speech">
    <button class="practice-icon-button speaker-button" :disabled="!voice" :aria-label="playing ? 'Stop pronunciation' : 'Play pronunciation'" :aria-pressed="playing"
      :title="voice ? 'American pronunciation · Alt+P' : 'Add an English (US) device voice to enable pronunciation'" @click.stop="play">
      <Square v-if="playing" width="23" height="23" aria-hidden="true" /><SoundHigh v-else width="25" height="25" aria-hidden="true" />
    </button>
    <span class="practice-ipa" :title="error || (ipa.us ? 'Packaged American phonetic transcription' : 'No American phonetic transcription')">{{ error || (ipa.us ? `AmE: ${ipa.us}` : '') }}</span>
  </div>
</template>
