import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageService } from './storage';
import type { Definition, WordEntry } from '~/types';

const store = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  return {
    values,
    getItem: vi.fn(async (key: string) => structuredClone(values.get(key) ?? null)),
    setItem: vi.fn(async (key: string, value: unknown) => {
      values.set(key, structuredClone(value));
    }),
  };
});
vi.mock('wxt/utils/storage', () => ({ storage: store }));

const first = new StorageService();
const second = new StorageService();
const definition: Definition = { word: 'apple', phonetics: [], meanings: [] };
const save = (service: StorageService, word: string, context = word) =>
  service.saveWord(word, { ...definition, word }, context, 'https://example.com/fixture');

beforeEach(() => {
  store.values.clear();
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('serialized vocabulary operations (disposable storage)', () => {
  it('retains both words when saves overlap', async () => {
    await Promise.all([save(first, 'apple'), save(second, 'banana')]);
    expect((await first.getAllWords()).map(entry => entry.word)).toEqual(['apple', 'banana']);
  });

  it('retains every increment and context when the same word is saved concurrently', async () => {
    await save(first, 'apple', 'seed');
    await Promise.all([save(first, 'apple', 'first'), save(second, 'apple', 'second')]);
    const entry = await first.getWord('apple');
    expect(entry?.count).toBe(3);
    expect(entry?.history.map(record => record.context)).toEqual(['seed', 'first', 'second']);
  });

  it('orders save, reset, delete, import and subsequent reads without losing unrelated changes', async () => {
    await save(first, 'apple');
    await save(first, 'banana');
    const imported: WordEntry = { word: 'cherry', count: 0, history: [], createdAt: 1, updatedAt: 1 };
    const results = await Promise.all([
      save(first, 'apple', 'before reset'),
      second.resetCount('apple'),
      save(second, 'apple', 'after reset'),
      first.deleteWord('banana'),
      second.importData(JSON.stringify([imported])),
      first.getAllWords(),
    ]);
    const words = results[5];
    expect(words.map(entry => entry.word)).toEqual(['apple', 'cherry']);
    expect(words[0].count).toBe(1);
    expect(words[0].history).toHaveLength(3);
    expect(words[1]).toEqual(imported);
  });

  it('continues after a failed write without saving its in-memory changes', async () => {
    await save(first, 'apple');
    store.setItem.mockRejectedValueOnce(new Error('write failed'));
    const results = await Promise.allSettled([save(first, 'apple', 'failed'), save(second, 'banana')]);
    expect(results.map(result => result.status)).toEqual(['rejected', 'fulfilled']);
    const words = await first.getAllWords();
    expect(words.map(entry => entry.word)).toEqual(['apple', 'banana']);
    expect(words[0].count).toBe(1);
    expect(words[0].history).toHaveLength(1);
  });

  it('continues after rejecting an invalid import and preserves existing vocabulary', async () => {
    await save(first, 'apple');
    const results = await Promise.allSettled([first.importData('{invalid'), save(second, 'banana')]);
    expect(results.map(result => result.status)).toEqual(['rejected', 'fulfilled']);
    expect((await first.getAllWords()).map(entry => entry.word)).toEqual(['apple', 'banana']);
  });
});
