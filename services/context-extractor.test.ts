/**
 * Integration tests for Context Extraction functionality
 * Tests Requirements: 6.1, 6.2, 6.3, 6.5
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ContextExtractor } from '~/services/context-extractor';

describe('Context Extractor - Sentence Extraction', () => {
  let extractor: ContextExtractor;

  beforeEach(() => {
    extractor = new ContextExtractor();
  });

  it('should extract complete sentence with word boundaries', () => {
    // Requirement 6.1, 6.2: Extract complete sentence using boundary detection
    const text = 'This is the first sentence. This is the second sentence. This is the third sentence.';
    const selectedWord = 'second';
    
    // Create a mock selection
    const mockSelection = createMockSelection(text, selectedWord);
    
    const result = extractor.extractSentence(mockSelection);
    
    expect(result.context).toBe('This is the second sentence.');
    expect(result.wordPosition).toBeDefined();
  });

  it('should handle different sentence boundaries', () => {
    // Requirement 6.2: Use sentence boundary detection (. ! ? \n)
    const testCases = [
      {
        text: 'First sentence! Second sentence? Third sentence.',
        word: 'Second',
        expected: 'Second sentence?',
      },
      {
        text: 'Question here? Answer here. Statement here!',
        word: 'Answer',
        expected: 'Answer here.',
      },
      {
        text: 'Line one.\nLine two.\nLine three.',
        word: 'two',
        expected: 'Line two.',
      },
    ];

    testCases.forEach(({ text, word, expected }) => {
      const mockSelection = createMockSelection(text, word);
      const result = extractor.extractSentence(mockSelection);
      expect(result.context).toBe(expected);
    });
  });

  it('should truncate long sentences to 200 characters', () => {
    // Requirement 6.3: Truncate sentences over 200 characters
    const longSentence = 'This is a very long sentence that contains many words and will definitely exceed the maximum context length of two hundred characters which is the limit we have set for context extraction in order to keep the display manageable and readable for users who are learning vocabulary.';
    const selectedWord = 'limit';
    
    const mockSelection = createMockSelection(longSentence, selectedWord);
    const result = extractor.extractSentence(mockSelection);
    
    // Should be truncated
    expect(result.context.length).toBeLessThanOrEqual(215); // 200 + "..." on both sides + some buffer
    expect(result.context).toContain('limit');
    expect(result.context).toContain('...');
  });

  it('should extract 100 characters before and after selected word in long sentences', () => {
    // Requirement 6.3: Extract 100 chars before and after the word
    const prefix = 'A'.repeat(150); // 150 chars before
    const word = 'TARGET';
    const suffix = 'B'.repeat(150); // 150 chars after
    const longText = `${prefix} ${word} ${suffix}`;
    
    const mockSelection = createMockSelection(longText, word);
    const result = extractor.extractSentence(mockSelection);
    
    // Should contain the word
    expect(result.context).toContain(word);
    
    // Should be truncated with ellipsis
    expect(result.context).toContain('...');
    
    // Should be approximately 200 chars + ellipsis
    expect(result.context.length).toBeLessThanOrEqual(215);
  });

  it('should handle edge case when word is at start of text', () => {
    // Test boundary case
    const text = 'Beginning is important. Middle is here. End is there.';
    const selectedWord = 'Beginning';
    
    const mockSelection = createMockSelection(text, selectedWord);
    const result = extractor.extractSentence(mockSelection);
    
    expect(result.context).toBe('Beginning is important.');
  });

  it('should handle edge case when word is at end of text', () => {
    // Test boundary case
    const text = 'Start is here. Middle is there. This is the end';
    const selectedWord = 'end';
    
    const mockSelection = createMockSelection(text, selectedWord);
    const result = extractor.extractSentence(mockSelection);
    
    expect(result.context).toBe('This is the end');
  });

  it('should return empty string when selection is invalid', () => {
    // Requirement 6.5: Return empty string when unable to extract sentence
    const emptySelection = {
      rangeCount: 0,
      toString: () => '',
      getRangeAt: () => {
        throw new Error('No range');
      },
    } as unknown as Selection;
    
    const result = extractor.extractSentence(emptySelection);
    
    expect(result.context).toBe('');
  });

  it('should handle special characters and punctuation', () => {
    // Test special characters
    const text = 'Dr. Smith said, "Hello!" Mr. Jones replied, "Hi there."';
    const selectedWord = 'Jones';
    
    const mockSelection = createMockSelection(text, selectedWord);
    const result = extractor.extractSentence(mockSelection);
    
    // Should extract the sentence containing the word
    expect(result.context).toContain('Jones');
  });

  it('should preserve word position in extracted context', () => {
    // Verify word position tracking
    const text = 'The quick brown fox jumps over the lazy dog.';
    const selectedWord = 'fox';
    
    const mockSelection = createMockSelection(text, selectedWord);
    const result = extractor.extractSentence(mockSelection);
    
    expect(result.wordPosition).toBeDefined();
    
    if (result.wordPosition) {
      const extractedWord = result.context.substring(
        result.wordPosition.start,
        result.wordPosition.end
      );
      expect(extractedWord).toBe(selectedWord);
    }
  });

  it('should handle multiple spaces and whitespace', () => {
    // Test whitespace handling
    const text = 'First   sentence.    Second    sentence.     Third sentence.';
    const selectedWord = 'Second';
    
    const mockSelection = createMockSelection(text, selectedWord);
    const result = extractor.extractSentence(mockSelection);
    
    expect(result.context).toContain('Second');
  });
});

/**
 * Helper function to create a mock Selection object for testing
 */
function createMockSelection(fullText: string, selectedWord: string): Selection {
  const startIndex = fullText.indexOf(selectedWord);
  const endIndex = startIndex + selectedWord.length;

  // Create a mock text node
  const textNode = {
    nodeType: Node.TEXT_NODE,
    textContent: fullText,
    parentElement: {
      textContent: fullText,
    },
    previousSibling: null,
  } as unknown as Node;

  // Create a mock range
  const mockRange = {
    commonAncestorContainer: textNode,
    startContainer: textNode,
    startOffset: startIndex,
    endOffset: endIndex,
  } as unknown as Range;

  // Create a mock selection
  const mockSelection = {
    rangeCount: 1,
    toString: () => selectedWord,
    getRangeAt: (index: number) => {
      if (index === 0) return mockRange;
      throw new Error('Invalid range index');
    },
  } as unknown as Selection;

  return mockSelection;
}
