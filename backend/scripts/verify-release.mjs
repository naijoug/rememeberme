import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
const archive = resolve(process.argv[2] || '.build/rememberme-api.tar.gz');
const directory = await mkdtemp(join(tmpdir(), 'rememberme-release-smoke-'));
let child;
try {
  const files = spawnSync('tar', ['-tzf', archive], { encoding: 'utf8' });
  assert.equal(files.status, 0);
  const names = files.stdout.trim().split('\n');
  assert.ok(names.includes('runtime/server.mjs') && names.includes('runtime/scripts/restore.mjs'));
  assert.ok(names.every(name => !name.includes('..') && !name.startsWith('/') && !/\.(sqlite|db)(-|$)/.test(name)
    && !name.endsWith('/api.env') && !name.endsWith('/.env')), 'Archive must exclude databases and credentials');
  assert.equal(spawnSync('tar', ['-xzf', archive, '-C', directory]).status, 0);
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const origin = 'http://127.0.0.1:' + port, databasePath = join(directory, 'state', 'fixture.sqlite');
  await mkdir(join(directory, 'state'));
  let output = '';
  child = spawn(process.execPath, [join(directory, 'runtime/server.mjs')], {
    cwd: join(directory, 'runtime'), stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, ENVIRONMENT: 'local', PUBLIC_ORIGIN: origin, PORT: String(port), DATABASE_PATH: databasePath },
  });
  child.stderr.on('data', value => { output += value; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Release startup timeout: ' + output.slice(-2000))), 10_000);
    child.stdout.on('data', value => {
      output += value;
      if (output.includes('"event":"listening"')) { clearTimeout(timer); resolve(); }
    });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error('Release stopped: ' + code + ' ' + output.slice(-2000))); });
  });
  for (const [path, status, mime] of [['/api/v1/health', 200, 'application/json'], ['/api/v1/me', 401, 'application/json'],
    ['/auth/missing', 404, 'application/json'], ['/', 200, 'text/html']]) {
    const response = await fetch(origin + path, { redirect: 'error' });
    assert.equal(response.status, status); assert.ok(response.headers.get('content-type').includes(mime)); await response.body.cancel();
  }
  const capability = await (await fetch(origin + '/api/v1/capabilities')).json();
  assert.equal(capability.translation, false); assert.ok(capability.translationSources.includes('hermes'));
  // A second SQLite connection produces a live WAL fixture for the online backup.
  const writer = new DatabaseSync(databasePath);
  writer.exec("PRAGMA journal_mode=WAL; INSERT INTO users(id,provider_id,login,sync_epoch,created_at) VALUES('synthetic-user','synthetic-provider','Synthetic','old-epoch',1)");
  const backup = join(directory, 'backup.sqlite'), restored = join(directory, 'restored.sqlite');
  for (const [script, source, target] of [['backup.mjs', databasePath, backup], ['restore.mjs', backup, restored]]) {
    if (script === 'restore.mjs') {
      writer.close(); const exit = once(child, 'exit'); child.kill('SIGTERM'); await exit; child = undefined;
    }
    const result = spawnSync(process.execPath, [join(directory, 'runtime/scripts', script), source, target], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  const checked = new DatabaseSync(restored, { readOnly: true });
  const user = checked.prepare('SELECT login,sync_epoch FROM users').get();
  assert.equal(user.login, 'Synthetic'); assert.notEqual(user.sync_epoch, 'old-epoch'); checked.close();
  assert.notEqual(spawnSync(process.execPath, [join(directory, 'runtime/scripts/backup.mjs'), backup, restored]).status, 0,
    'An existing recovery database must never be overwritten');
  assert.ok((await readFile(join(directory, 'deploy/api.env.example'), 'utf8')).includes('configure-before-deploy.invalid'));
  console.log('Extracted release: startup/health/auth boundary, credential-free archive, live WAL backup, new-path restore and fresh epochs passed.');
} finally {
  if (child) {
    const exit = once(child, 'exit'); child.kill('SIGTERM'); await exit;
  }
  await rm(directory, { recursive: true, force: true });
}
