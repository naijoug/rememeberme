import { expect, it, vi } from 'vitest';
import gateway, { type AccountGatewayEnv } from '../account-gateway';
import entry from '../account-entry/public/_worker.js';
import lookupEntry from '../lookup-entry/public/_worker.js';
const extension = 'chrome-extension://blmbjchnpodecheenfmajdjfpmgimdcj';
const origin = 'https://rememberme.couplelabs.cn';
function fixture() {
  const fetch = vi.fn().mockResolvedValue(new Response('{"error":{"code":"UNAUTHENTICATED"}}', { status: 401, headers: { 'Content-Type': 'application/json' } }));
  const env: AccountGatewayEnv = { PUBLIC_ORIGIN: origin, CLIENT_ORIGIN: extension, ACCOUNT_SERVICE: { fetch },
    ACCOUNT_RATE: { limit: vi.fn().mockResolvedValue({ success: true }) } };
  const call = (path: string, init: RequestInit = {}) => gateway.fetch(new Request(origin + path, init), env);
  return { fetch, env, call };
}
it('routes only account requests to the account gateway and retains anonymous lookup isolation', async () => {
  const account = vi.fn().mockImplementation(async () => new Response('account')), lookup = vi.fn().mockImplementation(async () => new Response('lookup'));
  const assets = vi.fn().mockImplementation(async () => new Response('asset'));
  const env = { ACCOUNT_GATEWAY: { fetch: account }, ASSETS: { fetch: assets } };
  for (const path of ['/auth/native/start?state=synthetic', '/api/v1/me', '/api/v1/sync/changes?cursor=1', '/api/v1/capabilities', '/api/v1/health'])
    expect(await (await entry.fetch(new Request(origin + path), env)).text()).toBe('account');
  for (const path of ['/', '/privacy', '/api/v1/public/lookup/translation', '/api/v1/public/lookup/dictionary'])
    expect(await (await entry.fetch(new Request(origin + path), env)).text()).toBe('asset');
  for (const path of ['/api/v1/health', '/api/v1/public/lookup/translation', '/api/v1/me'])
    expect(await (await lookupEntry.fetch(new Request(origin + path), { LOOKUP_GATEWAY: { fetch: lookup } })).text()).toBe('lookup');
  expect(account).toHaveBeenCalledTimes(5); expect(lookup).toHaveBeenCalledTimes(3); expect(assets).toHaveBeenCalledTimes(4);
});
it('preserves exact frozen operations, bearer/epoch and query cursors while dropping unrelated cookies and proxy headers', async () => {
  const { fetch, call } = fixture();
  const body = '{ "operations": [], "fixture": "literal <tag>" }';
  const response = await call('/api/v1/sync/operations?cursor=a%2Fb', { method: 'POST', body, headers: {
    Authorization: 'Bearer synthetic', 'X-Sync-Epoch': 'epoch', 'X-Client-Capabilities': 'history-order-v1',
    Origin: extension, Cookie: 'private=secret', 'X-Forwarded-For': 'spoof', 'CF-Connecting-IP': '192.0.2.1', 'Content-Type': 'application/json',
  } });
  expect(response.status).toBe(401); expect(await response.json()).toEqual({ error: { code: 'UNAUTHENTICATED' } });
  expect(response.headers.get('Cache-Control')).toBe('no-store'); expect(response.headers.get('Access-Control-Allow-Origin')).toBe(extension);
  const request: Request = fetch.mock.calls[0][0];
  expect(request.url).toBe('http://rememberme-account.internal:8787/api/v1/sync/operations?cursor=a%2Fb');
  expect(await request.text()).toBe(body); expect(request.redirect).toBe('manual');
  expect(request.headers.get('Authorization')).toBe('Bearer synthetic'); expect(request.headers.get('X-Sync-Epoch')).toBe('epoch');
  expect(request.headers.get('Cookie')).toBeNull(); expect(request.headers.get('X-Forwarded-For')).toBe('192.0.2.1');
  expect(request.headers.get('CF-Connecting-IP')).toBe('192.0.2.1');
});
it('preserves OAuth state cookie and exact permitted redirects without following them', async () => {
  const { fetch, call } = fixture();
  const cookie = 'rm_auth_flow=' + 's'.repeat(43) + '; HttpOnly; Secure; SameSite=Lax; Path=/auth';
  fetch.mockImplementation(async () => new Response(null, { status: 302, headers: { Location: 'https://github.com/login/oauth/authorize?state=fixture', 'Set-Cookie': cookie } }));
  let response = await call('/auth/native/start?state=fixture');
  expect(response.status).toBe(302); expect(response.headers.get('Set-Cookie')).toBe(cookie);
  fetch.mockImplementation(async () => new Response(null, { status: 302, headers: { Location: 'rememberme://auth/callback?state=fixture&code=one-time' } }));
  response = await call('/auth/github/callback?state=fixture&code=provider', { headers: { Cookie: 'other=private; rm_auth_flow=' + 's'.repeat(43) } });
  expect(response.status).toBe(302); expect(fetch.mock.calls[1][0].headers.get('Cookie')).toBe('rm_auth_flow=' + 's'.repeat(43));
  for (const target of ['https://evil.test/callback', 'rememberme://auth/other', 'https://github.com.evil.test/login/oauth/authorize']) {
    fetch.mockImplementation(async () => new Response(null, { status: 302, headers: { Location: target } }));
    expect((await call('/auth/github/callback?state=fixture')).status).toBe(503);
  }
});
it('rejects other origins, public routes and large bodies before forwarding account requests', async () => {
  const { fetch, call } = fixture();
  expect((await call('/api/v1/me', { headers: { Origin: 'chrome-extension://' + 'a'.repeat(32) } })).status).toBe(403);
  expect((await call('/api/v1/public/lookup/translation', { method: 'POST' })).status).toBe(404);
  expect((await call('/api/v1/sync/operations', { method: 'POST', body: 'x'.repeat(256 * 1024 + 1) })).status).toBe(413);
  expect(fetch).not.toHaveBeenCalled();
});
it('retains conflict metadata and preflight while blocking HTML, unexpected redirects and private transport details', async () => {
  const { fetch, call } = fixture();
  fetch.mockImplementation(async () => new Response('{"error":{"code":"SYNC_EPOCH_CHANGED","epoch":"fixture"}}', { status: 409, headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'private=secret' } }));
  let response = await call('/api/v1/me');
  expect(response.status).toBe(409); expect((await response.json()).error.epoch).toBe('fixture'); expect(response.headers.get('Set-Cookie')).toBeNull();
  fetch.mockImplementation(async () => new Response(null, { status: 204, headers: { 'Access-Control-Allow-Headers': 'Authorization,Content-Type,X-Sync-Epoch' } }));
  response = await call('/api/v1/sync/operations', { method: 'OPTIONS', headers: { Origin: extension, 'Access-Control-Request-Method': 'POST' } });
  expect(response.status).toBe(204); expect(response.headers.get('Access-Control-Allow-Origin')).toBe(extension);
  fetch.mockImplementation(async () => new Response('<h1>private host detail</h1>', { headers: { 'Content-Type': 'text/html' } }));
  expect((await call('/api/v1/me')).status).toBe(503);
  fetch.mockRejectedValue(new Error('secret internal connection detail'));
  expect(await (await call('/api/v1/me')).text()).not.toContain('secret');
});
