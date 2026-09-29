import type { Definition } from '~/types';

export function isDefinition(value: unknown): value is Definition {
  if (typeof value !== 'object' || value === null) return false;
  const definition = value as Record<string, unknown>;
  return typeof definition.word === 'string' &&
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
