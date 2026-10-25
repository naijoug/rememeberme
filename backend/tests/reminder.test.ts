import fixture from '../../contracts/fixtures/reminder-device-v1.json';
import { env } from 'cloudflare:workers';
import { it, expect } from 'vitest';
import { account, request } from './helpers';
import { sha, token } from '../src/http';
import { identity } from '../src/auth';
import { selectReminderDevice } from '../src/reminder';

it('selects one device per account and rejects stale reclaim/release after handoff', async () => {
  const first = await account(), other = await account('other');
  const access = token();
  await env.DB.prepare('INSERT INTO devices(user_id,id,name,created_at) VALUES(?,?,?,?)').bind(first.userId, 'second-device', 'second', 1).run();
  await env.DB.prepare('INSERT INTO sessions(token_hash,user_id,device_id,refresh_hash,access_expires_at,refresh_expires_at) VALUES(?,?,?,?,?,?)')
    .bind(await sha(access), first.userId, 'second-device', await sha(token()), Date.now() + 900_000, Date.now() + 900_000).run();
  expect(await (await request('/api/v1/me', first.access)).json()).toMatchObject({ reminderDevice: { deviceId: null, revision: 0 } });
  const claim = fixture.request;
  expect(await (await request('/api/v1/reminder-device', first.access, 'PUT', claim)).json()).toEqual(fixture.response);
  expect((await request('/api/v1/reminder-device', access, 'PUT', { enabled: true, expectedRevision: 1 })).status).toBe(200);
  expect((await request('/api/v1/reminder-device', first.access, 'PUT', claim)).status).toBe(409);
  expect((await request('/api/v1/reminder-device', first.access, 'PUT', { enabled: false, expectedRevision: 2 })).status).toBe(409);
  expect(await (await request('/api/v1/me', first.access)).json()).toMatchObject({ reminderDevice: { deviceId: 'second-device', revision: 2 } });
  expect(await (await request('/api/v1/me', other.access)).json()).toMatchObject({ reminderDevice: { deviceId: null, revision: 0 } });
  expect((await request('/api/v1/reminder-device', access, 'PUT', { enabled: false, expectedRevision: 2 })).status).toBe(200);
  expect(await (await request('/api/v1/me', first.access)).json()).toMatchObject({ reminderDevice: { deviceId: null, revision: 3 } });
});
it('rejects arbitrary target devices, invalid revisions, unauthenticated and revoked sessions', async () => {
  const user = await account();
  expect((await request('/api/v1/reminder-device', undefined, 'PUT', { enabled: true, expectedRevision: 0 })).status).toBe(401);
  for (const body of [{ enabled: true, expectedRevision: -1 }, { enabled: true, expectedRevision: 0, deviceId: 'other' }, { enabled: 'yes', expectedRevision: 0 }]) {
    expect((await request('/api/v1/reminder-device', user.access, 'PUT', body)).status).toBe(400);
  }
  const who = await identity(new Request('https://api.example.test', { headers: { Authorization: 'Bearer ' + user.access } }), env.DB);
  await env.DB.prepare('UPDATE devices SET revoked_at=1 WHERE user_id=?').bind(user.userId).run();
  await expect(selectReminderDevice(env.DB, who, { enabled: true, expectedRevision: 0 })).rejects.toMatchObject({ code: 'REMINDER_SELECTION_CHANGED' });
  expect(await env.DB.prepare('SELECT reminder_revision FROM users WHERE id=?').bind(user.userId).first('reminder_revision')).toBe(0);
});
