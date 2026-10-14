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

export default defineBackground(() => {
  const synchronize = () => void storageService.synchronize().catch(() => {});
  browser.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'rememberme-sync') synchronize(); });
  browser.alarms.create('rememberme-sync', { periodInMinutes: 1 });
  browser.runtime.onStartup.addListener(synchronize);
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
      const cloudMessage = typeof message === 'object' && message !== null && 'type' in message
        && typeof message.type === 'string' && message.type.startsWith('CLOUD_');
      // Account controls are available only to extension pages, never webpage scripts.
      if (cloudMessage) {
        if (!_sender.url?.startsWith(browser.runtime.getURL(''))) return { success: false, error: 'Account controls require an extension page.' } as const;
        return (await handleCloudMessage(message))!;
      }
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
