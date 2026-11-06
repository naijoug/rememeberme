import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DictionaryStore } from '../src/dictionary/store';
import { DictionaryGenerator } from '../src/dictionary/provider';
import { runBuild } from '../src/dictionary/runner';
import { packageEdition } from '../src/dictionary/package';
import { GenerationError, hash, parseDataset, parseEntry, type BuildConfig, type Generated } from '../src/dictionary/model';

const config: BuildConfig = { model: 'fixture/model', baseURL: 'http://127.0.0.1:1234/v1/', maxRequests: 10, maxOutputTokens: 1000, outputBudget: 10000, maxAttempts: 3 };
const dataset = parseDataset({ id: 'synthetic-v1', metadata: { source: 'disposable test fixture' }, words: [
  { word: 'fixture', tags: ['test'] }, { word: 'sample', tags: ['test'] },
] });
const raw = (word: string) => ({ word, forms: [], senses: [{ partOfSpeech: 'noun', en: 'A test example.', zh: '测试示例',
  example: { en: 'This is a test example.', zh: '这是一个测试示例。' }, collocations: ['test example'] }] });
const generated = (word: string): Generated => ({ entry: parseEntry(raw(word), word), model: 'fixture/model', provider: 'fixture', usage: { input: 100, output: 200 } });
const directories: string[] = [], stores: DictionaryStore[] = [];
function setup(custom = config) {
  const directory = mkdtempSync(join(tmpdir(), 'rm-dictionary-test-')); directories.push(directory);
  const path = join(directory, 'dictionary.sqlite');
  const store = new DictionaryStore(path); stores.push(store);
  return { store, build: store.initialize(dataset, custom), path, directory };
}
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('independent dictionary database', () => {
  it('rejects a user database without changing its schema or journaling mode', () => {
    const directory = mkdtempSync(join(tmpdir(), 'rm-user-db-test-')); directories.push(directory);
    const path = join(directory, 'users.sqlite'); const db = new DatabaseSync(path);
    db.exec('CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES(\'synthetic\');'); db.close();
    const before = readFileSync(path);
    expect(() => new DictionaryStore(path)).toThrow('non-dictionary');
    expect(readFileSync(path)).toEqual(before);
  });
  it('seeds idempotently and rejects changed datasets under the same version', () => {
    const { store, build } = setup();
    expect(store.initialize(dataset, config)).toBe(build);
    expect(store.status(build).states).toEqual([{ state: 'pending', count: 2 }]);
    expect(() => store.initialize({ ...dataset, words: dataset.words.slice(0, 1) }, config)).toThrow('Dataset changed');
  });
  it('resumes without regenerating successful drafts and preserves provenance', async () => {
    const { store, build, path } = setup(); const calls: string[] = [];
    const generator = { generate: async (word: string) => { calls.push(word); return generated(word); } };
    await runBuild(store, build, generator, { limit: 1, delayMs: 0 });
    const reopened = new DictionaryStore(path); stores.push(reopened);
    await runBuild(reopened, build, generator, { delayMs: 0 });
    await runBuild(reopened, build, generator, { delayMs: 0 });
    expect(calls).toEqual(['fixture', 'sample']);
    expect(reopened.records(build)[0].provenance.model).toBe('fixture/model');
    expect(reopened.status(build).usage).toMatchObject({ requests: 2, reportedOutput: 400 });
  });
  it('keeps older prompt builds readable but refuses to resume them with new generation code', async () => {
    const { store, build } = setup();
    await runBuild(store, build, { generate: async word => generated(word) }, { delayMs: 0 });
    store.db.prepare('UPDATE builds SET prompt_hash=?,prompt_version=? WHERE id=?').run('historical-hash', 'historical-prompt', build);
    expect(store.records(build)[0].provenance).toMatchObject({ promptHash: 'historical-hash', promptVersion: 'historical-prompt' });
    expect(store.status(build).usage).toMatchObject({ requests: 2 });
    await expect(runBuild(store, build, { generate: async word => generated(word) })).rejects.toThrow('Build code changed');
  });
  it('charges interrupted requests against durable budgets and recovers stale leases', () => {
    const { store, build, path } = setup({ ...config, maxRequests: 1 });
    store.acquire(); const reserved = store.reserve(build)!;
    const reopened = new DictionaryStore(path); stores.push(reopened);
    expect(() => reopened.acquire()).toThrow('lease');
    store.db.exec('UPDATE lease SET expires_at=0'); reopened.acquire();
    expect(reopened.reserve(build)).toBeNull();
    expect(reopened.status(build).usage).toMatchObject({ requests: 1, reservedOutput: 1000, unknownUsageRequests: 1 });
    expect(() => store.complete(build, reserved, generated('fixture'))).toThrow('lease lost');
    expect(reopened.db.prepare('SELECT state FROM attempts').get()!.state).toBe('interrupted');
    reopened.release();
  });
  it('does not exceed the output reservation budget after retryable failures', () => {
    const { store, build } = setup({ ...config, outputBudget: 1000 });
    store.acquire(); const job = store.reserve(build)!;
    store.complete(build, job, undefined, new GenerationError('TIMEOUT', true));
    expect(store.reserve(build)).toBeNull(); store.release();
    expect(store.status(build).usage).toMatchObject({ requests: 1, reservedOutput: 1000 });
  });
  it('limits retries per word and finishes first attempts before retrying', () => {
    const { store, build } = setup({ ...config, maxAttempts: 2 }); store.acquire();
    const words: string[] = [];
    for (let i = 0; i < 4; i++) { const job = store.reserve(build)!; words.push(job.word); store.complete(build, job, undefined, new GenerationError('TIMEOUT', true)); }
    expect(words).toEqual(['fixture', 'sample', 'fixture', 'sample']); expect(store.reserve(build)).toBeNull(); store.release();
  });
  it('does not overclaim the invocation limit under concurrent workers', async () => {
    const { store, build } = setup(); let calls = 0;
    await runBuild(store, build, { generate: async word => { calls++; return generated(word); } }, { limit: 1, concurrency: 4, delayMs: 0 });
    expect(calls).toBe(1); expect(store.status(build).usage).toMatchObject({ requests: 1 });
  });
  it('stops a run on authentication failure and never approves generated content', async () => {
    const { store, build } = setup();
    const report = await runBuild(store, build, { generate: async () => { throw new GenerationError('HTTP_401'); } }, { delayMs: 0 });
    expect(report.completed).toBe(1);
    expect(report.states).toEqual([{ state: 'failed', count: 1 }, { state: 'pending', count: 1 }]);
    expect(store.db.prepare('SELECT count(*) AS n FROM reviews').get()!.n).toBe(0);
  });
  it('requires hash-bound reviews, publishes only approved records and verifies backups', async () => {
    const { store, build, directory } = setup();
    await runBuild(store, build, { generate: async word => generated(word) }, { delayMs: 0 });
    const destination = join(directory, 'release');
    expect(() => store.publish(build, destination)).toThrow('review');
    const records = store.records(build);
    expect(() => store.review(build, 'fixture', 'wrong', 'approved', 'tester', 'checked')).toThrow('content hash');
    store.review(build, 'fixture', records[0].contentHash, 'approved', 'tester', 'Synthetic acceptance only');
    store.review(build, 'sample', records[1].contentHash, 'rejected', 'tester', 'Synthetic rejection only');
    expect(() => store.review(build, 'fixture', records[0].contentHash, 'rejected', 'tester', 'late')).toThrow();
    const manifest = store.publish(build, destination); expect(manifest.count).toBe(1);
    const shard = JSON.parse(readFileSync(join(destination, hash('fixture').slice(0, 2) + '.json'), 'utf8'));
    expect(shard.fixture.reviewStatus).toBe('approved'); expect(Object.keys(shard)).toEqual(['fixture']);
    expect(() => store.publish(build, destination)).toThrow('exists');
    const backup = join(directory, 'backup.sqlite'); store.backup(backup);
    const restored = new DictionaryStore(backup); stores.push(restored);
    expect(restored.records(build)).toEqual(store.records(build));
    const jsonl = join(directory, 'review.jsonl'); expect(store.exportDrafts(build, jsonl)).toBe(2);
    expect(() => store.exportDrafts(build, jsonl)).toThrow();
  });
  it('publishes a fully reviewed edition without rewriting the original rejected or draft records', async () => {
    const { store, build, directory } = setup();
    await runBuild(store, build, { generate: async word => generated(word) }, { delayMs: 0 });
    const original = store.records(build);
    store.review(build, 'fixture', original[0].contentHash, 'rejected', 'tester', 'Synthetic example correction required');
    const decisions = { reviewer: 'synthetic-editor', method: 'ai-assisted-v1' as const, evidenceHash: 'a'.repeat(64),
      items: original.map(row => ({ word: row.word, inputHash: row.contentHash, decision: 'approved' as const, entry: raw(row.word), note: 'Checked all synthetic senses and examples.' })) };
    expect(() => store.approveEdition(build, decisions)).toThrow('rejected draft');
    decisions.items[0].entry.senses[0].example.en = 'This object is only a synthetic fixture.';
    const stale = structuredClone(decisions); stale.items[1].inputHash = 'b'.repeat(64);
    expect(() => store.approveEdition(build, stale)).toThrow('Stale');
    expect(store.status(build).editions).toHaveLength(0);
    const edition = store.approveEdition(build, decisions);
    expect(store.approveEdition(build, decisions)).toBe(edition);
    expect(store.records(build)[0].reviewStatus).toBe('rejected');
    expect(store.records(build)[0].contentHash).toBe(original[0].contentHash);
    expect(store.status(build).editions[0]).toMatchObject({ id: edition, approved: 2 });
    const manifest = store.publishEdition(edition, join(directory, 'reviewed-release'));
    expect(manifest.dictionaryVersion).toBe(edition); expect(manifest.count).toBe(2);
    const row = store.db.prepare('SELECT original_entry,entry FROM edition_entries WHERE edition_id=? AND word=?').get(edition, 'fixture')!;
    expect(JSON.parse(String(row.original_entry))).toEqual(generated('fixture').entry);
    expect(JSON.parse(String(row.entry)).senses[0].example.en).toBe('This object is only a synthetic fixture.');
    const packed = packageEdition(join(directory, 'reviewed-release'), join(directory, 'client-assets'));
    expect(packed.entries).toBe(2); expect(packed.version).toBe(edition);
    expect(Object.keys(packed.words)).toEqual(expect.arrayContaining(['fixture', 'sample']));
    const asset = readFileSync(join(directory, 'client-assets', packed.words.fixture + '.json'), 'utf8');
    expect(hash(asset)).toBe(packed.shards[packed.words.fixture].sha256);
    expect(asset).not.toContain('reviewer');
  });
  it('migrates a v1 dictionary database without losing drafts', async () => {
    const { store, build, path } = setup();
    await runBuild(store, build, { generate: async word => generated(word) }, { delayMs: 0 });
    store.db.exec('DROP TABLE edition_entries; DROP TABLE editions; PRAGMA user_version=1;');
    const migrated = new DictionaryStore(path); stores.push(migrated);
    expect(migrated.db.prepare('PRAGMA user_version').get()!.user_version).toBe(2);
    expect(migrated.records(build)).toHaveLength(2);
  });
});

describe('dictionary generation boundary', () => {
  it('validates the checked-in 1,000-word pilot and its selection digest', () => {
    const pilot = parseDataset(JSON.parse(readFileSync(new URL('../dictionary/pilot-1000.json', import.meta.url), 'utf8')));
    expect(pilot.words.length).toBe(1000);
    expect(hash(pilot.words.map(w => w.word).join('\n') + '\n')).toBe(pilot.metadata.wordsSha256);
    expect(pilot.words.every(w => w.tags.includes('pilot-common'))).toBe(true);
  });
  it('rejects mismatched words, HTML, duplicate senses and invalid Chinese', () => {
    expect(parseEntry(raw('I'), 'i').word).toBe('i');
    expect(() => parseEntry(raw('US'), 'us')).toThrow();
    expect(() => parseEntry(raw('sample'), 'fixture')).toThrow();
    for (const patch of [{ en: '<script>bad</script>' }, { zh: 'English only' }, { partOfSpeech: 'unknown' }]) {
      const entry = raw('fixture'); Object.assign(entry.senses[0], patch); expect(() => parseEntry(entry, 'fixture')).toThrow();
    }
    const entry = raw('fixture'); entry.senses.push(entry.senses[0]); expect(() => parseEntry(entry, 'fixture')).toThrow();
    expect(() => parseDataset({ ...dataset, words: [dataset.words[0], dataset.words[0]] })).toThrow('Duplicate');
  });
  it('uses a private word-only request and records upstream headers, not the alias', async () => {
    const fetcher: typeof fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      expect(request.messages[1].content).toBe('{"word":"fixture"}');
      expect(request.max_tokens).toBe(1000); expect(init?.redirect).toBe('error');
      return Response.json({ model: 'group/alias', usage: { prompt_tokens: 21, completion_tokens: 65 },
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(raw('fixture')) } }] },
      { headers: { 'X-Magpie-Model': 'fixture/model', 'X-Magpie-Provider': 'fixture' } });
    };
    const result = await new DictionaryGenerator(config, 'synthetic-key', fetcher).generate('fixture');
    expect(result.model).toBe('fixture/model'); expect(result.usage).toEqual({ input: 21, output: 65 });
  });
  it('retains usage on invalid entries, rejects tool calls and keeps missing attribution unknown', async () => {
    const response = (message: object) => Response.json({ usage: { prompt_tokens: 10, completion_tokens: 20 }, choices: [{ finish_reason: 'stop', message }] });
    await expect(new DictionaryGenerator(config, 'synthetic-key', async () => response({ content: '{}' })).generate('fixture'))
      .rejects.toMatchObject({ code: 'INVALID_ENTRY', observation: { usage: { input: 10, output: 20 } } });
    await expect(new DictionaryGenerator(config, 'synthetic-key', async () => response({ content: JSON.stringify(raw('fixture')), tool_calls: [] })).generate('fixture'))
      .rejects.toMatchObject({ code: 'INVALID_COMPLETION' });
    const result = await new DictionaryGenerator(config, 'synthetic-key', async () => response({ content: JSON.stringify(raw('fixture')) })).generate('fixture');
    expect(result.model).toBeNull();
  });
  it('caps response size, preserves cancellation and times out fetches', async () => {
    await expect(new DictionaryGenerator(config, 'synthetic-key', async () => new Response('x'.repeat(140000), { headers: { 'Content-Type': 'application/json' } })).generate('fixture'))
      .rejects.toMatchObject({ code: 'OVERSIZED_RESPONSE' });
    const fetcher: typeof fetch = async (_url, init) => new Promise((_resolve, reject) => {
      if (init?.signal?.aborted) reject(new Error('aborted'));
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
    await expect(new DictionaryGenerator(config, 'synthetic-key', fetcher, 10).generate('fixture')).rejects.toMatchObject({ code: 'TIMEOUT' });
    await expect(new DictionaryGenerator(config, 'synthetic-key', fetcher).generate('fixture', AbortSignal.abort())).rejects.toMatchObject({ code: 'CANCELLED' });
  });
  it('bounds uncooperative fetches and stalled response bodies', async () => {
    await expect(new DictionaryGenerator(config, 'synthetic-key', async () => new Promise(() => {}), 10).generate('fixture'))
      .rejects.toMatchObject({ code: 'TIMEOUT' });
    let cancelled = false;
    const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'Content-Type': 'application/json' } });
    await expect(new DictionaryGenerator(config, 'synthetic-key', async () => response, 10).generate('fixture')).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(cancelled).toBe(true);
  });
});
