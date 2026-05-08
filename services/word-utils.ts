export const ENGLISH_WORD_REGEX = /^[a-zA-Z][a-zA-Z'\-]*[a-zA-Z]$|^[a-zA-Z]$/;

export function isEnglishWord(text: string): boolean {
  const trimmed = text.trim();

  if (!trimmed || /\s/.test(trimmed)) {
    return false;
  }

  return ENGLISH_WORD_REGEX.test(trimmed);
}

export function getOrdinal(n: number): string {
  const suffixes = ['th', 'st', 'nd', 'rd'];
  const value = n % 100;
  return n + (suffixes[(value - 20) % 10] || suffixes[value] || suffixes[0]);
}
