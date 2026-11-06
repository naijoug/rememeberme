import type { Translation } from '~/types';
import { isEnglishWord } from './word-utils';
import { publicLookupClient, type PublicLookupClient } from './public-lookup';
import { isTranslation } from './definition-utils';
import { SharedLookup } from './shared-lookup';
import { TRANSLATION_SERVICE_TIMEOUT_MS } from '../../../contracts/translation-policy';
import { TranslationCache, translationCacheFresh } from './translation-cache';
import { reviewedDictionary } from './reviewed-lookup';

export const TRANSLATION_TIMEOUT_MS = TRANSLATION_SERVICE_TIMEOUT_MS;
const REFRESH_BACKOFF_MS = 60_000;
interface Subscribers { users: number; listeners: Set<(value: Translation) => void>; cached?: Translation }
export class TranslationService {
  private pending = new SharedLookup<Translation>(TRANSLATION_TIMEOUT_MS, 'Chinese translation timed out. Please try again.');
  private subscribers = new Map<string, Subscribers>();
  private retryAfter = new Map<string, number>();
  constructor(private backend: Pick<PublicLookupClient, 'request'> = publicLookupClient,
    private cache = new TranslationCache(),
    private localLookup: (word: string) => Promise<Translation | null> = word => reviewedDictionary.getTranslation(word)) {}

  async translate(input: string, signal?: AbortSignal, onCached?: (translation: Translation) => void): Promise<Translation> {
    signal?.throwIfAborted();
    const word = input.trim().toLowerCase();
    if (!isEnglishWord(word) || word.length > 500) throw new Error('Select one English word to translate.');
    const subscribers = this.subscribers.get(word) ?? { users: 0, listeners: new Set<(value: Translation) => void>() };
    this.subscribers.set(word, subscribers); subscribers.users++;
    const preview = (value: Translation) => { if (!signal?.aborted) onCached?.(structuredClone(value)); };
    if (onCached) subscribers.listeners.add(preview);
    try {
      if (subscribers.cached) preview(subscribers.cached);
      // Subscribe before asynchronous cache I/O: another caller's cancellation
      // must not interrupt this caller or duplicate a fast cache-miss request.
      return await this.pending.run(word, async requestSignal => {
        const local = await this.localLookup(word).catch(() => null);
        requestSignal.throwIfAborted();
        if (local) return local;
        const cached = await this.cache.get(word);
        requestSignal.throwIfAborted();
        if (cached && translationCacheFresh(cached)) return cached.translation;
        if (cached) {
          subscribers.cached = cached.translation;
          for (const listener of subscribers.listeners) listener(cached.translation);
          // Legacy/context-menu calls without a preview callback never start
          // detached refresh work. Ports retain cancellation through final reply.
          if (!subscribers.listeners.size || Date.now() < (this.retryAfter.get(word) ?? 0)) return cached.translation;
        }
        try {
          const reply = await this.backend.request<{ translation: unknown }>('/api/v1/public/lookup/translation', 'POST', { word, target: 'zh-CN' }, requestSignal);
          requestSignal.throwIfAborted();
          if (!isTranslation(reply.translation)) throw new Error('The backend returned an invalid translation.');
          this.cache.put(word, reply.translation); this.retryAfter.delete(word);
          return reply.translation;
        } catch (error) {
          requestSignal.throwIfAborted();
          if (!cached) throw error;
          this.retryAfter.delete(word); this.retryAfter.set(word, Date.now() + REFRESH_BACKOFF_MS);
          if (this.retryAfter.size > 256) this.retryAfter.delete(this.retryAfter.keys().next().value!);
          return cached.translation;
        }
      }, signal);
    } finally {
      subscribers.listeners.delete(preview);
      if (--subscribers.users === 0 && this.subscribers.get(word) === subscribers) this.subscribers.delete(word);
    }
  }
}
export const translationService = new TranslationService();
