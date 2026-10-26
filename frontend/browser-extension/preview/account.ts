// Development-only component fixture. No extension storage or backend access.
import { createApp, h, ref } from 'vue';
import '../assets/paper-sage.css';
import type { CloudStatus, MigrationPreview } from '../services/cloud-vocabulary';

const params = new URLSearchParams(location.search);
const state = params.get('state') ?? 'local';
const status: CloudStatus = { connected: state !== 'signed-out',
  displayName: params.has('long-name') ? 'a-very-long-github-user-name-for-layout' : 'synthetic-reader',
  owner: ['account', 'paused', 'conflict'].includes(state) ? 'account:fixture' : 'anonymous',
  enabled: state === 'account', pending: state === 'conflict' ? 2 : 0,
  conflicts: state === 'conflict' ? 1 : 0, localWords: 3, archives: [],
  ...(state === 'conflict' ? { failure: 'VERSION_CONFLICT' } : {}),
};
const plan: MigrationPreview = { token: 'a'.repeat(64), displayName: 'synthetic-reader', total: 3, copy: 2, skip: 1,
  items: [
    { word: 'serendipity', count: 2, histories: 2, action: 'copy' },
    { word: 'meticulous', count: 0, histories: 4, action: 'copy' },
    { word: 'familiar', count: 3, histories: 3, action: 'skip' },
  ] };
Object.defineProperty(globalThis, 'browser', { value: { runtime: { id: 'synthetic-preview', async sendMessage(input: { type: string; enabled?: boolean }) {
  if (input.type === 'CLOUD_PREVIEW_LOCAL') {
    status.owner = 'account:fixture'; status.enabled = false;
    return { success: true, data: structuredClone(plan) };
  }
  if (input.type === 'CLOUD_COPY_LOCAL') { status.pending = 4; status.enabled = false; }
  if (input.type === 'CLOUD_OPEN') status.owner = 'account:fixture';
  if (input.type === 'CLOUD_USE_LOCAL') { status.owner = 'anonymous'; status.enabled = false; }
  if (input.type === 'CLOUD_SYNC') status.pending = 0;
  if (input.type === 'CLOUD_ENABLE') status.enabled = input.enabled === true;
  if (input.type === 'CLOUD_DISCONNECT') { status.connected = false; status.owner = 'anonymous'; status.notice = 'Disconnected on this device. Server revocation could not be confirmed.'; }
  return { success: true, data: structuredClone(status) };
} } } });
const preference = ref<'system' | 'light' | 'dark'>(params.get('theme') === 'dark' ? 'dark' : 'light');
const resolvedTheme = () => preference.value === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : preference.value;
void Promise.all([import('../components/CloudConnection.vue'), import('../components/VocabularyPanel.vue')])
  .then(([{ default: CloudConnection }, { default: VocabularyPanel }]) => createApp({
    render: () => h('main', { style: 'width:min(400px,100%);margin:24px auto;' }, [
      h('p', { style: 'font:12px system-ui;margin:0 0 12px;color:#667269;' }, 'Synthetic settings preview · no account or vocabulary access'),
      h(VocabularyPanel, { words: [], theme: resolvedTheme(), themePreference: preference.value,
        'onTheme-change': (value: string) => { preference.value = value === 'system' ? 'system' : value === 'dark' ? 'dark' : 'light'; },
      }, { account: () => h(CloudConnection, { 'data-theme': resolvedTheme() }) }),
    ]),
  }).mount('#preview'));
