import { env } from 'cloudflare:workers';
import { applyD1Migrations, reset } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { account, create, record, request, send, emptyDefinition } from './helpers';
import { sha, token } from '../src/http';
import type { WireOperation } from '../../contracts/api-v1';
import { identity } from '../src/auth';
import { applyOperation } from '../src/store';

describe('D1 operation ownership and atomicity', () => {
  it('deduplicates concurrent response-loss retries and counts distinct clicks', async () => {
    const user = await account(); expect((await send(user.access, create())).status).toBe(200);
    const operation = record('entry-A', 'event-1');
    const responses = await Promise.all(Array.from({ length: 6 }, () => send(user.access, operation)));
    expect(responses.map(r => r.status)).toEqual(Array(6).fill(200));
    const replies = await Promise.all(responses.map(r => r.json()));
    expect(replies.every(v => JSON.stringify(v) === JSON.stringify(replies[0]))).toBe(true);
    expect((await send(user.access, record('entry-A', 'event-2'))).status).toBe(200);
    const entry = await (await request('/api/v1/entries/entry-A', user.access)).json<{ entry: { count: number } }>();
    expect(entry.entry.count).toBe(2);
    const history = await (await request('/api/v1/entries/entry-A/history', user.access)).json<{ events: unknown[] }>();
    expect(history.events).toHaveLength(2);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM sync_operations').first('n')).toBe(3);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM write_guards').first('n')).toBe(0);
  });
  it('rejects changed content on the same operation ID and prevents cross-account access', async () => {
    const a = await account('A'), b = await account('B'); await send(a.access, create());
    expect((await request('/api/v1/entries/entry-A', b.access)).status).toBe(404);
    expect((await send(a.access, { ...create(), payload: { ...create().payload, count: 99 } })).status).toBe(409);
    const response = await request('/api/v1/sync/changes?epoch=synthetic-epoch-B', b.access);
    expect(await response.json()).toMatchObject({ changes: [] });
    expect((await send(b.access, { ...create('entry-A', 'own-create'), payload: { ...create().payload, word: 'entry-A' } })).status).toBe(200);
  });
  it('rolls back business data, receipt and changes together when a real SQL write fails', async () => {
    const user = await account(); await send(user.access, create());
    await env.DB.exec("CREATE TRIGGER reject_fixture BEFORE INSERT ON encounters WHEN NEW.id='fail-event' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");
    expect((await send(user.access, record('entry-A', 'fail-event'))).status).toBe(500);
    expect(await env.DB.prepare('SELECT count FROM vocabulary_entries WHERE id=?').bind('entry-A').first('count')).toBe(null);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM sync_operations').first('n')).toBe(1);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM sync_changes').first('n')).toBe(1);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM encounters').first('n')).toBe(0);
  });
  it('retains history on reset and prevents stale edits or tombstone resurrection', async () => {
    const user = await account(); await send(user.access, create()); await send(user.access, record('entry-A', 'event-1'));
    const reset: WireOperation = { operationId: 'reset-1', entryId: 'entry-A', kind: 'reset', baseVersion: 2, payload: {} };
    expect((await send(user.access, reset)).status).toBe(200);
    const history = await (await request('/api/v1/entries/entry-A/history', user.access)).json<{ events: unknown[] }>(); expect(history.events).toHaveLength(1);
    expect((await send(user.access, { ...reset, operationId: 'stale-reset' })).status).toBe(409);
    expect((await send(user.access, { operationId: 'delete-1', entryId: 'entry-A', kind: 'delete', baseVersion: 3, payload: {} })).status).toBe(200);
    expect((await send(user.access, record('entry-A', 'offline-old-event'))).status).toBe(409);
    expect((await send(user.access, create('entry-A', 'recreate-old-id'))).status).toBe(409);
  });
  it('applies one shared migration baseline and imports history without increments', async () => {
    const user = await account(), digest = 'a'.repeat(64), key = 'synthetic';
    const operationId = 'seed:' + await sha(JSON.stringify(['legacy-seed-v1', digest, key]));
    const baseline: WireOperation = { ...create('legacy-entry', operationId, 0.5), kind: 'seed', payload: { ...create().payload, word: key, count: 0.5, sourceDigest: digest } };
    expect((await send(user.access, baseline)).status).toBe(200); expect((await send(user.access, baseline)).status).toBe(200);
    const events = [1, 2].map(n => ({ id: 'legacy-event-' + n, timestamp: 0.5, definition: emptyDefinition }));
    expect((await send(user.access, { operationId: 'history-chunk-1', entryId: 'legacy-entry', kind: 'importHistory', payload: { events } })).status).toBe(200);
    expect((await send(user.access, { operationId: 'history-chunk-2', entryId: 'legacy-entry', kind: 'importHistory', payload: { events } })).status).toBe(200);
    expect(await env.DB.prepare('SELECT count FROM vocabulary_entries WHERE id=?').bind('legacy-entry').first('count')).toBe(0.5);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM encounters').first('n')).toBe(2);
    expect((await send(user.access, create('different-source', 'different-source-op', 3))).status).toBe(200);
    const collision = create('conflicting-source', 'source-conflict'); collision.payload.word = key;
    expect((await send(user.access, collision)).status).toBe(409);
  });
  it('preserves large legacy counts and refuses a precision-losing increment', async () => {
    const user = await account(); expect((await send(user.access, create('large-count', 'large-create', 1e20))).status).toBe(200);
    expect((await send(user.access, record('large-count', 'large-event'))).status).toBe(409);
    expect(await env.DB.prepare('SELECT count FROM vocabulary_entries WHERE id=?').bind('large-count').first('count')).toBe(1e20);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM encounters').first('n')).toBe(0);
  });
  it('enforces explicit context/URL consent without hiding another result', async () => {
    const user = await account(); await send(user.access, create());
    const op = record('entry-A', 'context-event'); const event = { id: 'context-event', timestamp: 1000, definition: emptyDefinition, context: '<script>literal</script>', url: 'javascript:literal' };
    op.payload.event = event;
    expect((await send(user.access, op)).status).toBe(400);
    expect((await request('/api/v1/preferences', user.access, 'PUT', { timezone: 'Asia/Shanghai', syncContext: true, syncURLs: true })).status).toBe(200);
    expect((await send(user.access, op)).status).toBe(200);
    const response = await (await request('/api/v1/entries/entry-A/history', user.access)).json<{ events: { context: string; url: string }[] }>();
    expect(response.events[0]).toMatchObject({ context: event.context, url: event.url });
  });
  it('uses fixed pull boundaries and epoch validation', async () => {
    const user = await account(); await send(user.access, create('one', 'create-one')); await send(user.access, create('two', 'create-two'));
    const first = await (await request('/api/v1/sync/changes?epoch=synthetic-epoch-A&limit=1', user.access)).json<{ boundary: number; nextCursor: number; hasMore: boolean }>();
    expect(first.hasMore).toBe(true);
    await send(user.access, create('three', 'create-three'));
    const next = await (await request(`/api/v1/sync/changes?epoch=synthetic-epoch-A&after=${first.nextCursor}&boundary=${first.boundary}&limit=1`, user.access)).json<{ changes: { entry: { id: string } }[]; hasMore: boolean }>();
    expect(next.changes.map(v => v.entry.id)).toEqual(['two']); expect(next.hasMore).toBe(false);
    expect((await request('/api/v1/sync/changes?epoch=old-epoch', user.access)).status).toBe(409);
  });
  it('applies one explicit legacy merge batch and imports its history without a second count change', async () => {
    const user = await account(); await send(user.access, create('merge-entry', 'merge-create', 3));
    const op: WireOperation = { operationId: 'confirmed-merge-batch', entryId: 'merge-entry', kind: 'legacyMerge', baseVersion: 1,
      payload: { countDelta: 0.5, definition: emptyDefinition } };
    expect((await send(user.access, op)).status).toBe(200);
    expect((await send(user.access, op)).status).toBe(200);
    expect((await send(user.access, { operationId: 'merge-history', entryId: op.entryId, kind: 'importHistory',
      payload: { events: [{ id: 'merge-event', timestamp: 1, definition: emptyDefinition }] } })).status).toBe(200);
    expect(await env.DB.prepare('SELECT count FROM vocabulary_entries WHERE id=?').bind(op.entryId).first('count')).toBe(3.5);
    expect((await send(user.access, { ...op, operationId: 'stale-merge' })).status).toBe(409);
    expect((await send(user.access, { ...op, operationId: 'next-confirmed-batch', baseVersion: 3 })).status).toBe(200);
    expect(await env.DB.prepare('SELECT count FROM vocabulary_entries WHERE id=?').bind(op.entryId).first('count')).toBe(4);
  });
  it('checks the server epoch again at the atomic write boundary', async () => {
    const user = await account();
    const who = await identity(new Request('https://api.example.test/api/v1/me', { headers: { Authorization: 'Bearer ' + user.access } }), env.DB);
    await env.DB.prepare('UPDATE users SET sync_epoch=? WHERE id=?').bind('synthetic-restored-epoch', user.userId).run();
    await expect(applyOperation(env.DB, who, create())).rejects.toMatchObject({ code: 'SYNC_EPOCH_CHANGED', status: 409 });
    expect(await env.DB.prepare('SELECT count(*) AS n FROM vocabulary_entries').first('n')).toBe(0);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM sync_operations').first('n')).toBe(0);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM write_guards').first('n')).toBe(0);
  });
  it('allows a separate lifecycle only with an explicit duplicate choice and keeps normal races guarded', async () => {
    const user = await account();
    const a = create('first', 'first-op', 3), b = create('second', 'second-op', 4);
    a.payload.word = b.payload.word = 'same-spelling';
    const statuses = await Promise.all([send(user.access, a), send(user.access, b)]);
    expect(statuses.map(r => r.status).sort()).toEqual([200, 409]);
    const explicit = create('separate-lifecycle', 'explicit-copy', 2);
    explicit.payload.word = 'same-spelling'; explicit.payload.allowDuplicate = true;
    expect((await send(user.access, explicit)).status).toBe(200);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM vocabulary_entries WHERE normalized_key=?').bind('same-spelling').first('n')).toBe(2);
    expect((await send(user.access, explicit)).status).toBe(200);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM vocabulary_entries WHERE normalized_key=?').bind('same-spelling').first('n')).toBe(2);
  });
  it('returns retained encounter positions independently from the pagination ID order', async () => {
    const user = await account(); await send(user.access, create('ordered', 'ordered-create', 3));
    const events = [
      { id: 'z-first', timestamp: 30, definition: emptyDefinition },
      { id: 'a-second', timestamp: 10, definition: emptyDefinition },
      { id: 'm-third', timestamp: 10, definition: emptyDefinition }
    ];
    expect((await send(user.access, { operationId: 'original-order', entryId: 'ordered', kind: 'importHistory', payload: { events } })).status).toBe(200);
    const page = await (await request('/api/v1/entries/ordered/history', user.access)).json<{ events: { id: string; position: number }[] }>();
    expect(page.events.map(e => e.id)).toEqual(['a-second', 'm-third', 'z-first']);
    expect([...page.events].sort((a, b) => a.position - b.position).map(e => e.id)).toEqual(['z-first', 'a-second', 'm-third']);
    expect(await env.DB.prepare('SELECT history_ordering FROM vocabulary_entries WHERE id=?').bind('ordered').first('history_ordering')).toBe('retained');
    expect((await send(user.access, { operationId: 'intentional-merge', entryId: 'ordered', kind: 'legacyMerge', baseVersion: 2,
      payload: { countDelta: 0, definition: emptyDefinition } })).status).toBe(200);
    expect(await env.DB.prepare('SELECT history_ordering FROM vocabulary_entries WHERE id=?').bind('ordered').first('history_ordering')).toBe('timestamp');
  });
  it('keeps history pages within the entry version represented by their count snapshot', async () => {
    const user = await account(); await send(user.access, create('bounded', 'bounded-create', 0));
    await send(user.access, record('bounded', 'z-earlier'));
    const first = await (await request('/api/v1/entries/bounded/history?version=2', user.access)).json<{ entryVersion: number; events: { id: string }[] }>();
    expect(first.entryVersion).toBe(2); expect(first.events.map(e => e.id)).toEqual(['z-earlier']);
    await send(user.access, record('bounded', 'a-later'));
    const old = await (await request('/api/v1/entries/bounded/history?version=2', user.access)).json<{ events: { id: string }[] }>();
    expect(old.events.map(e => e.id)).toEqual(['z-earlier']);
    const next = await (await request('/api/v1/entries/bounded/history?version=3', user.access)).json<{ events: { id: string }[] }>();
    expect(next.events.map(e => e.id)).toEqual(['a-later', 'z-earlier']);
    expect((await request('/api/v1/entries/bounded/history?version=4', user.access)).status).toBe(409);
  });
  it('upgrades populated original local databases without losing count or retained history order', async () => {
    await reset();
    const original = env.TEST_MIGRATIONS.filter(migration => migration.name.startsWith('0001'));
    expect(original).toHaveLength(1); await applyD1Migrations(env.DB, original);
    const user = await account();
    await env.DB.prepare(`INSERT INTO vocabulary_entries(user_id,id,normalized_key,word,kind,count,definition_json,notes,created_at,updated_at,version,deleted,review_version)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(user.userId, 'pre-upgrade', 'synthetic', 'synthetic', 'word', 0.5, JSON.stringify(emptyDefinition), 'retained note', 0.5, 1e100, 2, 0, 0).run();
    for (const [id, time] of [['z-original-first', 30], ['a-original-second', 10]] as const) {
      await env.DB.prepare('INSERT INTO encounters(user_id,id,entry_id,timestamp,definition_json,context,url,immutable_hash) VALUES(?,?,?,?,?,?,?,?)')
        .bind(user.userId, id, 'pre-upgrade', time, JSON.stringify(emptyDefinition), 'private synthetic source', '', 'synthetic-hash-' + id).run();
    }
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
    const entry = await (await request('/api/v1/entries/pre-upgrade', user.access)).json<{ entry: { count: number; updatedAtMs: number; notes: string; historyOrdering: string } }>();
    expect(entry.entry).toMatchObject({ count: 0.5, updatedAtMs: 1e100, notes: 'retained note', historyOrdering: 'retained' });
    const page = await (await request('/api/v1/entries/pre-upgrade/history?version=2', user.access)).json<{ entryVersion: number; events: { id: string; position: number }[] }>();
    expect(page.entryVersion).toBe(2);
    expect([...page.events].sort((a, b) => a.position - b.position).map(e => e.id)).toEqual(['z-original-first', 'a-original-second']);
    expect(page.events.every(e => !('context' in e))).toBe(true);
    expect((await request('/api/v1/auth/refresh', undefined, 'POST', { refreshToken: user.refresh, requestId: token() })).status).toBe(200);
  });
});
