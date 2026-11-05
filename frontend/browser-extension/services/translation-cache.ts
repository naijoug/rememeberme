import { storage } from 'wxt/utils/storage';
import { LOOKUP_SERVICE_ORIGIN } from '~/config/backend';
import type { Translation } from '~/types';
import { isTranslation } from './definition-utils';
import { isEnglishWord } from './word-utils';

export const TRANSLATION_CACHE_DATABASE = 'rememberme-translation-cache-v1';
export const TRANSLATION_CACHE_LIMIT = 10_000;
export const TRANSLATION_CACHE_MAX_AGE_MS = 30 * 86_400_000;
const MEMORY_LIMIT = 256;
const READ_BUDGET_MS = 150;
export interface TranslationCacheEntry {
  key: string; word: string; format: 1; translation: Translation;
  timestamp: number; lastUsed: number; legacyAnonymous?: boolean;
}
export const translationCacheKey = (word: string) => JSON.stringify([LOOKUP_SERVICE_ORIGIN, 'public:v3', 'zh-CN', word]);
export const translationCacheFresh = (entry: TranslationCacheEntry, now = Date.now()) =>
  now - entry.timestamp < (entry.translation.source === 'mymemory' && !entry.legacyAnonymous ? 3_600_000 : 7 * 86_400_000);
function valid(entry: unknown, word: string): entry is TranslationCacheEntry {
  const e = entry as TranslationCacheEntry | undefined;
  return !!e && e.format === 1 && e.word === word && e.key === translationCacheKey(word) && isTranslation(e.translation)
    && Number.isFinite(e.timestamp) && e.timestamp <= Date.now() && Date.now() - e.timestamp < TRANSLATION_CACHE_MAX_AGE_MS
    && Number.isFinite(e.lastUsed) && e.lastUsed <= Date.now() && (e.legacyAnonymous === undefined || e.legacyAnonymous === true);
}
function bounded<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Translation cache timed out')), ms); })])
    .finally(() => clearTimeout(timer));
}

/** Disposable word-result cache, completely separate from vocabulary and sync. */
export class TranslationCache {
  private connection?: Promise<IDBDatabase>;
  private memory = new Map<string, TranslationCacheEntry>();
  private writes = Promise.resolve();
  constructor(private name = TRANSLATION_CACHE_DATABASE, private limit = TRANSLATION_CACHE_LIMIT,
    private legacyRead: () => Promise<unknown> = () => storage.getItem('local:translationCache')) {}

  async get(word: string): Promise<TranslationCacheEntry | undefined> {
    let entry = this.memory.get(word);
    if (!valid(entry, word)) {
      this.memory.delete(word);
      try {
        entry = await bounded(this.open().then(db => this.transaction(db, 'readonly', stores => stores.entries.get(translationCacheKey(word)))), READ_BUDGET_MS);
      } catch { return; } // A broken cache must never stall a live lookup.
    }
    if (!valid(entry, word)) return;
    this.remember(entry);
    this.enqueue(async db => {
      await this.transaction(db, 'readwrite', stores => {
        const request = stores.entries.get(entry!.key);
        request.onsuccess = () => {
          if (valid(request.result, word)) stores.entries.put({ ...request.result, lastUsed: Date.now() });
        };
      });
    });
    return structuredClone(entry);
  }

  put(word: string, translation: Translation): void {
    const entry: TranslationCacheEntry = { key: translationCacheKey(word), word, format: 1,
      translation: structuredClone(translation), timestamp: Date.now(), lastUsed: Date.now() };
    if (!isEnglishWord(word) || !valid(entry, word)) return;
    this.remember(entry);
    this.enqueue(async db => {
      await this.transaction(db, 'readwrite', stores => { stores.entries.put(entry); this.prune(stores.entries); });
    });
  }
  /** Useful for shutdown/verification; lookup rendering never awaits persistence. */
  flush(): Promise<void> { return this.writes; }
  async close(): Promise<void> { await this.flush(); const db = await this.connection?.catch(() => undefined); db?.close(); this.connection = undefined; this.memory.clear(); }

  private remember(entry: TranslationCacheEntry) {
    this.memory.delete(entry.word); this.memory.set(entry.word, structuredClone(entry));
    while (this.memory.size > Math.min(MEMORY_LIMIT, this.limit)) this.memory.delete(this.memory.keys().next().value!);
  }
  private enqueue(write: (db: IDBDatabase) => Promise<void>) {
    this.writes = this.writes.then(async () => write(await this.open())).catch(() => {});
  }
  private open(): Promise<IDBDatabase> {
    if (this.connection) return this.connection;
    const opened = new Promise<IDBDatabase>((resolve, reject) => {
      let finished = false;
      const request = indexedDB.open(this.name, 1);
      const fail = (error: unknown) => { if (!finished) { finished = true; clearTimeout(timer); reject(error); } };
      const timer = setTimeout(() => fail(new Error('Translation cache unavailable')), 300);
      request.onupgradeneeded = () => {
        if (finished) { request.transaction?.abort(); return; }
        const entries = request.result.createObjectStore('entries', { keyPath: 'key' });
        entries.createIndex('lastUsed', 'lastUsed'); entries.createIndex('timestamp', 'timestamp');
        request.result.createObjectStore('metadata');
      };
      request.onerror = () => fail(request.error);
      request.onblocked = () => fail(new Error('Translation cache upgrade blocked'));
      request.onsuccess = () => {
        if (finished) { request.result.close(); return; }
        finished = true; clearTimeout(timer);
        request.result.onversionchange = () => { request.result.close(); this.connection = undefined; this.memory.clear(); };
        resolve(request.result);
      };
    });
    this.connection = opened.then(async db => { await this.migrate(db).catch(() => {}); return db; })
      .catch(error => { this.connection = undefined; throw error; });
    return this.connection;
  }
  private transaction<T>(db: IDBDatabase, mode: IDBTransactionMode,
    work: (stores: { entries: IDBObjectStore; metadata: IDBObjectStore }) => IDBRequest<T> | void): Promise<T> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['entries', 'metadata'], mode);
      const timer = setTimeout(() => { try { tx.abort(); } catch {} reject(new Error('Translation cache transaction timed out')); }, 2_000);
      let request: IDBRequest<T> | void;
      tx.oncomplete = () => { clearTimeout(timer); resolve(request?.result as T); };
      tx.onabort = tx.onerror = () => { clearTimeout(timer); reject(tx.error ?? new Error('Translation cache transaction failed')); };
      try { request = work({ entries: tx.objectStore('entries'), metadata: tx.objectStore('metadata') }); }
      catch (error) { clearTimeout(timer); tx.abort(); reject(error); }
    });
  }
  private async migrate(db: IDBDatabase) {
    const marker = 'legacy-public-v3';
    if (await this.transaction(db, 'readonly', stores => stores.metadata.get(marker))) return;
    const old = await bounded(this.legacyRead(), READ_BUDGET_MS);
    const entries: TranslationCacheEntry[] = [];
    if (old && typeof old === 'object' && !Array.isArray(old)) {
      for (const [key, raw] of Object.entries(old).slice(-500)) {
        const word = key.startsWith('public:v3:') ? key.slice('public:v3:'.length) : key;
        if (!isEnglishWord(word) || word !== word.toLowerCase() || word.length > 500 || !raw || typeof raw !== 'object') continue;
        const entry: TranslationCacheEntry = { key: translationCacheKey(word), word, format: 1,
          translation: { text: raw.text, source: raw.source ?? 'mymemory', target: 'zh-CN' }, timestamp: raw.timestamp,
          lastUsed: raw.timestamp, ...(key === word ? { legacyAnonymous: true } : {}) };
        if (valid(entry, word)) entries.push(entry);
      }
    }
    await this.transaction(db, 'readwrite', stores => {
      for (const entry of entries) {
        const request = stores.entries.get(entry.key);
        request.onsuccess = () => { if (!request.result) stores.entries.put(entry); };
      }
      stores.metadata.put(true, marker);
    });
    await this.transaction(db, 'readwrite', stores => this.prune(stores.entries));
    // Keep the old WXT cache untouched for rollback; never read account/vocabulary stores.
  }
  private prune(store: IDBObjectStore): void {
    const expired = store.index('timestamp').openCursor(IDBKeyRange.upperBound(Date.now() - TRANSLATION_CACHE_MAX_AGE_MS));
    expired.onsuccess = () => {
      const cursor = expired.result;
      if (cursor) { cursor.delete(); cursor.continue(); return; }
      const count = store.count();
      count.onsuccess = () => {
        let excess = count.result - this.limit;
        if (excess <= 0) return;
        const oldest = store.index('lastUsed').openCursor();
        oldest.onsuccess = () => { const row = oldest.result; if (row && excess-- > 0) { row.delete(); row.continue(); } };
      };
    };
  }
}
