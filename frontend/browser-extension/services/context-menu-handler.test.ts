import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Definition, WordEntry } from '~/types';
import {
  CONTEXT_MENU_ID,
  createContextMenu,
  handleContextMenuClick,
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

  const status = { clear: vi.fn(), show: vi.fn() };

  const deps = {
    dictionaryService: { getDefinition },
    storageService: { saveWord },
    tabs: { sendMessage },
    status,
  };

  beforeEach(() => {
    vi.resetAllMocks();
    sendMessage.mockResolvedValue({ context: 'Words remember you, too.' });
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
      documentUrlPatterns: ['http://*/*', 'https://*/*', 'file:///*'],
    });
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
      'https://example.com/article',
      expect.any(Number)
    );
    expect(sendMessage).toHaveBeenNthCalledWith(1, 7, { type: 'EXTRACT_CONTEXT' }, { frameId: 0 });
    expect(sendMessage).toHaveBeenNthCalledWith(2, 7, {
      type: 'SHOW_NOTIFICATION',
      message: 'This is the 2nd time you forgot "serendipity"',
      notificationType: 'success',
    }, { frameId: 0 });
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
    }, { frameId: 0 });
  });

  it('shows an error notification when definition lookup fails', async () => {
    getDefinition.mockRejectedValue(new Error('Definition not found'));
    sendMessage.mockResolvedValue({ context: '' });

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
    }, { frameId: 0 });
  });

  it('checks the page before lookup and reports a missing receiver through the toolbar', async () => {
    sendMessage.mockRejectedValue(new Error('Could not establish connection. Receiving end does not exist.'));
    await handleContextMenuClick(deps, { menuItemId: CONTEXT_MENU_ID, selectionText: 'apple' }, { id: 7 });
    expect(getDefinition).not.toHaveBeenCalled();
    expect(saveWord).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(status.show).toHaveBeenCalledWith(7, expect.stringContaining('Refresh the webpage'), 'error');
  });

  it('rejects a stale menu click on the extension manager without lookup or injection', async () => {
    const reconnectPage = vi.fn();
    await handleContextMenuClick({ ...deps, reconnectPage }, {
      menuItemId: CONTEXT_MENU_ID, selectionText: 'apple', pageUrl: 'chrome://extensions/',
    }, { id: 7 });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(reconnectPage).not.toHaveBeenCalled();
    expect(getDefinition).not.toHaveBeenCalled();
    expect(saveWord).not.toHaveBeenCalled();
    expect(status.show).toHaveBeenCalledWith(7, expect.stringContaining('extension management pages'), 'error');
  });

  it('reconnects the clicked frame once and saves its captured context and URL', async () => {
    const reconnectPage = vi.fn().mockResolvedValue(undefined);
    sendMessage.mockRejectedValueOnce(new Error('Receiving end does not exist.'))
      .mockResolvedValueOnce({ context: 'The original selected sentence.' })
      .mockResolvedValueOnce({ success: true });
    getDefinition.mockResolvedValue(definition);
    saveWord.mockResolvedValue(savedWord);
    await handleContextMenuClick({ ...deps, reconnectPage }, {
      menuItemId: CONTEXT_MENU_ID, selectionText: 'serendipity', frameId: 3,
      pageUrl: 'https://example.com/parent', frameUrl: 'https://example.com/frame',
    }, { id: 7 });
    expect(reconnectPage).toHaveBeenCalledExactlyOnceWith(7, 3);
    expect(sendMessage).toHaveBeenNthCalledWith(2, 7, { type: 'EXTRACT_CONTEXT' }, { frameId: 3 });
    expect(sendMessage.mock.invocationCallOrder[1]).toBeLessThan(getDefinition.mock.invocationCallOrder[0]);
    expect(saveWord).toHaveBeenCalledExactlyOnceWith('serendipity', definition, 'The original selected sentence.', 'https://example.com/frame', expect.any(Number));
  });

  it('does not query or save when a restricted page cannot be reconnected', async () => {
    sendMessage.mockRejectedValue(new Error('Receiving end does not exist.'));
    const reconnectPage = vi.fn().mockRejectedValue(new Error('Cannot access a chrome:// URL'));
    await handleContextMenuClick({ ...deps, reconnectPage }, { menuItemId: CONTEXT_MENU_ID, selectionText: 'apple' }, { id: 7 });
    expect(reconnectPage).toHaveBeenCalledTimes(1);
    expect(getDefinition).not.toHaveBeenCalled();
    expect(saveWord).not.toHaveBeenCalled();
    expect(status.show).toHaveBeenCalledWith(7, expect.stringContaining('restricted pages'), 'error');
  });

  it('preserves the lookup error if the page disappears before notification', async () => {
    sendMessage.mockResolvedValueOnce({ context: 'A sentence.' })
      .mockRejectedValueOnce(new Error('Receiving end does not exist.'));
    getDefinition.mockRejectedValue(new Error('Dictionary request timed out'));
    await handleContextMenuClick(deps, { menuItemId: CONTEXT_MENU_ID, selectionText: 'apple' }, { id: 7 });
    expect(status.show).toHaveBeenCalledWith(7, 'Error: Dictionary request timed out', 'error');
    expect(saveWord).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });

  it('reports an already completed save as success when page notification fails', async () => {
    sendMessage.mockResolvedValueOnce({ context: 'A sentence.' })
      .mockRejectedValueOnce(new Error('Tab closed'));
    getDefinition.mockResolvedValue(definition);
    saveWord.mockResolvedValue(savedWord);
    await handleContextMenuClick(deps, { menuItemId: CONTEXT_MENU_ID, selectionText: 'serendipity' }, { id: 7 });
    expect(saveWord).toHaveBeenCalledTimes(1);
    expect(status.show).toHaveBeenCalledWith(7, expect.stringContaining('2nd time'), 'success');
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});
