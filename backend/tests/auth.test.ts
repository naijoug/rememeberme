import { env } from 'cloudflare:workers';
import { afterAll, afterEach, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { network } from './network';
import { account, request, create, send } from './helpers';
import { challenge, token, providerJSON, sha } from '../src/http';
import { app } from '../src/index';

beforeAll(() => network.enable());
beforeEach(() => network.use(http.all('*', () => HttpResponse.error())));
afterEach(() => network.resetHandlers());
afterAll(() => network.disable());
describe('native code exchange and device sessions', () => {
  it('recovers a lost refresh response with one persisted request ID, including concurrent retries', async () => {
    const user = await account(), requestId = token();
    const body = { refreshToken: user.refresh, requestId };
    const responses = await Promise.all([request('/api/v1/auth/refresh', undefined, 'POST', body), request('/api/v1/auth/refresh', undefined, 'POST', body)]);
    expect(responses.map(value => value.status)).toEqual([200, 200]);
    const pairs = await Promise.all(responses.map(value => value.json()));
    expect(pairs[0]).toEqual(pairs[1]);
    expect(await (await request('/api/v1/auth/refresh', undefined, 'POST', body)).json()).toEqual(pairs[0]);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM sessions WHERE revoked_at IS NULL').first('n')).toBe(1);
    expect((await request('/api/v1/auth/refresh', undefined, 'POST', { ...body, requestId: token() })).status).toBe(401);
    expect((await request('/api/v1/auth/refresh', undefined, 'POST', { refreshToken: user.refresh })).status).toBe(401);
    const rows = JSON.stringify((await env.DB.prepare('SELECT * FROM sessions').all()).results);
    expect(rows).not.toContain(user.refresh); expect(rows).not.toContain(requestId);
  });
  it('rejects rotation recovery after its time window, successor rotation or device revocation', async () => {
    for (const failure of ['expired', 'rotated', 'revoked']) {
      const user = await account(failure), body = { refreshToken: user.refresh, requestId: token() };
      const response = await request('/api/v1/auth/refresh', undefined, 'POST', body);
      const next = await response.json<{ accessToken: string; refreshToken: string }>();
      if (failure === 'expired') await env.DB.prepare('UPDATE sessions SET rotation_expires_at=0 WHERE refresh_hash=?').bind(await sha(user.refresh)).run();
      if (failure === 'rotated') expect((await request('/api/v1/auth/refresh', undefined, 'POST', { refreshToken: next.refreshToken, requestId: token() })).status).toBe(200);
      if (failure === 'revoked') await request('/api/v1/devices/' + user.deviceId, next.accessToken, 'DELETE');
      expect((await request('/api/v1/auth/refresh', undefined, 'POST', body)).status).toBe(401);
    }
  });
  it('revokes an expired-access session with its refresh token without affecting another account', async () => {
    const user = await account(), other = await account('other');
    await env.DB.prepare('UPDATE sessions SET access_expires_at=0 WHERE user_id=?').bind(user.userId).run();
    const body = { refreshToken: user.refresh };
    expect((await request('/api/v1/auth/logout', undefined, 'POST', body)).status).toBe(200);
    expect((await request('/api/v1/auth/logout', undefined, 'POST', body)).status).toBe(200);
    expect((await request('/api/v1/auth/refresh', undefined, 'POST', body)).status).toBe(401);
    expect((await request('/api/v1/me', other.access)).status).toBe(200);
  });
  it('revokes the successor when logging out after a lost refresh reply', async () => {
    const user = await account(), body = { refreshToken: user.refresh, requestId: token() };
    const next = await (await request('/api/v1/auth/refresh', undefined, 'POST', body)).json<{ accessToken: string; refreshToken: string }>();
    expect((await request('/api/v1/auth/logout', undefined, 'POST', { refreshToken: user.refresh })).status).toBe(200);
    expect((await request('/api/v1/me', next.accessToken)).status).toBe(401);
    expect((await request('/api/v1/auth/refresh', undefined, 'POST', { refreshToken: next.refreshToken })).status).toBe(401);
    expect((await request('/api/v1/auth/refresh', undefined, 'POST', body)).status).toBe(401);
  });
  it('does not allow an unknown or stale refresh token to revoke an active device', async () => {
    const user = await account(), body = { refreshToken: user.refresh, requestId: token() };
    const next = await (await request('/api/v1/auth/refresh', undefined, 'POST', body)).json<{ accessToken: string }>();
    await env.DB.prepare('UPDATE sessions SET rotation_expires_at=0 WHERE refresh_hash=?').bind(await sha(user.refresh)).run();
    for (const refreshToken of [token(), user.refresh]) expect((await request('/api/v1/auth/logout', undefined, 'POST', { refreshToken })).status).toBe(200);
    expect((await request('/api/v1/me', next.accessToken)).status).toBe(200);
  });
  it('keeps refresh-authenticated logout behind exact origin checks', async () => {
    const user = await account();
    const result = await app.request('https://api.example.test/api/v1/auth/logout', {
      method: 'POST', headers: { Origin: 'https://attacker.example.test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: user.refresh }),
    }, env);
    expect(result.status).toBe(403);
    expect((await request('/api/v1/me', user.access)).status).toBe(200);
  });
  it('fences a refresh racing with device logout', async () => {
    const user = await account();
    const [rotation, logout] = await Promise.all([
      request('/api/v1/auth/refresh', undefined, 'POST', { refreshToken: user.refresh, requestId: token() }),
      request('/api/v1/auth/logout', undefined, 'POST', { refreshToken: user.refresh }),
    ]);
    expect(logout.status).toBe(200); expect([200, 401]).toContain(rotation.status);
    if (rotation.status === 200) {
      const pair = await rotation.json<{ refreshToken: string }>();
      expect((await request('/api/v1/auth/refresh', undefined, 'POST', { refreshToken: pair.refreshToken })).status).toBe(401);
    }
    expect(await env.DB.prepare('SELECT count(*) AS n FROM sessions WHERE user_id=? AND revoked_at IS NULL').bind(user.userId).first('n')).toBe(0);
  });
  it('binds browser state and both PKCE challenges, then consumes one code exactly once', async () => {
    const verifier = token(), state = token(), proof = await challenge(verifier);
    const start = await request(`/auth/native/start?state=${state}&challenge=${proof}&callback=${encodeURIComponent('rememberme://auth/callback')}&deviceName=synthetic`);
    expect(start.status).toBe(302);
    const authorization = new URL(start.headers.get('Location')!);
    expect(authorization.origin).toBe('https://github.com'); expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
    const oauthState = authorization.searchParams.get('state')!, cookie = start.headers.get('Set-Cookie')!.split(';')[0];
    const denied = await request(`/auth/github/callback?state=${oauthState}&code=provider-code`); expect(denied.status).toBe(401);
    network.use(http.post('https://github.com/login/oauth/access_token', () => HttpResponse.json({ access_token: 'synthetic-provider-token' })),
      http.get('https://api.github.com/user', () => HttpResponse.json({ id: 123, login: 'synthetic' })));
    expect(await providerJSON('https://api.github.com/user')).toMatchObject({ id: 123, login: 'synthetic' });
    const callback = await app.request(`https://api.example.test/auth/github/callback?state=${oauthState}&code=provider-code`, { headers: { Cookie: cookie } }, env);
    expect(callback.status).toBe(302);
    const returned = new URL(callback.headers.get('Location')!);
    expect(returned.searchParams.get('state')).toBe(state); expect(returned.searchParams.get('accessToken')).toBe(null);
    const code = returned.searchParams.get('code')!;
    expect((await request('/api/v1/auth/exchange', undefined, 'POST', { code, verifier: token() })).status).toBe(401);
    const results = await Promise.all([1, 2].map(() => request('/api/v1/auth/exchange', undefined, 'POST', { code, verifier })));
    expect(results.map(r => r.status).sort()).toEqual([200, 401]);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM devices').first('n')).toBe(1);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM sessions').first('n')).toBe(1);
  });
  it('rotates refresh credentials and revokes both access/refresh by device', async () => {
    const user = await account();
    const response = await request('/api/v1/auth/refresh', undefined, 'POST', { refreshToken: user.refresh }); expect(response.status).toBe(200);
    const next = await response.json<{ accessToken: string; refreshToken: string }>();
    expect((await request('/api/v1/me', user.access)).status).toBe(401);
    expect((await request('/api/v1/me', next.accessToken)).status).toBe(200);
    expect((await request('/api/v1/auth/refresh', undefined, 'POST', { refreshToken: user.refresh })).status).toBe(401);
    expect((await request('/api/v1/devices/' + user.deviceId, next.accessToken, 'DELETE')).status).toBe(200);
    expect((await request('/api/v1/me', next.accessToken)).status).toBe(401);
    expect((await request('/api/v1/auth/refresh', undefined, 'POST', { refreshToken: next.refreshToken })).status).toBe(401);
    const row = await env.DB.prepare('SELECT token_hash,refresh_hash FROM sessions LIMIT 1').first<{ token_hash: string; refresh_hash: string }>();
    expect(row?.token_hash).toHaveLength(64); expect(row?.refresh_hash).toHaveLength(64);
  });
  it('rejects unknown callbacks and cross-origin writes and bounds streamed input', async () => {
    const state = token(), proof = await challenge(token());
    expect((await request(`/auth/native/start?state=${state}&challenge=${proof}&callback=${encodeURIComponent('https://attacker.example.test/')}`)).status).toBe(400);
    const user = await account();
    const cross = await app.request('https://api.example.test/api/v1/sync/operations', { method: 'POST', headers: { Origin: 'https://attacker.example.test', Authorization: 'Bearer ' + user.access, 'Content-Type': 'application/json' }, body: JSON.stringify(create()) }, env);
    expect(cross.status).toBe(403);
    const big = await request('/api/v1/sync/operations', user.access, 'POST', { data: 'x'.repeat(300_000) }); expect(big.status).toBe(413);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM vocabulary_entries').first('n')).toBe(0);
  });
  it('isolates device revocation and disables deleted accounts', async () => {
    const a = await account('A'), b = await account('B');
    await send(a.access, create());
    await request('/api/v1/devices/' + b.deviceId, a.access, 'DELETE');
    expect((await request('/api/v1/me', b.access)).status).toBe(200);
    expect((await request('/api/v1/account', a.access, 'DELETE')).status).toBe(200);
    expect((await send(a.access, create())).status).toBe(401);
    expect((await request('/api/v1/me', b.access)).status).toBe(200);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM sessions WHERE user_id=?').bind(a.userId).first('n')).toBe(0);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM vocabulary_entries WHERE user_id=?').bind(a.userId).first('n')).toBe(0);
  });
});
