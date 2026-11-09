<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { SoundHigh } from '@iconoir/vue';
import { PhoneticsService } from '~/services/phonetics';
import type { PhoneticTranscriptions } from '~/types';
const props = defineProps<{ word: string; active?: boolean; obscured?: boolean; disabled?: boolean }>();
const emit = defineEmits<{ played: [] }>();
const phonetics = new PhoneticsService();
const ipa = ref<PhoneticTranscriptions>({}), voices = shallowRef<SpeechSynthesisVoice[]>([]);
const playing = ref(false), speaking = ref(false), error = ref('');
let synth: SpeechSynthesis | undefined, utterance: SpeechSynthesisUtterance | undefined;
let timer: ReturnType<typeof setTimeout> | undefined, autoplayed = false;
const voice = computed(() => voices.value.find(v => v.localService && v.lang.replace('_', '-').toLowerCase() === 'en-us'));
const status = computed(() => error.value || (!voice.value ? '暂无本地美式语音，请在系统设置中添加 English (US) 语音。' : ''));
function stop() {
  clearTimeout(timer); timer = undefined;
  if (utterance) { utterance.onstart = null; utterance.onend = null; utterance.onerror = null; synth?.cancel(); }
  utterance = undefined; playing.value = false; speaking.value = false;
}
function play(manual = true) {
  if (props.disabled) return;
  if (playing.value) { stop(); if (manual) emit('played'); return; }
  if (!synth || !voice.value || typeof SpeechSynthesisUtterance === 'undefined') return;
  stop(); error.value = '';
  try {
    const next = new SpeechSynthesisUtterance(props.word);
    next.voice = voice.value; next.lang = 'en-US'; next.rate = .85;
    next.onstart = () => { if (utterance === next) speaking.value = true; };
    next.onend = () => { if (utterance === next) stop(); };
    next.onerror = () => { if (utterance === next) { stop(); error.value = '发音播放失败，请重试'; } };
    utterance = next; playing.value = true;
    timer = setTimeout(() => { if (utterance === next) { stop(); error.value = '发音播放超时，请重试'; } }, 8000);
    synth.speak(next);
  } catch { stop(); error.value = '发音播放失败，请重试'; }
  if (manual) emit('played');
}
function maybeAutoplay() {
  if (!props.active || !voice.value || autoplayed) return;
  autoplayed = true; play(false);
}
defineExpose({ play, stop });
watch(() => props.word, async (word, _, cleanup) => {
  let cancelled = false; cleanup(() => { cancelled = true; });
  stop(); autoplayed = false; ipa.value = {}; error.value = '';
  maybeAutoplay();
  try { const value = await phonetics.getPhonetics(word); if (!cancelled) ipa.value = value; }
  catch { /* Missing packaged IPA must not block typing. */ }
}, { immediate: true });
watch(() => props.active, active => {
  if (!active) { stop(); autoplayed = false; } else maybeAutoplay();
});
function updateVoices() { voices.value = synth?.getVoices() ?? []; maybeAutoplay(); }
onMounted(() => {
  synth = window.speechSynthesis; updateVoices(); synth?.addEventListener('voiceschanged', updateVoices);
});
onUnmounted(() => { stop(); synth?.removeEventListener('voiceschanged', updateVoices); });
</script>
<template>
  <div class="practice-speech">
    <button class="practice-icon-button speaker-button" :class="{ 'is-playing': playing, 'is-speaking': speaking }" :disabled="!voice || disabled" :aria-label="playing ? '停止发音' : '播放发音'" :aria-pressed="playing"
      :title="voice ? '美式发音 · Alt+P' : '请添加本地 English (US) 语音'" @click.stop="play()">
      <SoundHigh width="25" height="25" aria-hidden="true" />
    </button>
    <span class="practice-ipa" :class="{ 'is-frosted': obscured }" :aria-hidden="obscured || undefined" :title="obscured ? undefined : '本地美式音标'">{{ ipa.us ? `AmE /${ipa.us.replace(/^\/|\/$/g, '')}/` : '' }}</span>
    <span v-if="status" class="practice-speech-status" role="status">{{ status }}</span>
  </div>
</template>
