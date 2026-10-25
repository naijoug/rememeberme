import { defineConfig } from 'wxt';
import { ACCOUNT_SYNC_ENABLED } from './config/backend';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  // Entrypoint metadata needs matches/options only. WXT 0.21's inline importer
  // does not run Vue/CSS buildStart hooks; keep UI imports out of that environment.
  // Normal browser builds and the development server use the real Vue/CSS plugins.
  vite: () => ({ plugins: [{
    name: 'rememberme-entrypoint-metadata',
    enforce: 'pre',
    applyToEnvironment: environment => environment.name === 'inline',
    resolveId(id) { if (/\.(vue|css)(\?|$)/.test(id)) return '\0rememberme-entrypoint-ui-stub.js'; },
    load(id) { if (id === '\0rememberme-entrypoint-ui-stub.js') return 'export default "";'; },
  }] }),
  manifest: {
    name: 'Remember Me',
    description: 'Look up English words as you read and keep a local vocabulary history of the words you forget.',
    // Static content scripts handle selection; no temporary activeTab grant is needed.
    permissions: ['storage', 'contextMenus', ...(ACCOUNT_SYNC_ENABLED ? ['identity', 'alarms'] : [])],
    host_permissions: ['<all_urls>'],
  },
});
