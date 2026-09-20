import type { BackgroundMessage, BackgroundResponse, Definition } from '~/types';
import { isEnglishWord } from './word-utils';

function isDefinitionRequest(message: unknown): message is BackgroundMessage {
  return typeof message === 'object' && message !== null &&
    'type' in message && message.type === 'GET_DEFINITION' &&
    'word' in message && typeof message.word === 'string' && isEnglishWord(message.word);
}

export async function handleBackgroundRequest(
  message: unknown,
  dictionary: { getDefinition(word: string): Promise<Definition> }
): Promise<BackgroundResponse> {
  if (!isDefinitionRequest(message)) {
    return { success: false, error: 'Unsupported or invalid background request' };
  }

  try {
    return { success: true, data: await dictionary.getDefinition(message.word) };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch definition',
    };
  }
}
