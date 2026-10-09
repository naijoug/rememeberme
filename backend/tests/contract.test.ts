import { it, expect } from 'vitest';
import fixture from '../../contracts/fixtures/sync-create-v1.json';
import mergeFixture from '../../contracts/fixtures/sync-legacy-merge-v1.json';
import reviewFixtures from '../../contracts/fixtures/review-v1.json';
import { parseOperation, parseEntry, nextReview, canonical, ApiError } from '../../contracts/api-v1';
import { account, send } from './helpers';

it('uses the shared wire fixture without changing legacy time/count values', async () => {
  const operation = parseOperation(fixture.request), user = await account();
  const response = await send(user.access, operation);
  expect(response.status).toBe(200); expect(await response.json()).toEqual(fixture.response);
  expect(parseEntry(fixture.response.entry).count).toBe(0.5);
});
it('shares review-v1 elapsed-time results with Swift fixtures', () => {
  for (const row of reviewFixtures) {
    const state = row.step < 0 ? null : { algorithmVersion: 'review-v1' as const, step: row.step, dueAtMs: 0 };
    const next = nextReview(state, row.result, row.answeredAtMs);
    expect(next.step).toBe(row.nextStep); expect(next.dueAtMs).toBe(row.dueAtMs);
  }
});
it('accepts the same native legacy-merge wire projection as Swift', async () => {
  const user = await account(); await send(user.access, parseOperation(fixture.request));
  const response = await send(user.access, parseOperation(mergeFixture.request));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ operationId: mergeFixture.request.operationId, status: 'applied', entry: { count: 1, version: 2 } });
});
it('rejects ownership injection and keeps prototype-like definition keys literal', () => {
  expect(() => parseOperation({ ...fixture.request, userId: 'other-owner' })).toThrow(ApiError);
  const json = JSON.parse('{"__proto__":{"injected":true},"word":"synthetic","phonetics":[],"meanings":[]}');
  expect(canonical(json)).toContain('"__proto__"'); expect(Object.prototype).not.toHaveProperty('injected');
});
