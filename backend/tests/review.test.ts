import { env } from 'cloudflare:workers';
import { it, expect } from 'vitest';
import { account, create, request, send, emptyDefinition } from './helpers';
import type { WireOperation } from '../../contracts/api-v1';

it('deduplicates review answers, persists admissions, and keeps count independent', async () => {
  const user = await account(); await send(user.access, create('review-entry', 'review-create', 7));
  const review: WireOperation = { operationId: 'review-one', entryId: 'review-entry', kind: 'review', baseVersion: 1,
    payload: { event: { id: 'review-event-one', result: 'remembered', answeredAtMs: 1700000000000, baseReviewVersion: 0, algorithmVersion: 'review-v1' } } };
  expect((await send(user.access, review)).status).toBe(200); expect((await send(user.access, review)).status).toBe(200);
  const response = await (await request('/api/v1/entries/review-entry', user.access)).json<{ entry: { count: number; reviewVersion: number; review: { step: number; dueAtMs: number } } }>();
  expect(response.entry.count).toBe(7); expect(response.entry.reviewVersion).toBe(1);
  expect(response.entry.review).toMatchObject({ step: 0, dueAtMs: 1700000000000 + 86400000 });
  expect(await env.DB.prepare('SELECT count(*) AS n FROM review_admissions').first('n')).toBe(1);
  const conflict: WireOperation = { ...review, operationId: 'review-stale', baseVersion: 2,
    payload: { event: { id: 'other-event', result: 'remembered', answeredAtMs: 1700000000000, baseReviewVersion: 0, algorithmVersion: 'review-v1' } } };
  expect((await send(user.access, conflict)).status).toBe(409);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM review_events').first('n')).toBe(1);
});
it('restores a count/review snapshot without replaying history or old versions', async () => {
  const user = await account(); await send(user.access, create('restore-entry', 'restore-create', 0));
  const restored: WireOperation = { operationId: 'restore-one', entryId: 'restore-entry', kind: 'restore', baseVersion: 1,
    payload: { count: 0.5, definition: emptyDefinition, notes: 'synthetic note', review: { algorithmVersion: 'review-v1', step: 2, dueAtMs: 1700000000000 }, baseReviewVersion: 0 } };
  expect((await send(user.access, restored)).status).toBe(200);
  const response = await (await request('/api/v1/entries/restore-entry', user.access)).json<{ entry: { count: number; version: number; reviewVersion: number } }>();
  expect(response.entry).toMatchObject({ count: 0.5, version: 2, reviewVersion: 1 });
  expect(await env.DB.prepare('SELECT count(*) AS n FROM review_events').first('n')).toBe(0);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM review_admissions').first('n')).toBe(0);
  expect((await send(user.access, { ...restored, operationId: 'old-restore' })).status).toBe(409);
});
it('limits new admissions to 20 per account/local date using atomic guards', async () => {
  const user = await account();
  for (let index = 0; index < 21; index++) {
    const entryId = 'new-entry-' + index;
    await send(user.access, create(entryId, 'create-' + index));
    const response = await send(user.access, { operationId: 'review-' + index, entryId, kind: 'review', baseVersion: 1,
      payload: { event: { id: 'event-' + index, result: 'forgot', answeredAtMs: 1700000000000, baseReviewVersion: 0, algorithmVersion: 'review-v1' } } });
    expect(response.status).toBe(index < 20 ? 200 : 409);
  }
  expect(await env.DB.prepare('SELECT count(*) AS n FROM review_admissions').first('n')).toBe(20);
  expect(await env.DB.prepare('SELECT count(*) AS n FROM review_events').first('n')).toBe(20);
});
it('returns one state per entry in a fixed-boundary initial snapshot', async () => {
  const user = await account(); await send(user.access, create('snapshot-entry', 'snapshot-create', 3));
  await send(user.access, { operationId: 'snapshot-reset', entryId: 'snapshot-entry', kind: 'reset', baseVersion: 1, payload: {} });
  const snapshot = await (await request('/api/v1/sync/snapshot?epoch=synthetic-epoch-A', user.access)).json<{ changes: { entry: { count: number } }[] }>();
  expect(snapshot.changes).toHaveLength(1); expect(snapshot.changes[0].entry.count).toBe(0);
  expect((await request('/api/v1/sync/snapshot?epoch=synthetic-epoch-A&boundary=999999', user.access)).status).toBe(409);
});
it('reports current account-day admission IDs without changing review state', async () => {
  const user = await account(); await send(user.access, create('today-entry', 'today-create', 7));
  const timestamp = Date.now();
  await send(user.access, { operationId: 'today-review-op', entryId: 'today-entry', kind: 'review', baseVersion: 1,
    payload: { event: { id: 'today-review-event', result: 'remembered', answeredAtMs: timestamp, baseReviewVersion: 0, algorithmVersion: 'review-v1' } } });
  const profile = await (await request('/api/v1/me', user.access)).json<{ reviewDay: string; reviewAdmissionIds: string[] }>();
  expect(profile.reviewDay).toBe(new Date(timestamp).toISOString().slice(0, 10));
  expect(profile.reviewAdmissionIds).toEqual(['today-review-event']);
  expect(await env.DB.prepare('SELECT count FROM vocabulary_entries WHERE id=?').bind('today-entry').first('count')).toBe(7);
  const other = await account('B');
  expect(await (await request('/api/v1/me', other.access)).json()).toMatchObject({ reviewAdmissionIds: [] });
});
