import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    name: 'Remember Me',
    description: 'Look up English words as you read and keep a local vocabulary history of the words you forget.',
    // Static content scripts handle selection; no temporary activeTab grant is needed.
    permissions: ['storage', 'contextMenus', 'identity', 'alarms'],
    host_permissions: ['<all_urls>'],
  },
});
