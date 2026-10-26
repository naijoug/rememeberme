import { storage } from 'wxt/utils/storage';
import type { Translation } from '~/types';
import { isEnglishWord } from './word-utils';
import { publicLookupClient, type PublicLookupClient } from './public-lookup';
import { isTranslation } from './definition-utils';

const CACHE_KEY = 'local:translationCache';
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;
export const TRANSLATION_TIMEOUT_MS = 20_000;
type CacheEntry = { text: string; timestamp: number; source?: Translation['source'] };
const lifetime = (key: string, entry: CacheEntry) => key.startsWith('public:') && entry.source === 'mymemory' ? 3_600_000 : CACHE_TTL;

export class TranslationService {
  private cache = new Map<string, CacheEntry>();
  private pending = new Map<string, Promise<Translation>>();
  private loaded?: Promise<void>;
  private writes = Promise.resolve();
  constructor(private backend: Pick<PublicLookupClient, 'request'> = publicLookupClient) {}

  async translate(input: string): Promise<Translation> {
    const word = input.trim().toLowerCase();
    if (!isEnglishWord(word) || word.length > 500) throw new Error('Select one English word to translate.');
    await (this.loaded ??= this.loadCache());
    const key = 'public:v3:' + word;
    const cacheKey = this.cache.has(key) ? key : word;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < lifetime(cacheKey, cached)) return { text: cached.text, source: cached.source ?? 'mymemory', target: 'zh-CN' };
    const existing = this.pending.get(key);
    if (existing) return existing;
    const request = this.backend.request<{ translation: unknown }>('/api/v1/public/lookup/translation', 'POST', { word, target: 'zh-CN' }).then(reply => {
      if (!isTranslation(reply.translation)) throw new Error('The backend returned an invalid translation.');
      return reply.translation;
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bounded = Promise.race([request, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Chinese translation timed out. Please try again.')), TRANSLATION_TIMEOUT_MS);
    })]);
    this.pending.set(key, bounded);
    try {
      const translation = await bounded;
      this.cache.delete(key);
      this.cache.set(key, { text: translation.text, source: translation.source, timestamp: Date.now() });
      if (this.cache.size > MAX_CACHE_ENTRIES) this.cache.delete(this.cache.keys().next().value!);
      // Cache persistence is best-effort and never blocks a usable translation.
      this.writes = this.writes.then(() => storage.setItem(CACHE_KEY, Object.fromEntries(this.cache))).catch(() => {});
      return translation;
    } finally {
      clearTimeout(timer);
      this.pending.delete(key);
    }
  }

  private async loadCache(): Promise<void> {
    try {
      const stored = await storage.getItem<Record<string, CacheEntry>>(CACHE_KEY);
      if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return;
      for (const [word, entry] of Object.entries(stored).slice(-MAX_CACHE_ENTRIES)) {
        if ((isEnglishWord(word) || word.startsWith('public:')) && entry && typeof entry.text === 'string' && entry.text.trim() && entry.text.length <= 2000 &&
            (entry.source === undefined || entry.source === 'mymemory' || entry.source === 'hermes' || entry.source === 'magpie') &&
            Number.isFinite(entry.timestamp) && entry.timestamp <= Date.now() && Date.now() - entry.timestamp < lifetime(word, entry)) {
          this.cache.set(word, entry);
        }
      }
    } catch { /* Cache failure must not disable live translation. */ }
  }
}

export const translationService = new TranslationService();
