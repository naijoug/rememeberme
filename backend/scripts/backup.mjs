import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const [source, target] = process.argv.slice(2);
if (!source || !target) throw new Error('Usage: node scripts/backup.mjs DATABASE NEW_BACKUP_PATH');
if (existsSync(target)) throw new Error('Backup destination must be a new file');
const database = new DatabaseSync(resolve(source), { readOnly: true });
try {
  database.prepare('VACUUM INTO ?').run(resolve(target));
  chmodSync(target, 0o600);
} finally { database.close(); }
const backup = new DatabaseSync(resolve(target), { readOnly: true });
try {
  if (backup.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok'
    || backup.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Backup verification failed');
} finally { backup.close(); }
console.log('Consistent SQLite backup verified.');
