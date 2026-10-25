import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DictionaryService } from './dictionary';
vi.mock('./public-lookup', () => ({ publicLookupClient: { request: vi.fn() } }));

const result = [{ word: 'apple', phonetics: [], meanings: [] }];
const fetchMock = vi.fn<typeof fetch>();
let dictionary: DictionaryService;

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  // These cases exercise only the online fallback, with a local dictionary miss.
  dictionary = new DictionaryService(async () => null);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('dictionary requests (mock network)', () => {
  it('routes misses through the public service without account credentials or direct provider requests', async () => {
    const connection = { origin: 'https://api.example.test', credentials: { userId: 'fixture-a' } };
    const request = vi.fn().mockResolvedValue({ definition: { ...result[0], source: 'dictionary-api' } });
    const backend = { current: async () => connection, request } as unknown as import('./backend-client').BackendClient;
    dictionary = new DictionaryService(async () => null, backend);
    expect((await dictionary.getDefinition(' Apple ')).source).toBe('dictionary-api');
    await dictionary.getDefinition('apple');
    expect(request).toHaveBeenCalledExactlyOnceWith('/api/v1/public/lookup/dictionary', 'POST', { word: 'apple' });
    expect(request).toHaveBeenCalledTimes(1); expect(fetchMock).not.toHaveBeenCalled();
    request.mockRejectedValue(new Error('DICTIONARY_NOT_FOUND'));
    await expect(dictionary.getDefinition('unknown')).rejects.toThrow('DICTIONARY_NOT_FOUND');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retains packaged definitions when connected and bounds a stalled backend without caching late results', async () => {
    const request = vi.fn().mockImplementation(() => new Promise(() => {}));
    const backend = { current: async () => ({ origin: 'https://api.example.test', credentials: { userId: 'fixture' } }), request } as unknown as import('./backend-client').BackendClient;
    const local = { ...result[0], source: 'wordnet' as const };
    dictionary = new DictionaryService(async () => local, backend);
    expect(await dictionary.getDefinition('apple')).toEqual(local); expect(request).not.toHaveBeenCalled();
    dictionary = new DictionaryService(async () => null, backend);
    const assertion = expect(dictionary.getDefinition('apple')).rejects.toThrow(/taking too long/);
    await vi.advanceTimersByTimeAsync(8500); await assertion;
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a local hit without contacting the online provider', async () => {
    const local = { word: 'apple', source: 'wordnet' as const, phonetics: [], meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A fruit.' }] }] };
    const lookup = vi.fn(async () => local);
    dictionary = new DictionaryService(lookup);
    expect(await dictionary.getDefinition('apple')).toEqual(local);
    expect(await dictionary.getDefinition('apple')).toEqual(local);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('recovers a broken local shard via the server and rejects malformed responses without caching', async () => {
    const request = vi.fn().mockResolvedValueOnce({ definition: { word: 'apple' } })
      .mockResolvedValue({ definition: { ...result[0], source: 'dictionary-api' } });
    const backend = { current: async () => ({ origin: 'https://api.example.test', credentials: { userId: 'fixture' } }), request } as unknown as import('./backend-client').BackendClient;
    dictionary = new DictionaryService(async () => { throw new Error('Missing shard'); }, backend);
    await expect(dictionary.getDefinition('apple')).rejects.toThrow(/invalid definition/);
    const [a, b] = await Promise.all([dictionary.getDefinition('apple'), dictionary.getDefinition('APPLE')]);
    expect(a).toEqual(b); expect(request).toHaveBeenCalledTimes(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['', 'two words', '中文'])('rejects invalid selections %s without network requests', async word => {
    await expect(dictionary.getDefinition(word)).rejects.toThrow(/one English word/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
