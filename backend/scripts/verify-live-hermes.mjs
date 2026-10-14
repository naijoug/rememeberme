import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [runtimeArgument, environmentPath] = process.argv.slice(2);
if (!runtimeArgument || !environmentPath) throw new Error('Usage: node verify-live-hermes.mjs RUNTIME_DIRECTORY PRIVATE_ENV_FILE');
const directory = resolve(runtimeArgument);
const { app, createRuntime } = await import(pathToFileURL(join(directory, 'library.mjs')).href);
const configuration = {};
for (const line of (await readFile(environmentPath, 'utf8')).split('\n')) {
  const separator = line.indexOf('=');
  const name = line.slice(0, separator);
  if (!['HERMES_BASE_URL', 'HERMES_API_KEY', 'HERMES_MODEL'].includes(name)) continue;
  const value = line.slice(separator + 1).trim();
  configuration[name] = value.startsWith('"') ? JSON.parse(value) : value;
}
const upstream = new URL(configuration.HERMES_BASE_URL);
assert.equal(upstream.protocol, 'http:');
assert.equal(upstream.hostname, '127.0.0.1');
assert.ok(configuration.HERMES_API_KEY && configuration.HERMES_MODEL);
// Always create a disposable database; production DATABASE_PATH and OAuth values are ignored.
const fixture = await mkdtemp(join(tmpdir(), 'rememberme-live-hermes-'));
let runtime, server;
try {
  runtime = createRuntime({ databasePath: join(fixture, 'fixture.sqlite'), migrations: join(directory, 'migrations'),
    publicDirectory: join(directory, 'public'), configuration: { ...configuration, ENVIRONMENT: 'local', PUBLIC_ORIGIN: 'http://127.0.0.1' } });
  const access = randomBytes(32).toString('base64url'), hash = createHash('sha256').update(access).digest('hex');
  await runtime.DB.batch([
    runtime.DB.prepare('INSERT INTO users(id,provider_id,login,sync_epoch,created_at) VALUES(?,?,?,?,?)')
      .bind('synthetic-user', 'synthetic-provider', 'Synthetic', 'synthetic-epoch', Date.now()),
    runtime.DB.prepare('INSERT INTO devices(user_id,id,name,created_at) VALUES(?,?,?,?)')
      .bind('synthetic-user', 'synthetic-device', 'Synthetic acceptance', Date.now()),
    runtime.DB.prepare('INSERT INTO sessions(token_hash,user_id,device_id,refresh_hash,access_expires_at,refresh_expires_at) VALUES(?,?,?,?,?,?)')
      .bind(hash, 'synthetic-user', 'synthetic-device', 'synthetic-refresh', Date.now() + 60_000, Date.now() + 60_000),
  ]);
  server = createServer(async (incoming, outgoing) => {
    try {
      const chunks = []; let length = 0;
      for await (const chunk of incoming) {
        length += chunk.length;
        if (length > 1024) throw new Error('Unexpected fixture body');
        chunks.push(chunk);
      }
      const request = new Request('http://127.0.0.1' + incoming.url, { method: incoming.method,
        headers: incoming.headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
      const response = await app.fetch(request, { ...runtime, CLIENT_IP: 'synthetic-acceptance' });
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch { outgoing.writeHead(500); outgoing.end('Fixture transport failure'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  const body = JSON.stringify({ word: 'synthetic', target: 'zh-CN' });
  const denied = await fetch(origin + '/api/v1/lookup/translation', { method: 'POST', body,
    headers: { 'Content-Type': 'application/json' } });
  assert.equal(denied.status, 401); await denied.body.cancel();
  const started = Date.now();
  const reply = await fetch(origin + '/api/v1/lookup/translation', { method: 'POST', body,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + access }, signal: AbortSignal.timeout(17_000) });
  const result = await reply.json();
  if (reply.status !== 200) throw new Error('Live translation failed: HTTP ' + reply.status + ' ' + result.error?.code);
  assert.equal(result.translation.source, 'hermes'); assert.equal(result.translation.target, 'zh-CN');
  assert.ok(/[\u3400-\u9fff]/u.test(result.translation.text));
  console.log(JSON.stringify({ acceptance: 'real-http-authenticated-hermes', fixtureWord: 'synthetic',
    translation: result.translation.text, elapsedMs: Date.now() - started, productionDatabaseUsed: false }));
} finally {
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  runtime?.DB.close();
  await rm(fixture, { recursive: true, force: true });
}
