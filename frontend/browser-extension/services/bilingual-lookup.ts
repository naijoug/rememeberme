import type { Definition, Translation } from '~/types';

// Context-menu saves have no progressive UI, so retain whichever sources succeed.
export async function lookupForSave(
  word: string,
  dictionary: { getDefinition(word: string): Promise<Definition> },
  translator: { translate(word: string): Promise<Translation> },
): Promise<Definition> {
  const [english, chinese] = await Promise.allSettled([dictionary.getDefinition(word), translator.translate(word)]);
  if (english.status === 'fulfilled') {
    return { ...english.value, ...(chinese.status === 'fulfilled' ? { translation: chinese.value } : {}) };
  }
  if (chinese.status === 'fulfilled') return { word, phonetics: [], meanings: [], translation: chinese.value };
  throw new Error([chinese.reason, english.reason].map(error => error instanceof Error ? error.message : 'Lookup unavailable.').join(' '));
}
