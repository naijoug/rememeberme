import { env } from 'cloudflare:workers';
import { it, expect } from 'vitest';
import { account, create, request, send } from './helpers';
import { token, challenge, sha } from '../src/http';

it('preserves rejected operation identity instead of silently applying it later', async () => {
  const user = await account(); await send(user.access, create('existing', 'create-existing'));
  const conflicting = create('new', 'conflicting-create'); conflicting.payload.word = 'existing';
  expect((await send(user.access, conflicting)).status).toBe(409);
  await send(user.access, { operationId: 'delete-existing', entryId: 'existing', kind: 'delete', baseVersion: 1, payload: {} });
  expect((await send(user.access, conflicting)).status).toBe(409);
  expect((await send(user.access, { ...conflicting, operationId: 'explicit-new-create' })).status).toBe(200);
});
it('rejects expired native codes and rolls back failed exchanges without devices', async () => {
  const user = await account(), verifier = token(), code = token();
  await env.DB.prepare(`INSERT INTO auth_flows(state_hash,client_state,challenge,callback,device_name,provider_verifier,expires_at,code_hash,user_id,code_expires_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(await sha(token()), token(), await challenge(verifier), 'rememberme://auth/callback', 'synthetic', '', Date.now()+100000, await sha(code), user.userId, Date.now()-1).run();
  expect((await request('/api/v1/auth/exchange', undefined, 'POST', { code, verifier })).status).toBe(401);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM devices').first('n')).toBe(1);
});
it('keeps unknown API/auth routes JSON and enforces configured login rate limits', async () => {
  const user = await account();
  const missing = await request('/api/v1/unknown', user.access);
  expect(missing.status).toBe(404); expect(missing.headers.get('Content-Type')).toContain('json');
  const state = token(), proof = await challenge(token());
  let limited = false;
  for (let index=0; index<40; index++) {
    const response = await request(`/auth/native/start?state=${state}&challenge=${proof}&callback=${encodeURIComponent('https://wrong.example.test')}`);
    if (response.status === 429) { limited=true; expect(response.headers.get('Retry-After')).toBe('60'); break; }
  }
  expect(limited).toBe(true);
});
