import type { Definition, WordEntry } from '~/types';

export const CONTEXT_MENU_ID = 'remember-me';
export const ENGLISH_WORD_REGEX = /^[a-zA-Z][a-zA-Z'\-]*[a-zA-Z]$|^[a-zA-Z]$/;

export interface ContextMenuClickInfo {
  menuItemId?: string | number;
  selectionText?: string;
  pageUrl?: string;
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
    url: string
  ): Promise<WordEntry>;
}

export interface ContextMenuCreateApi {
  create(options: any): unknown;
}

export interface TabMessageApi {
  sendMessage(tabId: number, message: unknown): Promise<any>;
}

export interface ContextMenuDeps {
  dictionaryService: DictionaryLikeService;
  storageService: StorageLikeService;
  tabs: TabMessageApi;
}

export function createContextMenu(contextMenus: ContextMenuCreateApi): void {
  contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: 'Remember Me',
    contexts: ['selection'],
  });
}

export function isEnglishWord(text: string): boolean {
  const trimmed = text.trim();

  if (!trimmed || /\s/.test(trimmed)) {
    return false;
  }

  return ENGLISH_WORD_REGEX.test(trimmed);
}

export function getOrdinal(n: number): string {
  const suffixes = ['th', 'st', 'nd', 'rd'];
  const value = n % 100;
  return n + (suffixes[(value - 20) % 10] || suffixes[value] || suffixes[0]);
}

export async function handleContextMenuClick(
  deps: ContextMenuDeps,
  info: ContextMenuClickInfo,
  tab?: TabReference
): Promise<void> {
  if (info.menuItemId !== CONTEXT_MENU_ID || !info.selectionText || !tab?.id) {
    return;
  }

  const selectedText = info.selectionText.trim();

  if (!isEnglishWord(selectedText)) {
    await sendNotificationToTab(deps.tabs, tab.id, 'Please select a valid English word', 'error');
    return;
  }

  try {
    const definition = await deps.dictionaryService.getDefinition(selectedText);
    const contextResponse = await deps.tabs.sendMessage(tab.id, {
      type: 'EXTRACT_CONTEXT',
    });
    const context = contextResponse?.context || '';

    const updatedWord = await deps.storageService.saveWord(
      selectedText,
      definition,
      context,
      info.pageUrl || ''
    );

    const message = `This is the ${getOrdinal(updatedWord.count)} time you forgot "${updatedWord.word}"`;
    await sendNotificationToTab(deps.tabs, tab.id, message, 'success');
  } catch (error) {
    console.error('Context menu save error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to save word';
    await sendNotificationToTab(deps.tabs, tab.id, `Error: ${errorMessage}`, 'error');
  }
}

async function sendNotificationToTab(
  tabs: TabMessageApi,
  tabId: number,
  message: string,
  type: 'success' | 'error'
): Promise<void> {
  try {
    await tabs.sendMessage(tabId, {
      type: 'SHOW_NOTIFICATION',
      message,
      notificationType: type,
    });
  } catch (error) {
    console.error('Failed to send notification to tab:', error);
  }
}
