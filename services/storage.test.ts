/**
 * Integration tests for Export/Import functionality
 * Tests Requirements: 5.1, 5.2, 5.3, 5.4
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mockStorageService } from '~/services/__mocks__/storage-mock';
import type { Definition } from '~/types';

describe('Storage Service - Export/Import Functionality', () => {
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
    // Clear storage before each test
    mockStorageService.clear();
  });

  it('should export data as valid JSON', async () => {
    // Requirement 5.1, 5.2: Generate JSON file with all WordEntry and HistoryRecord
    const word1 = 'export1';
    const word2 = 'export2';
    const context1 = 'This is the first context.';
    const context2 = 'This is the second context.';
    const url1 = 'https://example.com/page1';
    const url2 = 'https://example.com/page2';

    await mockStorageService.saveWord(word1, mockDefinition, context1, url1);
    await mockStorageService.saveWord(word2, mockDefinition, context2, url2);

    const exportedData = await mockStorageService.exportData();
    
    // Verify it's valid JSON
    expect(() => JSON.parse(exportedData)).not.toThrow();
    
    const parsed = JSON.parse(exportedData);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    
    // Verify exported data structure
    parsed.forEach((word: any) => {
      expect(word.word).toBeDefined();
      expect(word.count).toBeDefined();
      expect(word.history).toBeDefined();
      expect(Array.isArray(word.history)).toBe(true);
      expect(word.createdAt).toBeDefined();
      expect(word.updatedAt).toBeDefined();
      
      // Verify history records
      word.history.forEach((record: any) => {
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
    await mockStorageService.saveWord(existingWord, mockDefinition, 'existing context', 'url1');

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

    await mockStorageService.importData(importData);

    const words = await mockStorageService.getAllWords();
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
    await mockStorageService.saveWord(word, mockDefinition, context1, url1);

    const localWord = await mockStorageService.getWord(word);
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

    await mockStorageService.importData(importData);

    const mergedWord = await mockStorageService.getWord(word);
    
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

    await expect(mockStorageService.importData(invalidJson)).rejects.toThrow('Invalid JSON format');
  });

  it('should handle invalid data format during import', async () => {
    // Test error handling for invalid data structure
    const invalidData = JSON.stringify({ not: 'an array' });

    await expect(mockStorageService.importData(invalidData)).rejects.toThrow('Invalid data format');
  });

  it('should preserve all word data during export-import cycle', async () => {
    // Complete export-import cycle test
    const word1 = 'cycle1';
    const word2 = 'cycle2';

    // Save multiple words with history
    await mockStorageService.saveWord(word1, mockDefinition, 'context1', 'url1');
    await mockStorageService.saveWord(word1, mockDefinition, 'context2', 'url2');
    await mockStorageService.saveWord(word2, mockDefinition, 'context3', 'url3');

    const originalWords = await mockStorageService.getAllWords();
    
    // Export data
    const exportedData = await mockStorageService.exportData();
    
    // Clear storage
    mockStorageService.clear();
    
    let clearedWords = await mockStorageService.getAllWords();
    expect(clearedWords).toHaveLength(0);
    
    // Import data back
    await mockStorageService.importData(exportedData);
    
    const importedWords = await mockStorageService.getAllWords();
    
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
