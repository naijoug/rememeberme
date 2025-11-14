import { createApp, type App as VueApp } from 'vue';
import { contextExtractor } from '~/services/context-extractor';
import { storageService } from '~/services/storage';
import type { Definition, Position } from '~/types';
import SelectionPopup from '../components/SelectionPopup.vue';

// 英文单词验证正则（基本验证：字母、连字符、撇号）
const ENGLISH_WORD_REGEX = /^[a-zA-Z][a-zA-Z'\-]*[a-zA-Z]$|^[a-zA-Z]$/;

// 防抖延迟时间（毫秒）
const DEBOUNCE_DELAY = 300;

let debounceTimer: number | null = null;
let popupContainer: HTMLElement | null = null;
let popupApp: VueApp | null = null;
let popupState = {
  word: '',
  position: { x: 0, y: 0 },
  visible: false,
  definition: undefined as Definition | undefined,
  loading: false,
  error: '',
  context: '',
  selection: null as Selection | null,
};

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    console.log('Vocabulary Counter content script loaded');
    
    // 监听 mouseup 事件检测文本选择
    document.addEventListener('mouseup', handleTextSelection);
    
    // 监听页面点击事件，点击弹窗外区域时关闭
    document.addEventListener('click', handleDocumentClick);
  },
});

/**
 * 处理文本选择事件（带防抖）
 */
function handleTextSelection(event: MouseEvent): void {
  // 清除之前的防抖计时器
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
  }

  // 设置新的防抖计时器
  debounceTimer = window.setTimeout(() => {
    processTextSelection(event);
  }, DEBOUNCE_DELAY);
}

/**
 * 处理文本选择的核心逻辑
 */
async function processTextSelection(event: MouseEvent): Promise<void> {
  const selection = window.getSelection();
  
  if (!selection || selection.rangeCount === 0) {
    return;
  }

  const selectedText = selection.toString().trim();

  // 验证选中文本是否为英文单词
  if (!selectedText || !isEnglishWord(selectedText)) {
    hidePopup();
    return;
  }

  // 计算弹窗位置
  const position = calculatePopupPosition(event, selection);

  // 提取上下文句子
  const contextResult = contextExtractor.extractSentence(selection);

  // 保存选择状态
  popupState.word = selectedText;
  popupState.position = position;
  popupState.context = contextResult.context;
  popupState.selection = selection;

  // 显示弹窗并加载释义
  await showPopup(selectedText, position);
}

/**
 * 显示弹窗并请求单词释义
 */
async function showPopup(word: string, position: Position): Promise<void> {
  // 创建或更新弹窗容器
  if (!popupContainer) {
    popupContainer = document.createElement('div');
    popupContainer.id = 'vocab-counter-popup-root';
    document.body.appendChild(popupContainer);
  }

  // 更新状态：显示加载中
  popupState.visible = true;
  popupState.loading = true;
  popupState.error = '';
  popupState.definition = undefined;

  // 创建或更新 Vue 应用实例
  if (!popupApp) {
    popupApp = createApp(SelectionPopup, {
      ...popupState,
      onRemember: handleRemember,
      onForget: handleForget,
      onClose: hidePopup,
    });
    popupApp.mount(popupContainer);
  } else {
    // 更新 props
    updatePopupProps();
  }

  // 通过消息通信向 background 请求单词释义
  try {
    const definition = await requestDefinition(word);
    popupState.definition = definition;
    popupState.loading = false;
    updatePopupProps();
  } catch (error) {
    popupState.loading = false;
    popupState.error = error instanceof Error ? error.message : 'Failed to load definition';
    updatePopupProps();
  }
}

/**
 * 向 background 请求单词释义
 */
async function requestDefinition(word: string): Promise<Definition> {
  return new Promise((resolve, reject) => {
    browser.runtime.sendMessage(
      { type: 'GET_DEFINITION', word },
      (response: any) => {
        if (browser.runtime.lastError) {
          reject(new Error(browser.runtime.lastError.message));
          return;
        }

        if (!response.success) {
          reject(new Error(response.error || 'Failed to fetch definition'));
          return;
        }

        resolve(response.data);
      }
    );
  });
}

/**
 * 更新弹窗组件的 props
 * Uses requestAnimationFrame to minimize reflows and repaints
 */
function updatePopupProps(): void {
  if (popupApp && popupContainer) {
    // Use requestAnimationFrame to batch DOM updates
    requestAnimationFrame(() => {
      if (popupApp && popupContainer) {
        // 卸载并重新挂载以更新 props
        popupApp.unmount();
        popupApp = createApp(SelectionPopup, {
          ...popupState,
          onRemember: handleRemember,
          onForget: handleForget,
          onClose: hidePopup,
        });
        popupApp.mount(popupContainer);
      }
    });
  }
}

/**
 * 处理 Remember 按钮点击
 */
function handleRemember(): void {
  hidePopup();
}

/**
 * 处理 Forget 按钮点击 - 保存单词
 */
async function handleForget(): Promise<void> {
  if (!popupState.definition) {
    console.error('No definition available to save');
    return;
  }

  try {
    // 调用 storage.saveWord 保存单词、释义、上下文、URL
    const updatedWord = await storageService.saveWord(
      popupState.word,
      popupState.definition,
      popupState.context,
      window.location.href
    );

    // 显示"第 N 次忘记该单词"的提示消息
    showNotification(`This is the ${getOrdinal(updatedWord.count)} time you forgot "${updatedWord.word}"`);

    // 关闭弹窗
    hidePopup();
  } catch (error) {
    console.error('Failed to save word:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to save word';
    popupState.error = errorMessage;
    updatePopupProps();
    
    // Show error notification
    showNotification(`Error: ${errorMessage}`, 'error');
  }
}

/**
 * 显示通知消息
 * @param message - 通知消息内容
 * @param type - 通知类型 ('success' | 'error')
 */
function showNotification(message: string, type: 'success' | 'error' = 'success'): void {
  const notification = document.createElement('div');
  notification.className = 'vocab-counter-notification';
  notification.textContent = message;
  
  const backgroundColor = type === 'error' ? '#d32f2f' : '#323232';
  
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${backgroundColor};
    color: white;
    padding: 12px 20px;
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    z-index: 1000000;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    animation: slideIn 0.3s ease-out;
  `;

  document.body.appendChild(notification);

  // 3 秒后自动移除
  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease-out';
    setTimeout(() => {
      notification.remove();
    }, 300);
  }, 3000);
}

/**
 * 获取序数词（1st, 2nd, 3rd, 4th, etc.）
 */
function getOrdinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/**
 * 验证文本是否为英文单词
 * @param text - 要验证的文本
 * @returns 是否为有效的英文单词
 */
function isEnglishWord(text: string): boolean {
  // 移除首尾空格
  const trimmed = text.trim();
  
  // 检查是否为空或包含空格（多个单词）
  if (!trimmed || /\s/.test(trimmed)) {
    return false;
  }

  // 使用正则验证是否为英文单词
  return ENGLISH_WORD_REGEX.test(trimmed);
}

/**
 * 计算弹窗位置
 * @param event - 鼠标事件
 * @param selection - Selection 对象
 * @returns 弹窗位置坐标
 */
function calculatePopupPosition(event: MouseEvent, selection: Selection): Position {
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();

  // 弹窗显示在选中文本下方，居中对齐
  return {
    x: rect.left + rect.width / 2,
    y: rect.bottom + window.scrollY + 5, // 5px 间距
  };
}

/**
 * 隐藏弹窗
 * Uses requestAnimationFrame to minimize reflows
 */
function hidePopup(): void {
  popupState.visible = false;
  if (popupContainer) {
    requestAnimationFrame(() => {
      if (popupContainer) {
        popupContainer.style.display = 'none';
      }
    });
  }
}

/**
 * 处理文档点击事件 - 点击弹窗外区域时关闭
 */
function handleDocumentClick(event: MouseEvent): void {
  if (!popupState.visible) {
    return;
  }

  // 检查点击是否在弹窗内
  if (popupContainer && !popupContainer.contains(event.target as Node)) {
    hidePopup();
  }
}
