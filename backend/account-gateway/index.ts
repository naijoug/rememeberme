/// <reference path="./bindings.d.ts" />
// Authenticated account transport. Binding names come from Wrangler's generated types.
export type AccountGatewayEnv = Pick<AccountWorkerEnv, 'PUBLIC_ORIGIN' | 'CLIENT_ORIGIN' | 'ACCOUNT_SERVICE' | 'ACCOUNT_RATE'>;

const authPaths = ['/auth/native/start', '/auth/extension/start', '/auth/github/callback'];
export function accountPath(path: string): boolean {
  return authPaths.includes(path) || path === '/api/v1/capabilities'
    || path.startsWith('/api/v1/') && !['/api/v1/health', '/api/v1/public/lookup/dictionary', '/api/v1/public/lookup/translation'].includes(path);
}
async function bounded(body: ReadableStream<Uint8Array> | null, maximum: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!body) return new Uint8Array();
  const reader = body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('BODY_TIMEOUT')), 10_000); });
  try {
    while (true) {
      const result = await Promise.race([reader.read(), deadline]); if (result.done) break;
      size += result.value.byteLength;
      if (size > maximum) throw new Error('BODY_TOO_LARGE');
      chunks.push(result.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } finally { if (timer !== undefined) clearTimeout(timer); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
function allowedRedirect(location: string, path: string, clientOrigin: string): boolean {
  try {
    const target = new URL(location);
    if (path !== '/auth/github/callback') return target.origin === 'https://github.com' && target.pathname === '/login/oauth/authorize';
    const extensionID = new URL(clientOrigin).hostname;
    return target.protocol === 'rememberme:' && target.hostname === 'auth' && target.pathname === '/callback'
      || target.origin === `https://${extensionID}.chromiumapp.org` && target.pathname === '/auth/callback';
  } catch { return false; }
}
export default {
  async fetch(request: Request, env: AccountGatewayEnv): Promise<Response> {
    const url = new URL(request.url), origin = request.headers.get('Origin');
    const headers = new Headers({ 'Cache-Control': 'no-store', 'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    const reply = (status: number, code: string) => new Response(JSON.stringify({ error: { code, retryable: status >= 500 || status === 429 } }), { status, headers });
    const health = url.pathname === '/api/v1/health' && request.method === 'GET';
    if (url.origin !== env.PUBLIC_ORIGIN || !accountPath(url.pathname) && !health || url.search.length > 8192
      || !['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'].includes(request.method)) return reply(404, 'NOT_FOUND');
    if (origin && ![env.PUBLIC_ORIGIN, env.CLIENT_ORIGIN].includes(origin)) return reply(403, 'ORIGIN_REJECTED');
    if (origin) { headers.set('Access-Control-Allow-Origin', origin); headers.set('Vary', 'Origin'); }
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    if (!(await env.ACCOUNT_RATE.limit({ key: ip })).success) { headers.set('Retry-After', '60'); return reply(429, 'RATE_LIMITED'); }
    let body: Uint8Array<ArrayBuffer> | undefined;
    try {
      if (!['GET', 'OPTIONS'].includes(request.method) && request.body) body = await bounded(request.body, 256 * 1024);
    } catch { return reply(413, 'REQUEST_TOO_LARGE'); }
    const upstreamHeaders = new Headers({ Accept: 'application/json', 'CF-Connecting-IP': ip, 'X-Forwarded-For': ip });
    for (const name of ['Origin', 'Content-Type', 'Authorization', 'X-Sync-Epoch', 'X-Client-Capabilities',
      'Access-Control-Request-Method', 'Access-Control-Request-Headers']) {
      const value = request.headers.get(name); if (value) upstreamHeaders.set(name, value);
    }
    if (authPaths.includes(url.pathname)) {
      const cookie = request.headers.get('Cookie')?.split(';').map(part => part.trim()).find(part => /^rm_auth_flow=[A-Za-z0-9_-]{43}$/.test(part));
      if (cookie) upstreamHeaders.set('Cookie', cookie);
    }
    try {
      // The VPC service fixes the destination to loopback 8787; client URLs cannot select a host.
      const target = new Request('http://rememberme-account.internal:8787' + url.pathname + url.search, {
        method: request.method, headers: upstreamHeaders, ...(body?.length ? { body } : {}),
        redirect: 'manual', signal: AbortSignal.timeout(20_000),
      });
      const response = await env.ACCOUNT_SERVICE.fetch(target);
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('Location');
        if (!authPaths.includes(url.pathname) || !location || !allowedRedirect(location, url.pathname, env.CLIENT_ORIGIN)) throw new Error('INVALID_REDIRECT');
        headers.set('Location', location);
        const cookie = response.headers.get('Set-Cookie');
        if (cookie?.startsWith('rm_auth_flow=')) headers.set('Set-Cookie', cookie);
        return new Response(null, { status: response.status, headers });
      }
      if (response.status !== 204 && !response.headers.get('Content-Type')?.includes('application/json')) throw new Error('INVALID_RESPONSE');
      for (const name of ['Content-Type', 'X-Request-Id', 'Retry-After', 'Access-Control-Allow-Methods', 'Access-Control-Allow-Headers']) {
        const value = response.headers.get(name); if (value) headers.set(name, value);
      }
      const bytes = await bounded(response.body, 16 * 1024 * 1024);
      return new Response(response.status === 204 ? null : bytes, { status: response.status, headers });
    } catch {
      // No request URL, OAuth codes, credentials or vocabulary are emitted to logs.
      return reply(503, 'ACCOUNT_SERVICE_UNAVAILABLE');
    }
  },
};
