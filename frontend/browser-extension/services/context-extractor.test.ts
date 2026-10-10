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

  it('captures the full sentence when the word is nested in a link and emphasis', () => {
    const p = document.createElement('p');
    p.innerHTML = 'First sentence.\n  We study <a href="#"><strong>architecture</strong></a> in this course.';
    const node = p.querySelector('strong')!.firstChild!;
    const range = document.createRange(); range.selectNodeContents(node);
    const selection = { rangeCount: 1, getRangeAt: () => range, toString: () => range.toString() } as unknown as Selection;
    const result = extractor.extractSentence(selection);
    expect(result.context).toBe('We study architecture in this course.');
    expect(result.context.slice(result.wordPosition!.start, result.wordPosition!.end)).toBe('architecture');
  });

  it('locates the selected occurrence after inline siblings and repeated words', () => {
    const p = document.createElement('p');
    p.innerHTML = '<b>Architecture</b> changed. The <em>new</em> <span>architecture</span> works well.';
    const range = document.createRange(); range.selectNodeContents(p.querySelector('span')!);
    const selection = { rangeCount: 1, getRangeAt: () => range, toString: () => range.toString() } as unknown as Selection;
    expect(extractor.extractSentence(selection).context).toBe('The new architecture works well.');
  });

  it('preserves a word split across inline elements and its exact position', () => {
    const p = document.createElement('p'); p.innerHTML = 'Learn <b>archi</b><em>tecture</em> today.';
    const range = document.createRange(); range.setStart(p.querySelector('b')!.firstChild!, 0); range.setEnd(p.querySelector('em')!.firstChild!, 7);
    const selection = { rangeCount: 1, getRangeAt: () => range, toString: () => range.toString() } as unknown as Selection;
    const result = extractor.extractSentence(selection);
    expect(result.context).toBe('Learn architecture today.');
    expect(result.context.slice(result.wordPosition!.start, result.wordPosition!.end)).toBe('architecture');
  });

  it('keeps a full code line containing a URL rather than splitting at its dots', () => {
    const pre = document.createElement('pre'); pre.innerHTML = 'RSS endpoint:\nhttps://example.com/api/<code>curated</code>.xml\nNext line';
    const range = document.createRange(); range.selectNodeContents(pre.querySelector('code')!);
    const selection = { rangeCount: 1, getRangeAt: () => range, toString: () => range.toString() } as unknown as Selection;
    expect(extractor.extractSentence(selection).context).toBe('https://example.com/api/curated.xml');
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

  it('keeps complete sentences longer than the old 200-character limit', () => {
    // The record should preserve ordinary full sentences, including long ones.
    const longSentence = 'This is a very long sentence that contains many words and will definitely exceed the maximum context length of two hundred characters which is the limit we have set for context extraction in order to keep the display manageable and readable for users who are learning vocabulary.';
    const selectedWord = 'limit';
    
    const mockSelection = createMockSelection(longSentence, selectedWord);
    const result = extractor.extractSentence(mockSelection);
    
    expect(result.context).toBe(longSentence);
    expect(result.context).toContain('limit');
    expect(result.context).not.toContain('...');
  });

  it('should extract a bounded window around the selected word in very long sentences', () => {
    const prefix = 'A'.repeat(750);
    const word = 'TARGET';
    const suffix = 'B'.repeat(750);
    const longText = `${prefix} ${word} ${suffix}`;
    
    const mockSelection = createMockSelection(longText, word);
    const result = extractor.extractSentence(mockSelection);
    
    // Should contain the word
    expect(result.context).toContain(word);
    
    // Should be truncated with ellipsis
    expect(result.context).toContain('...');
    
    // A pathological sentence is bounded to 1000 characters plus ellipses.
    expect(result.context.length).toBeLessThanOrEqual(1006);
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

  const paragraph = document.createElement('p');
  paragraph.textContent = fullText;
  const mockRange = document.createRange();
  mockRange.setStart(paragraph.firstChild!, startIndex);
  mockRange.setEnd(paragraph.firstChild!, endIndex);

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
