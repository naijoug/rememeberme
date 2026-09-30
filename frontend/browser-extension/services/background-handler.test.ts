import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleBackgroundRequest } from './background-handler';

const vocabulary = {
  getAllWords: vi.fn(), saveWord: vi.fn(), deleteWord: vi.fn(),
  resetCount: vi.fn(), importData: vi.fn(), exportData: vi.fn(),
};
beforeEach(() => vi.resetAllMocks());

describe('background requests', () => {
  it('dispatches translation separately from English lookup and returns provider failures', async () => {
    const data = { text: '精选', target: 'zh-CN' as const, source: 'mymemory' as const };
    const translate = vi.fn().mockResolvedValueOnce(data).mockRejectedValueOnce(new Error('Translation quota exhausted.'));
    const dictionary = { getDefinition: vi.fn() };
    expect(await handleBackgroundRequest({ type: 'GET_TRANSLATION', word: 'curated' }, dictionary, vocabulary, { translate })).toEqual({ success: true, data });
    expect(await handleBackgroundRequest({ type: 'GET_TRANSLATION', word: 'curated' }, dictionary, vocabulary, { translate })).toEqual({ success: false, error: 'Translation quota exhausted.' });
    expect(await handleBackgroundRequest({ type: 'GET_TRANSLATION', word: 'two words' }, dictionary, vocabulary, { translate })).toMatchObject({ success: false });
    expect(translate).toHaveBeenCalledTimes(2);
    expect(dictionary.getDefinition).not.toHaveBeenCalled();
    expect(vocabulary.saveWord).not.toHaveBeenCalled();
  });

  it('returns the requested definition', async () => {
    const definition = { word: 'apple', phonetics: [], meanings: [] };
    const getDefinition = vi.fn().mockResolvedValue(definition);
    expect(await handleBackgroundRequest({ type: 'GET_DEFINITION', word: 'apple' }, { getDefinition }, vocabulary))
      .toEqual({ success: true, data: definition });
    expect(getDefinition).toHaveBeenCalledWith('apple');
  });

  it.each(['SAVE_WORD', 'DELETE_WORD', 'RESET_COUNT', 'IMPORT_DATA', 'UNKNOWN'])(
    'rejects incomplete or unsupported %s instead of reporting a successful no-op', async type => {
      const getDefinition = vi.fn();
      expect(await handleBackgroundRequest({ type }, { getDefinition }, vocabulary)).toMatchObject({ success: false });
      expect(getDefinition).not.toHaveBeenCalled();
    }
  );

  it.each([null, {}, { type: 'GET_DEFINITION' }, { type: 'GET_DEFINITION', word: 'two words' }])(
    'rejects invalid input %# without calling the dictionary', async message => {
      const getDefinition = vi.fn();
      expect(await handleBackgroundRequest(message, { getDefinition }, vocabulary)).toMatchObject({ success: false });
      expect(getDefinition).not.toHaveBeenCalled();
    }
  );

  it('returns a dictionary failure to the caller', async () => {
    const getDefinition = vi.fn().mockRejectedValue(new Error('Definition not found'));
    expect(await handleBackgroundRequest({ type: 'GET_DEFINITION', word: 'apple' }, { getDefinition }, vocabulary))
      .toEqual({ success: false, error: 'Definition not found' });
  });

  it.each([
    { type: 'SAVE_WORD', word: 'apple', definition: null, context: '', url: '' },
    { type: 'SAVE_WORD', word: 'apple', definition: { word: 'apple', phonetics: [], meanings: [null] }, context: '', url: '' },
    { type: 'SAVE_WORD', word: 'apple', definition: { word: 'apple', phonetics: [], meanings: [] }, context: 1, url: '' },
    { type: 'DELETE_WORD', word: ' ' },
    { type: 'RESET_COUNT', word: null },
    { type: 'IMPORT_DATA', jsonData: [] },
  ])('rejects malformed vocabulary request %# before accessing storage', async message => {
    expect(await handleBackgroundRequest(message, { getDefinition: vi.fn() }, vocabulary))
      .toMatchObject({ success: false });
    for (const method of Object.values(vocabulary)) expect(method).not.toHaveBeenCalled();
  });

  it('allows deletion of a legacy imported word outside the selection alphabet', async () => {
    expect(await handleBackgroundRequest({ type: 'DELETE_WORD', word: 'legacy word 1' }, { getDefinition: vi.fn() }, vocabulary))
      .toEqual({ success: true, data: null });
    expect(vocabulary.deleteWord).toHaveBeenCalledWith('legacy word 1');
  });
});
