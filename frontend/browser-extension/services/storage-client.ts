import type { BackgroundResponse, Definition, VocabularyMessage, WordEntry } from '~/types';

async function request<T>(message: VocabularyMessage): Promise<T> {
  const response: BackgroundResponse<T> | undefined = await browser.runtime.sendMessage(message);
  if (!response) throw new Error('No response from vocabulary storage');
  if (!response.success) throw new Error(response.error);
  return response.data;
}

// Every vocabulary operation goes through the background's shared queue.
// Never fall back to a local write when messaging fails.
export const storageClient = {
  getAllWords: () => request<WordEntry[]>({ type: 'GET_WORDS' }),
  saveWord: (word: string, definition: Definition, context: string, url: string) =>
    request<WordEntry>({ type: 'SAVE_WORD', word, definition, context, url }),
  deleteWord: (word: string) => request<void>({ type: 'DELETE_WORD', word }),
  resetCount: (word: string) => request<void>({ type: 'RESET_COUNT', word }),
  importData: (jsonData: string) => request<void>({ type: 'IMPORT_DATA', jsonData }),
  exportData: () => request<string>({ type: 'EXPORT_DATA' }),
};
