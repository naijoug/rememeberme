/**
 * Storage Service
 * Handles persistent storage of word entries using WXT storage API
 */

import { storage } from 'wxt/utils/storage';
import type { WordEntry, Definition, HistoryRecord } from '~/types';

export class StorageService {
  private readonly STORAGE_KEY = 'local:words';

  /**
   * Get all word entries from storage
   * @returns Promise with array of WordEntry objects
   */
  async getAllWords(): Promise<WordEntry[]> {
    try {
      const words = await storage.getItem<WordEntry[]>(this.STORAGE_KEY);
      return words || [];
    } catch (error) {
      console.error('Storage read error:', error);
      this.handleStorageError(error);
      throw new Error('Failed to load words from storage');
    }
  }

  /**
   * Get a single word entry by word text
   * @param word - The word to look up
   * @returns Promise with WordEntry or null if not found
   */
  async getWord(word: string): Promise<WordEntry | null> {
    try {
      const normalizedWord = word.trim().toLowerCase();
      const words = await this.getAllWords();
      const foundWord = words.find(w => w.word.toLowerCase() === normalizedWord);
      return foundWord || null;
    } catch (error) {
      console.error('Storage read error:', error);
      this.handleStorageError(error);
      throw new Error('Failed to load word from storage');
    }
  }

  /**
   * Save or update a word entry
   * Creates new entry if word doesn't exist, otherwise increments count and adds history
   * @param word - The word text
   * @param definition - The word definition
   * @param context - The context sentence
   * @param url - The page URL where word was found
   * @returns Promise with the updated WordEntry
   */
  async saveWord(
    word: string,
    definition: Definition,
    context: string,
    url: string
  ): Promise<WordEntry> {
    try {
      const normalizedWord = word.trim().toLowerCase();
      const words = await this.getAllWords();
      const existingWordIndex = words.findIndex(
        w => w.word.toLowerCase() === normalizedWord
      );

      const timestamp = Date.now();
      const historyRecord: HistoryRecord = {
        timestamp,
        context,
        url,
        definition,
      };

      let updatedWord: WordEntry;

      if (existingWordIndex === -1) {
        // Create new word entry
        updatedWord = {
          word: normalizedWord,
          count: 1,
          history: [historyRecord],
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        words.push(updatedWord);
      } else {
        // Update existing word entry
        const existingWord = words[existingWordIndex];
        updatedWord = {
          ...existingWord,
          count: existingWord.count + 1,
          history: [...existingWord.history, historyRecord],
          updatedAt: timestamp,
        };
        words[existingWordIndex] = updatedWord;
      }

      await storage.setItem(this.STORAGE_KEY, words);
      return updatedWord;
    } catch (error) {
      console.error('Storage write error:', error);
      this.handleStorageError(error);
      throw new Error('Failed to save word to storage');
    }
  }

  /**
   * Delete a word entry from storage
   * @param word - The word to delete
   * @returns Promise that resolves when deletion is complete
   */
  async deleteWord(word: string): Promise<void> {
    try {
      const normalizedWord = word.trim().toLowerCase();
      const words = await this.getAllWords();
      const filteredWords = words.filter(
        w => w.word.toLowerCase() !== normalizedWord
      );

      await storage.setItem(this.STORAGE_KEY, filteredWords);
    } catch (error) {
      console.error('Storage write error:', error);
      this.handleStorageError(error);
      throw new Error('Failed to delete word from storage');
    }
  }

  /**
   * Reset the count of a word entry to 0
   * @param word - The word to reset
   * @returns Promise that resolves when reset is complete
   */
  async resetCount(word: string): Promise<void> {
    try {
      const normalizedWord = word.trim().toLowerCase();
      const words = await this.getAllWords();
      const wordIndex = words.findIndex(
        w => w.word.toLowerCase() === normalizedWord
      );

      if (wordIndex === -1) {
        throw new Error('Word not found');
      }

      words[wordIndex] = {
        ...words[wordIndex],
        count: 0,
        updatedAt: Date.now(),
      };

      await storage.setItem(this.STORAGE_KEY, words);
    } catch (error) {
      console.error('Storage write error:', error);
      this.handleStorageError(error);
      throw new Error('Failed to reset word count');
    }
  }

  /**
   * Export all word entries as JSON string
   * @returns Promise with JSON string containing all word data
   */
  async exportData(): Promise<string> {
    try {
      const words = await this.getAllWords();
      return JSON.stringify(words, null, 2);
    } catch (error) {
      console.error('Failed to export data:', error);
      throw new Error('Failed to export data');
    }
  }

  /**
   * Import word entries from JSON string and merge with existing data
   * Merges history arrays and updates counts for duplicate words
   * @param jsonData - JSON string containing word entries
   * @returns Promise that resolves when import is complete
   */
  async importData(jsonData: string): Promise<void> {
    try {
      const importedWords: WordEntry[] = JSON.parse(jsonData);

      if (!Array.isArray(importedWords)) {
        throw new Error('Invalid data format: expected array of word entries');
      }

      const existingWords = await this.getAllWords();
      const wordMap = new Map<string, WordEntry>();

      // Add existing words to map
      existingWords.forEach(word => {
        wordMap.set(word.word.toLowerCase(), word);
      });

      // Merge imported words
      importedWords.forEach(importedWord => {
        const normalizedWord = importedWord.word.toLowerCase();
        const existing = wordMap.get(normalizedWord);

        if (existing) {
          // Merge history and update count
          const mergedHistory = [...existing.history, ...importedWord.history];
          // Sort history by timestamp
          mergedHistory.sort((a, b) => a.timestamp - b.timestamp);

          wordMap.set(normalizedWord, {
            ...existing,
            count: existing.count + importedWord.count,
            history: mergedHistory,
            updatedAt: Date.now(),
          });
        } else {
          // Add new word
          wordMap.set(normalizedWord, {
            ...importedWord,
            word: normalizedWord,
          });
        }
      });

      const mergedWords = Array.from(wordMap.values());
      await storage.setItem(this.STORAGE_KEY, mergedWords);
    } catch (error) {
      console.error('Storage import error:', error);
      if (error instanceof SyntaxError) {
        throw new Error('Invalid JSON format');
      }
      this.handleStorageError(error);
      throw new Error('Failed to import data');
    }
  }

  /**
   * Handle storage errors with specific error messages
   * @param error - The error object
   */
  private handleStorageError(error: unknown): void {
    if (error instanceof Error) {
      // Check for quota exceeded error
      if (error.name === 'QuotaExceededError' || 
          error.message.includes('quota') || 
          error.message.includes('storage')) {
        console.error('Storage quota exceeded. Please export your data and clear some words.');
      }
      // Check for read/write errors
      else if (error.message.includes('read') || error.message.includes('write')) {
        console.error('Storage read/write error. Please try again.');
      }
      // Generic storage error
      else {
        console.error('Storage error:', error.message);
      }
    }
  }
}

// Export singleton instance
export const storageService = new StorageService();
