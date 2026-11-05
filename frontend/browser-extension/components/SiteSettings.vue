<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { storage } from 'wxt/utils/storage';
import { SITE_SETTINGS_KEY, type SiteStatus } from '~/services/site-settings';
const status = ref<SiteStatus>();
const error = ref('');
const busy = ref(false);
const confirmReset = ref(false);
let disposed = false, revision = 0;
let stop: (() => void) | undefined;
async function load() {
  const version = ++revision;
  try {
    const reply = await browser.runtime.sendMessage({ type: 'SITE_STATUS' });
    if (!reply?.success) throw new Error(reply?.error || 'Could not load website settings.');
    if (!disposed && version === revision) { status.value = reply.data; error.value = ''; }
  } catch (cause) { if (!disposed && version === revision) error.value = cause instanceof Error ? cause.message : 'Could not load website settings.'; }
}
async function change(message: object) {
  if (busy.value) return;
  busy.value = true; error.value = '';
  try {
    const reply = await browser.runtime.sendMessage(message);
    if (!reply?.success) throw new Error(reply?.error || 'Could not save website settings.');
    confirmReset.value = false;
    await load();
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Could not save website settings.'; }
  finally { busy.value = false; }
}
onMounted(() => { stop = storage.watch(SITE_SETTINGS_KEY, () => { void load(); }); void load(); });
onUnmounted(() => { disposed = true; revision++; stop?.(); });
</script>

<template>
  <section class="settings-section site-settings" aria-labelledby="websites-heading" :aria-busy="busy">
    <h3 id="websites-heading">Websites</h3>
    <div class="settings-group">
      <div v-if="status?.hostname" class="setting-row">
        <span class="site-host">{{ status.hostname }}</span>
        <button type="button" class="rm-text-action" :disabled="busy || !status.settings"
          @click="change({ type: 'SITE_SET_CURRENT', tabId: status.tabId, hostname: status.hostname, enabled: !status.enabled })">
          {{ status.enabled ? 'Disable on this website' : 'Enable on this website' }}
        </button>
      </div>
      <p v-else class="setting-row">Open an HTTP or HTTPS webpage to change its setting.</p>
      <p v-if="status?.error" class="setting-row" role="alert">{{ status.error }}</p>
      <template v-if="status?.settings">
        <p v-if="!status.settings.disabledHosts.length" class="setting-row">No websites disabled.</p>
        <div v-for="hostname in status.settings.disabledHosts" :key="hostname" class="setting-row">
          <span class="site-host">{{ hostname }}</span>
          <button type="button" class="rm-text-action" :aria-label="'Enable ' + hostname" :disabled="busy"
            @click="change({ type: 'SITE_ENABLE_HOST', hostname })">Enable</button>
        </div>
      </template>
      <template v-else-if="status?.error">
        <button v-if="!confirmReset" type="button" class="setting-row" @click="confirmReset = true">Restore website settings</button>
        <div v-else class="setting-row">
          <span>Clear website rules and enable lookups?</span>
          <button type="button" :disabled="busy" @click="change({ type: 'SITE_RESET' })">Restore</button>
          <button type="button" :disabled="busy" @click="confirmReset = false">Cancel</button>
        </div>
      </template>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
    <button v-if="error" type="button" class="rm-text-action" :disabled="busy" @click="load">Reload website settings</button>
  </section>
</template>
<style scoped>
.site-host { overflow-wrap: anywhere; min-width: 0; }
.setting-row { gap: 12px; }
</style>
