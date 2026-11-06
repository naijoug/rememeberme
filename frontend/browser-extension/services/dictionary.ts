/** Approved learner entries, then packaged WordNet; online misses use the built-in service. */
import type { Definition } from '~/types';
import { isDefinition } from './definition-utils';
import { offlineDictionary } from './offline-dictionary';
import { lookupPackagedDefinition } from './learner-dictionary';
import { reviewedDictionary } from './reviewed-lookup';
import { publicLookupClient, type PublicLookupClient } from './public-lookup';
import { isEnglishWord } from './word-utils';
import { SharedLookup } from './shared-lookup';

type CacheEntry = { definition: Definition; timestamp: number };
export class DictionaryService {
  private readonly CACHE_DURATION_MS = 24 * 60 * 60 * 1000;
  private cache = new Map<string, CacheEntry>();
  private pending = new SharedLookup<Definition>(8500, 'The dictionary is taking too long. Please try again.');
  constructor(private readonly localLookup = (word: string) => lookupPackagedDefinition(word, reviewedDictionary, offlineDictionary),
    private readonly backend: Pick<PublicLookupClient, 'request'> = publicLookupClient) {}

  async getDefinition(input: string, signal?: AbortSignal): Promise<Definition> {
    signal?.throwIfAborted();
    const word = input.trim().toLowerCase();
    if (!isEnglishWord(word) || word.length > 500) throw new Error('Select one English word to look up.');
    const key = word;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION_MS) return cached.definition;
    return this.pending.run(key, async requestSignal => {
      const definition = await this.lookup(word, requestSignal);
      requestSignal.throwIfAborted();
      for (const [name, entry] of this.cache) if (Date.now() - entry.timestamp >= this.CACHE_DURATION_MS) this.cache.delete(name);
      this.cache.delete(key); this.cache.set(key, { definition, timestamp: Date.now() });
      while (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value!);
      return definition;
    }, signal);
  }

  private async lookup(word: string, signal: AbortSignal): Promise<Definition> {
    try {
      const local = await this.localLookup(word);
      signal.throwIfAborted();
      if (local) return local;
    } catch { signal.throwIfAborted(); /* Missing packaged shards may recover online. */ }
    const reply = await this.backend.request<{ definition: unknown }>('/api/v1/public/lookup/dictionary', 'POST', { word }, signal);
    signal.throwIfAborted();
    if (!isDefinition(reply.definition) || !['dictionary-api', 'wordnet'].includes(reply.definition.source ?? '')) throw new Error('The lookup service returned an invalid definition.');
    return reply.definition;
  }
}
export const dictionaryService = new DictionaryService();
