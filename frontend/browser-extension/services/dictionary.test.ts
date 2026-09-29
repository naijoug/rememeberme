import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DictionaryService } from './dictionary';

const result = [{ word: 'apple', phonetics: [], meanings: [] }];
const fetchMock = vi.fn<typeof fetch>();
let dictionary: DictionaryService;

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  dictionary = new DictionaryService();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function delayedResponse(delay: number, bodyOnly = false) {
  fetchMock.mockImplementation((_input, options) => {
    const body = new Promise<Response | typeof result>((resolve, reject) => {
      const timer = setTimeout(() => resolve(bodyOnly ? result : new Response(JSON.stringify(result))), delay);
      options?.signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    });
    return bodyOnly
      ? Promise.resolve({ ok: true, json: () => body } as Response)
      : body as Promise<Response>;
  });
}

describe('dictionary requests (mock network)', () => {
  it('accepts a response taking longer than the old three-second timeout', async () => {
    delayedResponse(4500);
    const lookup = dictionary.getDefinition('apple');
    const assertion = expect(lookup).resolves.toMatchObject({ word: 'apple' });
    await vi.advanceTimersByTimeAsync(4500);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shares a lookup between simultaneous selection and context-menu requests', async () => {
    delayedResponse(100);
    const first = dictionary.getDefinition(' Apple ');
    const second = dictionary.getDefinition('apple');
    await vi.advanceTimersByTimeAsync(100);
    expect(await first).toEqual(await second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('times out a stalled response body as well as stalled response headers', async () => {
    delayedResponse(100000, true);
    const assertion = expect(dictionary.getDefinition('apple')).rejects.toThrow(/timed out.*dictionaryapi\.dev/i);
    await vi.advanceTimersByTimeAsync(26000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('reports a network failure clearly and allows a fresh request after failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const assertion = expect(dictionary.getDefinition('apple')).rejects.toThrow(/Cannot reach.*dictionaryapi\.dev/i);
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
    fetchMock.mockResolvedValue(new Response(JSON.stringify(result)));
    expect(await dictionary.getDefinition('apple')).toMatchObject({ word: 'apple' });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it.each([404, 429])('does not retry HTTP %s', async status => {
    fetchMock.mockResolvedValue(new Response('', { status }));
    await expect(dictionary.getDefinition('apple')).rejects.toThrow(status === 404 ? 'Definition not found' : 'Too many requests');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
