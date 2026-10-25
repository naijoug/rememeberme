// Temporary HTTPS connectors target this loopback-only, lookup-only bridge.
// It has no credentials or access to account/database routes.
import { createServer } from 'node:http';
import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';

const paths = new Set(['/api/v1/public/lookup/dictionary', '/api/v1/public/lookup/translation']);
export function createLookupBridge({ fetcher = fetch, upstream = 'http://127.0.0.1:8787' } = {}) {
  const base = new URL(upstream);
  if (base.origin !== 'http://127.0.0.1:8787') throw new Error('The lookup bridge targets only the local Remember Me API.');
  let active = 0;
  const server = createServer({ maxHeaderSize: 8 * 1024 }, async (incoming, outgoing) => {
    const reply = (status, code) => {
      outgoing.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      outgoing.end(JSON.stringify({ error: { code } }));
    };
    const health = incoming.url === '/api/v1/health' && incoming.method === 'GET';
    if (!health && (!paths.has(incoming.url) || !['POST', 'OPTIONS'].includes(incoming.method))) { incoming.resume(); reply(404, 'NOT_FOUND'); return; }
    if (active >= 8) { incoming.resume(); reply(503, 'LOOKUP_BUSY'); return; }
    active++;
    try {
      const origin = incoming.headers.origin;
      if (origin !== undefined && typeof origin !== 'string') { reply(403, 'ORIGIN_REJECTED'); return; }
      const chunks = []; let bytes = 0;
      for await (const chunk of incoming) {
        bytes += chunk.length;
        if (bytes > 2048) { incoming.resume(); reply(413, 'REQUEST_TOO_LARGE'); return; }
        chunks.push(chunk);
      }
      const headers = { Accept: 'application/json', ...(origin ? { Origin: origin } : {}) };
      // Cloudflare overwrites CF-Connecting-IP at its edge. Ignore client-supplied XFF/auth/cookies.
      const address = incoming.headers['cf-connecting-ip'];
      if (typeof address === 'string' && isIP(address)) headers['X-Forwarded-For'] = address;
      else headers['X-Forwarded-For'] = 'temporary-lookup-unknown';
      if (typeof incoming.headers['content-type'] === 'string') headers['Content-Type'] = incoming.headers['content-type'];
      for (const name of ['access-control-request-method', 'access-control-request-headers']) {
        if (typeof incoming.headers[name] === 'string') headers[name] = incoming.headers[name];
      }
      const response = await fetcher(base.origin + incoming.url, { method: incoming.method, headers,
        ...(incoming.method === 'POST' ? { body: Buffer.concat(chunks) } : {}), redirect: 'error', signal: AbortSignal.timeout(20_000) });
      const outputHeaders = {};
      for (const name of ['content-type', 'cache-control', 'access-control-allow-origin', 'access-control-allow-methods',
        'access-control-allow-headers', 'vary', 'retry-after', 'x-request-id']) {
        const value = response.headers.get(name); if (value) outputHeaders[name] = value;
      }
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length > 256 * 1024) throw new Error('Oversize lookup response');
      outgoing.writeHead(response.status, outputHeaders); outgoing.end(body);
    } catch { if (!outgoing.headersSent) reply(502, 'LOOKUP_UNAVAILABLE'); else outgoing.destroy(); }
    finally { active--; }
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000;
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createLookupBridge();
  server.listen(8788, '127.0.0.1', () => console.info('Lookup-only bridge listening on loopback 8788'));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
}
