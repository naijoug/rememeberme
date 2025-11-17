/**
 * Background Service Worker
 * Handles message communication and API requests
 */

import { dictionaryService } from '~/services/dictionary';
import { storageService } from '~/services/storage';
import type { BackgroundMessage, BackgroundResponse } from '~/types';

// 英文单词验证正则（基本验证：字母、连字符、撇号）
const ENGLISH_WORD_REGEX = /^[a-zA-Z][a-zA-Z'\-]*[a-zA-Z]$|^[a-zA-Z]$/;

export default defineBackground(() => {
  console.log('Vocabulary Counter background service started', { id: browser.runtime.id });

  // Create context menu on installation
  browser.runtime.onInstalled.addListener(() => {
    createContextMenu();
  });

  // Listen for context menu clicks
  browser.contextMenus.onClicked.addListener((info, tab) => {
    handleContextMenuClick(info, tab);
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
 * Create context menu for "Remember Me" functionality
 */
function createContextMenu(): void {
  browser.contextMenus.create({
    id: 'remember-me',
    title: 'Remember Me',
    contexts: ['selection'],
  });
  console.log('Context menu created');
}

/**
 * Handle context menu click events
 */
async function handleContextMenuClick(
  info: any,
  tab?: any
): Promise<void> {
  if (info.menuItemId !== 'remember-me' || !info.selectionText || !tab?.id) {
    return;
  }

  const selectedText = info.selectionText.trim();

  // 验证选中文本是否为有效的英文单词
  if (!isEnglishWord(selectedText)) {
    await sendNotificationToTab(tab.id, 'Please select a valid English word', 'error');
    return;
  }

  try {
    // 1. 获取单词释义
    const definition = await dictionaryService.getDefinition(selectedText);

    // 2. 向 content script 请求提取上下文
    const contextResponse = await browser.tabs.sendMessage(tab.id, {
      type: 'EXTRACT_CONTEXT',
    });

    const context = contextResponse?.context || '';

    // 3. 保存单词
    const updatedWord = await storageService.saveWord(
      selectedText,
      definition,
      context,
      info.pageUrl || ''
    );

    // 4. 显示成功通知
    const message = `This is the ${getOrdinal(updatedWord.count)} time you forgot "${updatedWord.word}"`;
    await sendNotificationToTab(tab.id, message, 'success');

    console.log('Word saved successfully via context menu:', selectedText);
  } catch (error) {
    console.error('Context menu save error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to save word';
    await sendNotificationToTab(tab.id, `Error: ${errorMessage}`, 'error');
  }
}

/**
 * 验证文本是否为英文单词
 */
function isEnglishWord(text: string): boolean {
  const trimmed = text.trim();
  
  // 检查是否为空或包含空格（多个单词）
  if (!trimmed || /\s/.test(trimmed)) {
    return false;
  }

  // 使用正则验证是否为英文单词
  return ENGLISH_WORD_REGEX.test(trimmed);
}

/**
 * 向指定标签页发送通知消息
 */
async function sendNotificationToTab(
  tabId: number,
  message: string,
  type: 'success' | 'error'
): Promise<void> {
  try {
    await browser.tabs.sendMessage(tabId, {
      type: 'SHOW_NOTIFICATION',
      message,
      notificationType: type,
    });
  } catch (error) {
    console.error('Failed to send notification to tab:', error);
  }
}

/**
 * 获取序数词（1st, 2nd, 3rd, 4th, etc.）
 */
function getOrdinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

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
