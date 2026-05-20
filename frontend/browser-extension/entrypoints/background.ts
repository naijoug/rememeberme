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
import type { BackgroundMessage, BackgroundResponse } from '~/types';

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
    message: BackgroundMessage,
    sender: any,
    sendResponse: (response: BackgroundResponse) => void
  ) => {
    handleMessage(message, sender)
      .then(response => sendResponse(response))
      .catch(error => {
        console.error('Background message handler error:', error);
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error occurred',
        } as BackgroundResponse);
      });

    // Return true to indicate async response
    return true;
  });
});

/**
 * Handle incoming messages from content scripts
 */
async function handleMessage(
  message: BackgroundMessage,
  sender: any
): Promise<BackgroundResponse> {
  console.log('Received message:', message.type, sender.tab?.id);

  switch (message.type) {
    case 'GET_DEFINITION':
      return await handleGetDefinition(message.word);

    case 'SAVE_WORD':
    case 'GET_WORDS':
    case 'DELETE_WORD':
      // These will be handled by storage service directly from content/popup
      // Background doesn't need to proxy storage operations
      return { success: true };

    default:
      throw new Error(`Unknown message type: ${(message as any).type}`);
  }
}

/**
 * Handle GET_DEFINITION message
 * Fetches word definition from dictionary API
 */
async function handleGetDefinition(word: string): Promise<BackgroundResponse> {
  try {
    const definition = await dictionaryService.getDefinition(word);
    return {
      success: true,
      data: definition,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to fetch definition';
    return {
      success: false,
      error: errorMessage,
    };
  }
}
