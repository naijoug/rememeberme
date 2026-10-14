import { storage } from 'wxt/utils/storage';
import type { Translation } from '~/types';
import { isEnglishWord } from './word-utils';
import { backendClient, type BackendClient } from './backend-client';
import { isTranslation } from './definition-utils';

const CACHE_KEY = 'local:translationCache';
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;
export const TRANSLATION_TIMEOUT_MS = 15_000;
type CacheEntry = { text: string; timestamp: number; source?: Translation['source'] };

export class TranslationService {
  private cache = new Map<string, CacheEntry>();
  private pending = new Map<string, Promise<Translation>>();
  private loaded?: Promise<void>;
  private writes = Promise.resolve();
  constructor(private backend: BackendClient = backendClient) {}

  async translate(input: string): Promise<Translation> {
    const word = input.trim().toLowerCase();
    if (!isEnglishWord(word) || word.length > 500) throw new Error('Select one English word to translate.');
    await (this.loaded ??= this.loadCache());
    const connection = await this.backend.current();
    const key = connection ? 'hermes:' + connection.origin + ':' + connection.credentials.userId + ':' + word : word;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) return { text: cached.text, source: cached.source ?? 'mymemory', target: 'zh-CN' };
    const existing = this.pending.get(key);
    if (existing) return existing;
    const request = connection ? this.backend.request<{ translation: unknown }>('/api/v1/lookup/translation', 'POST', { word, target: 'zh-CN' }).then(reply => {
      if (!isTranslation(reply.translation) || reply.translation.source !== 'hermes') throw new Error('The backend returned an invalid translation.');
      return reply.translation;
    }) : this.fetchTranslation(word);
    this.pending.set(key, request);
    try {
      const translation = await request;
      this.cache.delete(key);
      this.cache.set(key, { text: translation.text, source: translation.source, timestamp: Date.now() });
      if (this.cache.size > MAX_CACHE_ENTRIES) this.cache.delete(this.cache.keys().next().value!);
      // Cache persistence is best-effort and never blocks a usable translation.
      this.writes = this.writes.then(() => storage.setItem(CACHE_KEY, Object.fromEntries(this.cache))).catch(() => {});
      return translation;
    } finally {
      this.pending.delete(key);
    }
  }

  private result(text: string): Translation { return { text, target: 'zh-CN', source: 'mymemory' }; }

  private async loadCache(): Promise<void> {
    try {
      const stored = await storage.getItem<Record<string, CacheEntry>>(CACHE_KEY);
      if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return;
      for (const [word, entry] of Object.entries(stored).slice(-MAX_CACHE_ENTRIES)) {
        if ((isEnglishWord(word) || word.startsWith('hermes:')) && entry && typeof entry.text === 'string' && entry.text.trim() && entry.text.length <= 2000 &&
            (entry.source === undefined || entry.source === 'mymemory' || entry.source === 'hermes') &&
            Number.isFinite(entry.timestamp) && entry.timestamp <= Date.now() && Date.now() - entry.timestamp < CACHE_TTL) {
          this.cache.set(word, entry);
        }
      }
    } catch { /* Cache failure must not disable live translation. */ }
  }

  private async fetchTranslation(word: string): Promise<Translation> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('Chinese translation timed out. Please try again.')); }, TRANSLATION_TIMEOUT_MS);
    });
    try {
      const url = new URL('https://api.mymemory.translated.net/get');
      url.searchParams.set('q', word);
      url.searchParams.set('langpair', 'en|zh-CN');
      const request = fetch(url.toString(), { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' }).then(async response => {
        if (response.status === 429) throw new Error('The free translation quota is exhausted. Please try later.');
        if (!response.ok) throw new Error('Chinese translation is unavailable. Please try again.');
        const data = await response.json();
        if (data?.quotaFinished || Number(data?.responseStatus) === 403 || Number(data?.responseStatus) === 429) {
          throw new Error('The free translation quota is exhausted. Please try later.');
        }
        if (Number(data?.responseStatus) !== 200) throw new Error('Chinese translation is unavailable. Please try again.');
        const text = data?.responseData?.translatedText;
        if (typeof text !== 'string' || !text.trim() || text.length > 2000 || text.trim().toLowerCase() === word) {
          throw new Error('No Chinese translation was found for this word.');
        }
        return this.result(text.trim());
      });
      return await Promise.race([request, deadline]);
    } catch (error) {
      if (error instanceof TypeError) throw new Error('Cannot reach Chinese translation. Check your connection and retry.');
      if (error instanceof Error && error.name === 'AbortError') throw new Error('Chinese translation timed out. Please try again.');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

export const translationService = new TranslationService();
