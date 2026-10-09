import { env } from 'cloudflare:workers';
import { app } from '../src/index';
import { sha, token } from '../src/http';
import type { WireOperation } from '../../contracts/api-v1';

export async function account(name = 'A') {
  const userId = 'synthetic-user-' + name, deviceId = 'synthetic-device-' + name, access = token(), refresh = token();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO users(id,provider_id,login,sync_epoch,created_at) VALUES(?,?,?,?,?)').bind(userId, name, name, 'synthetic-epoch-' + name, 1),
    env.DB.prepare('INSERT INTO devices(user_id,id,name,created_at) VALUES(?,?,?,?)').bind(userId, deviceId, name, 1),
    env.DB.prepare('INSERT INTO sessions(token_hash,user_id,device_id,refresh_hash,access_expires_at,refresh_expires_at) VALUES(?,?,?,?,?,?)')
      .bind(await sha(access), userId, deviceId, await sha(refresh), Date.now() + 900_000, Date.now() + 86_400_000)
  ]);
  return { userId, deviceId, access, refresh };
}
export function request(path: string, access?: string, method = 'GET', body?: unknown) {
  return app.request('https://api.example.test' + path, { method,
    headers: { ...(access ? { Authorization: 'Bearer ' + access } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
}
export const emptyDefinition = { word: 'synthetic', phonetics: [], meanings: [] };
export function create(entryId = 'entry-A', operationId = 'create-A', count: number | null = null): WireOperation {
  return { operationId, entryId, kind: 'create', payload: { word: entryId, kind: 'word', count, definition: emptyDefinition, notes: '', createdAtMs: 1, updatedAtMs: 1 } };
}
export function record(entryId: string, eventId: string): WireOperation {
  return { operationId: eventId, entryId, kind: 'record', payload: { event: { id: eventId, timestamp: 1000, definition: emptyDefinition } } };
}
export async function send(access: string, operation: WireOperation) { return request('/api/v1/sync/operations', access, 'POST', operation); }
