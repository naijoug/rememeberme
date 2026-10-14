// Creates a new recovery database; never overwrites a running database.
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const [source, target] = process.argv.slice(2);
if (!source || !target) throw new Error('Usage: node scripts/restore.mjs BACKUP NEW_DATABASE_PATH (stop API writes first)');
const result = spawnSync(process.execPath, [fileURLToPath(new URL('./backup.mjs', import.meta.url)), source, target], { stdio: 'inherit' });
if (result.status !== 0) throw new Error('Restore copy verification failed');
const database = new DatabaseSync(target);
try {
  database.exec('PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; BEGIN IMMEDIATE');
  try {
    for (const { id } of database.prepare('SELECT id FROM users').all()) {
      database.prepare('UPDATE users SET sync_epoch=? WHERE id=?').run(randomUUID(), id);
    }
    database.exec('COMMIT');
  } catch (error) { database.exec('ROLLBACK'); throw error; }
  if (database.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok'
    || database.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Restored database verification failed');
} finally { database.close(); }
console.log('New recovery database verified with fresh account epochs. Select it only after API writes are stopped and the previous database/WAL are retained.');
