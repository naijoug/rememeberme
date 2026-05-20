/**
 * Core type definitions for Vocabulary Counter
 */

/**
 * Position information for popup placement
 */
export interface Position {
  x: number;
  y: number;
}

/**
 * Word definition from dictionary API
 */
export interface Definition {
  word: string;
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
export type BackgroundMessage =
  | { type: 'GET_DEFINITION'; word: string }
  | { type: 'SAVE_WORD'; data: { word: string; definition: Definition; context: string; url: string } }
  | { type: 'GET_WORDS' }
  | { type: 'DELETE_WORD'; word: string };

/**
 * Response types for background messages
 */
export type BackgroundResponse =
  | { success: true; data: Definition }
  | { success: true; data: WordEntry[] }
  | { success: true }
  | { success: false; error: string };
