import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { isDefinition } from '../frontend/browser-extension/services/definition-utils.ts';

const root = new URL('./fixtures/', import.meta.url);
const read = (name: string) => JSON.parse(readFileSync(new URL(name, root), 'utf8'));
const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
export function validLegacy(input: unknown): boolean {
  return Array.isArray(input) && input.every(row => row && typeof row.word === 'string' && row.word.trim()
    && finite(row.count) && finite(row.createdAt) && finite(row.updatedAt) && Array.isArray(row.history)
    && row.history.every((event: any) => event && finite(event.timestamp) && typeof event.context === 'string'
      && typeof event.url === 'string' && isDefinition(event.definition)));
}
const digest = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const id = (type: string, values: unknown[]) => `${type}:${digest(JSON.stringify(values))}`;
export function sourceReport(bytes: Buffer) {
  const sourceDigest = digest(bytes);
  const rows = JSON.parse(bytes.toString('utf8'));
  assert.ok(validLegacy(rows));
  const entries = rows.map((row: any, index: number) => ({
    id: id('entry', ['legacy-entry-v1', sourceDigest, index]), word: row.word.trim().toLowerCase(), count: row.count,
    encounters: row.history.map((_: any, position: number) => id('encounter', ['legacy-encounter-v1', sourceDigest, index, position])),
  }));
  return { sourceDigest, entries };
}
if (process.argv.includes('--report')) {
  console.log(JSON.stringify(sourceReport(readFileSync(new URL('legacy-shared.json', root)))));
} else {
  for (const test of read('legacy-validation.json')) assert.equal(validLegacy(test.data), test.valid, test.name);
  for (const test of read('normalization.json')) assert.equal(test.input.trim().toLowerCase(), test.expected);
  for (const test of read('review-v1.json')) {
    const step = test.result === 'forgot' ? 0 : test.result === 'fuzzy' ? Math.max(test.step, 0) : Math.min(test.step + 1, 4);
    assert.equal(step, test.nextStep);
    assert.equal(test.answeredAtMs + [1, 3, 7, 14, 30][step] * 86_400_000, test.dueAtMs);
  }
  const report = sourceReport(readFileSync(new URL('legacy-shared.json', root)));
  assert.deepEqual(report, read('legacy-expected.json'));
  const backup = read('backup-v1.json');
  assert.equal(backup.format, 'rememberme-backup');
  assert.equal(backup.schemaVersion, 1);
  const legacyBackup = backup.entries.map((entry: any) => ({ ...entry.legacyFields,
    word: entry.normalizedKey, count: entry.count ?? 0, createdAt: entry.createdAt, updatedAt: entry.updatedAt,
    history: entry.history.map((record: any) => ({ ...record.legacyFields, timestamp: record.timestamp,
      context: record.context, url: record.url, definition: record.definition })),
  }));
  assert.deepEqual(legacyBackup, read('backup-legacy-expected.json'));
  for (const test of read('restore-v1.json')) {
    const conflict = test.deleted ? test.choice !== 'keepCurrent'
      : test.currentCount !== test.backupCount && test.choice == null;
    assert.equal(conflict, test.conflict, test.name);
    if (conflict) assert.equal(!test.deleted, test.canUseBackup, test.name);
    else assert.equal(test.choice === 'useBackup' && !test.deleted ? test.backupCount : test.currentCount, test.expectedCount);
  }
  if (process.argv.includes('--swift-report')) {
    const index = process.argv.indexOf('--swift-report');
    assert.deepEqual(JSON.parse(readFileSync(fileURLToPath(new URL(process.argv[index + 1], `file://${process.cwd()}/`)), 'utf8')), report);
  }
  console.log('Shared validation, normalization, source identity, backup/restore and review fixtures passed.');
}
