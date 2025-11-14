/**
 * Integration tests for Popup UI functionality
 * Tests Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mockStorageService } from '~/services/__mocks__/storage-mock';
import type { Definition } from '~/types';

describe('Popup UI - Word List Functionality', () => {
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

  it('should display all saved words', async () => {
    // Requirement 3.2: Display all WordEntry with word text, count, and last saved time
    const word1 = 'apple';
    const word2 = 'banana';

    await mockStorageService.saveWord(word1, mockDefinition, 'context1', 'url1');
    await mockStorageService.saveWord(word2, mockDefinition, 'context2', 'url2');

    const words = await mockStorageService.getAllWords();
    
    expect(words).toHaveLength(2);
    expect(words.find(w => w.word === word1)).toBeDefined();
    expect(words.find(w => w.word === word2)).toBeDefined();
    
    // Verify each word has required fields
    words.forEach(word => {
      expect(word.word).toBeDefined();
      expect(word.count).toBeDefined();
      expect(word.updatedAt).toBeDefined();
      expect(word.history).toBeDefined();
    });
  });

  it('should sort words by count (descending)', async () => {
    // Requirement 3.3: Support sorting by count from high to low
    const word1 = 'frequent';
    const word2 = 'rare';

    // Save word1 three times
    await mockStorageService.saveWord(word1, mockDefinition, 'context1', 'url1');
    await mockStorageService.saveWord(word1, mockDefinition, 'context2', 'url2');
    await mockStorageService.saveWord(word1, mockDefinition, 'context3', 'url3');

    // Save word2 once
    await mockStorageService.saveWord(word2, mockDefinition, 'context4', 'url4');

    const words = await mockStorageService.getAllWords();
    const sortedByCount = [...words].sort((a, b) => b.count - a.count);

    expect(sortedByCount[0].word).toBe(word1);
    expect(sortedByCount[0].count).toBe(3);
    expect(sortedByCount[1].word).toBe(word2);
    expect(sortedByCount[1].count).toBe(1);
  });

  it('should sort words by last updated time', async () => {
    // Requirement 3.4: Support sorting by last saved time
    const word1 = 'old';
    const word2 = 'new';

    // Save word1 first
    await mockStorageService.saveWord(word1, mockDefinition, 'context1', 'url1');
    
    // Wait a bit to ensure different timestamps
    await new Promise(resolve => setTimeout(resolve, 10));
    
    // Save word2 later
    await mockStorageService.saveWord(word2, mockDefinition, 'context2', 'url2');

    const words = await mockStorageService.getAllWords();
    const sortedByTime = [...words].sort((a, b) => b.updatedAt - a.updatedAt);

    expect(sortedByTime[0].word).toBe(word2);
    expect(sortedByTime[1].word).toBe(word1);
    expect(sortedByTime[0].updatedAt).toBeGreaterThan(sortedByTime[1].updatedAt);
  });

  it('should display word history records', async () => {
    // Requirement 3.5, 3.6: Display all HistoryRecord with timestamp, context, URL, definition
    const word = 'history';
    const context1 = 'First context sentence.';
    const context2 = 'Second context sentence.';
    const url1 = 'https://example.com/page1';
    const url2 = 'https://example.com/page2';

    await mockStorageService.saveWord(word, mockDefinition, context1, url1);
    await mockStorageService.saveWord(word, mockDefinition, context2, url2);

    const savedWord = await mockStorageService.getWord(word);
    
    expect(savedWord).toBeDefined();
    expect(savedWord!.history).toHaveLength(2);
    
    // Verify first history record
    const history1 = savedWord!.history[0];
    expect(history1.timestamp).toBeDefined();
    expect(history1.context).toBe(context1);
    expect(history1.url).toBe(url1);
    expect(history1.definition).toBeDefined();
    
    // Verify second history record
    const history2 = savedWord!.history[1];
    expect(history2.timestamp).toBeDefined();
    expect(history2.context).toBe(context2);
    expect(history2.url).toBe(url2);
    expect(history2.definition).toBeDefined();
  });

  it('should delete word from storage', async () => {
    // Requirement 4.1: Remove WordEntry from storage
    const word = 'deleteme';

    await mockStorageService.saveWord(word, mockDefinition, 'context', 'url');
    
    let words = await mockStorageService.getAllWords();
    expect(words.find(w => w.word === word)).toBeDefined();

    await mockStorageService.deleteWord(word);
    
    words = await mockStorageService.getAllWords();
    expect(words.find(w => w.word === word)).toBeUndefined();
  });

  it('should reset word count to 0', async () => {
    // Requirement 4.2: Reset WordEntry count to 0
    const word = 'resetme';

    // Save word multiple times
    await mockStorageService.saveWord(word, mockDefinition, 'context1', 'url1');
    await mockStorageService.saveWord(word, mockDefinition, 'context2', 'url2');
    await mockStorageService.saveWord(word, mockDefinition, 'context3', 'url3');

    let savedWord = await mockStorageService.getWord(word);
    expect(savedWord!.count).toBe(3);

    await mockStorageService.resetCount(word);

    savedWord = await mockStorageService.getWord(word);
    expect(savedWord!.count).toBe(0);
    // History should still be preserved
    expect(savedWord!.history).toHaveLength(3);
  });
});
