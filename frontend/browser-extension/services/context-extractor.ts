const SENTENCE_BOUNDARIES = /[.!?。！？\n]/;
const MAX_CONTEXT_LENGTH = 1000;
const BLOCK_TAGS = new Set(['P', 'LI', 'BLOCKQUOTE', 'PRE', 'TD', 'TH', 'FIGCAPTION', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'DIV', 'SECTION', 'ARTICLE', 'BODY']);

export interface ContextResult {
  context: string;
  wordPosition?: { start: number; end: number };
}

export class ContextExtractor {
  extractSentence(selection: Selection): ContextResult {
    if (!selection?.rangeCount || !selection.toString().trim()) return { context: '' };
    try {
      const range = selection.getRangeAt(0);
      let container = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? range.commonAncestorContainer as Element : range.commonAncestorContainer.parentElement;
      if (!container) return { context: selection.toString().trim() };
      // Inline links/emphasis/spans are not sentence boundaries.
      while (container.parentElement && !BLOCK_TAGS.has(container.tagName)) container = container.parentElement;
      const prefix = range.cloneRange();
      prefix.selectNodeContents(container);
      prefix.setEnd(range.startContainer, range.startOffset);
      const preserveLines = container.tagName === 'PRE';
      const boundaries = preserveLines ? /\n/ : SENTENCE_BOUNDARIES;
      const normalize = (text: string) => preserveLines ? text : text.replace(/\s+/g, ' ');
      const selected = range.toString();
      const word = selected.trim();
      const leadingSelection = selected.match(/^\s*/)?.[0] ?? '';
      const text = normalize(container.textContent ?? '');
      const start = normalize(prefix.toString() + leadingSelection).length;
      const end = start + word.length;
      let sentenceStart = start;
      while (sentenceStart > 0 && !boundaries.test(text[sentenceStart - 1])) sentenceStart--;
      let sentenceEnd = end;
      while (sentenceEnd < text.length && !boundaries.test(text[sentenceEnd])) sentenceEnd++;
      if (sentenceEnd < text.length) sentenceEnd++;
      const raw = text.slice(sentenceStart, sentenceEnd);
      const leading = raw.length - raw.trimStart().length;
      const sentence = raw.trim();
      const wordStart = start - sentenceStart - leading;
      const wordEnd = wordStart + word.length;
      if (sentence.length <= MAX_CONTEXT_LENGTH) return { context: sentence, wordPosition: { start: wordStart, end: wordEnd } };
      // Keep ordinary sentences whole; bound pathological paragraphs around the
      // selected occurrence without confusing it with an earlier repeated word.
      const limit = Math.max(MAX_CONTEXT_LENGTH, word.length);
      const from = Math.max(0, Math.min(wordStart - Math.floor((limit - word.length) / 2), sentence.length - limit));
      const to = Math.min(sentence.length, from + limit);
      const before = from > 0 ? '...' : '';
      return {
        context: before + sentence.slice(from, to) + (to < sentence.length ? '...' : ''),
        wordPosition: { start: wordStart - from + before.length, end: wordEnd - from + before.length },
      };
    } catch {
      return { context: selection.toString().trim() };
    }
  }
}

export const contextExtractor = new ContextExtractor();
