import { describe, expect, it, vi } from 'vitest';
import { handleBackgroundRequest } from './background-handler';

describe('background requests', () => {
  it('returns the requested definition', async () => {
    const definition = { word: 'apple', phonetics: [], meanings: [] };
    const getDefinition = vi.fn().mockResolvedValue(definition);
    expect(await handleBackgroundRequest({ type: 'GET_DEFINITION', word: 'apple' }, { getDefinition }))
      .toEqual({ success: true, data: definition });
    expect(getDefinition).toHaveBeenCalledWith('apple');
  });

  it.each(['SAVE_WORD', 'GET_WORDS', 'DELETE_WORD', 'UNKNOWN'])(
    'rejects unsupported %s instead of reporting a successful no-op', async type => {
      const getDefinition = vi.fn();
      expect(await handleBackgroundRequest({ type }, { getDefinition })).toMatchObject({ success: false });
      expect(getDefinition).not.toHaveBeenCalled();
    }
  );

  it.each([null, {}, { type: 'GET_DEFINITION' }, { type: 'GET_DEFINITION', word: 'two words' }])(
    'rejects invalid input %# without calling the dictionary', async message => {
      const getDefinition = vi.fn();
      expect(await handleBackgroundRequest(message, { getDefinition })).toMatchObject({ success: false });
      expect(getDefinition).not.toHaveBeenCalled();
    }
  );

  it('returns a dictionary failure to the caller', async () => {
    const getDefinition = vi.fn().mockRejectedValue(new Error('Definition not found'));
    expect(await handleBackgroundRequest({ type: 'GET_DEFINITION', word: 'apple' }, { getDefinition }))
      .toEqual({ success: false, error: 'Definition not found' });
  });
});
