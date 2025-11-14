/**
 * Context Extractor Service
 * 从用户选中的文本中提取完整的上下文句子
 */

const SENTENCE_BOUNDARIES = /[.!?\n]/;
const MAX_CONTEXT_LENGTH = 200;
const CONTEXT_HALF_LENGTH = 100;

export interface ContextResult {
  context: string;
  wordPosition?: {
    start: number;
    end: number;
  };
}

export class ContextExtractor {
  /**
   * 从 Selection 对象提取包含选中单词的完整句子
   * @param selection - 浏览器 Selection 对象
   * @returns 上下文句子和单词位置信息
   */
  extractSentence(selection: Selection): ContextResult {
    if (!selection || selection.rangeCount === 0) {
      return { context: '' };
    }

    const range = selection.getRangeAt(0);
    const selectedText = selection.toString().trim();

    if (!selectedText) {
      return { context: '' };
    }

    try {
      // 获取选中文本所在的文本节点
      const container = range.commonAncestorContainer;
      const textContent = this.getTextContent(container);

      if (!textContent) {
        return { context: '' };
      }

      // 找到选中文本在完整文本中的位置
      const selectionStart = this.findSelectionStart(textContent, selectedText, range);
      
      if (selectionStart === -1) {
        return { context: selectedText };
      }

      const selectionEnd = selectionStart + selectedText.length;

      // 查找句子的起止位置
      const sentenceStart = this.findSentenceStart(textContent, selectionStart);
      const sentenceEnd = this.findSentenceEnd(textContent, selectionEnd);

      // 提取完整句子
      let sentence = textContent.substring(sentenceStart, sentenceEnd).trim();

      // 计算选中单词在句子中的位置
      const wordStartInSentence = selectionStart - sentenceStart;
      const wordEndInSentence = selectionEnd - sentenceStart;

      // 如果句子过长，进行截断
      if (sentence.length > MAX_CONTEXT_LENGTH) {
        const truncated = this.truncateContext(
          sentence,
          wordStartInSentence,
          wordEndInSentence
        );
        return truncated;
      }

      return {
        context: sentence,
        wordPosition: {
          start: wordStartInSentence,
          end: wordEndInSentence,
        },
      };
    } catch (error) {
      console.error('Error extracting context:', error);
      return { context: '' };
    }
  }

  /**
   * 获取节点的文本内容
   */
  private getTextContent(node: Node): string {
    // 如果是文本节点，获取父元素的文本
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentElement;
      return parent ? parent.textContent || '' : node.textContent || '';
    }

    // 如果是元素节点，直接获取文本内容
    if (node.nodeType === Node.ELEMENT_NODE) {
      return node.textContent || '';
    }

    return '';
  }

  /**
   * 在文本中查找选中内容的起始位置
   */
  private findSelectionStart(
    textContent: string,
    selectedText: string,
    range: Range
  ): number {
    // 尝试通过 range 的偏移量计算位置
    try {
      const container = range.startContainer;
      let offset = range.startOffset;

      // 如果是文本节点，需要计算前面兄弟节点的文本长度
      if (container.nodeType === Node.TEXT_NODE) {
        let currentNode = container.previousSibling;
        while (currentNode) {
          if (currentNode.nodeType === Node.TEXT_NODE) {
            offset += currentNode.textContent?.length || 0;
          }
          currentNode = currentNode.previousSibling;
        }
      }

      return offset;
    } catch {
      // 如果失败，使用简单的字符串查找
      return textContent.indexOf(selectedText);
    }
  }

  /**
   * 向前查找句子的开始位置
   * 使用句子边界检测（. ! ? \n）
   */
  private findSentenceStart(text: string, position: number): number {
    // 从选中位置向前查找句子开始
    for (let i = position - 1; i >= 0; i--) {
      const char = text[i];

      // 遇到句子边界符
      if (SENTENCE_BOUNDARIES.test(char)) {
        // 跳过边界符和后续空格
        let start = i + 1;
        while (start < text.length && /\s/.test(text[start])) {
          start++;
        }
        return start;
      }
    }

    // 如果没有找到边界，返回文本开始
    return 0;
  }

  /**
   * 向后查找句子的结束位置
   * 使用句子边界检测（. ! ? \n）
   */
  private findSentenceEnd(text: string, position: number): number {
    // 从选中位置向后查找句子结束
    for (let i = position; i < text.length; i++) {
      const char = text[i];

      // 遇到句子边界符
      if (SENTENCE_BOUNDARIES.test(char)) {
        // 包含边界符
        return i + 1;
      }
    }

    // 如果没有找到边界，返回文本结束
    return text.length;
  }

  /**
   * 当句子超过最大长度时，截取选中单词前后各 100 字符
   */
  private truncateContext(
    sentence: string,
    wordStart: number,
    wordEnd: number
  ): ContextResult {
    const wordLength = wordEnd - wordStart;

    // 计算截取范围
    let contextStart = Math.max(0, wordStart - CONTEXT_HALF_LENGTH);
    let contextEnd = Math.min(sentence.length, wordEnd + CONTEXT_HALF_LENGTH);

    // 如果前面不够 100 字符，尝试从后面多取一些
    if (wordStart < CONTEXT_HALF_LENGTH) {
      const deficit = CONTEXT_HALF_LENGTH - wordStart;
      contextEnd = Math.min(sentence.length, contextEnd + deficit);
    }

    // 如果后面不够 100 字符，尝试从前面多取一些
    if (sentence.length - wordEnd < CONTEXT_HALF_LENGTH) {
      const deficit = CONTEXT_HALF_LENGTH - (sentence.length - wordEnd);
      contextStart = Math.max(0, contextStart - deficit);
    }

    // 提取截断的上下文
    let truncated = sentence.substring(contextStart, contextEnd);

    // 添加省略号
    if (contextStart > 0) {
      truncated = '...' + truncated;
    }
    if (contextEnd < sentence.length) {
      truncated = truncated + '...';
    }

    // 重新计算单词位置
    const newWordStart = wordStart - contextStart + (contextStart > 0 ? 3 : 0);
    const newWordEnd = newWordStart + wordLength;

    return {
      context: truncated,
      wordPosition: {
        start: newWordStart,
        end: newWordEnd,
      },
    };
  }
}

// 导出单例实例
export const contextExtractor = new ContextExtractor();
