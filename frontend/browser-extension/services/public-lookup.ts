import { LOOKUP_SERVICE_ORIGIN } from '~/config/backend';
import { lookupCancelled } from './shared-lookup';
import { EXPLANATION_PATH, EXPLANATION_CAPABILITIES_PATH } from '../../../contracts/context-explanation';
import { TRANSLATION_FIRST_ATTEMPT_MS, TRANSLATION_REQUEST_BUDGET_MS } from '../../../contracts/translation-policy';
export { TRANSLATION_FIRST_ATTEMPT_MS, TRANSLATION_REQUEST_BUDGET_MS } from '../../../contracts/translation-policy';

// Recovery stays inside the service's 20s and UI's 22s deadlines. Only the
// word-only translation POST is retried; vocabulary writes never use this client.
class LookupFailure extends Error {
  constructor(message: string, readonly retryable = false) { super(message); }
}
const unavailable = () => new LookupFailure('Lookup service is unavailable. Please try again.', true);
const timedOut = (path: string) => new LookupFailure(path.endsWith('/translation')
  ? 'Chinese translation timed out. Please try again.' : path === EXPLANATION_PATH ? 'Sentence explanation timed out. Please try again.' : 'Dictionary lookup timed out. Please try again.', true);

export class PublicLookupClient {
  constructor(private origin = LOOKUP_SERVICE_ORIGIN, private fetcher: typeof fetch = fetch) {}
  async request<T>(path: string, method: string, body: unknown, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) throw lookupCancelled();
    if (!((['/api/v1/public/lookup/dictionary', '/api/v1/public/lookup/translation', EXPLANATION_PATH].includes(path) && method === 'POST') || (path === EXPLANATION_CAPABILITIES_PATH && method === 'GET' && body === undefined))) throw new Error('Invalid lookup request.');
    const translation = path.endsWith('/translation');
    const encoded = method === 'GET' ? undefined : JSON.stringify(body);
    const deadline = Date.now() + (translation ? TRANSLATION_REQUEST_BUDGET_MS : path === EXPLANATION_PATH ? 20_000 : 8_000);
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw lookupCancelled();
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw timedOut(path);
      const budget = translation && attempt === 0 ? Math.min(remaining, TRANSLATION_FIRST_ATTEMPT_MS) : remaining;
      try { return await this.attempt<T>(path, method, encoded, budget, signal); }
      catch (error) {
        if (signal?.aborted) throw lookupCancelled();
        if (!translation || attempt !== 0 || !(error instanceof LookupFailure) || !error.retryable) throw error;
      }
    }
  }
  private async attempt<T>(path: string, method: string, body: string | undefined, timeoutMs: number, signal?: AbortSignal): Promise<T> {
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onCancel: () => void;
    const readJSON = async (response: Response, limit: number): Promise<unknown> => {
      reader = response.body!.getReader();
      const chunks: Uint8Array[] = []; let count = 0;
      while (true) {
        const next = await reader.read(); if (next.done) break;
        count += next.value.length;
        if (count > limit) throw new LookupFailure('Lookup response is too large.');
        chunks.push(next.value);
      }
      const bytes = new Uint8Array(count); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; }
      catch { throw new LookupFailure('Lookup service returned an invalid response.'); }
    };
    const cancelled = new Promise<never>((_, reject) => {
      onCancel = () => { reject(lookupCancelled()); controller.abort(); };
      if (signal?.aborted) onCancel(); else signal?.addEventListener('abort', onCancel, { once: true });
    });
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { reject(timedOut(path)); controller.abort(); }, timeoutMs);
    });
    try {
      return await Promise.race([(async () => {
        if (signal?.aborted) throw lookupCancelled();
        const response = await this.fetcher(this.origin + path, { method, body,
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', signal: controller.signal });
        if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); throw timedOut(path); }
        if (!response.ok) {
          let retryable = [502, 503, 504].includes(response.status);
          if (retryable && response.headers.get('content-type')?.includes('application/json') && response.body) {
            // Only trust the boolean policy, never display an upstream message.
            // Error bodies share the attempt deadline and have a smaller size cap.
            const data = await readJSON(response, 8 * 1024);
            if (data && typeof data === 'object' && 'error' in data && data.error
              && typeof data.error === 'object' && 'retryable' in data.error && data.error.retryable === false) retryable = false;
          } else { void response.body?.cancel().catch(() => {}); }
          throw new LookupFailure(response.status === 429 ? 'Too many lookups. Please try again shortly.'
            : response.status === 404 ? 'Definition not found.' : 'Lookup service is unavailable. Please try again.',
          retryable);
        }
        if (!response.headers.get('content-type')?.includes('application/json') || !response.body) {
          void response.body?.cancel().catch(() => {});
          throw new LookupFailure('Lookup service returned an invalid response.');
        }
        return await readJSON(response, 256 * 1024) as T;
      })(), deadline, cancelled]);
    } catch (error) {
      if (signal?.aborted) throw lookupCancelled();
      if (error instanceof LookupFailure) throw error;
      if (controller.signal.aborted || error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) throw timedOut(path);
      if (error instanceof TypeError) throw unavailable();
      throw error;
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', onCancel!);
      if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    }
  }
}
// Resolve fetch at request time so an extension service worker and tests can replace it.
export const publicLookupClient = new PublicLookupClient(LOOKUP_SERVICE_ORIGIN, (...args) => fetch(...args));
