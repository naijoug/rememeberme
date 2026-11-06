import type { PublicPath } from 'wxt/browser';
import type { Definition, Translation } from '~/types';
import { isEnglishWord } from './word-utils';

export interface LearnerManifest {
  schemaVersion: number; version: string; entries: number; reviewMethod: string;
  words: Record<string, string>; shards: Record<string, { sha256: string; bytes: number }>;
}
interface Entry {
  word: string; contentHash: string; reviewStatus: string;
  senses: { id: string; partOfSpeech: string; en: string; zh: string; example: { en: string; zh: string }; collocations: string[] }[];
}
const parts: Record<string, string> = { noun: 'n.', verb: 'v.', adjective: 'adj.', adverb: 'adv.', pronoun: 'pron.',
  determiner: 'det.', preposition: 'prep.', conjunction: 'conj.', interjection: 'int.', auxiliary: 'aux.', numeral: 'num.', particle: 'part.' };
const plain = (value: unknown, limit: number): value is string => typeof value === 'string' && !!value.trim()
  && value.length <= limit && !/[<>\u0000-\u001f]/u.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function validEntry(value: unknown, word: string): value is Entry {
  if (!object(value) || value.word !== word || value.reviewStatus !== 'approved' || !/^[a-f0-9]{64}$/.test(String(value.contentHash))
    || !Array.isArray(value.senses) || !value.senses.length || value.senses.length > 4) return false;
  return value.senses.every(s => object(s) && plain(s.id, 120) && typeof s.partOfSpeech === 'string' && Object.hasOwn(parts, s.partOfSpeech)
    && plain(s.en, 320) && plain(s.zh, 160) && object(s.example) && plain(s.example.en, 320) && plain(s.example.zh, 240)
    && Array.isArray(s.collocations) && s.collocations.length <= 3 && s.collocations.every(c => plain(c, 100)));
}

/** Exact-spelling lookup only. Generated forms are never used as trusted aliases. */
export class LearnerDictionary {
  private shards = new Map<string, Record<string, unknown>>();
  private pending = new Map<string, Promise<Record<string, unknown>>>();
  constructor(private manifest: LearnerManifest,
    private assetUrl = (path: string) => browser.runtime.getURL(path as PublicPath), private timeoutMs = 1500) {}
  async getDefinition(input: string): Promise<Definition | null> {
    const word = input.trim().toLowerCase();
    if (!isEnglishWord(word) || !Object.hasOwn(this.manifest.words, word)) return null;
    if (this.manifest.schemaVersion !== 1 || this.manifest.reviewMethod !== 'ai-assisted-v1'
      || !/^[a-f0-9]{24}$/.test(this.manifest.version)) throw new Error('Invalid learner dictionary manifest');
    const key = this.manifest.words[word];
    if (!/^[a-f0-9]{2}$/.test(key)) throw new Error('Invalid learner dictionary shard');
    const shard = await this.load(key), entry = Object.hasOwn(shard, word) ? shard[word] : undefined;
    if (!validEntry(entry, word)) throw new Error('Invalid reviewed dictionary entry');
    const groups = new Map<string, Definition['meanings'][number]>();
    for (const sense of entry.senses) {
      const meaning = groups.get(sense.partOfSpeech) ?? { partOfSpeech: sense.partOfSpeech, definitions: [] };
      meaning.definitions.push({ definition: sense.en, glossZh: sense.zh, example: sense.example.en,
        exampleTranslation: sense.example.zh, collocations: [...sense.collocations] });
      groups.set(sense.partOfSpeech, meaning);
    }
    return { word, source: 'rememberme-dict', phonetics: [], meanings: [...groups.values()], translation: {
      text: entry.senses.map(s => `${parts[s.partOfSpeech]} ${s.zh}`).join('；'), target: 'zh-CN', source: 'magpie',
      dictionary: { id: 'rememberme-dict', version: this.manifest.version, entryHash: entry.contentHash, review: 'ai-assisted-v1' },
    } };
  }
  async getTranslation(word: string): Promise<Translation | null> { return (await this.getDefinition(word))?.translation ?? null; }
  private async load(key: string): Promise<Record<string, unknown>> {
    const cached = this.shards.get(key);
    if (cached) { this.shards.delete(key); this.shards.set(key, cached); return cached; }
    if (this.pending.has(key)) return this.pending.get(key)!;
    const request = this.fetchShard(key); this.pending.set(key, request);
    try {
      const shard = await request; this.shards.set(key, shard);
      while (this.shards.size > 24) this.shards.delete(this.shards.keys().next().value!);
      return shard;
    } finally { this.pending.delete(key); }
  }
  private async fetchShard(key: string) {
    const info = this.manifest.shards[key];
    if (!info || !/^[a-f0-9]{64}$/.test(info.sha256) || !Number.isInteger(info.bytes) || info.bytes < 1 || info.bytes > 256 * 1024) throw new Error('Invalid learner dictionary integrity metadata');
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Local learner dictionary timed out')); }, this.timeoutMs); });
    try {
      return await Promise.race([(async () => {
        const response = await fetch(this.assetUrl(`/dictionary/rememberme/${key}.json`), { signal: controller.signal, credentials: 'omit' });
        if (!response.ok || !response.body || controller.signal.aborted) { void response.body?.cancel(); throw new Error('Local learner dictionary unavailable'); }
        reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
        while (true) {
          const next = await reader.read(); if (next.done) break;
          length += next.value.length; if (length > info.bytes) throw new Error('Local learner dictionary size mismatch');
          chunks.push(next.value);
        }
        if (controller.signal.aborted || length !== info.bytes) throw new Error('Local learner dictionary size mismatch');
        const data = new Uint8Array(length); let offset = 0;
        for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
        const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(x => x.toString(16).padStart(2, '0')).join('');
        if (controller.signal.aborted || digest !== info.sha256) throw new Error('Local learner dictionary checksum mismatch');
        const shard: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
        if (!object(shard)) throw new Error('Invalid learner dictionary shard');
        return shard;
      })(), deadline]);
    } finally { clearTimeout(timer); if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); } }
  }
}

/** A broken reviewed shard must not skip the established packaged WordNet fallback. */
export async function lookupPackagedDefinition(word: string,
  reviewed: Pick<LearnerDictionary, 'getDefinition'>,
  fallback: { getDefinition(word: string): Promise<Definition | null> }): Promise<Definition | null> {
  try { const value = await reviewed.getDefinition(word); if (value) return value; } catch { /* Try WordNet next. */ }
  return fallback.getDefinition(word);
}
