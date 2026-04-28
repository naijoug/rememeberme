import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Definition, WordEntry } from '~/types';
import {
  CONTEXT_MENU_ID,
  createContextMenu,
  getOrdinal,
  handleContextMenuClick,
  isEnglishWord,
} from './context-menu-handler';

describe('context-menu-handler', () => {
  const definition: Definition = {
    word: 'serendipity',
    phonetics: [],
    meanings: [
      {
        partOfSpeech: 'noun',
        definitions: [{ definition: 'a happy accidental discovery' }],
      },
    ],
  };

  const savedWord: WordEntry = {
    word: 'serendipity',
    count: 2,
    history: [],
    createdAt: 1,
    updatedAt: 2,
  };

  const getDefinition = vi.fn<() => Promise<Definition>>();
  const saveWord = vi.fn<() => Promise<WordEntry>>();
  const sendMessage = vi.fn<(tabId: number, message: unknown) => Promise<any>>();
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  const deps = {
    dictionaryService: { getDefinition },
    storageService: { saveWord },
    tabs: { sendMessage },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('creates the expected browser context menu', () => {
    const create = vi.fn();

    createContextMenu({ create });

    expect(create).toHaveBeenCalledWith({
      id: CONTEXT_MENU_ID,
      title: 'Remember Me',
      contexts: ['selection'],
    });
  });

  it('validates English words consistently', () => {
    expect(isEnglishWord('hello')).toBe(true);
    expect(isEnglishWord("rock'n'roll")).toBe(true);
    expect(isEnglishWord('self-aware')).toBe(true);
    expect(isEnglishWord('two words')).toBe(false);
    expect(isEnglishWord('123')).toBe(false);
    expect(isEnglishWord(' hello ')).toBe(true);
  });

  it('formats ordinals for notifications', () => {
    expect(getOrdinal(1)).toBe('1st');
    expect(getOrdinal(2)).toBe('2nd');
    expect(getOrdinal(3)).toBe('3rd');
    expect(getOrdinal(4)).toBe('4th');
    expect(getOrdinal(11)).toBe('11th');
    expect(getOrdinal(22)).toBe('22nd');
  });

  it('saves a valid selected word and shows a success notification', async () => {
    getDefinition.mockResolvedValue(definition);
    saveWord.mockResolvedValue(savedWord);
    sendMessage
      .mockResolvedValueOnce({ context: 'Words remember you, too.' })
      .mockResolvedValueOnce(undefined);

    await handleContextMenuClick(
      deps,
      {
        menuItemId: CONTEXT_MENU_ID,
        selectionText: 'Serendipity',
        pageUrl: 'https://example.com/article',
      },
      { id: 7 }
    );

    expect(getDefinition).toHaveBeenCalledWith('Serendipity');
    expect(saveWord).toHaveBeenCalledWith(
      'Serendipity',
      definition,
      'Words remember you, too.',
      'https://example.com/article'
    );
    expect(sendMessage).toHaveBeenNthCalledWith(1, 7, { type: 'EXTRACT_CONTEXT' });
    expect(sendMessage).toHaveBeenNthCalledWith(2, 7, {
      type: 'SHOW_NOTIFICATION',
      message: 'This is the 2nd time you forgot "serendipity"',
      notificationType: 'success',
    });
  });

  it('rejects invalid selections before calling external services', async () => {
    sendMessage.mockResolvedValue(undefined);

    await handleContextMenuClick(
      deps,
      {
        menuItemId: CONTEXT_MENU_ID,
        selectionText: 'two words',
      },
      { id: 7 }
    );

    expect(getDefinition).not.toHaveBeenCalled();
    expect(saveWord).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(7, {
      type: 'SHOW_NOTIFICATION',
      message: 'Please select a valid English word',
      notificationType: 'error',
    });
  });

  it('shows an error notification when definition lookup fails', async () => {
    getDefinition.mockRejectedValue(new Error('Definition not found'));
    sendMessage.mockResolvedValue(undefined);

    await handleContextMenuClick(
      deps,
      {
        menuItemId: CONTEXT_MENU_ID,
        selectionText: 'xyzabc',
      },
      { id: 9 }
    );

    expect(saveWord).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(9, {
      type: 'SHOW_NOTIFICATION',
      message: 'Error: Definition not found',
      notificationType: 'error',
    });
  });
});
