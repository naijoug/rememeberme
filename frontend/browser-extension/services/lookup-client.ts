import { portLookup } from './lookup-port-client';
import type { BackgroundMessage, Definition, PhoneticTranscriptions, Translation } from '~/types';
import { isPhoneticTranscriptions } from './phonetics';
import { TRANSLATION_UI_TIMEOUT_MS } from '../../../contracts/translation-policy';

export const LOOKUP_DEADLINE_MS = 10_000;

// A UI deadline also covers a disconnected background with no response.
export function requestDefinition(word: string, signal?: AbortSignal): Promise<Definition> {
  return request<Definition>('GET_DEFINITION', word, LOOKUP_DEADLINE_MS, signal);
}

export function requestTranslation(word: string, signal?: AbortSignal): Promise<Translation> {
  return request<Translation>('GET_TRANSLATION', word, TRANSLATION_UI_TIMEOUT_MS, signal);
}

export async function requestPhonetics(word: string, signal?: AbortSignal): Promise<PhoneticTranscriptions> {
  const data = await request<unknown>('GET_PHONETICS', word, 2000, signal);
  if (!isPhoneticTranscriptions(data)) throw new Error('Phonetic data is unavailable.');
  return data;
}

function request<T>(type: BackgroundMessage['type'], word: string, timeout: number, signal?: AbortSignal): Promise<T> {
  return portLookup<T>(type, { word }, timeout, signal);
}
