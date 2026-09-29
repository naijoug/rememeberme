import type { BackgroundMessage, BackgroundResponse, Definition, VocabularyMessage } from '~/types';
import type { StorageService } from './storage';
import { isDefinition } from './definition-utils';
import { isEnglishWord } from './word-utils';

function isDefinitionRequest(message: unknown): message is BackgroundMessage {
  return typeof message === 'object' && message !== null &&
    'type' in message && message.type === 'GET_DEFINITION' &&
    'word' in message && typeof message.word === 'string' && isEnglishWord(message.word);
}

function isVocabularyRequest(message: unknown): message is VocabularyMessage {
  if (typeof message !== 'object' || message === null || !('type' in message)) return false;
  switch (message.type) {
    case 'GET_WORDS':
    case 'EXPORT_DATA':
      return true;
    case 'DELETE_WORD':
    case 'RESET_COUNT':
      // Backups may contain words outside the selection validator's alphabet.
      return 'word' in message && typeof message.word === 'string' && message.word.trim().length > 0;
    case 'IMPORT_DATA':
      return 'jsonData' in message && typeof message.jsonData === 'string';
    case 'SAVE_WORD':
      return 'word' in message && typeof message.word === 'string' && isEnglishWord(message.word) &&
        'definition' in message && isDefinition(message.definition) &&
        'context' in message && typeof message.context === 'string' &&
        'url' in message && typeof message.url === 'string';
    default:
      return false;
  }
}

type VocabularyStorage = Pick<StorageService,
  'getAllWords' | 'saveWord' | 'deleteWord' | 'resetCount' | 'importData' | 'exportData'>;

export async function handleBackgroundRequest(
  message: unknown,
  dictionary: { getDefinition(word: string): Promise<Definition> },
  vocabulary: VocabularyStorage
): Promise<BackgroundResponse<unknown>> {
  try {
    if (isDefinitionRequest(message)) {
      return { success: true, data: await dictionary.getDefinition(message.word) };
    }
    if (!isVocabularyRequest(message)) {
      return { success: false, error: 'Unsupported or invalid background request' };
    }
    switch (message.type) {
      case 'GET_WORDS':
        return { success: true, data: await vocabulary.getAllWords() };
      case 'SAVE_WORD':
        return { success: true, data: await vocabulary.saveWord(message.word, message.definition, message.context, message.url) };
      case 'DELETE_WORD':
        await vocabulary.deleteWord(message.word);
        return { success: true, data: null };
      case 'RESET_COUNT':
        await vocabulary.resetCount(message.word);
        return { success: true, data: null };
      case 'IMPORT_DATA':
        await vocabulary.importData(message.jsonData);
        return { success: true, data: null };
      case 'EXPORT_DATA':
        return { success: true, data: await vocabulary.exportData() };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Background request failed',
    };
  }
}
