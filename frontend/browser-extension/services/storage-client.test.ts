import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { storageClient } from './storage-client';
import { storageService } from './storage';
import { handleBackgroundRequest } from './background-handler';
import { CONTEXT_MENU_ID, handleContextMenuClick } from './context-menu-handler';
import type { Definition } from '~/types';

const store = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  return {
    values,
    getItem: vi.fn(async (key: string) => structuredClone(values.get(key) ?? null)),
    setItem: vi.fn(async (key: string, value: unknown) => { values.set(key, structuredClone(value)); }),
  };
});
vi.mock('wxt/utils/storage', () => ({ storage: store }));

const definition: Definition = { word: 'apple', phonetics: [], meanings: [] };
const dictionary = { getDefinition: vi.fn(async () => definition) };
const sendMessage = vi.fn((message: unknown) => handleBackgroundRequest(message, dictionary, storageService));
const save = (word: string, context = word) =>
  storageClient.saveWord(word, { ...definition, word }, context, 'https://example.com/fixture');

beforeEach(() => {
  vi.clearAllMocks();
  store.values.clear();
  vi.stubGlobal('browser', { runtime: { sendMessage } });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('vocabulary client through the background handler (mock transport/storage)', () => {
  it('persists one count and distinct sentence/time/URL per click and retains records after reset', async () => {
    const word = 'architecture';
    const meaning = { ...definition, word };
    await Promise.all([
      storageClient.saveWord(word, meaning, 'Architecture shapes this city.', 'https://example.com/first?q=1', 1000),
      storageClient.saveWord(word, meaning, 'We study architecture here.', 'https://example.com/second#section', 2000),
    ]);
    const saved = await storageClient.getWord(' Architecture ');
    expect(saved?.count).toBe(2);
    expect(saved?.history.map(({ context, timestamp, url }) => ({ context, timestamp, url }))).toEqual([
      { context: 'Architecture shapes this city.', timestamp: 1000, url: 'https://example.com/first?q=1' },
      { context: 'We study architecture here.', timestamp: 2000, url: 'https://example.com/second#section' },
    ]);
    expect(sendMessage).toHaveBeenCalledWith({ type: 'GET_WORD', word: ' Architecture ' });
    await storageClient.resetCount(word);
    const afterReset = await storageClient.saveWord(word, meaning, 'Architecture again.', '', 3000);
    expect(afterReset.count).toBe(1);
    expect(afterReset.history).toHaveLength(3);
    expect(afterReset.history[2]).toMatchObject({ context: 'Architecture again.', timestamp: 3000, url: '' });
    const backup = await storageClient.exportData();
    store.values.clear();
    await storageClient.importData(backup);
    expect(await storageClient.getWord(word)).toEqual(afterReset);
  });

  it('shares one queue across page requests, popup import and direct context-menu saves', async () => {
    await save('apple', 'seed');
    await Promise.all([
      save('apple', 'page one'),
      save('banana', 'page two'),
      storageClient.importData(JSON.stringify([
        { word: 'cherry', count: 0, history: [], createdAt: 1, updatedAt: 1 },
      ])),
      handleContextMenuClick({
        dictionaryService: dictionary, storageService,
        status: { clear: vi.fn(), show: vi.fn() },
        tabs: { sendMessage: vi.fn(async (_tab, message: any) =>
          message.type === 'EXTRACT_CONTEXT' ? { context: 'context menu' } : {}) },
      }, { menuItemId: CONTEXT_MENU_ID, selectionText: 'apple', pageUrl: 'https://example.com/menu' }, { id: 1 }),
    ]);
    const words = await storageClient.getAllWords();
    expect(words.map(entry => entry.word)).toEqual(['apple', 'banana', 'cherry']);
    expect(words[0].count).toBe(3);
    expect(words[0].history.map(record => record.context)).toEqual(['seed', 'page one', 'context menu']);
    await storageClient.resetCount('apple');
    await storageClient.deleteWord('banana');
    const backup = JSON.parse(await storageClient.exportData());
    expect(backup.map((entry: { word: string }) => entry.word)).toEqual(['apple', 'cherry']);
    expect(backup[0].count).toBe(0);
    expect(backup[0].history).toHaveLength(3);
  });

  it('acknowledges a save only after persistence completes', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    store.setItem.mockImplementationOnce(async (key, value) => {
      await gate;
      store.values.set(key, structuredClone(value));
    });
    const acknowledged = vi.fn();
    const saving = save('apple').then(acknowledged);
    await vi.waitFor(() => expect(store.setItem).toHaveBeenCalled());
    expect(acknowledged).not.toHaveBeenCalled();
    release();
    await saving;
    expect(acknowledged).toHaveBeenCalledWith(expect.objectContaining({ word: 'apple', count: 1 }));
  });

  it('returns write and import failures without blocking later requests', async () => {
    store.setItem.mockRejectedValueOnce(new Error('write failed'));
    await expect(save('apple')).rejects.toThrow('Failed to save word to storage');
    await expect(storageClient.importData('{broken')).rejects.toThrow('Invalid JSON format');
    await save('banana');
    expect((await storageClient.getAllWords()).map(entry => entry.word)).toEqual(['banana']);
  });

  it('does not fall back to local writes or retry when the background is unreachable', async () => {
    sendMessage.mockRejectedValueOnce(new Error('message port closed'));
    await expect(save('apple')).rejects.toThrow('message port closed');
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(store.setItem).not.toHaveBeenCalled();
  });
});
