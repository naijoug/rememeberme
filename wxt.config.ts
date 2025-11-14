import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    name: 'Vocabulary Counter',
    description: '英语学习词汇追踪工具 - 帮助你追踪和管理不认识的单词',
    permissions: ['storage', 'activeTab'],
    host_permissions: ['<all_urls>'],
  },
});
