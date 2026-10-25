import { ApiError, keys, object, version } from '../../contracts/api-v1';
import type { Database } from './runtime';
import type { Identity } from './auth';

/** Compare-and-set prevents a late retry from taking the reminder role back. */
export async function selectReminderDevice(db: Database, who: Identity, input: unknown) {
  if (!object(input)) throw new ApiError('INVALID_REQUEST');
  keys(input, ['enabled', 'expectedRevision'], ['enabled', 'expectedRevision']);
  if (typeof input.enabled !== 'boolean' || !version(input.expectedRevision)) throw new ApiError('INVALID_REQUEST');
  if (input.expectedRevision >= Number.MAX_SAFE_INTEGER) throw new ApiError('VERSION_EXHAUSTED', 409);
  const changed = await db.prepare(`UPDATE users SET reminder_device_id=?,reminder_revision=reminder_revision+1
    WHERE id=? AND deleted_at IS NULL AND reminder_revision=?
    AND (?=1 OR reminder_device_id=?)
    AND EXISTS (SELECT 1 FROM sessions s JOIN devices d ON d.user_id=s.user_id AND d.id=s.device_id
      WHERE s.token_hash=? AND s.user_id=users.id AND s.revoked_at IS NULL AND s.access_expires_at>?
      AND d.revoked_at IS NULL)`).bind(input.enabled ? who.deviceId : null, who.userId,
      input.expectedRevision, Number(input.enabled), who.deviceId, who.sessionHash, Date.now()).run();
  if (changed.meta.changes !== 1) throw new ApiError('REMINDER_SELECTION_CHANGED', 409);
  return { deviceId: input.enabled ? who.deviceId : null, revision: input.expectedRevision + 1 };
}
