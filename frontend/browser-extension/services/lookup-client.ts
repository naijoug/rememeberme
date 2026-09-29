import type { BackgroundMessage, BackgroundResponse, Definition } from '~/types';

export const LOOKUP_DEADLINE_MS = 10_000;

// A UI deadline also covers a disconnected background with no response.
export function requestDefinition(word: string, signal?: AbortSignal): Promise<Definition> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, definition?: Definition) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(definition!);
    };
    const abort = () => finish(new DOMException('Lookup cancelled', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('The dictionary is taking too long. Please try again.')), LOOKUP_DEADLINE_MS);
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => browser.runtime.sendMessage({ type: 'GET_DEFINITION', word } satisfies BackgroundMessage))
      .then((response: BackgroundResponse | undefined) => {
        if (!response) finish(new Error('The extension is reconnecting. Please try again.'));
        else if (!response.success) finish(new Error(response.error));
        else finish(undefined, response.data);
      }).catch(() => finish(new Error('The extension is reconnecting. Please try again.')));
  });
}
