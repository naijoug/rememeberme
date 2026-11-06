import type { Definition, Translation } from '~/types';

export function isTranslation(value: unknown): value is Translation {
  if (typeof value !== 'object' || value === null) return false;
  const translation = value as Record<string, unknown>;
  return (translation.source === 'mymemory' || translation.source === 'hermes' || translation.source === 'magpie') && translation.target === 'zh-CN' &&
    typeof translation.text === 'string' && translation.text.trim().length > 0 && translation.text.length <= 2000;
}

/** Publication metadata is optional; legacy provider identifiers remain valid. */
export function isRememberMeTranslation(value: unknown): value is Translation & { dictionary: NonNullable<Translation['dictionary']> } {
  if (!isTranslation(value) || value.source !== 'magpie') return false;
  const meta = value.dictionary;
  return !!meta && meta.id === 'rememberme-dict' && meta.review === 'ai-assisted-v1'
    && typeof meta.version === 'string' && /^[a-f0-9]{24}$/.test(meta.version)
    && typeof meta.entryHash === 'string' && /^[a-f0-9]{64}$/.test(meta.entryHash);
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
