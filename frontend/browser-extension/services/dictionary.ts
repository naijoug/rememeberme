/** Packaged WordNet first; all online definitions go through the built-in service. */
import type { Definition } from '~/types';
import { isDefinition } from './definition-utils';
import { offlineDictionary } from './offline-dictionary';
import { publicLookupClient, type PublicLookupClient } from './public-lookup';
import { isEnglishWord } from './word-utils';

type CacheEntry = { definition: Definition; timestamp: number };
export class DictionaryService {
  private readonly TOTAL_TIMEOUT_MS = 8500;
  private readonly CACHE_DURATION_MS = 24 * 60 * 60 * 1000;
  private cache = new Map<string, CacheEntry>();
  private pending = new Map<string, Promise<Definition>>();
  constructor(private readonly localLookup = (word: string) => offlineDictionary.getDefinition(word),
    private readonly backend: Pick<PublicLookupClient, 'request'> = publicLookupClient) {}

  async getDefinition(input: string): Promise<Definition> {
    const word = input.trim().toLowerCase();
    if (!isEnglishWord(word) || word.length > 500) throw new Error('Select one English word to look up.');
    const key = word;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION_MS) return cached.definition;
    const existing = this.pending.get(key);
    if (existing) return existing;
    const request = this.lookup(word).then(definition => {
      for (const [name, entry] of this.cache) if (Date.now() - entry.timestamp >= this.CACHE_DURATION_MS) this.cache.delete(name);
      this.cache.delete(key); this.cache.set(key, { definition, timestamp: Date.now() });
      while (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value!);
      return definition;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }

  private async lookup(word: string): Promise<Definition> {
    const deadline = Date.now() + this.TOTAL_TIMEOUT_MS;
    try {
      const local = await this.localLookup(word);
      if (local) return local;
    } catch { /* A missing packaged shard can recover through the backend. */ }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.backend.request<{ definition: unknown }>('/api/v1/public/lookup/dictionary', 'POST', { word }).then(reply => {
          if (!isDefinition(reply.definition) || !['dictionary-api', 'wordnet'].includes(reply.definition.source ?? '')) throw new Error('The lookup service returned an invalid definition.');
          return reply.definition;
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('The dictionary is taking too long. Please try again.')), Math.max(0, deadline - Date.now()));
        }),
      ]);
    } finally { clearTimeout(timer); }
  }
}
export const dictionaryService = new DictionaryService();
