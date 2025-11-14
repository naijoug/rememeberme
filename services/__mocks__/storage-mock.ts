/**
 * Mock storage implementation for testing
 * Simulates browser storage without requiring browser runtime
 */

import type { WordEntry, Definition, HistoryRecord } from '~/types';

class MockStorageService {
  private storage: Map<string, any> = new Map();
  private readonly STORAGE_KEY = 'local:words';

  async getAllWords(): Promise<WordEntry[]> {
    const words = this.storage.get(this.STORAGE_KEY);
    return words || [];
  }

  async getWord(word: string): Promise<WordEntry | null> {
    const normalizedWord = word.trim().toLowerCase();
    const words = await this.getAllWords();
    const foundWord = words.find(w => w.word.toLowerCase() === normalizedWord);
    return foundWord || null;
  }

  async saveWord(
    word: string,
    definition: Definition,
    context: string,
    url: string
  ): Promise<WordEntry> {
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
      updatedWord = {
        word: normalizedWord,
        count: 1,
        history: [historyRecord],
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      words.push(updatedWord);
    } else {
      const existingWord = words[existingWordIndex];
      updatedWord = {
        ...existingWord,
        count: existingWord.count + 1,
        history: [...existingWord.history, historyRecord],
        updatedAt: timestamp,
      };
      words[existingWordIndex] = updatedWord;
    }

    this.storage.set(this.STORAGE_KEY, words);
    return updatedWord;
  }

  async deleteWord(word: string): Promise<void> {
    const normalizedWord = word.trim().toLowerCase();
    const words = await this.getAllWords();
    const filteredWords = words.filter(
      w => w.word.toLowerCase() !== normalizedWord
    );
    this.storage.set(this.STORAGE_KEY, filteredWords);
  }

  async resetCount(word: string): Promise<void> {
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

    this.storage.set(this.STORAGE_KEY, words);
  }

  async exportData(): Promise<string> {
    const words = await this.getAllWords();
    return JSON.stringify(words, null, 2);
  }

  async importData(jsonData: string): Promise<void> {
    let importedWords: WordEntry[];
    
    try {
      importedWords = JSON.parse(jsonData);
    } catch (error) {
      throw new Error('Invalid JSON format');
    }

    if (!Array.isArray(importedWords)) {
      throw new Error('Invalid data format: expected array of word entries');
    }

    const existingWords = await this.getAllWords();
    const wordMap = new Map<string, WordEntry>();

    existingWords.forEach(word => {
      wordMap.set(word.word.toLowerCase(), word);
    });

    importedWords.forEach(importedWord => {
      const normalizedWord = importedWord.word.toLowerCase();
      const existing = wordMap.get(normalizedWord);

      if (existing) {
        const mergedHistory = [...existing.history, ...importedWord.history];
        mergedHistory.sort((a, b) => a.timestamp - b.timestamp);

        wordMap.set(normalizedWord, {
          ...existing,
          count: existing.count + importedWord.count,
          history: mergedHistory,
          updatedAt: Date.now(),
        });
      } else {
        wordMap.set(normalizedWord, {
          ...importedWord,
          word: normalizedWord,
        });
      }
    });

    const mergedWords = Array.from(wordMap.values());
    this.storage.set(this.STORAGE_KEY, mergedWords);
  }

  // Test helper to clear storage
  clear(): void {
    this.storage.clear();
  }
}

export const mockStorageService = new MockStorageService();
