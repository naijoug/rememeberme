import type { Definition, WordEntry } from '~/types';
import { getOrdinal, isEnglishWord } from './word-utils';

export const CONTEXT_MENU_ID = 'remember-me';
export { getOrdinal, isEnglishWord };

export interface ContextMenuClickInfo {
  menuItemId?: string | number;
  selectionText?: string;
  pageUrl?: string;
  frameId?: number;
  frameUrl?: string;
}

export interface TabReference {
  id?: number;
}

export interface DictionaryLikeService {
  getDefinition(word: string): Promise<Definition>;
}

export interface StorageLikeService {
  saveWord(
    word: string,
    definition: Definition,
    context: string,
    url: string,
    timestamp?: number
  ): Promise<WordEntry>;
}

export interface ContextMenuCreateApi {
  create(options: any): unknown;
}

export interface TabMessageApi {
  sendMessage(tabId: number, message: unknown, options?: { frameId: number }): Promise<any>;
}

export interface ContextMenuStatusApi {
  clear(tabId: number): Promise<void>;
  show(tabId: number, message: string, type: 'success' | 'error'): Promise<void>;
}

export interface ContextMenuDeps {
  dictionaryService: DictionaryLikeService;
  storageService: StorageLikeService;
  tabs: TabMessageApi;
  status: ContextMenuStatusApi;
  reconnectPage?: (tabId: number, frameId: number) => Promise<void>;
}

export function createContextMenu(contextMenus: ContextMenuCreateApi): void {
  contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: 'Remember Me',
    contexts: ['selection'],
    documentUrlPatterns: ['http://*/*', 'https://*/*', 'file:///*'],
  });
}

export async function handleContextMenuClick(
  deps: ContextMenuDeps,
  info: ContextMenuClickInfo,
  tab?: TabReference
): Promise<void> {
  if (info.menuItemId !== CONTEXT_MENU_ID || !info.selectionText || tab?.id == null) {
    return;
  }

  const selectedText = info.selectionText.trim();
  const timestamp = Date.now();
  const frameId = info.frameId ?? 0;
  try { await deps.status.clear(tab.id); } catch { /* The tab may already be closed. */ }

  if (!isEnglishWord(selectedText)) {
    await sendNotificationToTab(deps, tab.id, frameId, 'Please select a valid English word', 'error');
    return;
  }

  let pageConnected = false;
  try {
    if (info.pageUrl && !/^(https?|file):\/\//i.test(info.pageUrl)) {
      throw new Error('Use Remember Me on a webpage. Browser-internal and extension management pages are not supported.');
    }
    // Capture the selected page context before a slow dictionary request can
    // outlive the selection, and avoid lookup/save work on unreachable pages.
    const context = await getPageContext(deps, tab.id, frameId);
    pageConnected = true;
    const definition = await deps.dictionaryService.getDefinition(selectedText);

    const updatedWord = await deps.storageService.saveWord(
      selectedText,
      definition,
      context,
      info.frameUrl || info.pageUrl || '',
      timestamp
    );

    const message = `This is the ${getOrdinal(updatedWord.count)} time you forgot "${updatedWord.word}"`;
    await sendNotificationToTab(deps, tab.id, frameId, message, 'success');
  } catch (error) {
    console.error('Context menu save error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to save word';
    if (pageConnected) {
      await sendNotificationToTab(deps, tab.id, frameId, `Error: ${errorMessage}`, 'error');
    } else {
      await showFallback(deps, tab.id, errorMessage, 'error');
    }
  }
}

async function getPageContext(deps: ContextMenuDeps, tabId: number, frameId: number): Promise<string> {
  const request = async () => {
    const response = await deps.tabs.sendMessage(tabId, { type: 'EXTRACT_CONTEXT' }, { frameId });
    if (typeof response?.context !== 'string') throw new Error('No context response');
    return response.context as string;
  };
  try {
    return await request();
  } catch {
    // Local feedback builds already have scripting permission. Reconnect only
    // the frame the user clicked; never reload the page or retry a storage write.
    if (deps.reconnectPage) {
      try {
        await deps.reconnectPage(tabId, frameId);
        return await request();
      } catch { /* Restricted/closed pages still cannot receive the script. */ }
    }
    throw new Error('Cannot connect to this page. Refresh the webpage and try again. Browser-internal or restricted pages are not supported.');
  }
}

async function sendNotificationToTab(
  deps: ContextMenuDeps,
  tabId: number,
  frameId: number,
  message: string,
  type: 'success' | 'error'
): Promise<void> {
  try {
    await deps.tabs.sendMessage(tabId, {
      type: 'SHOW_NOTIFICATION',
      message,
      notificationType: type,
    }, { frameId });
  } catch {
    await showFallback(deps, tabId, message, type);
  }
}

async function showFallback(deps: ContextMenuDeps, tabId: number, message: string, type: 'success' | 'error') {
  try { await deps.status.show(tabId, message, type); } catch { /* No toolbar remains if the tab closed. */ }
}
