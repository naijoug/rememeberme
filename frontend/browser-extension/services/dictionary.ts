/**
 * Dictionary Service
 * Looks up packaged WordNet entries before the optional online fallback.
 */

import type { Definition, DictionaryResponse } from '~/types';
import { isDefinition } from './definition-utils';
import { offlineDictionary } from './offline-dictionary';

interface CacheEntry {
  definition: Definition;
  timestamp: number;
}

export class DictionaryService {
  private readonly API_URL = 'https://api.dictionaryapi.dev/api/v2/entries/en';
  private readonly TIMEOUT_MS = 8000;
  private readonly MAX_RETRIES = 1;
  // Leave headroom for the background reply before the UI's 10-second deadline.
  private readonly TOTAL_TIMEOUT_MS = 8500;
  private readonly CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
  private cache: Map<string, CacheEntry> = new Map();
  private pending = new Map<string, Promise<Definition>>();

  constructor(private readonly localLookup = (word: string) => offlineDictionary.getDefinition(word)) {
    // Clean expired cache entries every hour
    setInterval(() => {
      this.clearExpiredCache();
    }, 60 * 60 * 1000);
  }

  /**
   * Get a local definition first; use Free Dictionary API only on a local miss.
   * Uses cache to reduce duplicate API requests (24 hour cache)
   * @param word - The word to look up
   * @returns Promise with Definition object
   * @throws Error with user-friendly message
   */
  async getDefinition(word: string): Promise<Definition> {
    const normalizedWord = word.trim().toLowerCase();
    
    if (!normalizedWord) {
      throw new Error('Please provide a valid word');
    }

    // Check cache first
    const cached = this.getFromCache(normalizedWord);
    if (cached) {
      console.log(`Using cached definition for "${normalizedWord}"`);
      return cached;
    }

    const existing = this.pending.get(normalizedWord);
    if (existing) return existing;
    const request = this.lookup(normalizedWord);
    this.pending.set(normalizedWord, request);
    try {
      return await request;
    } finally {
      this.pending.delete(normalizedWord);
    }
  }

  private async lookup(normalizedWord: string): Promise<Definition> {
    const deadline = Date.now() + this.TOTAL_TIMEOUT_MS;
    try {
      const local = await this.localLookup(normalizedWord);
      if (local) {
        this.saveToCache(normalizedWord, local);
        return local;
      }
    } catch {
      // A damaged/missing packaged shard should still allow online recovery.
    }
    return this.lookupWithRetries(normalizedWord, deadline);
  }

  private async lookupWithRetries(normalizedWord: string, deadline: number): Promise<Definition> {
    let lastError: Error | null = null;
    
    // Retry logic
    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('The dictionary is taking too long. Please try again.');
        const definition = await this.fetchDefinition(normalizedWord, Math.min(this.TIMEOUT_MS, remaining));
        // Store in cache
        this.saveToCache(normalizedWord, definition);
        return definition;
      } catch (error) {
        lastError = error as Error;
        
        // Don't retry on 404 or 429
        if (error instanceof Error && 
            (error.message.includes('not found') || 
             error.message.includes('Too many requests') ||
             error.message.includes('invalid definition'))) {
          break;
        }
        
        // Wait before retry (exponential backoff)
        if (attempt < this.MAX_RETRIES && deadline - Date.now() > 400) {
          await this.delay(400);
        } else {
          break;
        }
      }
    }
    
    const reason = lastError?.message || 'The online dictionary is unavailable.';
    throw new Error(`This word isn't available in the local dictionary. ${reason}`);
  }

  /**
   * Get definition from cache if available and not expired
   * @param word - The word to look up
   * @returns Definition if cached and valid, null otherwise
   */
  private getFromCache(word: string): Definition | null {
    const entry = this.cache.get(word);
    if (!entry) {
      return null;
    }

    const now = Date.now();
    const age = now - entry.timestamp;

    // Check if cache entry is still valid (within 24 hours)
    if (age > this.CACHE_DURATION_MS) {
      this.cache.delete(word);
      return null;
    }

    return entry.definition;
  }

  /**
   * Save definition to cache
   * @param word - The word
   * @param definition - The definition to cache
   */
  private saveToCache(word: string, definition: Definition): void {
    this.cache.set(word, {
      definition,
      timestamp: Date.now(),
    });
  }

  /**
   * Clear expired cache entries
   * Called periodically to prevent memory leaks
   */
  private clearExpiredCache(): void {
    const now = Date.now();
    for (const [word, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.CACHE_DURATION_MS) {
        this.cache.delete(word);
      }
    }
  }

  /**
   * Fetch definition from API with timeout
   */
  private async fetchDefinition(word: string, timeoutMs: number): Promise<Definition> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.API_URL}/${encodeURIComponent(word)}`, {
        signal: controller.signal,
      });

      if (!response.ok) {
        throw await this.handleHttpError(response);
      }

      const data: DictionaryResponse[] = await response.json();
      
      if (!Array.isArray(data) || data.length === 0) {
        throw new Error('Definition not found');
      }

      const entry = { ...data[0], phonetics: data[0]?.phonetics ?? [] };
      if (!isDefinition(entry)) throw new Error('Dictionary returned an invalid definition. Please try again.');
      return this.parseApiResponse(entry);
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error('The dictionary is taking too long. Please try again.');
        }
        if (error instanceof TypeError) {
          throw new Error('Cannot reach the dictionary. Check your connection and try again.');
        }
        throw error;
      }
      
      throw new Error('Cannot reach the dictionary. Check your connection and try again.');
    } finally {
      // The response body can stall too; keep the deadline until JSON is read.
      clearTimeout(timeoutId);
    }
  }

  /**
   * Handle HTTP error responses
   */
  private async handleHttpError(response: Response): Promise<Error> {
    switch (response.status) {
      case 404:
        return new Error('Definition not found');
      case 429:
        return new Error('Too many requests - please try again later');
      case 500:
      case 502:
      case 503:
        return new Error('Dictionary service unavailable');
      default:
        return new Error(`Request failed with status ${response.status}`);
    }
  }

  /**
   * Parse API response to Definition interface
   */
  private parseApiResponse(data: DictionaryResponse): Definition {
    return {
      word: data.word,
      source: 'dictionary-api',
      phonetic: data.phonetic,
      phonetics: data.phonetics || [],
      meanings: data.meanings.map(meaning => ({
        partOfSpeech: meaning.partOfSpeech,
        definitions: meaning.definitions.map(def => ({
          definition: def.definition,
          example: def.example,
          synonyms: def.synonyms || [],
          antonyms: def.antonyms || [],
        })),
      })),
    };
  }

  /**
   * Delay helper for retry logic
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const dictionaryService = new DictionaryService();
