import { expect, it } from 'vitest';
import { app } from '../src/index';
import { env } from './node-bindings';
import { account } from './helpers';

it('allows only exact configured extension origins for preflight and authenticated API requests', async () => {
  const origin = 'chrome-extension://synthetic-installed-id';
  env.CLIENT_ORIGINS = origin;
  const preflight = await app.request('https://api.example.test/api/v1/me', { method: 'OPTIONS',
    headers: { Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'Authorization,X-Client-Capabilities' } }, env);
  expect(preflight.status).toBe(204); expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe(origin);
  const user = await account();
  const authenticated = await app.request('https://api.example.test/api/v1/me', {
    headers: { Origin: origin, Authorization: 'Bearer ' + user.access } }, env);
  expect(authenticated.status).toBe(200); expect(authenticated.headers.get('Access-Control-Allow-Origin')).toBe(origin);
  const rejected = await app.request('https://api.example.test/api/v1/me', {
    headers: { Origin: origin + '-different', Authorization: 'Bearer ' + user.access } }, env);
  expect(rejected.status).toBe(403);
  expect(rejected.headers.get('Access-Control-Allow-Origin')).toBeNull();
});

it('uses the existing PKCE flow for extension login with an exact registered callback', async () => {
  const callback = 'https://synthetic-installed-id.chromiumapp.org/auth/callback';
  env.NATIVE_CALLBACKS += ',' + callback;
  const start = (address: string) => '/auth/extension/start?' + new URLSearchParams({
    state: 's'.repeat(43), challenge: 'c'.repeat(43), callback: address, deviceName: 'Synthetic browser',
  });
  const accepted = await app.request('https://api.example.test' + start(callback), {}, env);
  expect(accepted.status).toBe(302);
  expect(new URL(accepted.headers.get('Location')!).origin).toBe('https://github.com');
  expect(accepted.headers.get('Set-Cookie')).toContain('HttpOnly; Secure; SameSite=Lax');
  for (const address of [callback + '/other', callback.replace('synthetic-installed-id', 'other-id')]) {
    expect((await app.request('https://api.example.test' + start(address), {}, env)).status).toBe(400);
  }
});
