import type { BackgroundMessage, BackgroundResponse, Definition, PhoneticTranscriptions, Translation } from '~/types';
import { isPhoneticTranscriptions } from './phonetics';

export const LOOKUP_DEADLINE_MS = 10_000;

// A UI deadline also covers a disconnected background with no response.
export function requestDefinition(word: string, signal?: AbortSignal): Promise<Definition> {
  return request<Definition>('GET_DEFINITION', word, LOOKUP_DEADLINE_MS, signal);
}

export function requestTranslation(word: string, signal?: AbortSignal): Promise<Translation> {
  return request<Translation>('GET_TRANSLATION', word, 22_000, signal);
}

export async function requestPhonetics(word: string, signal?: AbortSignal): Promise<PhoneticTranscriptions> {
  const data = await request<unknown>('GET_PHONETICS', word, 2000, signal);
  if (!isPhoneticTranscriptions(data)) throw new Error('Phonetic data is unavailable.');
  return data;
}

function request<T>(type: BackgroundMessage['type'], word: string, timeout: number, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, definition?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(definition!);
    };
    const abort = () => finish(new DOMException('Lookup cancelled', 'AbortError'));
    const timer = setTimeout(() => finish(new Error(type === 'GET_PHONETICS' ? 'Phonetic data could not be loaded.' : type === 'GET_TRANSLATION' ? 'Chinese translation timed out. Please try again.' : 'The dictionary is taking too long. Please try again.')), timeout);
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => browser.runtime.sendMessage({ type, word } satisfies BackgroundMessage))
      .then((response: BackgroundResponse<T> | undefined) => {
        if (!response) finish(new Error('The extension is reconnecting. Please try again.'));
        else if (!response.success) finish(new Error(response.error));
        else finish(undefined, response.data);
      }).catch(() => finish(new Error('The extension is reconnecting. Please try again.')));
  });
}
