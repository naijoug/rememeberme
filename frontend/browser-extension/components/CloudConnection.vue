<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { CloudStatus } from '~/services/cloud-vocabulary';
import { SERVICE_ORIGIN } from '~/config/backend';
const emit = defineEmits<{ changed: [] }>();
const busy = ref(false), error = ref('');
const status = ref<CloudStatus>();
async function action(type: string, extra: Record<string, unknown> = {}) {
  if (busy.value) return; busy.value = true; error.value = '';
  try {
    const reply = await browser.runtime.sendMessage({ type, ...extra });
    if (!reply?.success) throw new Error(reply?.error || 'The backend connection could not be updated.');
    status.value = reply.data;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Cloud action failed.';
    if (type !== 'CLOUD_STATUS') {
      const latest = await browser.runtime.sendMessage({ type: 'CLOUD_STATUS' }).catch(() => undefined);
      if (latest?.success) status.value = latest.data;
    }
  } finally {
    busy.value = false;
    if (type !== 'CLOUD_STATUS') emit('changed');
  }
}
async function copyLocal() {
  if (confirm('Copy this device’s local vocabulary into the connected account? This prepares words and definition history for upload when you enable sync. Context and source URLs remain local. The original local vocabulary is retained.')) await action('CLOUD_COPY_LOCAL');
}
async function recoverCloud() {
  if (confirm('Archive ALL pending account changes and use the current cloud vocabulary? Your current words and frozen requests will be retained in a private recovery copy. Old requests will not be replayed. Sync stays paused; you can export the recovery vocabulary before making further choices.')) await action('CLOUD_RECOVER');
}
async function exportArchive(key: string) {
  busy.value = true; error.value = '';
  try {
    const reply = await browser.runtime.sendMessage({ type: 'CLOUD_EXPORT_ARCHIVE', key });
    if (!reply?.success || typeof reply.data !== 'string') throw new Error(reply?.error || 'Recovery export failed.');
    const url = URL.createObjectURL(new Blob([reply.data], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'rememberme-recovery.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Recovery export failed.'; }
  finally { busy.value = false; }
}
onMounted(() => { void action('CLOUD_STATUS'); });
</script>
<template>
  <div class="cloud-connection rm-theme">
    <section aria-label="Account and sync settings">
      <h2>Account &amp; sync</h2>
      <p>Translation works without signing in. Sign in only if you want to sync your vocabulary across devices.</p>
      <template v-if="!status?.connected">
        <button :disabled="busy" @click="action('CLOUD_CONNECT', { origin: SERVICE_ORIGIN })">Sign in with GitHub</button>
      </template>
      <template v-else>
        <p>{{ status.owner === 'anonymous' ? 'Local vocabulary' : 'Account vocabulary' }} · {{ status.pending }} pending · {{ status.conflicts }} conflicts</p>
        <button :disabled="busy" @click="action('CLOUD_OPEN')">Open account vocabulary</button>
        <button :disabled="busy" @click="copyLocal">Copy local vocabulary ({{ status.localWords }})</button>
        <button :disabled="busy || status.owner === 'anonymous'" @click="action('CLOUD_ENABLE', { enabled: !status.enabled })">{{ status.enabled ? 'Pause sync' : 'Enable sync' }}</button>
        <button :disabled="busy || status.owner === 'anonymous'" @click="action('CLOUD_SYNC')">Sync now</button>
        <button :disabled="busy" @click="action('CLOUD_USE_LOCAL')">Use local vocabulary</button>
        <button :disabled="busy" @click="action('CLOUD_DISCONNECT')">Disconnect</button>
        <p v-if="status.failure" role="status">{{ status.failure }}. Local vocabulary and pending requests are retained.</p>
        <button v-if="status.conflicts || status.failure === 'SYNC_EPOCH_CHANGED'" :disabled="busy" @click="recoverCloud">Archive changes and use cloud vocabulary</button>
        <button v-for="archive in status.archives" :key="archive.key" :disabled="busy" @click="exportArchive(archive.key)">Export recovery copy · {{ new Date(archive.createdAt).toLocaleString() }}</button>
      </template>
      <p v-if="error" role="alert">{{ error }}</p>
      <p>Your vocabulary stays on this device until you choose to copy it and enable sync. Exported backups include your saved sentences and source links.</p>
    </section>
  </div>
</template>
<style scoped>
.cloud-connection { padding: 8px 16px; border-bottom: 1px solid var(--rm-border); background: var(--rm-bg); font-size: 12px; }
h2 { font-size: 16px; margin: 8px 0; }
section { padding: 8px 0; }
p { margin: 8px 0; overflow-wrap: anywhere; line-height: 1.45; }
button, input { padding: 6px 9px; margin: 3px; border: 1px solid var(--rm-border); border-radius: 6px; background: var(--rm-surface); color: inherit; font: inherit; }
input { width: 90%; }
button:not(:disabled) { cursor: pointer; }
button:disabled { opacity: .5; }
</style>
