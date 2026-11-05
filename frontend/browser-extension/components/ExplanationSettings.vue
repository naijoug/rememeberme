<script setup lang="ts">
import { ref, onUnmounted } from 'vue';
import { watchExplanationConsent } from '~/services/explanation-settings';
const enabled = ref(false), error = ref('');
const stop = watchExplanationConsent(value => { enabled.value = value; });
onUnmounted(stop);
async function disable() {
  error.value = '';
  try {
    const reply = await browser.runtime.sendMessage({ type: 'EXPLANATION_CONSENT', enabled: false });
    if (!reply?.success) throw new Error(reply?.error || 'Could not disable sentence explanation.');
    enabled.value = false;
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Could not disable sentence explanation.'; }
}
</script>
<template>
  <section class="settings-section" aria-labelledby="explanation-heading">
    <h3 id="explanation-heading">Sentence explanation</h3>
    <div class="settings-group"><div class="setting-row"><span>{{ enabled ? 'Enabled on request' : 'Off' }}</span><button v-if="enabled" class="rm-text-action" @click="disable">Disable sentence explanation</button></div></div>
    <p v-if="!enabled">Enable from a word card when you want to send its original sentence for an explanation.</p>
    <p v-if="error" role="alert">{{ error }}</p>
  </section>
</template>
