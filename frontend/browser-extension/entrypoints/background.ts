/**
 * Background Service Worker
 * Handles message communication and API requests
 */

import { dictionaryService } from '~/services/dictionary';
import {
  createContextMenu,
  handleContextMenuClick,
} from '~/services/context-menu-handler';
import { storageService } from '~/services/storage';
import { handleBackgroundRequest } from '~/services/background-handler';
import { reconnectLocalPage, startLocalFeedback } from '~/services/local-feedback';
import { contextMenuStatus } from '~/services/context-menu-status';
import type { BackgroundResponse } from '~/types';

export default defineBackground(() => {
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
    handleContextMenuClick(
      {
        dictionaryService,
        storageService,
        tabs: browser.tabs,
        status: contextMenuStatus,
        reconnectPage: import.meta.env.MODE === 'feedback' && import.meta.env.COMMAND === 'serve'
          ? reconnectLocalPage : undefined,
      },
      info,
      tab
    );
  });

  // Listen for messages from content scripts
  browser.runtime.onMessage.addListener((
    message: unknown,
    _sender,
    sendResponse: (response: BackgroundResponse<unknown>) => void
  ) => {
    handleBackgroundRequest(message, dictionaryService, storageService)
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
