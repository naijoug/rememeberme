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
import type { BackgroundResponse } from '~/types';

export default defineBackground(() => {
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
      },
      info,
      tab
    );
  });

  // Listen for messages from content scripts
  browser.runtime.onMessage.addListener((
    message: unknown,
    _sender,
    sendResponse: (response: BackgroundResponse) => void
  ) => {
    handleBackgroundRequest(message, dictionaryService)
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
