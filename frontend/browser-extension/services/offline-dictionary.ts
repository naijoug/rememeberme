import type { PublicPath } from 'wxt/browser';
import type { Definition } from '~/types';
import { isEnglishWord } from './word-utils';
import { wordFormCandidates } from './word-forms';

type Shard = Record<string, unknown>;

// Keep in sync with scripts/build-wordnet.py. All lookup keys are ASCII.
export function wordnetShard(word: string): string {
  let hash = 2166136261;
  for (const char of word) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return (hash & 255).toString(16).padStart(2, '0');
}

export class OfflineDictionary {
  private shards = new Map<string, Shard>();
  private pending = new Map<string, Promise<Shard>>();
  private readonly MAX_SHARDS = 24;

  constructor(private assetUrl = (path: string) => browser.runtime.getURL(path as PublicPath)) {}

  async getDefinition(input: string): Promise<Definition | null> {
    const word = input.trim().toLowerCase();
    if (!isEnglishWord(word)) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Local dictionary could not be opened')), 1500);
    });
    try {
      return await Promise.race([this.lookupForms(word), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async lookupForms(word: string): Promise<Definition | null> {
    const exact = await this.readWord(word);
    if (exact) return exact;
    // Read candidates concurrently so suffix probing cannot multiply the deadline.
    const candidates = wordFormCandidates(word);
    const results = await Promise.all(candidates.map(async candidate => {
      const entry = await this.readWord(candidate.word);
      const meanings = entry?.meanings.filter(meaning => meaning.partOfSpeech === candidate.partOfSpeech);
      return entry && meanings?.length ? { ...entry, meanings } : null;
    }));
    return results.find(Boolean) ?? null;
  }

  private async readWord(word: string): Promise<Definition | null> {
    const shard = await this.loadShard(wordnetShard(word));
    if (!Object.hasOwn(shard, word)) return null;
    const entry = shard[word];
    if (!Array.isArray(entry) || !entry.length) throw new Error('Invalid packaged dictionary entry');
    const meanings: Definition['meanings'] = entry.map(meaning => {
      if (!Array.isArray(meaning) || typeof meaning[0] !== 'string' || !Array.isArray(meaning[1]) || !meaning[1].length) {
        throw new Error('Invalid packaged dictionary meaning');
      }
      return {
        partOfSpeech: meaning[0],
        definitions: meaning[1].map((sense: unknown) => {
          if (!Array.isArray(sense) || typeof sense[0] !== 'string' || !sense[0].trim() || (sense[1] !== undefined && typeof sense[1] !== 'string')) {
            throw new Error('Invalid packaged dictionary sense');
          }
          return { definition: sense[0], ...(sense[1] ? { example: sense[1] } : {}) };
        }),
      };
    });
    return { word, phonetics: [], meanings, source: 'wordnet' };
  }

  private async loadShard(key: string): Promise<Shard> {
    const cached = this.shards.get(key);
    if (cached) {
      this.shards.delete(key);
      this.shards.set(key, cached);
      return cached;
    }
    const pending = this.pending.get(key);
    if (pending) return pending;
    const request = this.fetchShard(key);
    this.pending.set(key, request);
    try {
      const shard = await request;
      this.shards.set(key, shard);
      if (this.shards.size > this.MAX_SHARDS) this.shards.delete(this.shards.keys().next().value!);
      return shard;
    } finally {
      this.pending.delete(key);
    }
  }

  private async fetchShard(key: string): Promise<Shard> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('Local dictionary could not be opened')); }, 1500);
    });
    try {
      // This URL points inside the installed extension, never to a remote host.
      const read = fetch(this.assetUrl(`/dictionary/wordnet/${key}.json`), { signal: controller.signal, credentials: 'omit' })
        .then(async response => {
          if (!response.ok) throw new Error('Local dictionary file is unavailable');
          const data: unknown = await response.json();
          if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error('Invalid local dictionary file');
          return data as Shard;
        });
      return await Promise.race([read, deadline]);
    } finally {
      clearTimeout(timer);
    }
  }
}

export const offlineDictionary = new OfflineDictionary();
