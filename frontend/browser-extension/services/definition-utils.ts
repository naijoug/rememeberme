import type { Definition, Translation } from '~/types';

export function isTranslation(value: unknown): value is Translation {
  if (typeof value !== 'object' || value === null) return false;
  const translation = value as Record<string, unknown>;
  return (translation.source === 'mymemory' || translation.source === 'hermes') && translation.target === 'zh-CN' &&
    typeof translation.text === 'string' && translation.text.trim().length > 0 && translation.text.length <= 2000;
}

export function isDefinition(value: unknown): value is Definition {
  if (typeof value !== 'object' || value === null) return false;
  const definition = value as Record<string, unknown>;
  return typeof definition.word === 'string' &&
    (definition.translation === undefined || isTranslation(definition.translation)) &&
    Array.isArray(definition.phonetics) &&
    Array.isArray(definition.meanings) &&
    definition.meanings.every(meaning =>
      typeof meaning === 'object' && meaning !== null &&
      typeof meaning.partOfSpeech === 'string' &&
      Array.isArray(meaning.definitions) &&
      meaning.definitions.every((item: unknown) =>
        typeof item === 'object' && item !== null &&
        'definition' in item && typeof item.definition === 'string'));
}
