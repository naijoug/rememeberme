import { ApiError, definition, object, type Json } from '../../contracts/api-v1';
import { boundedJSON } from './http';
import type { Translation } from './runtime';

// Only fixed provider URLs are used. No client URL, credential or page context is forwarded.
async function provider(url: URL, timeoutMs: number, code: string, fetcher: typeof fetch): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new ApiError(code + '_TIMEOUT', 504, true)); }, timeoutMs);
  });
  try {
    return await Promise.race([(async () => {
      const response = await fetcher(url, { signal: controller.signal, redirect: 'error',
        credentials: 'omit', referrerPolicy: 'no-referrer', headers: { Accept: 'application/json' } });
      if (!response.ok) {
        await response.body?.cancel();
        throw new ApiError(code + (response.status === 404 ? '_NOT_FOUND' : response.status === 429 ? '_QUOTA' : '_UNAVAILABLE'),
          response.status === 404 ? 404 : 503, response.status !== 404);
      }
      if (!response.headers.get('content-type')?.includes('application/json')) throw new ApiError(code + '_INVALID_RESPONSE', 502);
      return await boundedJSON(response.body, 256 * 1024, controller.signal);
    })(), deadline]);
  } catch (error) {
    if (error instanceof ApiError && error.code.startsWith(code + '_')) throw error;
    throw new ApiError(code + '_UNAVAILABLE', 503, true);
  } finally { clearTimeout(timer); }
}

class LookupCache<T> {
  private cache = new Map<string, { value: T; expires: number }>();
  private pending = new Map<string, Promise<T>>();
  async get(word: string, code: string, load: () => Promise<T>, ttl: (value: T) => number): Promise<T> {
    const cached = this.cache.get(word);
    if (cached && cached.expires > Date.now()) return structuredClone(cached.value);
    const existing = this.pending.get(word);
    if (existing) return structuredClone(await existing);
    if (this.pending.size >= 8) throw new ApiError(code + '_BUSY', 503, true);
    const request = load().then(value => {
      this.cache.delete(word); this.cache.set(word, { value, expires: Date.now() + ttl(value) });
      while (this.cache.size > 1000) this.cache.delete(this.cache.keys().next().value!);
      return value;
    }).finally(() => this.pending.delete(word));
    this.pending.set(word, request);
    return structuredClone(await request);
  }
}

export class ServerDictionary {
  private cache = new LookupCache<Json>();
  constructor(private fetcher: typeof fetch = fetch, private timeoutMs = 6000,
    private local?: { getDefinition(word: string): Promise<Json | null> }) {}
  getDefinition(word: string): Promise<Json> {
    return this.cache.get(word, 'DICTIONARY', async () => {
      const local = await this.local?.getDefinition(word).catch(() => null);
      if (local) return local;
      const data = await provider(new URL('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(word)),
        this.timeoutMs, 'DICTIONARY', this.fetcher);
      const entry = Array.isArray(data) && object(data[0]) ? { ...data[0], phonetics: data[0].phonetics ?? [] } : undefined;
      if (!definition(entry) || !object(entry)) throw new ApiError('DICTIONARY_INVALID_RESPONSE', 502);
      // Keep the existing dictionary snapshot fields and provider attribution.
      const result = { word: entry.word, phonetics: entry.phonetics, meanings: entry.meanings,
        ...(typeof entry.phonetic === 'string' ? { phonetic: entry.phonetic } : {}), source: 'dictionary-api' };
      if (!definition(result)) throw new ApiError('DICTIONARY_INVALID_RESPONSE', 502);
      return result;
    }, () => 86_400_000);
  }
}

export class MyMemoryTranslator {
  constructor(private fetcher: typeof fetch = fetch, private timeoutMs = 4000) {}
  async translate(word: string): Promise<Translation> {
    const url = new URL('https://api.mymemory.translated.net/get');
    url.searchParams.set('q', word); url.searchParams.set('langpair', 'en|zh-CN');
    const data = await provider(url, this.timeoutMs, 'TRANSLATION', this.fetcher);
    if (!object(data)) throw new ApiError('TRANSLATION_INVALID_RESPONSE', 502);
    if (data.quotaFinished || [403, 429].includes(Number(data.responseStatus))) throw new ApiError('TRANSLATION_QUOTA', 503, true);
    const text = object(data.responseData) ? data.responseData.translatedText : undefined;
    if (Number(data.responseStatus) !== 200 || typeof text !== 'string' || !text.trim() || text.length > 2000
      || text.trim().toLowerCase() === word || !/[\u3400-\u9fff]/u.test(text)) throw new ApiError('TRANSLATION_INVALID_RESPONSE', 502);
    return { text: text.trim(), target: 'zh-CN', source: 'mymemory' };
  }
}

export class ServerTranslator {
  private cache = new LookupCache<Translation>();
  constructor(private primary?: { translate(word: string): Promise<Translation> },
    private fallback?: { translate(word: string): Promise<Translation> }) {}
  translate(word: string): Promise<Translation> {
    return this.cache.get(word, 'TRANSLATION', async () => {
      if (this.primary) {
        try { return await this.primary.translate(word); } catch (error) {
          // Profile isolation/configuration failures remain explicit. Only provider failures fall back.
          if (!this.fallback || !(error instanceof ApiError) || !['TRANSLATION_BUSY', 'TRANSLATION_TIMEOUT',
            'TRANSLATION_UNAVAILABLE', 'TRANSLATION_INVALID_RESPONSE'].includes(error.code)) throw error;
        }
      }
      if (!this.fallback) throw new ApiError('TRANSLATION_NOT_CONFIGURED', 503);
      return this.fallback.translate(word);
    }, value => value.source === 'mymemory' ? 3_600_000 : 7 * 86_400_000);
  }
}
