<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { NavArrowRight, Refresh } from '@iconoir/vue';
import type { CloudStatus, MigrationPreview } from '~/services/cloud-vocabulary';
import { SERVICE_ORIGIN } from '~/config/backend';
const emit = defineEmits<{ changed: []; 'view-words': [] }>();
const busy = ref(false), error = ref('');
let statusRevision = 0;
const status = ref<CloudStatus>();
const preview = ref<MigrationPreview>();
const previewPanel = ref<HTMLElement>();
const accountSelected = computed(() => Boolean(status.value?.connected && status.value.owner !== 'anonymous'));
const needsRecovery = computed(() => Boolean(status.value?.conflicts || status.value?.failure === 'SYNC_EPOCH_CHANGED'));
const syncState = computed(() => {
  if (!accountSelected.value) return 'Finishing sign-in';
  if (needsRecovery.value || status.value?.failure) return 'Needs attention';
  if (!status.value?.enabled) return 'Paused';
  if (status.value.downloading) return 'Downloading words…';
  if (status.value.pending) return 'Uploading changes…';
  return 'Up to date';
});
const syncDisabled = computed(() => busy.value || (!status.value?.enabled && needsRecovery.value));

async function action(type: string, extra: Record<string, unknown> = {}) {
  if (busy.value) return; busy.value = true; error.value = '';
  statusRevision++;
  preview.value = undefined;
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
async function previewLocal() {
  if (busy.value) return;
  busy.value = true; error.value = ''; preview.value = undefined;
  statusRevision++;
  try {
    const reply = await browser.runtime.sendMessage({ type: 'CLOUD_PREVIEW_LOCAL' });
    if (!reply?.success) throw new Error(reply?.error || 'Could not preview local vocabulary.');
    preview.value = reply.data;
    await nextTick(); previewPanel.value?.focus();
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Could not preview local vocabulary.'; }
  finally {
    const latest = await browser.runtime.sendMessage({ type: 'CLOUD_STATUS' }).catch(() => undefined);
    if (latest?.success) status.value = latest.data;
    busy.value = false; emit('changed');
  }
}
async function copyLocal() {
  const plan = preview.value;
  if (!plan || busy.value) return;
  if (confirm(`Copy ${plan.copy} new words to GitHub account @${plan.displayName}? Skip ${plan.skip} existing words without changing their counts. Context and source URLs remain local. The original local vocabulary is retained. ${status.value?.enabled ? 'New words will sync automatically.' : 'Resume sync to upload the new words.'}`)) {
    await action('CLOUD_COPY_LOCAL', { previewToken: plan.token });
  }
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
let statusTimer: ReturnType<typeof setInterval> | undefined;
let polling = false, stopped = false;
onMounted(() => {
  void action('CLOUD_STATUS');
  statusTimer = setInterval(async () => {
    if (busy.value || polling || document.hidden) return;
    polling = true;
    const revision = statusRevision;
    try {
      const reply = await browser.runtime.sendMessage({ type: 'CLOUD_STATUS' });
      if (!stopped && !busy.value && revision === statusRevision && reply?.success) status.value = reply.data;
    } catch { /* Keep the last confirmed state; explicit actions report errors. */ }
    finally { polling = false; }
  }, 5000);
});
onUnmounted(() => { stopped = true; clearInterval(statusTimer); });
</script>
<template>
  <section class="cloud-connection rm-theme" aria-label="Account and sync settings" :aria-busy="busy">
    <section class="settings-section" aria-labelledby="account-heading">
      <h3 id="account-heading">Account</h3>
      <div class="settings-group">
        <template v-if="status?.connected">
          <dl class="setting-row">
            <dt>GitHub</dt>
            <dd>{{ status.displayName ? `@${status.displayName}` : 'Username unavailable' }}</dd>
          </dl>
          <button v-if="accountSelected" class="setting-row row-action" @click="emit('view-words')">
            <span>View account words</span>
            <span class="row-trailing"><span class="row-value">{{ status.accountWords ?? 0 }}</span><NavArrowRight class="row-chevron" width="16" height="16" aria-hidden="true" /></span>
          </button>
        </template>
        <template v-else>
          <dl class="setting-row"><dt>GitHub</dt><dd>Not connected</dd></dl>
          <button class="setting-row row-action" :disabled="busy" @click="action('CLOUD_CONNECT', { origin: SERVICE_ORIGIN })">
            <span>Sign in with GitHub</span>
            <NavArrowRight class="row-chevron" width="16" height="16" aria-hidden="true" />
          </button>
        </template>
      </div>
      <p v-if="!status?.connected" class="section-note">Sign in to show your account words here and sync new words automatically. Translation works without signing in.</p>
    </section>

    <template v-if="status?.connected">
      <section class="settings-section" aria-labelledby="sync-heading">
        <h3 id="sync-heading">Synchronization</h3>
        <div class="settings-group">
          <div class="setting-row">
            <span id="cloud-sync-label">Cloud sync</span>
            <button class="sync-switch" type="button" role="switch" :aria-checked="status.enabled"
              aria-labelledby="cloud-sync-label" :aria-describedby="needsRecovery ? 'sync-recovery-hint' : 'sync-help'"
              :disabled="syncDisabled" @click="action('CLOUD_ENABLE', { enabled: !status.enabled })">
              <span class="switch-thumb" aria-hidden="true" />
            </button>
          </div>
          <dl class="setting-row sync-status">
            <dt>Status</dt>
            <dd>
              <span>{{ syncState }}</span>
              <small v-if="status.pending || status.conflicts">{{ status.pending }} pending · {{ status.conflicts }} {{ status.conflicts === 1 ? 'conflict' : 'conflicts' }}</small>
            </dd>
          </dl>
          <button class="setting-row row-action" :disabled="busy || (accountSelected && !status.enabled)" @click="action(accountSelected ? 'CLOUD_SYNC' : 'CLOUD_OPEN')">
            <span>{{ accountSelected ? 'Sync now' : 'Retry sync' }}</span><Refresh class="row-chevron" width="16" height="16" aria-hidden="true" />
          </button>
        </div>
        <p id="sync-help" class="section-note">{{ status.enabled ? 'New words sync automatically across your devices.' : 'Paused. Your account words stay visible and saved on this device.' }}</p>
        <p v-if="needsRecovery" id="sync-recovery-hint" class="section-note">Review recovery options before enabling sync.</p>
      </section>

      <section v-if="status.localWords" class="settings-section" aria-labelledby="local-heading">
        <h3 id="local-heading">Before you signed in</h3>
        <div class="settings-group">
          <button class="setting-row row-action" :disabled="busy" @click="previewLocal">
            <span>Add device words to account</span>
            <span class="row-trailing"><span class="row-value">{{ status.localWords }} {{ status.localWords === 1 ? 'word' : 'words' }}</span><NavArrowRight class="row-chevron" width="16" height="16" aria-hidden="true" /></span>
          </button>
        </div>
        <p class="section-note">These words were saved before sign-in. Review and add them to your account; the originals are kept.</p>
      </section>

      <section v-if="preview" ref="previewPanel" tabindex="-1" aria-label="Local vocabulary migration preview" class="migration-preview settings-section">
        <div class="preview-heading"><h3>Copy to @{{ preview.displayName }}</h3><button class="text-action" :disabled="busy" @click="preview = undefined">Cancel preview</button></div>
        <div class="settings-group">
          <div class="preview-summary">
            <p>{{ preview.total }} local words · {{ preview.copy }} new · {{ preview.skip }} skipped</p>
            <p class="section-note">Existing words are skipped without adding counts. {{ status.enabled ? 'New words sync automatically after confirmation.' : 'Resume sync after adding words.' }}</p>
          </div>
          <div class="migration-items" tabindex="0" aria-label="Words to copy or skip">
            <table>
              <thead><tr><th>Word</th><th>Count</th><th>History</th><th>Action</th></tr></thead>
              <tbody><tr v-for="(item, index) in preview.items" :key="index"><td>{{ item.word }}</td><td>{{ item.count }}</td><td>{{ item.histories }}</td><td>{{ item.action === 'copy' ? 'Copy' : 'Skip existing' }}</td></tr></tbody>
            </table>
          </div>
          <button class="setting-row row-action" :disabled="busy || !preview.copy" @click="copyLocal">
            <span>Confirm copy of {{ preview.copy }} new words</span><NavArrowRight class="row-chevron" width="16" height="16" aria-hidden="true" />
          </button>
        </div>
      </section>

      <p v-if="status.failure && status.failure !== error" class="feedback" role="status">{{ status.failure }}. Local vocabulary and pending requests are retained.</p>
      <section v-if="needsRecovery || status.archives.length" class="settings-section" aria-labelledby="recovery-heading">
        <h3 id="recovery-heading">Recovery</h3>
        <div class="settings-group">
          <button v-if="needsRecovery" class="setting-row row-action" :disabled="busy" @click="recoverCloud">
            <span>Archive changes and use cloud vocabulary</span><NavArrowRight class="row-chevron" width="16" height="16" aria-hidden="true" />
          </button>
          <button v-for="archive in status.archives" :key="archive.key" class="setting-row row-action" :disabled="busy" @click="exportArchive(archive.key)">
            <span>Export recovery copy<small>{{ new Date(archive.createdAt).toLocaleString() }}</small></span><NavArrowRight class="row-chevron" width="16" height="16" aria-hidden="true" />
          </button>
        </div>
      </section>

      <div class="settings-group disconnect-group">
        <button class="setting-row row-action disconnect-action" :disabled="busy" @click="action('CLOUD_DISCONNECT')">Sign out</button>
      </div>
    </template>
    <p v-if="status?.notice" class="feedback" role="status">{{ status.notice }}</p>
    <p v-if="error" class="feedback error" role="alert">{{ error }}</p>
  </section>
</template>
<style scoped>
.cloud-connection { --switch-on: #3e775e; --switch-knob: #fff; font-size: 13px; background: var(--rm-bg); }
.cloud-connection[data-theme='dark'] { --switch-on: #8cba9d; --switch-knob: #173523; }
.sync-status dd > span { color: var(--rm-text); }
.sync-switch { position: relative; width: 42px; height: 25px; flex-shrink: 0; border: 1px solid var(--rm-muted); border-radius: 99px; padding: 2px; background: var(--rm-border); transition: background .15s, border-color .15s; }
.switch-thumb { display: block; width: 19px; height: 19px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px #0003; transition: transform .15s; }
.sync-switch[aria-checked='true'] { background: var(--switch-on); border-color: var(--switch-on); }
.sync-switch[aria-checked='true'] .switch-thumb { transform: translateX(17px); background: var(--switch-knob); }
.sync-switch:disabled { opacity: .48; }
.disconnect-group { margin: 2px 0 18px; }
.cloud-connection .disconnect-action { color: var(--rm-error); }
.cloud-connection .feedback { margin: 12px 0; padding: 10px 12px; border-radius: 8px; background: var(--rm-soft); color: var(--rm-muted); overflow-wrap: anywhere; }
.cloud-connection .feedback.error { background: var(--rm-error-soft); color: var(--rm-error); }
.preview-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 0 12px 7px; }
.cloud-connection .preview-heading h3 { margin: 0; text-transform: none; letter-spacing: 0; overflow-wrap: anywhere; }
.text-action { flex-shrink: 0; padding: 0; border: 0; color: var(--rm-muted); background: transparent; font-size: 11px; }
.preview-summary { padding: 12px; }
.cloud-connection .preview-summary .section-note { margin: 5px 0 0; }
.migration-items { max-height: 180px; overflow: auto; border-block: 1px solid var(--rm-border); }
.migration-items:focus-visible { outline: 2px solid var(--rm-primary); outline-offset: -2px; }
table { width: 100%; border-collapse: collapse; text-align: left; font-size: 11px; }
th, td { padding: 8px 10px; border-bottom: 1px solid var(--rm-border); overflow-wrap: anywhere; }
th { color: var(--rm-muted); font-weight: 500; }
tr:last-child td { border-bottom: 0; }
@media (prefers-reduced-motion: reduce) { .sync-switch, .switch-thumb { transition: none; } }
</style>
