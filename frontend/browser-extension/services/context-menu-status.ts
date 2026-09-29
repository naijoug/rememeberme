import type { ContextMenuStatusApi } from './context-menu-handler';

// Available even when there is no receiving content script in the page.
export const contextMenuStatus: ContextMenuStatusApi = {
  async clear(tabId) {
    const action = browser.action ?? browser.browserAction;
    await action.setBadgeText({ tabId, text: '' });
    await action.setTitle({ tabId, title: browser.runtime.getManifest().name });
  },
  async show(tabId, message, type) {
    const action = browser.action ?? browser.browserAction;
    await action.setBadgeBackgroundColor({ tabId, color: type === 'error' ? '#d32f2f' : '#2e7d32' });
    await action.setBadgeText({ tabId, text: type === 'error' ? '!' : 'OK' });
    await action.setTitle({ tabId, title: `Remember Me: ${message}` });
  },
};
