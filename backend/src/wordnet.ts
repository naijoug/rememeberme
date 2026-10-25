import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { definition, object, ApiError, type Json } from '../../contracts/api-v1';
import { wordFormCandidates } from '../../frontend/browser-extension/services/word-forms';

// Uses the identical checked-in WordNet shards/license notices as the extension.
export class ServerWordNet {
  private shards = new Map<string, Record<string, unknown>>();
  private pending = new Map<string, Promise<Record<string, unknown>>>();
  constructor(private directory: string) {}
  private async read(word: string): Promise<Record<string, unknown> | null> {
    let hash = 2166136261;
    for (const char of word) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
    const key = (hash & 255).toString(16).padStart(2, '0');
    let shard = this.shards.get(key);
    if (!shard) {
      let request = this.pending.get(key);
      if (!request) {
        request = readFile(join(this.directory, key + '.json'), 'utf8').then(raw => {
          if (raw.length > 256 * 1024) throw new ApiError('DICTIONARY_INVALID_RESPONSE', 502);
          const value: unknown = JSON.parse(raw);
          if (!object(value)) throw new ApiError('DICTIONARY_INVALID_RESPONSE', 502);
          this.shards.set(key, value);
          while (this.shards.size > 24) this.shards.delete(this.shards.keys().next().value!);
          return value;
        }).finally(() => this.pending.delete(key));
        this.pending.set(key, request);
      }
      shard = await request;
    }
    if (!Object.hasOwn(shard, word)) return null;
    const entry = shard[word];
    if (!Array.isArray(entry)) throw new ApiError('DICTIONARY_INVALID_RESPONSE', 502);
    const meanings = entry.map(meaning => {
      if (!Array.isArray(meaning) || typeof meaning[0] !== 'string' || !Array.isArray(meaning[1])) throw new ApiError('DICTIONARY_INVALID_RESPONSE', 502);
      return { partOfSpeech: meaning[0], definitions: meaning[1].map((sense: unknown) => {
        if (!Array.isArray(sense) || typeof sense[0] !== 'string' || (sense[1] !== undefined && typeof sense[1] !== 'string')) throw new ApiError('DICTIONARY_INVALID_RESPONSE', 502);
        return { definition: sense[0], ...(sense[1] ? { example: sense[1] } : {}) };
      }) };
    });
    return { word, phonetics: [], meanings, source: 'wordnet' };
  }
  async getDefinition(word: string): Promise<Json | null> {
    if (!/^[a-z](?:[a-z'-]*[a-z])?$/.test(word) || word.length > 500) throw new ApiError('INVALID_LOOKUP_WORD');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([(async () => {
        let result = await this.read(word);
        if (!result) for (const candidate of wordFormCandidates(word)) {
          const entry = await this.read(candidate.word);
          if (entry && Array.isArray(entry.meanings)) {
            const meanings = entry.meanings.filter(meaning => object(meaning) && meaning.partOfSpeech === candidate.partOfSpeech);
            if (meanings.length) { result = { ...entry, meanings }; break; }
          }
        }
        if (result && !definition(result)) throw new ApiError('DICTIONARY_INVALID_RESPONSE', 502);
        return result as Json | null;
      })(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ApiError('DICTIONARY_TIMEOUT', 504, true)), 1500); })]);
    } finally { clearTimeout(timer); }
  }
}
