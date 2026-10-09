import { Hono } from 'hono';
import { ApiError, id, object, keys, parseOperation, version } from '../../contracts/api-v1';
import { requestJSON, checkOrigin } from './http';
import { identity, exchangeNative, refreshSession, startNative, githubCallback, type Identity } from './auth';
import { applyOperation, changes, getEntry, entryHistory, rememberConflict, reviewAdmissions } from './store';

const app = new Hono<{ Bindings: Env; Variables: { requestId: string; identity: Identity } }>();
app.use('*', async (c, next) => {
  c.set('requestId', crypto.randomUUID());
  c.header('Cache-Control', 'no-store'); c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Content-Type-Options', 'nosniff');
  await next();
  c.header('X-Request-Id', c.get('requestId'));
  console.info(JSON.stringify({ requestId: c.get('requestId'), status: c.res.status }));
});
app.onError((error, c) => {
  const failure = error instanceof ApiError ? error : new ApiError('INTERNAL_ERROR', 500, true);
  return Response.json({ error: { code: failure.code, retryable: failure.retryable, requestId: c.get('requestId') } },
    { status: failure.status, headers: { 'Cache-Control': 'no-store', ...(failure.status === 429 ? { 'Retry-After': '60' } : {}) } });
});
app.get('/api/v1/health', c => c.json({ apiVersion: 1, status: 'ok' }));
app.use('/auth/*', async (c, next) => {
  if (!(await c.env.AUTH_LIMIT.limit({ key: c.req.header('CF-Connecting-IP') ?? 'local' })).success) throw new ApiError('RATE_LIMITED', 429, true);
  await next();
});
app.use('/api/v1/auth/*', async (c, next) => {
  if (!(await c.env.AUTH_LIMIT.limit({ key: c.req.header('CF-Connecting-IP') ?? 'local' })).success) throw new ApiError('RATE_LIMITED', 429, true);
  await next();
});
app.get('/auth/native/start', c => startNative(c.req.raw, c.env));
app.get('/auth/github/callback', c => githubCallback(c.req.raw, c.env));
app.post('/api/v1/auth/exchange', async c => { checkOrigin(c.req.raw, c.env.PUBLIC_ORIGIN); return c.json(await exchangeNative(await requestJSON(c.req.raw), c.env.DB)); });
app.post('/api/v1/auth/refresh', async c => { checkOrigin(c.req.raw, c.env.PUBLIC_ORIGIN); return c.json(await refreshSession(await requestJSON(c.req.raw), c.env.DB)); });
app.use('/api/v1/*', async (c, next) => {
  checkOrigin(c.req.raw, c.env.PUBLIC_ORIGIN);
  const who = await identity(c.req.raw, c.env.DB); c.set('identity', who);
  const epoch = c.req.header('X-Sync-Epoch');
  if (epoch !== undefined && epoch !== who.epoch) throw new ApiError('SYNC_EPOCH_CHANGED', 409);
  if (!(await c.env.API_LIMIT.limit({ key: who.userId })).success) throw new ApiError('RATE_LIMITED', 429, true);
  await next();
});
app.get('/api/v1/me', async c => {
  const who = c.get('identity');
  const profile = await c.env.DB.prepare('SELECT login FROM users WHERE id=? AND deleted_at IS NULL').bind(who.userId).first<{ login: string }>();
  return c.json({ userId: who.userId, deviceId: who.deviceId, epoch: who.epoch, timezone: who.timezone,
    syncContext: who.syncContext, syncURLs: who.syncURLs, displayName: profile?.login ?? '',
    ...await reviewAdmissions(c.env.DB, who), syncCapabilities: ['history-order-v1', 'history-version-v1', 'explicit-lifecycles-v1'] });
});
app.get('/api/v1/entries/:id', async c => {
  const entryId = c.req.param('id'); if (!id(entryId)) throw new ApiError('INVALID_REQUEST');
  const entry = await getEntry(c.env.DB, c.get('identity').userId, entryId);
  if (!entry) throw new ApiError('ENTRY_NOT_FOUND', 404); return c.json({ entry });
});
app.get('/api/v1/entries/:id/history', async c => {
  const entryId = c.req.param('id'), after = c.req.query('after') ?? '', limit = Number(c.req.query('limit') ?? 25);
  if (!id(entryId) || (after && !id(after)) || !Number.isSafeInteger(limit) || limit < 1 || limit > 25) throw new ApiError('INVALID_REQUEST');
  const entry = await getEntry(c.env.DB, c.get('identity').userId, entryId);
  if (!entry) throw new ApiError('ENTRY_NOT_FOUND', 404);
  const upper = c.req.query('version') === undefined ? entry.version : Number(c.req.query('version'));
  if (!version(upper) || upper < 1 || upper > entry.version) throw new ApiError('CURSOR_REJECTED', 409);
  return c.json(await entryHistory(c.env.DB, c.get('identity'), entryId, after, limit, upper));
});
app.post('/api/v1/sync/operations', async c => {
  const submittedEpoch = c.req.header('X-Sync-Epoch');
  if (submittedEpoch !== undefined && submittedEpoch !== c.get('identity').epoch) throw new ApiError('SYNC_EPOCH_CHANGED', 409);
  const operation = parseOperation(await requestJSON(c.req.raw));
  try { return c.json(await applyOperation(c.env.DB, c.get('identity'), operation)); }
  catch (error) {
    if (error instanceof ApiError && error.status === 409 && !['OPERATION_ID_REUSED', 'SYNC_EPOCH_CHANGED', 'PREFERENCES_CHANGED'].includes(error.code)) {
      const replay = await rememberConflict(c.env.DB, c.get('identity'), operation, error);
      if (replay) return c.json(replay);
    }
    throw error;
  }
});
app.get('/api/v1/sync/:mode', async c => {
  const mode = c.req.param('mode'); if (mode !== 'changes' && mode !== 'snapshot') throw new ApiError('NOT_FOUND', 404);
  const who = c.get('identity');
  if (c.req.query('epoch') !== who.epoch) throw new ApiError('SYNC_EPOCH_CHANGED', 409);
  const after = Number(c.req.query('after') ?? 0), limit = Number(c.req.query('limit') ?? 25);
  const boundary = c.req.query('boundary');
  if (!version(after) || !Number.isSafeInteger(limit) || limit < 1 || limit > 50 || (boundary !== undefined && !version(Number(boundary)))) throw new ApiError('INVALID_REQUEST');
  return c.json(await changes(c.env.DB, who, after, limit, boundary === undefined ? undefined : Number(boundary), mode === 'snapshot'));
});
app.put('/api/v1/preferences', async c => {
  const input = await requestJSON(c.req.raw); if (!object(input)) throw new ApiError('INVALID_REQUEST');
  keys(input, ['timezone', 'syncContext', 'syncURLs'], ['timezone', 'syncContext', 'syncURLs']);
  if (typeof input.timezone !== 'string' || typeof input.syncContext !== 'boolean' || typeof input.syncURLs !== 'boolean') throw new ApiError('INVALID_REQUEST');
  try { new Intl.DateTimeFormat('en', { timeZone: input.timezone }); } catch { throw new ApiError('INVALID_TIMEZONE'); }
  await c.env.DB.prepare('UPDATE users SET timezone=?,sync_context=?,sync_urls=? WHERE id=? AND deleted_at IS NULL')
    .bind(input.timezone, Number(input.syncContext), Number(input.syncURLs), c.get('identity').userId).run();
  return c.json({ updated: true });
});
app.get('/api/v1/devices', async c => {
  const rows = await c.env.DB.prepare('SELECT id,name,created_at AS createdAtMs,revoked_at AS revokedAtMs FROM devices WHERE user_id=? ORDER BY created_at,id')
    .bind(c.get('identity').userId).all(); return c.json({ devices: rows.results });
});
app.delete('/api/v1/devices/:id', async c => {
  const who = c.get('identity'), deviceId = c.req.param('id'); if (!id(deviceId)) throw new ApiError('INVALID_REQUEST');
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE devices SET revoked_at=? WHERE user_id=? AND id=?').bind(Date.now(), who.userId, deviceId),
    c.env.DB.prepare('UPDATE sessions SET revoked_at=? WHERE user_id=? AND device_id=?').bind(Date.now(), who.userId, deviceId)
  ]); return c.json({ revoked: true });
});
app.post('/api/v1/auth/logout', async c => {
  const who = c.get('identity');
  await c.env.DB.prepare('UPDATE sessions SET revoked_at=? WHERE user_id=? AND token_hash=?').bind(Date.now(), who.userId, who.sessionHash).run();
  return c.json({ loggedOut: true });
});
app.delete('/api/v1/account', async c => {
  const who = c.get('identity');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM auth_flows WHERE user_id=?').bind(who.userId),
    c.env.DB.prepare('DELETE FROM encounters WHERE user_id=?').bind(who.userId),
    c.env.DB.prepare('DELETE FROM review_events WHERE user_id=?').bind(who.userId),
    c.env.DB.prepare('DELETE FROM review_admissions WHERE user_id=?').bind(who.userId),
    c.env.DB.prepare('DELETE FROM sync_operations WHERE user_id=?').bind(who.userId),
    c.env.DB.prepare('DELETE FROM sync_changes WHERE user_id=?').bind(who.userId),
    c.env.DB.prepare('DELETE FROM vocabulary_entries WHERE user_id=?').bind(who.userId),
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(who.userId),
    c.env.DB.prepare('DELETE FROM devices WHERE user_id=?').bind(who.userId),
    c.env.DB.prepare('DELETE FROM users WHERE id=?').bind(who.userId)
  ]); return c.json({ deleted: true });
});
app.notFound(c => {
  if (c.req.path.startsWith('/api/') || c.req.path.startsWith('/auth/')) throw new ApiError('NOT_FOUND', 404);
  return c.env.ASSETS.fetch(c.req.raw);
});
export { app };
export default { fetch: (request, env, ctx) => app.fetch(request, env, ctx) } satisfies ExportedHandler<Env>;
