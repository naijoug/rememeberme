import { serve } from '@hono/node-server';
import { app } from './index';
import { createRuntime, defaultDirectories } from './node-runtime';

const port = Number(process.env.PORT || 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid API port');
const runtime = createRuntime({
  ...defaultDirectories(), databasePath: process.env.DATABASE_PATH || './data/rememberme.sqlite',
  configuration: process.env,
});
const server = serve({
  hostname: '127.0.0.1', port,
  fetch: (request, bindings) => {
    const address = bindings.incoming.socket.remoteAddress || 'unknown';
    const forwarded = bindings.incoming.headers['x-forwarded-for'];
    const trusted = process.env.TRUST_LOOPBACK_PROXY === 'true' && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
    const clientIP = trusted && typeof forwarded === 'string' ? forwarded.split(',').at(-1)!.trim() : address;
    return app.fetch(request, { ...runtime, CLIENT_IP: clientIP });
  },
}, () => console.info(JSON.stringify({ event: 'listening', port })));
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (stopping) return; stopping = true;
    server.close(() => { runtime.DB.close(); process.exit(0); });
    if ('closeIdleConnections' in server) server.closeIdleConnections();
    setTimeout(() => { if ('closeAllConnections' in server) server.closeAllConnections(); }, 15_000).unref();
  });
}
