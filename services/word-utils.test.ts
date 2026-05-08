import { describe, expect, it } from 'vitest';
import { getOrdinal, isEnglishWord } from './word-utils';

describe('word-utils', () => {
  it('validates single English words consistently', () => {
    expect(isEnglishWord('hello')).toBe(true);
    expect(isEnglishWord("rock'n'roll")).toBe(true);
    expect(isEnglishWord('self-aware')).toBe(true);
    expect(isEnglishWord('two words')).toBe(false);
    expect(isEnglishWord('123')).toBe(false);
    expect(isEnglishWord(' hello ')).toBe(true);
  });

  it('formats ordinals for notification copy', () => {
    expect(getOrdinal(1)).toBe('1st');
    expect(getOrdinal(2)).toBe('2nd');
    expect(getOrdinal(3)).toBe('3rd');
    expect(getOrdinal(4)).toBe('4th');
    expect(getOrdinal(11)).toBe('11th');
    expect(getOrdinal(12)).toBe('12th');
    expect(getOrdinal(13)).toBe('13th');
    expect(getOrdinal(22)).toBe('22nd');
  });
});
