<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { portLookup } from '~/services/lookup-port-client';
import { watchExplanationConsent } from '~/services/explanation-settings';
import { isContextExplanation, isExplanationCapabilities, type ContextExplanation } from '../../../contracts/context-explanation';
const props = defineProps<{ word: string; context: string }>();
const available = ref(false), consent = ref(false), confirm = ref(false), loading = ref(false), error = ref('');
const result = ref<ContextExplanation>();
const validContext = computed(() => !!props.context.trim() && props.context.length <= 1000);
let version = 0, disposed = false;
let controller: AbortController | undefined;
let capabilityController: AbortController | undefined;
const stop = watchExplanationConsent(enabled => {
  consent.value = enabled;
  if (!enabled) { cancel(); result.value = undefined; confirm.value = false; }
});
function cancel() { version++; controller?.abort(); controller = undefined; loading.value = false; }
watch(() => [props.word, props.context], async () => {
  cancel(); capabilityController?.abort(); available.value = false; result.value = undefined; error.value = ''; confirm.value = false;
  const current = new AbortController(); capabilityController = current;
  try {
    const value = await portLookup<unknown>('EXPLANATION_CAPABILITIES', {}, 9000, current.signal);
    if (!disposed && !current.signal.aborted) available.value = isExplanationCapabilities(value) && value.enabled;
  } catch { /* Unknown/disabled server capability hides the entry. */ }
}, { immediate: true });
async function enable() {
  const current = version;
  try {
    const reply = await browser.runtime.sendMessage({ type: 'EXPLANATION_CONSENT', enabled: true });
    if (!reply?.success) throw new Error(reply?.error || 'Could not enable sentence explanation.');
    if (disposed || current !== version) return;
    consent.value = true; confirm.value = false; await explain();
  } catch (cause) { if (!disposed && current === version) error.value = cause instanceof Error ? cause.message : 'Could not enable sentence explanation.'; }
}
async function explain() {
  if (!available.value || !validContext.value || loading.value) return;
  if (!consent.value) { confirm.value = true; return; }
  cancel(); const current = version;
  controller = new AbortController(); loading.value = true; result.value = undefined; error.value = '';
  try {
    const value = await portLookup<unknown>('EXPLAIN_CONTEXT', { schemaVersion: 1, word: props.word, context: props.context, target: 'zh-CN' }, 22_000, controller.signal);
    if (!isContextExplanation(value)) throw new Error('The service returned an invalid sentence explanation.');
    if (!disposed && current === version) result.value = value;
  } catch (cause) {
    if (!disposed && current === version && !(cause instanceof DOMException && cause.name === 'AbortError')) error.value = cause instanceof Error ? cause.message : 'Sentence explanation unavailable.';
  } finally { if (current === version) loading.value = false; }
}
onUnmounted(() => { disposed = true; cancel(); capabilityController?.abort(); stop(); });
</script>
<template>
  <section v-if="available" class="context-explanation" aria-label="Sentence explanation">
    <button class="rm-text-action" :disabled="!validContext || loading" @click="explain">{{ result ? 'Explain this sentence again' : 'Explain this sentence' }}</button>
    <p v-if="!validContext">Select a word in a sentence of at most 1,000 characters.</p>
    <div v-if="confirm" class="explanation-consent" role="group" aria-label="Enable sentence explanation">
      <p>This sends the selected word and original sentence to the translation service and its AI provider. It does not send the page URL or your vocabulary. Results are temporary and are not saved to your word history.</p>
      <button class="rm-text-action" @click="enable">Enable and explain</button>
      <button class="rm-text-action" @click="confirm = false">Cancel</button>
    </div>
    <div v-if="loading" role="status">Explaining this sentence… <button class="rm-text-action" @click="cancel">Cancel explanation</button></div>
    <p v-if="error" role="alert">{{ error }} <button class="rm-text-action" @click="explain">Try again</button></p>
    <div v-if="result" class="explanation-result">
      <h3>Meaning in this sentence</h3><p>{{ result.contextualMeaning }}</p>
      <h3>Sentence translation</h3><p>{{ result.sentenceTranslation }}</p>
      <p v-if="result.usageNote">{{ result.usageNote }}</p>
    </div>
  </section>
</template>
