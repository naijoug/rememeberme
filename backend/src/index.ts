import { selectReminderDevice } from './reminder';
import { Hono } from 'hono';
import { ApiError, id, object, keys, parseOperation, version } from '../../contracts/api-v1';
import { requestJSON, checkOrigin } from './http';
import { identity, exchangeNative, refreshSession, logoutWithRefresh, startNative, githubCallback, type Identity } from './auth';
import { applyOperation, changes, getEntry, entryHistory, rememberConflict, reviewAdmissions } from './store';
import type { Bindings } from './runtime';
import type { Context } from 'hono';

type AppEnvironment = { Bindings: Bindings; Variables: { requestId: string; identity: Identity } };
const app = new Hono<AppEnvironment>();
async function lookup(c: Context<AppEnvironment>, translation: boolean) {
  const input = await requestJSON(c.req.raw);
  if (!object(input)) throw new ApiError('INVALID_REQUEST');
  keys(input, translation ? ['word', 'target'] : ['word'], translation ? ['word', 'target'] : ['word']);
  if (typeof input.word !== 'string' || input.word.length > 500 || (translation && input.target !== 'zh-CN')
    || !/^[a-z](?:[a-z'-]*[a-z])?$/.test(input.word.trim().toLowerCase())) throw new ApiError('INVALID_LOOKUP_WORD');
  const word = input.word.trim().toLowerCase();
  if (translation) {
    if (!c.env.TRANSLATOR) throw new ApiError('TRANSLATION_NOT_CONFIGURED', 503);
    return c.json({ translation: await c.env.TRANSLATOR.translate(word) });
  }
  if (!c.env.DICTIONARY) throw new ApiError('DICTIONARY_NOT_CONFIGURED', 503);
  return c.json({ definition: await c.env.DICTIONARY.getDefinition(word) });
}
app.use('*', async (c, next) => {
  const started = Date.now();
  c.set('requestId', crypto.randomUUID());
  c.header('Cache-Control', 'no-store'); c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Content-Type-Options', 'nosniff');
  await next();
  c.header('X-Request-Id', c.get('requestId'));
  console.info(JSON.stringify({ requestId: c.get('requestId'), status: c.res.status, durationMs: Date.now() - started }));
});
app.onError((error, c) => {
  const failure = error instanceof ApiError ? error : new ApiError('INTERNAL_ERROR', 500, true);
  return Response.json({ error: { code: failure.code, retryable: failure.retryable, requestId: c.get('requestId') } },
    { status: failure.status, headers: { 'Cache-Control': 'no-store', ...(failure.status === 429 ? { 'Retry-After': '60' } : {}) } });
});
app.get('/api/v1/health', c => c.json({ apiVersion: 1, status: 'ok' }));
app.get('/api/v1/capabilities', c => c.json({ apiVersion: 1,
  authCapabilities: ['refresh-retry-v1', 'refresh-logout-v1'],
  translationSources: ['mymemory', 'hermes', 'magpie'], translation: Boolean(c.env.TRANSLATOR),
  dictionary: Boolean(c.env.DICTIONARY),
  publicLookup: Boolean(c.env.LOOKUP_LIMIT),
  syncCapabilities: ['history-order-v1', 'history-version-v1', 'explicit-lifecycles-v1', 'source-privacy-v1', 'translation-source-v2', 'translation-source-v3', 'reminder-device-v1'] }));
app.use('*', async (c, next) => {
  const origin = c.req.header('Origin');
  checkOrigin(c.req.raw, c.env.PUBLIC_ORIGIN, c.env.CLIENT_ORIGINS);
  if (origin) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Vary', 'Origin');
  }
  if (c.req.method === 'OPTIONS') {
    c.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Authorization,Content-Type,X-Sync-Epoch,X-Client-Capabilities');
    return c.body(null, 204);
  }
  await next();
});
app.use('/auth/*', async (c, next) => {
  if (!(await c.env.AUTH_LIMIT.limit({ key: c.env.CLIENT_IP ?? c.req.header('CF-Connecting-IP') ?? 'local' })).success) throw new ApiError('RATE_LIMITED', 429, true);
  await next();
});
app.use('/api/v1/auth/*', async (c, next) => {
  if (!(await c.env.AUTH_LIMIT.limit({ key: c.env.CLIENT_IP ?? c.req.header('CF-Connecting-IP') ?? 'local' })).success) throw new ApiError('RATE_LIMITED', 429, true);
  await next();
});
app.get('/auth/native/start', c => startNative(c.req.raw, c.env));
app.get('/auth/extension/start', c => startNative(c.req.raw, c.env));
app.get('/auth/github/callback', c => githubCallback(c.req.raw, c.env));
app.post('/api/v1/auth/exchange', async c => c.json(await exchangeNative(await requestJSON(c.req.raw), c.env.DB)));
app.post('/api/v1/auth/refresh', async c => c.json(await refreshSession(await requestJSON(c.req.raw), c.env.DB)));
app.post('/api/v1/auth/logout', async c => {
  if (c.req.header('Content-Type')?.includes('application/json')) {
    return c.json(await logoutWithRefresh(await requestJSON(c.req.raw), c.env.DB));
  }
  // Older clients may still revoke their current session with a valid bearer.
  const who = await identity(c.req.raw, c.env.DB);
  await c.env.DB.prepare('UPDATE sessions SET revoked_at=? WHERE user_id=? AND token_hash=?').bind(Date.now(), who.userId, who.sessionHash).run();
  return c.json({ loggedOut: true });
});
app.use('/api/v1/public/lookup/*', async (c, next) => {
  if (!c.env.LOOKUP_LIMIT) throw new ApiError('PUBLIC_LOOKUP_NOT_CONFIGURED', 503);
  if (!(await c.env.LOOKUP_LIMIT.limit({ key: c.env.CLIENT_IP ?? c.req.header('CF-Connecting-IP') ?? 'local' })).success) throw new ApiError('RATE_LIMITED', 429, true);
  await next();
});
app.post('/api/v1/public/lookup/dictionary', c => lookup(c, false));
app.post('/api/v1/public/lookup/translation', c => lookup(c, true));
app.use('/api/v1/*', async (c, next) => {
  const who = await identity(c.req.raw, c.env.DB); c.set('identity', who);
  const epoch = c.req.header('X-Sync-Epoch');
  if (epoch !== undefined && epoch !== who.epoch) throw new ApiError('SYNC_EPOCH_CHANGED', 409);
  if (!(await c.env.API_LIMIT.limit({ key: who.userId })).success) throw new ApiError('RATE_LIMITED', 429, true);
  await next();
});
app.post('/api/v1/lookup/dictionary', c => lookup(c, false));
app.post('/api/v1/lookup/translation', c => lookup(c, true));
app.get('/api/v1/me', async c => {
  const who = c.get('identity');
  const profile = await c.env.DB.prepare('SELECT login,reminder_device_id,reminder_revision FROM users WHERE id=? AND deleted_at IS NULL').bind(who.userId).first<{ login: string; reminder_device_id: string | null; reminder_revision: number }>();
  return c.json({ userId: who.userId, deviceId: who.deviceId, epoch: who.epoch, timezone: who.timezone,
    sourceRevision: who.sourceRevision, syncContext: who.syncContext, syncURLs: who.syncURLs, displayName: profile?.login ?? '',
    reminderDevice: { deviceId: profile?.reminder_device_id ?? null, revision: profile?.reminder_revision ?? 0 },
    ...await reviewAdmissions(c.env.DB, who), syncCapabilities: ['history-order-v1', 'history-version-v1', 'explicit-lifecycles-v1', 'source-privacy-v1', 'translation-source-v2', 'translation-source-v3', 'reminder-device-v1'] });
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
app.put('/api/v1/reminder-device', async c => c.json(await selectReminderDevice(c.env.DB, c.get('identity'), await requestJSON(c.req.raw))));
app.put('/api/v1/preferences', async c => {
  const input = await requestJSON(c.req.raw); if (!object(input)) throw new ApiError('INVALID_REQUEST');
  keys(input, ['timezone', 'syncContext', 'syncURLs'], ['timezone', 'syncContext', 'syncURLs']);
  if (typeof input.timezone !== 'string' || typeof input.syncContext !== 'boolean' || typeof input.syncURLs !== 'boolean') throw new ApiError('INVALID_REQUEST');
  try { new Intl.DateTimeFormat('en', { timeZone: input.timezone }); } catch { throw new ApiError('INVALID_TIMEZONE'); }
  await c.env.DB.prepare('UPDATE users SET timezone=?,sync_context=?,sync_urls=? WHERE id=? AND deleted_at IS NULL')
    .bind(input.timezone, Number(input.syncContext), Number(input.syncURLs), c.get('identity').userId).run();
  return c.json({ updated: true });
});
app.post('/api/v1/sources/clear', async c => {
  const input = await requestJSON(c.req.raw);
  if (!object(input)) throw new ApiError('INVALID_REQUEST');
  keys(input, ['requestId', 'sourceRevision'], ['requestId', 'sourceRevision']);
  if (!id(input.requestId) || !version(input.sourceRevision)) throw new ApiError('INVALID_REQUEST');
  const who = c.get('identity'), db = c.env.DB;
  const receipt = () => db.prepare('SELECT source_revision FROM source_removals WHERE user_id=? AND id=?')
    .bind(who.userId, input.requestId).first<{ source_revision: number }>();
  const prior = await receipt();
  if (prior) {
    if (prior.source_revision !== input.sourceRevision + 1) throw new ApiError('OPERATION_ID_REUSED', 409);
    return c.json({ cleared: true, sourceRevision: prior.source_revision });
  }
  if (input.sourceRevision !== who.sourceRevision) throw new ApiError('SOURCE_REVISION_CHANGED', 409);
  if (who.sourceRevision >= Number.MAX_SAFE_INTEGER) throw new ApiError('VERSION_EXHAUSTED', 409);
  const nonce = crypto.randomUUID();
  try {
    await db.batch([
      db.prepare(`INSERT INTO write_guards(nonce,allowed) SELECT ?,CASE WHEN EXISTS(
        SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id JOIN devices d ON d.user_id=s.user_id AND d.id=s.device_id
        WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.access_expires_at>? AND d.revoked_at IS NULL
        AND u.deleted_at IS NULL AND u.source_revision=? AND u.sync_epoch=?) THEN 1 ELSE 0 END`)
        .bind(nonce, who.sessionHash, Date.now(), who.sourceRevision, who.epoch),
      db.prepare('UPDATE users SET sync_context=0,sync_urls=0,source_revision=source_revision+1 WHERE id=?').bind(who.userId),
      db.prepare("UPDATE encounters SET context='',url='' WHERE user_id=?").bind(who.userId),
      db.prepare('INSERT INTO source_removals(user_id,id,source_revision) VALUES(?,?,?)').bind(who.userId, input.requestId, who.sourceRevision + 1),
      db.prepare('DELETE FROM write_guards WHERE nonce=?').bind(nonce)
    ]);
  } catch {
    const replay = await receipt();
    if (!replay) throw new ApiError('SOURCE_REVISION_CHANGED', 409);
    if (replay.source_revision !== input.sourceRevision + 1) throw new ApiError('OPERATION_ID_REUSED', 409);
  }
  return c.json({ cleared: true, sourceRevision: who.sourceRevision + 1 });
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
    c.env.DB.prepare('DELETE FROM source_removals WHERE user_id=?').bind(who.userId),
    c.env.DB.prepare('DELETE FROM users WHERE id=?').bind(who.userId)
  ]); return c.json({ deleted: true });
});
app.notFound(c => {
  if (c.req.path.startsWith('/api/') || c.req.path.startsWith('/auth/')) throw new ApiError('NOT_FOUND', 404);
  return c.env.ASSETS.fetch(c.req.raw);
});
export { app };
export default { fetch: (request: Request, env: Bindings) => app.fetch(request, env) };
