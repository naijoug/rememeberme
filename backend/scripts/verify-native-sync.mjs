// Local-only Swift -> HTTP -> Node/SQLite integration. Never a production route.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, createRuntime, WindowLimiter, MagpieTranslator } from '../.build/library.mjs';

const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const probe = process.argv[2] && resolve(process.argv[2]);
if (!probe) throw new Error('Usage: node scripts/verify-native-sync.mjs /absolute/path/RememberMeProbe');
const temporary = await mkdtemp(join(tmpdir(), 'rememberme-native-sync-'));
const hash = value => createHash('sha256').update(value).digest('hex');
const definition = { word: 'synthetic-shared', phonetics: [], meanings: [] };
const legacy = [{ word: 'synthetic-shared', count: 0.5, createdAt: 0.5, updatedAt: 1e100,
  history: Array.from({ length: 26 }, (_, index) => ({ timestamp: index % 3 === 0 ? 30 : index,
    context: 'Synthetic private source ' + index, url: 'https://example.test/private/' + index, definition })) }];
const bytes = JSON.stringify(legacy);
await writeFile(join(temporary, 'synthetic-fixture-only'), 'Disposable synthetic integration fixtures only.\n');
await writeFile(join(temporary, 'legacy.json'), bytes, { mode: 0o600 });
let worker, lossArmed = false, lostOperation, outboundCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { outboundCalls++; throw new Error('Integration fixtures must never contact an external provider'); };
let sourcePhase = false, sourceLossArmed = false;
const operations = [];
const authCalls = [];
const errors = [];
const server = createServer(async (request, response) => {
  try {
    assert.ok(request.url.startsWith('/api/v1/'), 'fixture proxy accepts only API paths');
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const headers = { ...request.headers }; delete headers.host; delete headers.connection;
    let operation;
    if (request.url === '/api/v1/auth/refresh') authCalls.push(request.url);
    if (request.url === '/api/v1/sync/operations') {
      operation = JSON.parse(body.toString());
      operations.push({ id: operation.operationId, kind: operation.kind, digest: hash(body) });
      if (!sourcePhase && (operation.kind === 'record' || operation.kind === 'importHistory')) {
        const events = operation.kind === 'record' ? [operation.payload.event] : operation.payload.events;
        assert.ok(events.every(event => !('context' in event) && !('url' in event)), 'default wire must omit private source fields');
      }
    }
    const result = await worker.dispatchFetch(origin + request.url, {
      method: request.method, headers, ...(body.length ? { body } : {})
    });
    const data = Buffer.from(await result.arrayBuffer());
    if (sourceLossArmed && request.url === '/api/v1/sources/clear' && result.status === 200) {
      request.socket.destroy(); return;
    }
    if (lossArmed && result.status === 200 && operation?.kind === 'seed') {
      lostOperation ??= { id: operation.operationId, digest: hash(body) };
      assert.equal(operation.operationId, lostOperation.id);
      request.socket.destroy(); // Commit happened in the real SQLite database; no reply.
      return;
    }
    response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(data);
  } catch (error) {
    errors.push(error);
    if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { code: 'FIXTURE_FAILURE', retryable: false, requestId: '00000000-0000-0000-0000-000000000001' } }));
  }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const origin = 'http://127.0.0.1:' + server.address().port;
const configurations = {};
try {
  const runtime = createRuntime({
    databasePath: join(temporary, 'synthetic.sqlite'), migrations: join(backend, 'migrations'), publicDirectory: join(backend, 'public'),
    configuration: { PUBLIC_ORIGIN: origin, ENVIRONMENT: 'local' },
  });
  runtime.AUTH_LIMIT = new WindowLimiter(1000); runtime.API_LIMIT = new WindowLimiter(10_000);
  runtime.TRANSLATOR = new MagpieTranslator({ baseURL: 'http://127.0.0.1:3425/v1',
    key: 'synthetic-fixture-key', model: 'synthetic-model', fetch: async (url, init) => {
      if (String(url).endsWith('/chat/completions')) {
        const input = JSON.parse(init.body);
        assert.deepEqual(input.messages[1], { role: 'user', content: 'synthetic-shared' });
      }
      return new Response(JSON.stringify(String(url).endsWith('/toolsets') ? []
        : { choices: [{ finish_reason: 'stop', message: { content: '{"text":"合成释义"}' } }] }), { headers: { 'Content-Type': 'application/json' } });
    } });
  worker = {
    dispatchFetch: (url, init) => app.fetch(new Request(url, init), runtime),
    dispose: () => runtime.DB.close(),
  };
  const db = runtime.DB;
  const now = Date.now();
  for (const [name, user] of [['A', 'shared'], ['B', 'shared'], ['C', 'isolated']]) {
    const userId = 'synthetic-user-' + user, deviceId = 'synthetic-device-' + name;
    const accessToken = randomBytes(32).toString('base64url'), refreshToken = randomBytes(32).toString('base64url');
    await db.prepare('INSERT INTO users(id,provider_id,login,sync_epoch,created_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING')
      .bind(userId, user, 'Synthetic ' + user, 'synthetic-epoch-' + user, 1).run();
    await db.prepare('INSERT INTO devices(user_id,id,name,created_at) VALUES(?,?,?,?)').bind(userId, deviceId, 'Synthetic device ' + name, 1).run();
    const credentials = { userId, deviceId, accessToken, refreshToken, accessExpiresAtMs: name === 'A' ? now - 1000 : now + 900_000, refreshExpiresAtMs: now + 86_400_000 };
    await db.prepare('INSERT INTO sessions(token_hash,user_id,device_id,refresh_hash,access_expires_at,refresh_expires_at) VALUES(?,?,?,?,?,?)')
      .bind(hash(accessToken), userId, deviceId, hash(refreshToken), credentials.accessExpiresAtMs, credentials.refreshExpiresAtMs).run();
    const directory = join(temporary, name); await mkdir(directory);
    configurations[name] = join(directory, 'fixture.json');
    await writeFile(configurations[name], JSON.stringify({ format: 'rememberme-native-sync-fixture', origin, credentials }), { mode: 0o600 });
  }
  async function command(device, action) {
    const child = spawn(probe, ['native-sync', configurations[device], action], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    const deadline = setTimeout(() => child.kill('SIGKILL'), 90_000);
    const [code] = await once(child, 'exit'); clearTimeout(deadline);
    assert.equal(code, 0, action + ' failed: ' + stderr.slice(-4000));
    assert.equal(errors.length, 0, 'fixture HTTP proxy failed');
    const report = stdout.split('\n').filter(line => line.startsWith('{')).at(-1);
    return report ? JSON.parse(report) : null;
  }
  const translation = await command('A', 'translation');
  assert.deepEqual(translation, { source: 'magpie', target: 'zh-CN', text: '合成释义' });
  console.log('Real Swift authenticated translation -> HTTP -> Node/Magpie adapter passed with synthetic inference.');
  assert.deepEqual(await command('A', 'reminder-claim'), { deviceId: 'synthetic-device-A', revision: 1 });
  assert.deepEqual(await command('B', 'reminder-claim'), { deviceId: 'synthetic-device-B', revision: 2 });
  assert.deepEqual(await command('A', 'reminder-state'), { deviceId: 'synthetic-device-B', revision: 2 });
  assert.deepEqual(await command('B', 'reminder-release'), { deviceId: null, revision: 3 });
  console.log('Real Swift reminder selection, cross-device handoff, fresh-process read and release passed.');
  const entry = report => report.entries.find(value => value.word === 'synthetic-shared');
  const a = await command('A', 'prepare'), b = await command('B', 'prepare');
  assert.equal(entry(a).id, entry(b).id); assert.equal(entry(a).count, 1.5); assert.equal(entry(b).count, 1.5);
  assert.equal(operations.length, 0, 'ownership preparation must not send words');
  assert.equal(authCalls.length, 1, 'the expired Swift device must refresh through the actual Worker endpoint');
  lossArmed = true; await command('A', 'lose-response-exit'); lossArmed = false;
  const frozen = JSON.parse(await readFile(join(temporary, 'A/lost-response.json'), 'utf8'));
  assert.equal(frozen.operationId, lostOperation.id); assert.equal(frozen.requestDigest, lostOperation.digest);
  assert.equal(await db.prepare('SELECT count FROM vocabulary_entries WHERE user_id=?').bind('synthetic-user-shared').first('count'), 0.5);
  await command('A', 'sync'); await command('B', 'sync');
  const alignedA = await command('A', 'sync'), alignedB = await command('B', 'sync');
  for (const report of [alignedA, alignedB]) {
    assert.equal(report.pending, 0); assert.equal(report.conflicts, 0);
    assert.equal(entry(report).count, 2.5); assert.equal(entry(report).historyCount, 28);
    assert.equal(entry(report).privateHistoryCount, 27);
    const digest = hash(bytes);
    const retained = Array.from({ length: 26 }, (_, index) => 'encounter:' + hash(JSON.stringify(['legacy-encounter-v1', digest, 0, index])));
    assert.deepEqual(entry(report).eventIds.slice(0, 26), retained);
  }
  const replay = operations.filter(value => value.id === frozen.operationId);
  assert.ok(replay.length >= 3); assert.ok(replay.every(value => value.digest === frozen.requestDigest));
  assert.equal(await db.prepare('SELECT count(*) AS n FROM sync_operations WHERE id=?').bind(frozen.operationId).first('n'), 1);
  assert.equal(await db.prepare("SELECT count(*) AS n FROM encounters WHERE context<>'' OR url<>''").first('n'), 0);
  assert.equal(authCalls.length, 1, 'reopened Swift processes must use the persisted rotated fixture credentials');
  console.log('Real Swift/URLSession -> Node/SQLite shared baseline, refresh, response-loss/restart and retained history passed.');
  await command('A', 'merge');
  const merged = await command('A', 'sync'); await command('B', 'sync');
  assert.equal(entry(merged).count, 3); assert.equal(entry(merged).historyCount, 54); assert.equal(merged.conflicts, 0);
  await command('A', 'create-unknown'); const nullable = await command('A', 'sync');
  assert.equal(nullable.entries.find(value => value.id === 'synthetic-unknown').count, null);
  await command('A', 'review'); const reviewed = await command('A', 'sync');
  assert.equal(entry(reviewed).count, 3); assert.equal(entry(reviewed).reviewStep, 0);
  const remoteReview = await command('B', 'sync'); assert.equal(entry(remoteReview).reviewStep, 0);
  await command('A', 'backup-save');
  await command('A', 'reset'); await command('B', 'record'); await command('B', 'sync');
  const conflicted = await command('A', 'sync');
  assert.equal(conflicted.conflicts, 1); assert.deepEqual(conflicted.conflictCodes, ['VERSION_CONFLICT']);
  assert.equal(entry(conflicted).count, 0);
  const resolved = await command('A', 'use-cloud'); assert.equal(entry(resolved).count, 4);
  const beforeBackupSend = operations.length;
  await command('A', 'backup-ready-exit');
  const stagedBackup = await command('A', 'inspect'); assert.equal(entry(stagedBackup).count, 4);
  assert.equal(operations.length, beforeBackupSend);
  const restoredBackup = await command('A', 'backup-resume'); assert.equal(entry(restoredBackup).count, 3); assert.equal(restoredBackup.pending, 1);
  assert.equal(operations.length, beforeBackupSend, 'account backup publication keeps sending paused');
  await command('A', 'enable'); const restoredCloud = await command('A', 'sync');
  assert.equal(entry(restoredCloud).count, 3); assert.equal(entry(restoredCloud).historyCount, 55);
  assert.equal(entry(restoredCloud).reviewStep, 0); assert.equal(restoredCloud.reviewAllowance, 19);
  assert.equal(restoredCloud.pending, 0); assert.equal(restoredCloud.conflicts, 0);
  assert.deepEqual(operations.slice(beforeBackupSend).map(value => value.kind), ['restore', 'importHistory', 'importHistory', 'importHistory']);
  assert.equal(await db.prepare('SELECT count(*) AS n FROM review_events WHERE user_id=?').bind('synthetic-user-shared').first('n'), 1);
  console.log('Real account backup field restore, staged process exit/recheck, history independence and no review replay passed.');
  sourcePhase = true;
  await command('A', 'source-enable'); await command('A', 'source-backfill');
  await command('A', 'enable'); const enriched = await command('A', 'sync');
  assert.equal(enriched.pending, 0); assert.equal(entry(enriched).count, 3); assert.equal(entry(enriched).reviewStep, 0);
  const sourced = await db.prepare("SELECT count(*) AS n FROM encounters WHERE user_id=? AND context<>''").bind('synthetic-user-shared').first('n');
  assert.ok(sourced > 0);
  await command('A', 'source-freeze');
  sourceLossArmed = true; await command('A', 'source-clear-loss-exit'); sourceLossArmed = false;
  assert.equal(await db.prepare("SELECT count(*) AS n FROM encounters WHERE user_id=? AND (context<>'' OR url<>'')").bind('synthetic-user-shared').first('n'), 0);
  const beforeClearRetry = operations.length;
  await command('A', 'source-clear'); await command('A', 'source-enable'); await command('A', 'enable');
  const protectedRetry = await command('A', 'sync');
  assert.equal(operations.length, beforeClearRetry, 'frozen source request must be rejected locally after clear/reopen/re-enable');
  assert.deepEqual(protectedRetry.conflictCodes, ['SOURCE_CONSENT_CHANGED']);
  assert.ok(entry(protectedRetry).privateHistoryCount > 0, 'local sources remain available');
  await command('A', 'use-cloud');
  await command('A', 'source-backfill'); await command('A', 'enable');
  const reconsented = await command('A', 'sync');
  assert.equal(reconsented.conflicts, 0); assert.equal(entry(reconsented).count, 3);
  assert.ok(await db.prepare("SELECT count(*) AS n FROM encounters WHERE user_id=? AND context<>''").bind('synthetic-user-shared').first('n') > 0);
  await command('A', 'source-clear'); await command('A', 'enable');
  sourcePhase = false;
  console.log('Real source consent/backfill, committed removal loss/restart/retry and stale frozen request fencing passed; counts/review and local sources preserved.');
  await command('A', 'delete'); const deleted = await command('A', 'sync');
  assert.equal(entry(deleted).deleted, true);
  // This offline client records over its earlier live base; the server tombstone
  // must reject it, retaining the local input rather than resurrecting the word.
  await command('B', 'offline-record');
  const tombstone = await command('B', 'sync'); assert.equal(entry(tombstone).deleted, true);
  assert.deepEqual(tombstone.conflictCodes, ['ENTRY_DELETED']);
  const isolated = await command('C', 'connect-empty'); assert.deepEqual(isolated.entries, []); assert.equal(isolated.pending, 0);
  await db.prepare('UPDATE users SET sync_epoch=? WHERE id=?').bind('synthetic-restored-epoch', 'synthetic-user-shared').run();
  await command('A', 'create-after-epoch');
  const beforeEpochSend = operations.length;
  const epoch = await command('A', 'sync');
  assert.equal(epoch.phase, 'epochConflict'); assert.equal(epoch.pending, 1);
  assert.equal(operations.length, beforeEpochSend, 'old-epoch intents must not be sent after a restored server identity is observed');
  const recovery = await command('A', 'snapshot');
  assert.equal(recovery.epoch, 'synthetic-restored-epoch'); assert.equal(recovery.localPhase, 'epochConflict'); assert.equal(recovery.localPending, 1);
  assert.equal(entry(recovery).deleted, true); assert.equal(entry(recovery).historyCount, 55);
  assert.equal(recovery.entries.length, 2); assert.equal(operations.length, beforeEpochSend);
  await command('A', 'recover-ready-exit');
  const beforePublication = await command('A', 'inspect');
  assert.equal(beforePublication.phase, 'epochConflict'); assert.equal(beforePublication.pending, 1);
  assert.equal(operations.length, beforeEpochSend, 'a process exit before publication must retain the old active store and queue');
  const published = await command('A', 'recover-resume');
  assert.equal(published.phase, 'ready'); assert.equal(published.pending, 1); assert.equal(published.conflicts, 0);
  assert.equal(operations.length, beforeEpochSend, 'confirmed recovery remains paused');
  const fresh = published.entries.find(value => value.word === 'synthetic-pending-epoch');
  assert.notEqual(fresh.id, 'synthetic-pending-epoch');
  await command('A', 'enable'); const resumed = await command('A', 'sync');
  assert.equal(resumed.pending, 0); assert.equal(resumed.conflicts, 0); assert.equal(resumed.phase, 'ready');
  assert.equal(entry(resumed).deleted, true); assert.equal(entry(resumed).count, 3);
  const submissions = operations.slice(beforeEpochSend);
  assert.equal(submissions.length, 1); assert.equal(submissions[0].kind, 'create');
  assert.equal(await db.prepare('SELECT count(*) AS n FROM vocabulary_entries WHERE user_id=? AND id=?').bind('synthetic-user-shared', fresh.id).first('n'), 1);
  assert.equal(outboundCalls, 0);
  console.log('Real conflicts/merge/null/review/tombstones/account isolation and confirmed restored-epoch recovery passed; only a fresh chosen lifecycle was sent.');
} finally {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  if (worker) await worker.dispose();
  globalThis.fetch = originalFetch;
  await rm(temporary, { recursive: true, force: true });
}
