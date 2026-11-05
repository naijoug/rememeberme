import { storage } from 'wxt/utils/storage';
import { handleLookupPort } from '~/services/lookup-port-handler';
import { contextExplanationService } from '~/services/context-explanation';
import { EXPLANATION_CONSENT_KEY, explanationConsent, hasExplanationConsent, saveExplanationConsent } from '~/services/explanation-settings';
import { CONTEXT_EXPLANATION_ENABLED } from '~/config/backend';
import { isContextExplanationInput } from '../../../contracts/context-explanation';
/**
 * Background Service Worker
 * Handles message communication and API requests
 */

import { dictionaryService } from '~/services/dictionary';
import { translationService } from '~/services/translation';
import { phoneticsService } from '~/services/phonetics';
import { lookupForSave } from '~/services/bilingual-lookup';
import {
  createContextMenu,
  handleContextMenuClick,
} from '~/services/context-menu-handler';
import { cloudVocabulary as storageService } from '~/services/cloud-vocabulary';
import { handleCloudMessage } from '~/services/cloud-messages';
import { handleBackgroundRequest } from '~/services/background-handler';
import { reconnectLocalPage, startLocalFeedback } from '~/services/local-feedback';
import { contextMenuStatus } from '~/services/context-menu-status';
import type { BackgroundResponse } from '~/types';
import { ACCOUNT_SYNC_ENABLED } from '~/config/backend';
import { siteSettings, SITE_SETTINGS_KEY } from '~/services/site-settings';
import { checkPageSitePolicy, handleSiteMessage, senderPageURL } from '~/services/site-messages';

export default defineBackground(() => {
  storage.watch(EXPLANATION_CONSENT_KEY, value => { if (!explanationConsent(value)) contextExplanationService.clear(); });
  browser.runtime.onConnect.addListener(port => {
    handleLookupPort(port, {
      authorize: async operation => {
        const sender = port.sender;
        if (!sender || !(sender.tab || sender.url?.startsWith(browser.runtime.getURL('')))) throw new Error('Invalid lookup source.');
        await checkPageSitePolicy({ type: operation }, sender, siteSettings, browser.tabs, browser.runtime.getURL(''));
        if (operation === 'EXPLAIN_CONTEXT' && (!CONTEXT_EXPLANATION_ENABLED || !await hasExplanationConsent())) throw new Error('Sentence explanation is disabled.');
      },
      run: async (operation, payload, signal, cached) => {
        switch (operation) {
          case 'GET_DEFINITION': return dictionaryService.getDefinition(String(payload.word), signal);
          case 'GET_TRANSLATION': return translationService.translate(String(payload.word), signal, cached);
          case 'GET_PHONETICS': return phoneticsService.getPhonetics(String(payload.word));
          case 'EXPLANATION_CAPABILITIES': return contextExplanationService.capabilities(signal);
          case 'EXPLAIN_CONTEXT':
            if (!isContextExplanationInput(payload)) throw new Error('Invalid sentence explanation request.');
            return contextExplanationService.explain(payload, signal);
        }
      },
      subscribePolicy: recheck => {
        const stopSite = storage.watch(SITE_SETTINGS_KEY, recheck);
        const stopExplanation = storage.watch(EXPLANATION_CONSENT_KEY, recheck);
        return () => { stopSite(); stopExplanation(); };
      },
    });
  });
  const synchronize = () => { if (ACCOUNT_SYNC_ENABLED) void storageService.synchronize().catch(() => {}); };
  if (ACCOUNT_SYNC_ENABLED) {
    browser.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'rememberme-sync') synchronize(); });
    browser.alarms.create('rememberme-sync', { periodInMinutes: 1 });
    browser.runtime.onStartup.addListener(synchronize);
  }
  if (import.meta.env.MODE === 'feedback' && import.meta.env.COMMAND === 'serve') {
    startLocalFeedback();
  }
  console.log('Vocabulary Counter background service started', { id: browser.runtime.id });

  // Create context menu on installation
  browser.runtime.onInstalled.addListener(() => {
    createContextMenu(browser.contextMenus);
    console.log('Context menu created');
  });

  // Listen for context menu clicks
  browser.contextMenus.onClicked.addListener((info, tab) => {
    void handleContextMenuClick(
      {
        dictionaryService: { getDefinition: word => lookupForSave(word, dictionaryService, translationService) },
        storageService,
        tabs: browser.tabs,
        status: contextMenuStatus,
        ensureSiteAllowed: async tabId => {
          const access = await siteSettings.access(await senderPageURL({ tab: { id: tabId } }, browser.tabs));
          if (!access.enabled) throw new Error(access.error ?? 'Remember Me is disabled on this website. Enable it in Settings to continue.');
        },
        reconnectPage: import.meta.env.MODE === 'feedback' && import.meta.env.COMMAND === 'serve'
          ? reconnectLocalPage : undefined,
      },
      info,
      tab
    ).finally(synchronize).catch(() => {});
  });

  // Listen for messages from content scripts
  browser.runtime.onMessage.addListener((
    message: unknown,
    _sender,
    sendResponse: (response: BackgroundResponse<unknown>) => void
  ) => {
    (async () => {
      if (message && typeof message === 'object' && 'type' in message && message.type === 'EXPLANATION_CONSENT') {
        if (!CONTEXT_EXPLANATION_ENABLED || !('enabled' in message) || typeof message.enabled !== 'boolean') throw new Error('Sentence explanation is unavailable.');
        if (!_sender.tab && !_sender.url?.startsWith(browser.runtime.getURL(''))) throw new Error('Invalid settings source.');
        await checkPageSitePolicy({ type: 'EXPLAIN_CONTEXT' }, _sender, siteSettings, browser.tabs, browser.runtime.getURL(''));
        await saveExplanationConsent(message.enabled);
        if (!message.enabled) contextExplanationService.clear();
        return { success: true, data: null } as const;
      }
      const siteReply = await handleSiteMessage(message, _sender, siteSettings, browser.tabs, browser.runtime.getURL(''));
      if (siteReply) return siteReply;
      const cloudMessage = typeof message === 'object' && message !== null && 'type' in message
        && typeof message.type === 'string' && message.type.startsWith('CLOUD_');
      // Account controls are available only to extension pages, never webpage scripts.
      if (cloudMessage) {
        if (!ACCOUNT_SYNC_ENABLED) return { success: false, error: 'Account sync is unavailable in this release.' } as const;
        if (!_sender.url?.startsWith(browser.runtime.getURL(''))) return { success: false, error: 'Account controls require an extension page.' } as const;
        return (await handleCloudMessage(message))!;
      }
      await checkPageSitePolicy(message, _sender, siteSettings, browser.tabs, browser.runtime.getURL(''));
      const result = await handleBackgroundRequest(message, dictionaryService, storageService, translationService, phoneticsService);
      if (result.success && typeof message === 'object' && message !== null && 'type' in message
        && ['SAVE_WORD', 'DELETE_WORD', 'RESET_COUNT', 'IMPORT_DATA'].includes(String(message.type))) synchronize();
      return result;
    })()
      .then(response => sendResponse(response))
      .catch(error => {
        console.error('Background message handler error:', error);
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error occurred',
        });
      });

    // Return true to indicate async response
    return true;
  });
});
