// Synthetic extension -> real HTTP -> Node/SQLite. Never use an installed profile.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { app, createRuntime, HermesTranslator, WindowLimiter } from '../.build/library.mjs';

const backend = resolve(fileURLToPath(new URL('..', import.meta.url)));
const extension = resolve(backend, '../frontend/browser-extension');
createRequire(join(extension, 'package.json'))('fake-indexeddb/auto');
const directory = await mkdtemp(join(tmpdir(), 'rememberme-browser-http-'));
const definition = { word: 'synthetic', phonetics: [], meanings: [] };
const legacy = [{ word: 'synthetic', count: 0.5, createdAt: 0.5, updatedAt: 1e100,
  history: Array.from({ length: 26 }, (_, index) => ({ timestamp: 26 - index, definition,
    context: 'Synthetic private context ' + index, url: 'https://example.test/private/' + index })) }];
const originalFetch = globalThis.fetch, originalNow = Date.now;
let clock = originalNow(), runtime, loss = true;
Date.now = () => clock;
const bodies = [];
const server = createServer(async (incoming, outgoing) => {
  try {
    const chunks = []; for await (const chunk of incoming) chunks.push(chunk);
    const body = Buffer.concat(chunks), headers = { ...incoming.headers };
    delete headers.host; delete headers.connection;
    const request = new Request(origin + incoming.url, { method: incoming.method, headers, ...(body.length ? { body } : {}) });
    const response = await app.fetch(request, runtime);
    if (incoming.url === '/api/v1/sync/operations') {
      bodies.push(body.toString());
      if (loss && response.ok && JSON.parse(body).kind === 'seed') {
        loss = false; incoming.socket.destroy(); return;
      }
    }
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    if (!outgoing.headersSent) outgoing.writeHead(500, { 'Content-Type': 'application/json' });
    outgoing.end(JSON.stringify({ error: { code: 'SYNTHETIC_FIXTURE_FAILURE' } }));
  }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const origin = 'http://127.0.0.1:' + server.address().port;
globalThis.fetch = (url, init) => {
  assert.equal(new URL(url).origin, origin, 'No outbound provider requests in this fixture');
  return originalFetch(url, init);
};
try {
  runtime = createRuntime({ databasePath: join(directory, 'fixture.sqlite'), migrations: join(backend, 'migrations'),
    publicDirectory: join(backend, 'public'), configuration: { PUBLIC_ORIGIN: origin, ENVIRONMENT: 'local' } });
  runtime.AUTH_LIMIT = new WindowLimiter(1000); runtime.API_LIMIT = new WindowLimiter(10_000);
  runtime.TRANSLATOR = new HermesTranslator({ baseURL: 'http://127.0.0.1:8643/v1', key: 'synthetic-fixture-key',
    model: 'synthetic-model', fetch: async url => new Response(JSON.stringify(String(url).endsWith('/toolsets')
      ? [] : { choices: [{ message: { content: '{"text":"合成释义"}' } }] }), { headers: { 'Content-Type': 'application/json' } }) });
  const bundle = join(directory, 'browser.mjs');
  await build({ stdin: { contents: `
    export { BackendClient } from './services/backend-client';
    export { CloudVocabulary } from './services/cloud-vocabulary';
    export { VocabularyDB } from './services/vocabulary-db';
    export { fixtureDisk } from 'wxt/utils/storage';`, resolveDir: extension },
    outfile: bundle, bundle: true, platform: 'node', format: 'esm', target: 'node22',
    define: { 'import.meta.env.DEV': 'true' },
    plugins: [{ name: 'synthetic-extension-storage', setup(builder) {
      builder.onResolve({ filter: /^wxt\/utils\/storage$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
        export const fixtureDisk = new Map();
        export const storage = {
          getItem: async key => structuredClone(fixtureDisk.get(key) ?? null),
          setItem: async (key, value) => { fixtureDisk.set(key, structuredClone(value)); },
          removeItem: async key => { fixtureDisk.delete(key); }
        };`, loader: 'js' }));
    } }] });
  await runtime.DB.prepare('INSERT INTO users(id,provider_id,login,sync_epoch,created_at) VALUES(?,?,?,?,?)')
    .bind('synthetic-user', 'synthetic-provider', 'Synthetic User', 'synthetic-epoch', 1).run();
  const devices = [];
  for (const name of ['A', 'B']) {
    const module = await import(pathToFileURL(bundle).href + '?device=' + name);
    const deviceId = 'synthetic-device-' + name, accessToken = randomBytes(32).toString('base64url'), refreshToken = randomBytes(32).toString('base64url');
    const credentials = { userId: 'synthetic-user', deviceId, accessToken, refreshToken,
      accessExpiresAtMs: clock - 1000, refreshExpiresAtMs: clock + 86_400_000 };
    const hash = value => createHash('sha256').update(value).digest('hex');
    await runtime.DB.prepare('INSERT INTO devices(user_id,id,name,created_at) VALUES(?,?,?,?)').bind('synthetic-user', deviceId, name, 1).run();
    await runtime.DB.prepare('INSERT INTO sessions(token_hash,user_id,device_id,refresh_hash,access_expires_at,refresh_expires_at) VALUES(?,?,?,?,?,?)')
      .bind(hash(accessToken), 'synthetic-user', deviceId, hash(refreshToken), credentials.accessExpiresAtMs, credentials.refreshExpiresAtMs).run();
    module.fixtureDisk.set('local:backendConnection', { origin, credentials });
    module.fixtureDisk.set('local:words', legacy);
    const client = new module.BackendClient(), database = new module.VocabularyDB('synthetic-http-' + name + '-' + randomBytes(8).toString('hex'));
    devices.push({ module, client, database, repository: new module.CloudVocabulary(database, client) });
  }
  const [a, b] = devices;
  await a.repository.openAccount(true);
  await assert.rejects(a.repository.setEnabled(true));
  const first = bodies[0];
  clock += 31_000;
  a.repository = new a.module.CloudVocabulary(a.database, a.client);
  await a.repository.synchronize();
  assert.equal(bodies[1], first, 'Reopened extension retries exactly the committed request');
  assert.equal((await a.repository.getWord('synthetic')).count, 0.5);
  await b.repository.openAccount();
  assert.equal((await b.repository.getWord('synthetic')).history.length, 26);
  assert.deepEqual((await b.repository.getWord('synthetic')).history.map(row => row.timestamp), legacy[0].history.map(row => row.timestamp));
  await b.repository.setEnabled(true);
  await b.repository.saveWord('synthetic', definition, 'Another synthetic private source', 'https://example.test/private/new', 30);
  await b.repository.synchronize(); await a.repository.synchronize();
  assert.equal((await a.repository.getWord('synthetic')).count, 1.5);
  assert.equal((await a.repository.getWord('synthetic')).history.length, 27);
  assert.equal((await a.repository.getWord('synthetic')).history[0].context, legacy[0].history[0].context);
  assert.ok(bodies.every(body => !body.includes('example.test/private') && !body.includes('private context')));
  const translation = await a.client.request('/api/v1/lookup/translation', 'POST', { word: 'synthetic', target: 'zh-CN' });
  assert.equal(translation.translation.source, 'hermes');
  await a.repository.resetCount('synthetic');
  await b.repository.saveWord('synthetic', definition, '', '', 31); await b.repository.synchronize();
  await assert.rejects(a.repository.synchronize(), /VERSION_CONFLICT/);
  assert.equal((await a.repository.status()).conflicts, 1);
  assert.equal((await b.repository.getWord('synthetic')).count, 2.5);
  await a.repository.archiveAndReloadCloud();
  const recovered = await a.repository.status();
  assert.equal(recovered.enabled, false); assert.equal(recovered.pending, 0);
  assert.equal(JSON.parse(await a.repository.exportArchive(recovered.archives[0].key))[0].count, 0);
  assert.equal((await a.repository.getWord('synthetic')).count, 2.5);
  await runtime.DB.prepare('UPDATE users SET sync_epoch=? WHERE id=?').bind('restored-epoch', 'synthetic-user').run();
  await assert.rejects(b.repository.synchronize(), /server was restored/);
  assert.equal((await b.repository.status()).enabled, false);
  await b.repository.useLocal();
  assert.deepEqual(JSON.parse(await b.repository.exportData()), legacy);
  console.log('Extension repository and authenticated client -> real Node/SQLite HTTP: refresh, exact restart retry, cross-device history, privacy, conflict archive and epoch fencing passed. Hermes protocol uses a synthetic provider.');
} finally {
  globalThis.fetch = originalFetch; Date.now = originalNow;
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  runtime?.DB.close(); await rm(directory, { recursive: true, force: true });
}
