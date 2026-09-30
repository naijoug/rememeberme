import { describe, expect, it, vi } from 'vitest';
import { lookupForSave } from './bilingual-lookup';

const translation = { text: '精选', target: 'zh-CN' as const, source: 'mymemory' as const };
const definition = { word: 'curated', phonetics: [], meanings: [] };
describe('context-menu bilingual lookup with disposable providers', () => {
  it('can save Chinese translation when the English provider fails', async () => {
    const dictionary = { getDefinition: vi.fn().mockRejectedValue(new Error('English unavailable')) };
    const translator = { translate: vi.fn().mockResolvedValue(translation) };
    expect(await lookupForSave('curated', dictionary, translator)).toEqual({ ...definition, translation });
  });
  it('retains English when Chinese fails and merges both when they succeed', async () => {
    const dictionary = { getDefinition: vi.fn().mockResolvedValue(definition) };
    const translator = { translate: vi.fn().mockRejectedValueOnce(new Error('Quota')).mockResolvedValueOnce(translation) };
    expect(await lookupForSave('curated', dictionary, translator)).toEqual(definition);
    expect(await lookupForSave('curated', dictionary, translator)).toEqual({ ...definition, translation });
  });
  it('fails if neither provider returns usable data', async () => {
    await expect(lookupForSave('curated', { getDefinition: vi.fn().mockRejectedValue(new Error('English failed')) }, { translate: vi.fn().mockRejectedValue(new Error('Chinese failed')) })).rejects.toThrow('Chinese failed English failed');
  });
});
