import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [runtimeArgument, environmentPath] = process.argv.slice(2);
if (!runtimeArgument || !environmentPath) throw new Error('Usage: node verify-github-login.mjs RUNTIME_DIRECTORY PRIVATE_ENV_FILE');
const directory = resolve(runtimeArgument);
const { app, createRuntime } = await import(pathToFileURL(join(directory, 'library.mjs')).href);
const configuration = {};
for (const line of (await readFile(environmentPath, 'utf8')).split('\n')) {
  const separator = line.indexOf('=');
  const name = line.slice(0, separator);
  if (!['ENVIRONMENT', 'PUBLIC_ORIGIN', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'NATIVE_CALLBACKS', 'CLIENT_ORIGINS'].includes(name)) continue;
  const value = line.slice(separator + 1).trim();
  configuration[name] = value.startsWith('"') ? JSON.parse(value) : value;
}
assert.equal(configuration.PUBLIC_ORIGIN, 'https://rememberme.couplelabs.cn');
assert.ok(configuration.GITHUB_CLIENT_ID && configuration.GITHUB_CLIENT_SECRET);
assert.ok(configuration.NATIVE_CALLBACKS.split(',').includes('rememberme://auth/callback'));
// Login checks use only an in-memory account store and never create production sessions.
const runtime = createRuntime({ databasePath: ':memory:', migrations: join(directory, 'migrations'),
  publicDirectory: join(directory, 'public'), configuration });
try {
  const state = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(randomBytes(32)).digest('base64url');
  const start = new URL('/auth/native/start', configuration.PUBLIC_ORIGIN);
  start.search = new URLSearchParams({ state, challenge, callback: 'rememberme://auth/callback', deviceName: 'Synthetic login preflight' }).toString();
  const response = await app.fetch(new Request(start), { ...runtime, CLIENT_IP: 'synthetic-preflight' });
  assert.equal(response.status, 302);
  const authorization = new URL(response.headers.get('Location'));
  assert.equal(authorization.origin, 'https://github.com');
  assert.equal(authorization.pathname, '/login/oauth/authorize');
  assert.equal(authorization.searchParams.get('client_id'), configuration.GITHUB_CLIENT_ID);
  assert.equal(authorization.searchParams.get('redirect_uri'), configuration.PUBLIC_ORIGIN + '/auth/github/callback');
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
  assert.match(authorization.searchParams.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(authorization.searchParams.get('scope'), '');
  assert.match(response.headers.get('Set-Cookie'), /HttpOnly; Secure; SameSite=Lax/);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  for (const callback of ['https://unregistered.chromiumapp.org/auth/callback', 'https://example.invalid/callback', 'rememberme://auth/other']) {
    start.searchParams.set('callback', callback);
    const rejected = await app.fetch(new Request(start), { ...runtime, CLIENT_IP: 'synthetic-preflight' });
    assert.equal(rejected.status, 400);
    assert.equal((await rejected.json()).error.code, 'INVALID_LOGIN_REQUEST');
  }
  const denied = await app.fetch(new Request(new URL('/api/v1/me', configuration.PUBLIC_ORIGIN)), runtime);
  assert.equal(denied.status, 401);
  assert.equal((await runtime.DB.prepare('SELECT count(*) AS n FROM users').first()).n, 0);
  assert.equal((await runtime.DB.prepare('SELECT count(*) AS n FROM sessions').first()).n, 0);
  console.log('OAuth configuration checks passed: native redirect, exact callback, PKCE, secure cookie, no extra scopes and unauthorized access; production database unused.');
} finally { runtime.DB.close(); }
