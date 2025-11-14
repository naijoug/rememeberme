/**
 * Dictionary Service
 * Handles API calls to Free Dictionary API for word definitions
 */

import type { Definition, DictionaryResponse } from '~/types';

export class DictionaryService {
  private readonly API_URL = 'https://api.dictionaryapi.dev/api/v2/entries/en';
  private readonly TIMEOUT_MS = 3000;
  private readonly MAX_RETRIES = 2;

  /**
   * Get definition for a word from Free Dictionary API
   * @param word - The word to look up
   * @returns Promise with Definition object
   * @throws Error with user-friendly message
   */
  async getDefinition(word: string): Promise<Definition> {
    const normalizedWord = word.trim().toLowerCase();
    
    if (!normalizedWord) {
      throw new Error('Please provide a valid word');
    }

    let lastError: Error | null = null;
    
    // Retry logic
    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        const definition = await this.fetchDefinition(normalizedWord);
        return definition;
      } catch (error) {
        lastError = error as Error;
        
        // Don't retry on 404 or 429
        if (error instanceof Error && 
            (error.message.includes('not found') || 
             error.message.includes('Too many requests'))) {
          throw error;
        }
        
        // Wait before retry (exponential backoff)
        if (attempt < this.MAX_RETRIES) {
          await this.delay(Math.pow(2, attempt) * 500);
        }
      }
    }
    
    throw lastError || new Error('Failed to fetch definition');
  }

  /**
   * Fetch definition from API with timeout
   */
  private async fetchDefinition(word: string): Promise<Definition> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.TIMEOUT_MS);

    try {
      const response = await fetch(`${this.API_URL}/${encodeURIComponent(word)}`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw await this.handleHttpError(response);
      }

      const data: DictionaryResponse[] = await response.json();
      
      if (!data || data.length === 0) {
        throw new Error('Definition not found');
      }

      return this.parseApiResponse(data[0]);
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error('Request timeout - please try again');
        }
        throw error;
      }
      
      throw new Error('Network error - please check your connection');
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
