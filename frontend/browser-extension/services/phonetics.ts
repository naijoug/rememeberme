import type { PublicPath } from 'wxt/browser';
import type { InjectionKey } from 'vue';
import type { PhoneticTranscriptions } from '~/types';
import { isEnglishWord } from './word-utils';

type Shard = Record<string, unknown>;
export const phoneticsLookupKey: InjectionKey<(word: string, signal?: AbortSignal) => Promise<PhoneticTranscriptions>> = Symbol('phoneticsLookup');
// Keep in sync with scripts/build-ipa.py; keys are exact ASCII word spellings.
export function ipaShard(word: string): string {
  let hash = 2166136261;
  for (const char of word) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return (hash & 63).toString(16).padStart(2, '0');
}
export function isPhoneticTranscriptions(value: unknown): value is PhoneticTranscriptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return ['us', 'uk'].every(key => entry[key] === undefined ||
    (typeof entry[key] === 'string' && entry[key].trim().length > 0 && entry[key].length <= 2000));
}

export class PhoneticsService {
  private cache = new Map<string, Shard>();
  private pending = new Map<string, Promise<Shard>>();
  constructor(private assetUrl = (path: string) => browser.runtime.getURL(path as PublicPath)) {}

  async getPhonetics(input: string): Promise<PhoneticTranscriptions> {
    const word = input.trim().toLowerCase();
    if (!isEnglishWord(word)) throw new Error('Please select a single English word.');
    const shard = await this.load(ipaShard(word));
    if (!Object.hasOwn(shard, word)) return {};
    const entry = shard[word];
    if (!Array.isArray(entry) || entry.length !== 2 || !entry.every(value => value === null ||
      (typeof value === 'string' && value.trim().length > 0 && value.length <= 2000))) throw new Error('Phonetic data is unavailable.');
    const data = { ...(entry[0] ? { us: entry[0] } : {}), ...(entry[1] ? { uk: entry[1] } : {}) };
    if (!isPhoneticTranscriptions(data)) throw new Error('Phonetic data is unavailable.');
    return data;
  }
  private async load(key: string): Promise<Shard> {
    const cached = this.cache.get(key);
    if (cached) { this.cache.delete(key); this.cache.set(key, cached); return cached; }
    const pending = this.pending.get(key);
    if (pending) return pending;
    const read = this.read(key);
    this.pending.set(key, read);
    try {
      const shard = await read;
      this.cache.set(key, shard);
      if (this.cache.size > 16) this.cache.delete(this.cache.keys().next().value!);
      return shard;
    } finally { this.pending.delete(key); }
  }
  private async read(key: string): Promise<Shard> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('Phonetic data could not be loaded.')); }, 1500);
    });
    try {
      const read = fetch(this.assetUrl(`/dictionary/ipa/${key}.json`), { signal: controller.signal, credentials: 'omit' })
        .then(async response => {
          if (!response.ok) throw new Error('Phonetic data could not be loaded.');
          const data: unknown = await response.json();
          if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Phonetic data is unavailable.');
          return data as Shard;
        });
      return await Promise.race([read, deadline]);
    } finally { clearTimeout(timer); }
  }
}
export const phoneticsService = new PhoneticsService();
