/**
 * Integration tests for Export/Import functionality
 * Tests Requirements: 5.1, 5.2, 5.3, 5.4
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StorageService } from '~/services/storage';
import type { Definition, WordEntry } from '~/types';

const storageApiMock = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  const storage = {
    getItem: vi.fn(async (key: string) => values.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: unknown) => {
      values.set(key, value);
    }),
  };

  return { values, storage };
});

vi.mock('wxt/utils/storage', () => ({
  storage: storageApiMock.storage,
}));

describe('Storage Service - Export/Import Functionality', () => {
  const storageService = new StorageService();
  const mockDefinition: Definition = {
    word: 'test',
    phonetics: [],
    meanings: [
      {
        partOfSpeech: 'noun',
        definitions: [{ definition: 'a procedure to establish quality' }],
      },
    ],
  };

  beforeEach(() => {
    storageApiMock.values.clear();
    vi.clearAllMocks();
  });

  it('should export data as valid JSON', async () => {
    // Requirement 5.1, 5.2: Generate JSON file with all WordEntry and HistoryRecord
    const word1 = 'export1';
    const word2 = 'export2';
    const context1 = 'This is the first context.';
    const context2 = 'This is the second context.';
    const url1 = 'https://example.com/page1';
    const url2 = 'https://example.com/page2';

    await storageService.saveWord(word1, mockDefinition, context1, url1);
    await storageService.saveWord(word2, mockDefinition, context2, url2);

    const exportedData = await storageService.exportData();
    
    // Verify it's valid JSON
    expect(() => JSON.parse(exportedData)).not.toThrow();
    
    const parsed = JSON.parse(exportedData) as WordEntry[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    
    // Verify exported data structure
    parsed.forEach(word => {
      expect(word.word).toBeDefined();
      expect(word.count).toBeDefined();
      expect(word.history).toBeDefined();
      expect(Array.isArray(word.history)).toBe(true);
      expect(word.createdAt).toBeDefined();
      expect(word.updatedAt).toBeDefined();
      
      // Verify history records
      word.history.forEach(record => {
        expect(record.timestamp).toBeDefined();
        expect(record.context).toBeDefined();
        expect(record.url).toBeDefined();
        expect(record.definition).toBeDefined();
      });
    });
  });

  it('should import data and merge with existing words', async () => {
    // Requirement 5.3, 5.4: Import JSON and merge with existing data
    const existingWord = 'existing';
    const newWord = 'imported';

    // Save existing word
    await storageService.saveWord(existingWord, mockDefinition, 'existing context', 'url1');

    // Create import data with new word
    const importData = JSON.stringify([
      {
        word: newWord,
        count: 2,
        history: [
          {
            timestamp: Date.now() - 1000,
            context: 'imported context 1',
            url: 'url2',
            definition: mockDefinition,
          },
          {
            timestamp: Date.now(),
            context: 'imported context 2',
            url: 'url3',
            definition: mockDefinition,
          },
        ],
        createdAt: Date.now() - 2000,
        updatedAt: Date.now(),
      },
    ]);

    await storageService.importData(importData);

    const words = await storageService.getAllWords();
    expect(words).toHaveLength(2);
    
    const importedWordEntry = words.find(w => w.word === newWord);
    expect(importedWordEntry).toBeDefined();
    expect(importedWordEntry!.count).toBe(2);
    expect(importedWordEntry!.history).toHaveLength(2);
  });

  it('should merge duplicate words when importing', async () => {
    // Requirement 5.4: Merge HistoryRecord lists and update total count for duplicate words
    const word = 'duplicate';
    const context1 = 'Original context';
    const context2 = 'Imported context';
    const url1 = 'url1';
    const url2 = 'url2';

    // Save word locally
    await storageService.saveWord(word, mockDefinition, context1, url1);

    const localWord = await storageService.getWord(word);
    expect(localWord!.count).toBe(1);
    expect(localWord!.history).toHaveLength(1);

    // Create import data with same word
    const importData = JSON.stringify([
      {
        word: word,
        count: 2,
        history: [
          {
            timestamp: Date.now() + 1000,
            context: context2,
            url: url2,
            definition: mockDefinition,
          },
          {
            timestamp: Date.now() + 2000,
            context: 'Another imported context',
            url: 'url3',
            definition: mockDefinition,
          },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);

    await storageService.importData(importData);

    const mergedWord = await storageService.getWord(word);
    
    // Count should be sum of both
    expect(mergedWord!.count).toBe(3); // 1 + 2
    
    // History should be merged
    expect(mergedWord!.history).toHaveLength(3); // 1 + 2
    
    // Verify all contexts are present
    const contexts = mergedWord!.history.map(h => h.context);
    expect(contexts).toContain(context1);
    expect(contexts).toContain(context2);
    expect(contexts).toContain('Another imported context');
  });

  it('should handle invalid JSON during import', async () => {
    // Test error handling for invalid JSON
    const invalidJson = 'this is not valid json';

    await expect(storageService.importData(invalidJson)).rejects.toThrow('Invalid JSON format');
  });

  it('should handle invalid data format during import', async () => {
    // Test error handling for invalid data structure
    const invalidData = JSON.stringify({ not: 'an array' });

    await expect(storageService.importData(invalidData)).rejects.toThrow('Invalid data format');
  });

  it('should reject malformed word entries during import', async () => {
    const malformedData = JSON.stringify([
      {
        word: '',
        count: 1,
        history: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);

    await expect(storageService.importData(malformedData)).rejects.toThrow(
      'Invalid data format: invalid word entry at index 0'
    );
  });

  it('should reject malformed history records during import', async () => {
    const malformedData = JSON.stringify([
      {
        word: 'broken',
        count: 1,
        history: [
          {
            timestamp: Date.now(),
            context: 'missing definition',
            url: 'https://example.com',
          },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);

    await expect(storageService.importData(malformedData)).rejects.toThrow(
      'Invalid data format: invalid word entry at index 0'
    );
  });

  it('should preserve all word data during export-import cycle', async () => {
    // Complete export-import cycle test
    const word1 = 'cycle1';
    const word2 = 'cycle2';

    // Save multiple words with history
    await storageService.saveWord(word1, mockDefinition, 'context1', 'url1');
    await storageService.saveWord(word1, mockDefinition, 'context2', 'url2');
    await storageService.saveWord(word2, mockDefinition, 'context3', 'url3');

    const originalWords = await storageService.getAllWords();
    
    // Export data
    const exportedData = await storageService.exportData();
    
    // Clear storage
    storageApiMock.values.clear();
    
    let clearedWords = await storageService.getAllWords();
    expect(clearedWords).toHaveLength(0);
    
    // Import data back
    await storageService.importData(exportedData);
    
    const importedWords = await storageService.getAllWords();
    
    // Verify all data is preserved
    expect(importedWords).toHaveLength(originalWords.length);
    
    originalWords.forEach(originalWord => {
      const importedWord = importedWords.find(w => w.word === originalWord.word);
      expect(importedWord).toBeDefined();
      expect(importedWord!.count).toBe(originalWord.count);
      expect(importedWord!.history).toHaveLength(originalWord.history.length);
    });
  });
});
