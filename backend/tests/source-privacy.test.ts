import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import { account, create, record, request, send } from './helpers';
import { identity } from '../src/auth';
import { applyOperation } from '../src/store';

async function consent(access: string, context = true, urls = true) {
  expect((await request('/api/v1/preferences', access, 'PUT', { timezone: 'UTC', syncContext: context, syncURLs: urls })).status).toBe(200);
}
it('clears sources atomically, keeps counts/history/review, and fences old requests after re-enabling', async () => {
  const user = await account(), other = await account('B');
  await send(user.access, create()); await send(other.access, create());
  await consent(user.access); await consent(other.access);
  const first = record('entry-A', 'event-one'); first.payload.event = { ...first.payload.event as object, context: 'private context', url: 'https://example.test/private' };
  expect((await send(user.access, first)).status).toBe(200);
  expect((await send(other.access, first)).status).toBe(200);
  const stale = await identity(new Request('https://api.example.test', { headers: { Authorization: 'Bearer ' + user.access } }), env.DB);
  const pending = { ...first, operationId: 'lost-before-commit', payload: { event: { ...first.payload.event as object, id: 'event-two' } } };
  const clear = { requestId: 'clear-one', sourceRevision: 0 };
  expect((await request('/api/v1/sources/clear', user.access, 'POST', clear)).status).toBe(200);
  await consent(user.access);
  expect((await send(user.access, pending)).status).toBe(409);
  await expect(applyOperation(env.DB, stale, { ...pending, operationId: 'concurrent-with-clear' })).rejects.toMatchObject({ code: 'SOURCE_REVISION_CHANGED' });
  // A previously committed receipt can be acknowledged again, but never runs its source writes again.
  expect((await send(user.access, first)).status).toBe(200);
  const history = await (await request('/api/v1/entries/entry-A/history', user.access)).json<{ events: unknown[] }>();
  expect(history.events).toHaveLength(1); expect(history.events[0]).toMatchObject({ context: '', url: '' });
  expect(await env.DB.prepare('SELECT count FROM vocabulary_entries WHERE user_id=? AND id=?').bind(user.userId, 'entry-A').first('count')).toBe(1);
  expect(await env.DB.prepare('SELECT context FROM encounters WHERE user_id=?').bind(other.userId).first('context')).toBe('private context');
  const enrich = { operationId: 'explicit-backfill', entryId: 'entry-A', kind: 'enrichSource' as const, sourceRevision: 1,
    payload: { events: [{ id: 'event-one', context: 'explicit new consent' }] } };
  expect((await send(user.access, enrich)).status).toBe(200);
  expect((await request('/api/v1/sources/clear', user.access, 'POST', clear)).status).toBe(200);
  expect(await env.DB.prepare('SELECT context FROM encounters WHERE user_id=?').bind(user.userId).first('context')).toBe('explicit new consent');
  expect((await send(user.access, { ...enrich, operationId: 'old-backfill', sourceRevision: 0 })).status).toBe(409);
  expect((await request('/api/v1/sources/clear', user.access, 'POST', { requestId: 'stale-clear', sourceRevision: 0 })).status).toBe(409);
});
it('keeps independent consent and rejects malformed revisions and removal requests', async () => {
  const user = await account(); await send(user.access, create()); await consent(user.access, true, false);
  const event = record('entry-A', 'independent'); event.payload.event = { ...event.payload.event as object, context: 'only context' };
  expect((await send(user.access, event)).status).toBe(200);
  event.operationId = 'url-not-enabled'; event.payload.event = { ...event.payload.event as object, id: 'new-event', url: 'https://example.test' };
  expect((await send(user.access, event)).status).toBe(400);
  expect((await send(user.access, { ...event, sourceRevision: -1 })).status).toBe(400);
  expect((await request('/api/v1/sources/clear', user.access, 'POST', { requestId: 'bad' })).status).toBe(400);
  expect((await request('/api/v1/sources/clear', undefined, 'POST', { requestId: 'no-auth', sourceRevision: 0 })).status).toBe(401);
  await consent(user.access, false, false);
  const page = await (await request('/api/v1/entries/entry-A/history', user.access)).json<{ events: object[] }>();
  expect(page.events[0]).not.toHaveProperty('context');
  expect(await env.DB.prepare('SELECT context FROM encounters WHERE user_id=?').bind(user.userId).first('context')).toBe('only context');
});
