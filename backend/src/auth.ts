import { ApiError, object, text, keys } from '../../contracts/api-v1';
import { challenge, sha, token, cookie, providerJSON } from './http';
import { timingSafeEqual } from 'node:crypto';
import type { Bindings, Database } from './runtime';

export interface Identity { userId: string; deviceId: string; timezone: string; syncContext: boolean; syncURLs: boolean; epoch: string; sourceRevision: number; sessionHash: string }
interface SessionRow { user_id: string; device_id: string; timezone: string; sync_context: number; sync_urls: number; sync_epoch: string; source_revision: number }
interface FlowRow {
  state_hash: string; client_state: string; challenge: string; callback: string; device_name: string;
  provider_verifier: string; expires_at: number; claimed_by: string | null; code_hash: string | null;
  user_id: string | null; code_expires_at: number | null; redeemed_by: string | null;
}
export async function identity(request: Request, db: Database, now = Date.now()): Promise<Identity> {
  const raw = request.headers.get('Authorization');
  if (!raw || !/^Bearer [A-Za-z0-9_-]{43}$/.test(raw)) throw new ApiError('UNAUTHENTICATED', 401);
  const sessionHash = await sha(raw.slice(7));
  const row = await db.prepare(`SELECT s.user_id,s.device_id,u.timezone,u.sync_context,u.sync_urls,u.sync_epoch,u.source_revision
    FROM sessions s JOIN users u ON u.id=s.user_id JOIN devices d ON d.user_id=s.user_id AND d.id=s.device_id
    WHERE s.token_hash=? AND s.access_expires_at>? AND s.revoked_at IS NULL AND u.deleted_at IS NULL AND d.revoked_at IS NULL`)
    .bind(sessionHash, now).first<SessionRow>();
  if (!row) throw new ApiError('UNAUTHENTICATED', 401);
  return { userId: row.user_id, deviceId: row.device_id, timezone: row.timezone,
    syncContext: !!row.sync_context, syncURLs: !!row.sync_urls, epoch: row.sync_epoch, sourceRevision: row.source_revision, sessionHash };
}
export async function startNative(request: Request, env: Bindings): Promise<Response> {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) throw new ApiError('LOGIN_NOT_CONFIGURED', 503);
  const url = new URL(request.url), state = url.searchParams.get('state'), pkce = url.searchParams.get('challenge');
  const callback = url.searchParams.get('callback'), name = url.searchParams.get('deviceName') ?? 'Remember Me';
  if (!state || !/^[A-Za-z0-9_-]{32,128}$/.test(state) || !pkce || !/^[A-Za-z0-9_-]{43}$/.test(pkce)
    || !callback || !env.NATIVE_CALLBACKS.split(',').includes(callback) || !text(name, 80)) throw new ApiError('INVALID_LOGIN_REQUEST');
  const oauthState = token(), verifier = token(), now = Date.now();
  await env.DB.prepare(`INSERT INTO auth_flows(state_hash,client_state,challenge,callback,device_name,provider_verifier,expires_at)
    VALUES(?,?,?,?,?,?,?)`).bind(await sha(oauthState), state, pkce, callback, name, verifier, now + 600_000).run();
  const authorization = new URL('https://github.com/login/oauth/authorize');
  authorization.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  authorization.searchParams.set('redirect_uri', env.PUBLIC_ORIGIN + '/auth/github/callback');
  authorization.searchParams.set('state', oauthState); authorization.searchParams.set('code_challenge', await challenge(verifier));
  authorization.searchParams.set('code_challenge_method', 'S256'); authorization.searchParams.set('scope', '');
  return new Response(null, { status: 302, headers: { Location: authorization.toString(),
    'Set-Cookie': `rm_auth_flow=${oauthState}; HttpOnly; Secure; SameSite=Lax; Path=/auth; Max-Age=600`,
    'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
export async function githubCallback(request: Request, env: Bindings): Promise<Response> {
  const url = new URL(request.url), state = url.searchParams.get('state'), code = url.searchParams.get('code'), now = Date.now();
  const browser = cookie(request, 'rm_auth_flow');
  if (!state || !code || !browser || !/^[A-Za-z0-9_-]{43}$/.test(state) || state.length !== browser.length
    || !timingSafeEqual(new TextEncoder().encode(state), new TextEncoder().encode(browser))) throw new ApiError('LOGIN_STATE_REJECTED', 401);
  const hash = await sha(state), nonce = token();
  const claim = await env.DB.prepare('UPDATE auth_flows SET claimed_by=? WHERE state_hash=? AND expires_at>? AND claimed_by IS NULL RETURNING *')
    .bind(nonce, hash, now).all<FlowRow>();
  const flow = claim.results[0]; if (!flow) throw new ApiError('LOGIN_STATE_REJECTED', 401);
  try {
    const response = await providerJSON('https://github.com/login/oauth/access_token', { method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code,
        redirect_uri: env.PUBLIC_ORIGIN + '/auth/github/callback', code_verifier: flow.provider_verifier }) });
    if (!object(response) || typeof response.access_token !== 'string') throw new ApiError('LOGIN_PROVIDER_REJECTED', 401);
    const profile = await providerJSON('https://api.github.com/user', { headers: {
      Authorization: `Bearer ${response.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'Remember-Me' } });
    if (!object(profile) || !Number.isSafeInteger(profile.id) || !text(profile.login, 100)) throw new ApiError('LOGIN_PROVIDER_REJECTED', 401);
    const userId = 'user:' + crypto.randomUUID(), oneTimeCode = token(), epoch = token();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO users(id,provider_id,login,sync_epoch,created_at) VALUES(?,?,?,?,?) ON CONFLICT(provider_id) DO UPDATE SET login=excluded.login')
        .bind(userId, String(profile.id), profile.login, epoch, now),
      env.DB.prepare('UPDATE auth_flows SET user_id=(SELECT id FROM users WHERE provider_id=?),code_hash=?,code_expires_at=?,provider_verifier=\'\' WHERE state_hash=? AND claimed_by=?')
        .bind(String(profile.id), await sha(oneTimeCode), now + 120_000, hash, nonce)
    ]);
    const callback = new URL(flow.callback); callback.searchParams.set('state', flow.client_state); callback.searchParams.set('code', oneTimeCode);
    return new Response(null, { status: 302, headers: { Location: callback.toString(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
      'Set-Cookie': 'rm_auth_flow=; HttpOnly; Secure; SameSite=Lax; Path=/auth; Max-Age=0' } });
  } catch (error) {
    // A provider failure consumes this browser state. Start a fresh login, rather
    // than allowing an attacker to replay a provider code on the same flow.
    throw error instanceof ApiError ? error : new ApiError('LOGIN_PROVIDER_UNAVAILABLE', 502, true);
  }
}
function credentials(now: number) {
  return { accessToken: token(), refreshToken: token(), accessExpiresAtMs: now + 900_000, refreshExpiresAtMs: now + 30 * 86_400_000 };
}
export async function exchangeNative(input: unknown, db: Database) {
  if (!object(input)) throw new ApiError('INVALID_REQUEST'); keys(input, ['code', 'verifier'], ['code', 'verifier']);
  if (!text(input.code, 100) || !/^[A-Za-z0-9_-]{43}$/.test(input.code) || !text(input.verifier, 128)
    || !/^[A-Za-z0-9._~-]{43,128}$/.test(input.verifier)) throw new ApiError('INVALID_REQUEST');
  const now = Date.now(), codeHash = await sha(input.code), proof = await challenge(input.verifier);
  const flow = await db.prepare('SELECT * FROM auth_flows WHERE code_hash=? AND code_expires_at>? AND redeemed_by IS NULL AND challenge=?')
    .bind(codeHash, now, proof).first<FlowRow>();
  if (!flow?.user_id) throw new ApiError('LOGIN_CODE_REJECTED', 401);
  const deviceId = crypto.randomUUID(), nonce = token(), pair = credentials(now), guard = token();
  await db.batch([
    db.prepare(`INSERT INTO write_guards(nonce,allowed) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM auth_flows f JOIN users u ON u.id=f.user_id
      WHERE f.code_hash=? AND f.code_expires_at>? AND f.redeemed_by IS NULL AND f.challenge=? AND u.deleted_at IS NULL) THEN 1 ELSE 0 END`)
      .bind(guard, codeHash, now, proof),
    db.prepare('UPDATE auth_flows SET redeemed_by=? WHERE code_hash=? AND redeemed_by IS NULL').bind(nonce, codeHash),
    db.prepare('INSERT INTO devices(user_id,id,name,created_at) VALUES(?,?,?,?)').bind(flow.user_id, deviceId, flow.device_name, now),
    db.prepare('INSERT INTO sessions(token_hash,user_id,device_id,refresh_hash,access_expires_at,refresh_expires_at) VALUES(?,?,?,?,?,?)')
      .bind(await sha(pair.accessToken), flow.user_id, deviceId, await sha(pair.refreshToken), pair.accessExpiresAtMs, pair.refreshExpiresAtMs),
    db.prepare('DELETE FROM write_guards WHERE nonce=?').bind(guard)
  ]).catch(error => {
    if (error instanceof Error && error.message.includes('CHECK constraint failed')) throw new ApiError('LOGIN_CODE_REJECTED', 401);
    throw new ApiError('AUTH_STORAGE_UNAVAILABLE', 503, true);
  });
  return { ...pair, userId: flow.user_id, deviceId };
}
export async function refreshSession(input: unknown, db: Database) {
  if (!object(input)) throw new ApiError('INVALID_REQUEST'); keys(input, ['refreshToken'], ['refreshToken']);
  if (!text(input.refreshToken, 100) || !/^[A-Za-z0-9_-]{43}$/.test(input.refreshToken)) throw new ApiError('INVALID_REQUEST');
  const now = Date.now(), hash = await sha(input.refreshToken);
  const session = await db.prepare(`SELECT s.user_id,s.device_id,u.timezone,u.sync_context,u.sync_urls,u.sync_epoch FROM sessions s
    JOIN users u ON u.id=s.user_id JOIN devices d ON d.user_id=s.user_id AND d.id=s.device_id
    WHERE s.refresh_hash=? AND s.refresh_expires_at>? AND s.revoked_at IS NULL AND d.revoked_at IS NULL AND u.deleted_at IS NULL`)
    .bind(hash, now).first<SessionRow>();
  if (!session) throw new ApiError('REFRESH_REJECTED', 401);
  const pair = credentials(now), guard = token();
  await db.batch([
    db.prepare(`INSERT INTO write_guards(nonce,allowed) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM sessions s
      JOIN devices d ON d.user_id=s.user_id AND d.id=s.device_id JOIN users u ON u.id=s.user_id
      WHERE s.refresh_hash=? AND s.revoked_at IS NULL AND s.refresh_expires_at>? AND d.revoked_at IS NULL AND u.deleted_at IS NULL) THEN 1 ELSE 0 END`)
      .bind(guard, hash, Date.now()),
    db.prepare('UPDATE sessions SET revoked_at=? WHERE refresh_hash=?').bind(now, hash),
    db.prepare('INSERT INTO sessions(token_hash,user_id,device_id,refresh_hash,access_expires_at,refresh_expires_at) VALUES(?,?,?,?,?,?)')
      .bind(await sha(pair.accessToken), session.user_id, session.device_id, await sha(pair.refreshToken), pair.accessExpiresAtMs, pair.refreshExpiresAtMs),
    db.prepare('DELETE FROM write_guards WHERE nonce=?').bind(guard)
  ]).catch(error => {
    if (error instanceof Error && error.message.includes('CHECK constraint failed')) throw new ApiError('REFRESH_REJECTED', 401);
    throw new ApiError('AUTH_STORAGE_UNAVAILABLE', 503, true);
  });
  return { ...pair, userId: session.user_id, deviceId: session.device_id };
}
