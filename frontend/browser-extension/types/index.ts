/**
 * Core type definitions for Vocabulary Counter
 */

/**
 * Position information for popup placement
 */
export interface Position {
  x: number;
  y: number;
  anchorTop?: number;
}

/**
 * Word definition from dictionary API
 */
export interface Definition {
  word: string;
  /** Optional Chinese translation; legacy vocabulary remains compatible. */
  translation?: Translation;
  /** Optional provenance; old vocabulary and backups need no migration. */
  source?: 'wordnet' | 'dictionary-api';
  phonetic?: string;
  phonetics: Array<{
    text?: string;
    audio?: string;
  }>;
  meanings: Array<{
    partOfSpeech: string;
    definitions: Array<{
      definition: string;
      example?: string;
      synonyms?: string[];
      antonyms?: string[];
    }>;
  }>;
}

export interface Translation {
  text: string;
  target: 'zh-CN';
  source: 'mymemory' | 'hermes';
}

/** Independent display data from the packaged IPA dictionary; not vocabulary. */
export interface PhoneticTranscriptions { us?: string; uk?: string }

/**
 * History record for a single word lookup
 */
export interface HistoryRecord {
  timestamp: number;
  context: string;
  url: string;
  definition: Definition;
}

/**
 * Word entry with count and history
 */
export interface WordEntry {
  /** Account lifecycle identity and current definition are presentation metadata. */
  id?: string;
  currentDefinition?: Definition;
  countKnown?: boolean;
  word: string;
  count: number;
  history: HistoryRecord[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Dictionary API response structure
 */
export interface DictionaryResponse {
  word: string;
  phonetic?: string;
  phonetics?: Array<{
    text?: string;
    audio?: string;
  }>;
  meanings: Array<{
    partOfSpeech: string;
    definitions: Array<{
      definition: string;
      example?: string;
      synonyms?: string[];
      antonyms?: string[];
    }>;
  }>;
}

/**
 * Message types for communication between content script and background
 */
export type BackgroundMessage = { type: 'GET_DEFINITION' | 'GET_TRANSLATION' | 'GET_PHONETICS'; word: string };

export type VocabularyMessage =
  | { type: 'GET_WORDS' }
  | { type: 'GET_WORD'; word: string }
  | { type: 'SAVE_WORD'; word: string; definition: Definition; context: string; url: string; timestamp?: number }
  | { type: 'DELETE_WORD'; word: string }
  | { type: 'RESET_COUNT'; word: string }
  | { type: 'IMPORT_DATA'; jsonData: string }
  | { type: 'EXPORT_DATA' };

/**
 * Response types for background messages
 */
export type BackgroundResponse<T = Definition> =
  | { success: true; data: T }
  | { success: false; error: string };
