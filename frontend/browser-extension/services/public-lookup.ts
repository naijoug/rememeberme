import { LOOKUP_SERVICE_ORIGIN } from '~/config/backend';

export class PublicLookupClient {
  constructor(private origin = LOOKUP_SERVICE_ORIGIN, private fetcher: typeof fetch = fetch) {}
  async request<T>(path: string, method: string, body: unknown): Promise<T> {
    if (!['/api/v1/public/lookup/dictionary', '/api/v1/public/lookup/translation'].includes(path) || method !== 'POST') throw new Error('Invalid lookup request.');
    const response = await this.fetcher(this.origin + path, { method, body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', signal: AbortSignal.timeout(20_000) });
    if (!response.headers.get('content-type')?.includes('application/json') || !response.body) throw new Error('Lookup service is unavailable. Please try again.');
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let count = 0;
    try {
      while (true) {
        const next = await reader.read(); if (next.done) break;
        count += next.value.length; if (count > 256 * 1024) throw new Error('Lookup response is too large.');
        chunks.push(next.value);
      }
      const bytes = new Uint8Array(count); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!response.ok) throw new Error(response.status === 429 ? 'Too many lookups. Please try again shortly.'
        : response.status === 404 ? 'Definition not found.' : 'Lookup service is unavailable. Please try again.');
      return value;
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
}
// Resolve fetch at request time so an extension service worker and tests can replace it.
export const publicLookupClient = new PublicLookupClient(LOOKUP_SERVICE_ORIGIN, (...args) => fetch(...args));
