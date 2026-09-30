import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OfflineDictionary, wordnetShard } from './offline-dictionary';
import { DictionaryService } from './dictionary';

const fetchMock = vi.fn<typeof fetch>();
let offline: OfflineDictionary;

function servePackagedData() {
  fetchMock.mockImplementation(async input => {
    const path = new URL(String(input)).pathname;
    if (!/^\/dictionary\/wordnet\/[a-f0-9]{2}\.json$/.test(path)) throw new Error('Unexpected external request');
    const body = await readFile(resolve('public' + path), 'utf8');
    return new Response(body, { headers: { 'Content-Type': 'application/json' } });
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  offline = new OfflineDictionary(path => 'chrome-extension://fixture' + path);
  servePackagedData();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('packaged WordNet (real data, no external network)', () => {
  it('ships complete, correctly indexed shards matching the recorded entry count', async () => {
    const metadata = JSON.parse(await readFile(resolve('public/dictionary/wordnet/metadata.json'), 'utf8'));
    let count = 0;
    for (let index = 0; index < 256; index++) {
      const key = index.toString(16).padStart(2, '0');
      const shard = JSON.parse(await readFile(resolve(`public/dictionary/wordnet/${key}.json`), 'utf8'));
      for (const [word, meanings] of Object.entries(shard)) {
        if (wordnetShard(word) !== key || !Array.isArray(meanings) || meanings.length === 0) throw new Error(`Invalid shard entry: ${word}`);
        count++;
      }
    }
    expect(count).toBe(metadata.entries);
    expect(count).toBeGreaterThan(80000);
  });

  it('resolves the reported word from the packaged data without online access', async () => {
    const dictionary = new DictionaryService(word => offline.getDefinition(word));
    const result = await dictionary.getDefinition(' Serendipity ');
    expect(result).toMatchObject({ word: 'serendipity', source: 'wordnet', phonetics: [], meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'good luck in making unexpected and fortunate discoveries' }] }] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/^chrome-extension:\/\/fixture\/dictionary\/wordnet\//);
  });

  it.each(['apple', 'multiple', 'meticulous', 'ephemeral', 'profound', 'aesthetic', 'enigmatic', 'hello'])('loads real definitions for %s', async word => {
    const result = await offline.getDefinition(word);
    expect(result?.source).toBe('wordnet');
    expect(result?.meanings.some(meaning => meaning.definitions.some(sense => sense.definition.length > 0))).toBe(true);
  });

  it.each([['Having', 'have', 'verb'], ['apples', 'apple', 'noun'], ['studies', 'study', 'noun'], ['bravest', 'brave', 'adjective']])('resolves %s to a verified base form', async (word, base, pos) => {
    const dictionary = new DictionaryService(word => offline.getDefinition(word));
    const result = await dictionary.getDefinition(word);
    expect(result).toMatchObject({ word: base, source: 'wordnet' });
    expect(result.meanings.every(meaning => meaning.partOfSpeech === pos)).toBe(true);
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith('chrome-extension://fixture/'))).toBe(true);
  });

  it('does not replace an exact headword with a suffix match', async () => {
    expect((await offline.getDefinition('news'))?.word).toBe('news');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a suffix candidate found only under an unrelated part of speech', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ glorp: [['adjective', [['Synthetic adjective fixture.']]]] })));
    expect(await offline.getDefinition('glorps')).toBeNull();
  });

  it('keeps the whole local lookup bounded when candidate files stall', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(new Response('{}'));
    fetchMock.mockResolvedValue({ ok: true, json: () => new Promise(() => {}) } as Response);
    const assertion = expect(offline.getDefinition('having')).rejects.toThrow('Local dictionary could not be opened');
    await vi.advanceTimersByTimeAsync(1500);
    await assertion;
  });

  it('keeps source sense ordering and separates real examples', async () => {
    const result = await offline.getDefinition('multiple');
    const meaning = result?.meanings.find(item => item.partOfSpeech === 'adjective');
    expect(meaning?.definitions[0].definition).toBe('having or involving or consisting of more than one part or entity or individual');
    expect(meaning?.definitions[0].example).toContain('multiple birth');
  });

  it('coalesces shard loading and returns a miss for absent or invalid words', async () => {
    const [first, second] = await Promise.all([offline.getDefinition('apple'), offline.getDefinition('APPLE')]);
    expect(first).toEqual(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await offline.getDefinition('apple')).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await offline.getDefinition('zznonexistentfixtureword')).toBeNull();
    expect(await offline.getDefinition('../../secret')).toBeNull();
  });

  it('allows a fresh load after a damaged shard is replaced', async () => {
    fetchMock.mockResolvedValueOnce(new Response('not json'));
    await expect(offline.getDefinition('apple')).rejects.toThrow();
    expect((await offline.getDefinition('apple'))?.source).toBe('wordnet');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('bounds stalled local response bodies and can recover', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce({ ok: true, json: () => new Promise(() => {}) } as Response);
    const assertion = expect(offline.getDefinition('apple')).rejects.toThrow('Local dictionary could not be opened');
    await vi.advanceTimersByTimeAsync(1500);
    await assertion;
    vi.useRealTimers();
    expect((await offline.getDefinition('apple'))?.source).toBe('wordnet');
  });
});
