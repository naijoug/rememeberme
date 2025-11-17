import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    name: 'Remember Me',
    description: 'Words remember you, too.',
    permissions: ['storage', 'activeTab', 'contextMenus'],
    host_permissions: ['<all_urls>'],
  },
});
