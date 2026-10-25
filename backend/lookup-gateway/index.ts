const dictionary = '/api/v1/public/lookup/dictionary';
const translation = '/api/v1/public/lookup/translation';

async function readBounded(body: ReadableStream<Uint8Array> | null, limit: number): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  const reader = body.getReader(); const chunks: Uint8Array[] = []; let count = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      count += next.value.byteLength; if (count > limit) throw new Error('BODY_TOO_LARGE');
      chunks.push(next.value);
    }
    const value = new Uint8Array(count); let offset = 0;
    for (const chunk of chunks) { value.set(chunk, offset); offset += chunk.length; }
    return value;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
const corsOrigin = (origin: string | null) => origin === null || /^chrome-extension:\/\/[a-p]{32}$/.test(origin);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url), origin = request.headers.get('Origin');
    const headers = new Headers({ 'Cache-Control': 'no-store', 'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    const reply = (status: number, code: string) => new Response(JSON.stringify({ error: { code } }), { status, headers });
    if (url.search) return reply(404, 'NOT_FOUND');
    if (request.method === 'GET' && ['/privacy', '/privacy.html'].includes(url.pathname)) {
      const target = new URL('/privacy.html', url);
      const asset = await env.ASSETS.fetch(new Request(target, { method: 'GET' }));
      const output = new Headers(asset.headers);
      output.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
      output.set('X-Content-Type-Options', 'nosniff'); output.set('Referrer-Policy', 'no-referrer');
      return new Response(asset.body, { status: asset.status, headers: output });
    }
    const health = url.pathname === '/api/v1/health' && request.method === 'GET';
    if (!health && (![dictionary, translation].includes(url.pathname) || !['POST', 'OPTIONS'].includes(request.method))) return reply(404, 'NOT_FOUND');
    if (!corsOrigin(origin)) return reply(403, 'ORIGIN_REJECTED');
    if (origin) { headers.set('Access-Control-Allow-Origin', origin); headers.set('Vary', 'Origin'); }
    if (request.method === 'OPTIONS') {
      if (request.headers.get('Access-Control-Request-Method') !== 'POST'
        || (request.headers.get('Access-Control-Request-Headers') ?? '').split(',').some(h => h.trim() && !['content-type', 'accept'].includes(h.trim().toLowerCase()))) return reply(403, 'ORIGIN_REJECTED');
      headers.set('Access-Control-Allow-Methods', 'POST,OPTIONS'); headers.set('Access-Control-Allow-Headers', 'Content-Type,Accept');
      return new Response(null, { status: 204, headers });
    }
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (!health && !(await env.LOOKUP_RATE.limit({ key: ip })).success) {
      headers.set('Retry-After', '60'); return reply(429, 'RATE_LIMITED');
    }
    let body: Uint8Array | undefined, lookupWord = '';
    if (!health) {
      if (!request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase().endsWith('/json')) return reply(415, 'JSON_REQUIRED');
      try {
        body = await readBounded(request.body, 2048);
        const input: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(body));
        if (!input || typeof input !== 'object' || Array.isArray(input)) return reply(400, 'INVALID_LOOKUP');
        const values = Object.entries(input), allowed = url.pathname === translation ? ['word', 'target'] : ['word'];
        if (values.length !== allowed.length || values.some(([key]) => !allowed.includes(key))) return reply(400, 'INVALID_LOOKUP');
        const word = Reflect.get(input, 'word');
        if (typeof word !== 'string' || word.length > 500 || !/^[a-z](?:[a-z'-]*[a-z])?$/.test(word.trim().toLowerCase())
          || (url.pathname === translation && Reflect.get(input, 'target') !== 'zh-CN')) return reply(400, 'INVALID_LOOKUP');
        lookupWord = word.trim().toLowerCase();
      } catch (error) { return reply(error instanceof Error && error.message === 'BODY_TOO_LARGE' ? 413 : 400, 'INVALID_LOOKUP'); }
    }
    try {
      if (url.pathname === dictionary) {
        // English misses can use Cloudflare's egress instead of the Tencent route
        // that timed out during acceptance. The plugin still calls only this API.
        try {
          const remote = await fetch('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(lookupWord), {
            headers: { Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(3500),
          });
          if (!remote.ok || !remote.headers.get('Content-Type')?.includes('application/json')) throw new Error('DICTIONARY_UNAVAILABLE');
          const data: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(await readBounded(remote.body, 256 * 1024)));
          const entry = Array.isArray(data) && object(data[0]) ? { ...data[0], phonetics: data[0].phonetics ?? [] } : undefined;
          if (!validDefinition(entry) || !object(entry)) throw new Error('INVALID_DICTIONARY');
          return new Response(JSON.stringify({ definition: { word: entry.word, phonetics: entry.phonetics,
            meanings: entry.meanings, ...(typeof entry.phonetic === 'string' ? { phonetic: entry.phonetic } : {}), source: 'dictionary-api' } }), { headers });
        } catch { /* Server WordNet remains the recovery path when edge lookup fails. */ }
      }
      // VPC binding is restricted to loopback bridge 8788. No client URL/credential reaches it.
      const response = await env.LOOKUP_SERVICE.fetch('http://rememberme-lookup.internal:8788' + url.pathname, {
        method: request.method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
        ...(body ? { body } : {}), redirect: 'manual', signal: AbortSignal.timeout(20_000),
      });
      if (response.status >= 300 && response.status < 400 || !response.headers.get('Content-Type')?.includes('application/json')) throw new Error('INVALID_UPSTREAM');
      const value = await readBounded(response.body, 256 * 1024);
      if (response.status === 429) headers.set('Retry-After', '60');
      return new Response(value, { status: response.status, headers });
    } catch (error) {
      // Emit only documented VPC error codes; never log request words or URLs.
      const code = error instanceof Error ? error.message.match(/ProxyError: ([a-z_]+)/)?.[1] : undefined;
      console.warn('Lookup upstream failed', code ?? 'upstream_unavailable');
      return reply(503, 'LOOKUP_UNAVAILABLE');
    }
  },
} satisfies ExportedHandler<Env>;
import { definition as validDefinition, object } from '../../contracts/api-v1';
