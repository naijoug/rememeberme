import { LOOKUP_SERVICE_ORIGIN } from '~/config/backend';

// Recovery stays inside the service's 20s and UI's 22s deadlines. Only the
// word-only translation POST is retried; vocabulary writes never use this client.
export const TRANSLATION_REQUEST_BUDGET_MS = 19_000;
export const TRANSLATION_FIRST_ATTEMPT_MS = 5_000;
class LookupFailure extends Error {
  constructor(message: string, readonly retryable = false) { super(message); }
}
const unavailable = () => new LookupFailure('Lookup service is unavailable. Please try again.', true);
const timedOut = (path: string) => new LookupFailure(path.endsWith('/translation')
  ? 'Chinese translation timed out. Please try again.' : 'Dictionary lookup timed out. Please try again.', true);

export class PublicLookupClient {
  constructor(private origin = LOOKUP_SERVICE_ORIGIN, private fetcher: typeof fetch = fetch) {}
  async request<T>(path: string, method: string, body: unknown): Promise<T> {
    if (!['/api/v1/public/lookup/dictionary', '/api/v1/public/lookup/translation'].includes(path) || method !== 'POST') throw new Error('Invalid lookup request.');
    const translation = path.endsWith('/translation');
    const encoded = JSON.stringify(body);
    const deadline = Date.now() + (translation ? TRANSLATION_REQUEST_BUDGET_MS : 8_000);
    for (let attempt = 0; ; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw timedOut(path);
      const budget = translation && attempt === 0 ? Math.min(remaining, TRANSLATION_FIRST_ATTEMPT_MS) : remaining;
      try { return await this.attempt<T>(path, encoded, budget); }
      catch (error) {
        if (!translation || attempt !== 0 || !(error instanceof LookupFailure) || !error.retryable) throw error;
      }
    }
  }
  private async attempt<T>(path: string, body: string, timeoutMs: number): Promise<T> {
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { reject(timedOut(path)); controller.abort(); }, timeoutMs);
    });
    try {
      return await Promise.race([(async () => {
        const response = await this.fetcher(this.origin + path, { method: 'POST', body,
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', signal: controller.signal });
        if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); throw timedOut(path); }
        if (!response.ok) {
          void response.body?.cancel().catch(() => {});
          throw new LookupFailure(response.status === 429 ? 'Too many lookups. Please try again shortly.'
            : response.status === 404 ? 'Definition not found.' : 'Lookup service is unavailable. Please try again.',
          [502, 503, 504].includes(response.status));
        }
        if (!response.headers.get('content-type')?.includes('application/json') || !response.body) {
          void response.body?.cancel().catch(() => {});
          throw new LookupFailure('Lookup service returned an invalid response.');
        }
        reader = response.body.getReader();
        const chunks: Uint8Array[] = []; let count = 0;
        while (true) {
          const next = await reader.read(); if (next.done) break;
          count += next.value.length;
          if (count > 256 * 1024) throw new LookupFailure('Lookup response is too large.');
          chunks.push(next.value);
        }
        const bytes = new Uint8Array(count); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as T; }
        catch { throw new LookupFailure('Lookup service returned an invalid response.'); }
      })(), deadline]);
    } catch (error) {
      if (error instanceof LookupFailure) throw error;
      if (controller.signal.aborted || error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) throw timedOut(path);
      if (error instanceof TypeError) throw unavailable();
      throw error;
    } finally {
      clearTimeout(timer);
      if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    }
  }
}
// Resolve fetch at request time so an extension service worker and tests can replace it.
export const publicLookupClient = new PublicLookupClient(LOOKUP_SERVICE_ORIGIN, (...args) => fetch(...args));
