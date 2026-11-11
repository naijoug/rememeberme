import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DictionaryStore } from '../src/dictionary/store';
import { DictionaryGenerator } from '../src/dictionary/provider';
import { runBuild } from '../src/dictionary/runner';
import { packageEdition } from '../src/dictionary/package';
import { GenerationError, hash, parseDataset, parseEntry, parseReferences, type BuildConfig, type Generated } from '../src/dictionary/model';
import ecdictSource from '../dictionary/sources/ecdict.json';
import { parseWordlists, type Wordlist } from '../src/dictionary/wordlists';

const config: BuildConfig = { model: 'fixture/model', baseURL: 'http://127.0.0.1:1234/v1/', maxRequests: 10, maxOutputTokens: 1000, outputBudget: 10000, maxAttempts: 3 };
const dataset = parseDataset({ id: 'synthetic-v1', metadata: { source: 'disposable test fixture' }, words: [
  { word: 'fixture', tags: ['test'] }, { word: 'sample', tags: ['test'] },
] });
const raw = (word: string) => ({ word, forms: [], senses: [{ partOfSpeech: 'noun', en: 'A test example.', zh: '测试示例',
  example: { en: 'This is a test example.', zh: '这是一个测试示例。' }, collocations: ['test example'] }] });
const generated = (word: string): Generated => ({ entry: parseEntry(raw(word), word), model: 'fixture/model', provider: 'fixture', usage: { input: 100, output: 200 } });
const wordlist = (category: Wordlist['category'], words: string[]): Wordlist => ({ id: category + '-fixture-v1', category, title: category, version: 'fixture-v1',
  source: { url: 'https://example.com/wordlist', revision: 'fixture-v1', sha256: 'b'.repeat(64), license: 'CC0-1.0', note: 'Synthetic test list, not an exam syllabus.' }, words, excluded: [] });
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
    store.db.prepare('INSERT INTO generation_batches(id,build_id,prompt_hash,requested_model,max_output_tokens,started_at) VALUES(?,?,?,?,?,?)')
      .run('interrupted-fixture', build, hash('fixture batch prompt'), config.model, config.maxOutputTokens, Date.now());
    store.db.prepare('UPDATE attempts SET batch_id=? WHERE id=?').run('interrupted-fixture', reserved.attempt);
    const reopened = new DictionaryStore(path); stores.push(reopened);
    expect(() => reopened.acquire()).toThrow('lease');
    store.db.exec('UPDATE lease SET expires_at=0'); reopened.acquire();
    expect(reopened.reserve(build)).toBeNull();
    expect(reopened.status(build).usage).toMatchObject({ requests: 1, reservedOutput: 1000, unknownUsageRequests: 1 });
    expect(() => store.complete(build, reserved, generated('fixture'))).toThrow('lease lost');
    expect(reopened.db.prepare('SELECT state FROM attempts').get()!.state).toBe('interrupted');
    expect(reopened.db.prepare('SELECT error FROM generation_batches').get()!.error).toBe('INTERRUPTED');
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
    await runBuild(store, build, { generate: async word => { calls++; return generated(word); } }, { limit: 1, concurrency: 16, delayMs: 0 });
    expect(calls).toBe(1); expect(store.status(build).usage).toMatchObject({ requests: 1 });
  });
  it('stops a run on authentication failure and never approves generated content', async () => {
    const { store, build } = setup();
    const report = await runBuild(store, build, { generate: async () => { throw new GenerationError('HTTP_401'); } }, { delayMs: 0 });
    expect(report.completed).toBe(1);
    expect(report.states).toEqual([{ state: 'failed', count: 1 }, { state: 'pending', count: 1 }]);
    expect(store.db.prepare('SELECT count(*) AS n FROM reviews').get()!.n).toBe(0);
  });
  it('drains on rate limiting and persists the cooldown across restarts', async () => {
    const { store, build, path } = setup();
    const until = Date.now() + 120000;
    const report = await runBuild(store, build, { generate: async () => { throw new GenerationError('HTTP_429', true, undefined, until); } }, { delayMs: 0 });
    expect(report.completed).toBe(1); expect(report.stopped).toBe('provider-cooldown');
    expect(report.cooldownUntil).toBe(until);
    const reopened = new DictionaryStore(path); stores.push(reopened);
    expect(() => reopened.acquire()).toThrow('cooldown');
    reopened.acquire(until + 1); reopened.release();
  });
  it('supplies a failed draft with explicit editorial provenance without erasing failures or approving it', async () => {
    const { store, build } = setup();
    await runBuild(store, build, { generate: async () => { throw new GenerationError('INVALID_ENTRY', true); } }, { limit: 1, delayMs: 0 });
    const before = store.status(build).usage;
    const supplied = store.supplyEditorialDraft(build, 'fixture', raw('fixture'), 'fixture-editor', 'Disposable failure repair.');
    expect(supplied.reviewStatus).toBe('draft'); expect(store.status(build).usage).toEqual(before);
    expect(store.records(build)[0].provenance).toMatchObject({ origin: 'editorial-supply', model: null, provider: null, promptHash: null });
    expect(store.db.prepare('SELECT state,error FROM attempts').get()).toMatchObject({ state: 'failed', error: 'INVALID_ENTRY' });
    expect(store.db.prepare('SELECT count(*) AS n FROM reviews').get()!.n).toBe(0);
    expect(() => store.supplyEditorialDraft(build, 'fixture', raw('fixture'), 'fixture-editor', 'Cannot overwrite.')).toThrow('failed job');
  });
  it('journals an authorized model switch while retaining successful drafts, failed attempts and all budgets', async () => {
    const { store, build } = setup({ ...config, maxRequests: 3, outputBudget: 3000 });
    await runBuild(store, build, { generate: async word => {
      if (word === 'sample') throw new GenerationError('HTTP_402');
      return generated(word);
    } }, { delayMs: 0 });
    const original = store.records(build)[0].contentHash;
    expect(() => store.authorizeModel(build, 'fixture/alternative', '')).toThrow('reason');
    const routeId = store.authorizeModel(build, 'fixture/alternative', 'User-authorized provider switch after HTTP 402.');
    const calls: string[] = [];
    await runBuild(store, build, { generate: async word => { calls.push(word); return { ...generated(word), model: 'fixture/alternative' }; } }, { routeId, delayMs: 0 });
    expect(calls).toEqual(['sample']); expect(store.records(build)[0].contentHash).toBe(original);
    expect(store.config(build).model).toBe(config.model);
    expect(store.records(build)[1].provenance).toMatchObject({ generationRoute: routeId, requestedModel: 'fixture/alternative' });
    expect(store.status(build).usage).toMatchObject({ requests: 3, reservedOutput: 3000 });
    expect(store.db.prepare("SELECT count(*) AS n FROM attempts WHERE error='HTTP_402'").get()!.n).toBe(1);
    const other = store.initialize({ ...dataset, id: 'other-route-build' }, config);
    expect(() => store.routeConfig(other, routeId)).toThrow('Unknown model route');
  });
  it('cannot replenish a spent budget by switching model', async () => {
    const { store, build } = setup({ ...config, maxRequests: 1, outputBudget: 1000 });
    await runBuild(store, build, { generate: async () => { throw new GenerationError('HTTP_402'); } }, { delayMs: 0 });
    const routeId = store.authorizeModel(build, 'fixture/alternative', 'Synthetic route change.');
    const result = await runBuild(store, build, { generate: async word => generated(word) }, { routeId, delayMs: 0 });
    expect(result.completed).toBe(0); expect(result.usage).toMatchObject({ requests: 1, reservedOutput: 1000 });
  });
  it('stores versioned many-to-many lists and distinguishes missing, draft and approved coverage', async () => {
    const { store, build } = setup();
    const a = wordlist('ket', ['fixture', 'unseen']), b = wordlist('cet4', ['fixture', 'sample']);
    expect(store.importWordlists({ schemaVersion: 1, lists: [a, b] })).toHaveLength(2);
    store.importWordlists({ schemaVersion: 1, lists: [a] });
    expect(() => store.importWordlists({ schemaVersion: 1, lists: [{ ...a, words: ['other'] }] })).toThrow('new version');
    expect(() => parseWordlists({ schemaVersion: 1, lists: [{ ...a, words: ['two words'] }] })).toThrow('Invalid wordlist');
    await runBuild(store, build, { generate: async word => generated(word) }, { delayMs: 0 });
    expect(store.wordlistCoverage([a.id])[0]).toMatchObject({ target: 2, approved: 0, unapproved: 1, missing: 1, missingWords: ['unseen'] });
    store.approveEdition(build, { reviewer: 'fixture-editor', method: 'ai-assisted-v1', evidenceHash: 'a'.repeat(64),
      items: store.records(build).map(r => ({ word: r.word, inputHash: r.contentHash, decision: 'approved', entry: raw(r.word), note: 'Synthetic review.' })) });
    expect(store.wordlistCoverage([a.id, b.id]).map(r => [r.category, r.approved, r.missing])).toEqual([['cet4', 2, 0], ['ket', 1, 1]]);
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
    store.db.exec('ALTER TABLE attempts DROP COLUMN batch_id; DROP TABLE generation_batches; ALTER TABLE attempts DROP COLUMN route_id; DROP TABLE generation_routes; DROP TABLE wordlist_members; DROP TABLE wordlists; DROP TABLE editorial_drafts; DROP TABLE catalogs; ALTER TABLE lease DROP COLUMN cooldown_until; DROP TABLE edition_entries; DROP TABLE editions; PRAGMA user_version=1;');
    const migrated = new DictionaryStore(path); stores.push(migrated);
    expect(migrated.db.prepare('PRAGMA user_version').get()!.user_version).toBe(6);
    expect(migrated.records(build)).toHaveLength(2);
  });
  it('composes disjoint approved editions without regenerating or changing earlier entries', async () => {
    const { store, build: first, directory } = setup();
    const approve = async (build: string) => {
      await runBuild(store, build, { generate: async word => generated(word) }, { delayMs: 0 });
      return store.approveEdition(build, { reviewer: 'fixture-editor', method: 'ai-assisted-v1', evidenceHash: 'a'.repeat(64),
        items: store.records(build).map(r => ({ word: r.word, inputHash: r.contentHash, decision: 'approved', entry: raw(r.word), note: 'Synthetic review.' })) });
    };
    const a = await approve(first);
    const original = store.db.prepare('SELECT entry,content_hash FROM edition_entries WHERE edition_id=? AND word=?').get(a, 'fixture');
    const second = store.initialize({ id: 'expansion-v1', metadata: { source: ecdictSource }, words: [{ word: 'additional', tags: ['test'] }] }, config);
    const b = await approve(second);
    const before = store.status(first).usage!.requests;
    const manifest = store.publishCatalog([a, b], join(directory, 'catalog'));
    expect(manifest.count).toBe(3); expect(manifest.editions).toEqual([a, b].sort());
    expect(store.status(first).usage!.requests).toBe(before);
    expect(store.db.prepare('SELECT entry,content_hash FROM edition_entries WHERE edition_id=? AND word=?').get(a, 'fixture')).toEqual(original);
    const packed = packageEdition(join(directory, 'catalog'), join(directory, 'catalog-assets'));
    expect(packed.entries).toBe(3);
    expect(packed.sources).toEqual([{ id: 'ecdict', repository: ecdictSource.repository, revision: ecdictSource.revision, license: 'MIT' }]);
    expect(readFileSync(join(directory, 'catalog-assets', 'ECDICT-LICENSE.txt'), 'utf8')).toBe(ecdictSource.licenseText);
    const included = JSON.parse(readFileSync(join(directory, 'catalog-assets', packed.words.fixture + '.json'), 'utf8')).fixture;
    expect(included.contentHash).toBe(original!.content_hash);
    expect(store.publishCatalog([b, a], join(directory, 'same-catalog')).dictionaryVersion).toBe(manifest.dictionaryVersion);
    expect(() => store.publishCatalog([a, a], join(directory, 'duplicate'))).toThrow('distinct');
    const overlapBuild = store.initialize({ id: 'overlap-v1', metadata: {}, words: [{ word: 'fixture', tags: [] }] }, config);
    const overlap = await approve(overlapBuild);
    expect(() => store.publishCatalog([a, overlap], join(directory, 'overlap'))).toThrow('Overlapping');
    expect(() => store.publishCatalog([a, '0'.repeat(24)], join(directory, 'unknown'))).toThrow('Unknown');
    const list = wordlist('ket', ['fixture', 'additional', 'missing']);
    store.importWordlists({ schemaVersion: 1, lists: [list] });
    const categorized = store.publishCatalog([a, b], join(directory, 'categorized'), [list.id]);
    expect(categorized.dictionaryVersion).not.toBe(manifest.dictionaryVersion);
    const labeled = packageEdition(join(directory, 'categorized'), join(directory, 'categorized-assets'));
    expect(labeled.categories[0]).toMatchObject({ category: 'ket', target: 3, covered: 2, missing: 1, words: ['fixture', 'additional'] });
    expect(JSON.parse(readFileSync(join(directory, 'categorized-assets', labeled.words.fixture + '.json'), 'utf8')).fixture.contentHash).toBe(original!.content_hash);
  });
});

describe('dictionary generation boundary', () => {
  it('validates all six checked-in category lists and their disjoint supplementation plan', () => {
    const lists = parseWordlists(JSON.parse(readFileSync(new URL('../dictionary/categories/wordlists.json', import.meta.url), 'utf8')));
    expect(lists.map(l => l.category)).toEqual(['ket', 'cet4', 'cet6', 'tem8', 'toefl', 'ielts']);
    expect(lists.find(l => l.category === 'tem8')!.words).toContain('barometer');
    expect(lists.find(l => l.category === 'tem8')!.words).not.toContain('barometre');
    const base = JSON.parse(readFileSync(new URL('../dictionary/pilot-1000.json', import.meta.url), 'utf8'));
    const words: string[] = base.words.map((w: { word: string }) => w.word);
    for (const [directory, prefix, count] of [['expansion-10000', 'expansion-10000', 9], ['categories', 'category-expansion', 6]] as const) {
      for (let i = 1; i <= count; i++) {
        const dataset = parseDataset(JSON.parse(readFileSync(new URL(`../dictionary/${directory}/${prefix}-part-${String(i).padStart(2, '0')}.json`, import.meta.url), 'utf8')));
        expect(hash(dataset.words.map(w => w.word).join('\n') + '\n')).toBe(dataset.metadata.wordsSha256);
        words.push(...dataset.words.map(w => w.word));
      }
    }
    expect(words.length).toBe(15434); expect(new Set(words).size).toBe(words.length);
    expect(lists.every(l => l.words.every(w => words.includes(w)))).toBe(true);
  });
  it('pins nine disjoint expansion batches and preserves the approved base selection', () => {
    const base = parseDataset(JSON.parse(readFileSync(new URL('../dictionary/pilot-1000.json', import.meta.url), 'utf8')));
    const words = base.words.map(w => w.word);
    for (let part = 1; part <= 9; part++) {
      const data = parseDataset(JSON.parse(readFileSync(new URL(`../dictionary/expansion-10000/expansion-10000-part-${String(part).padStart(2, '0')}.json`, import.meta.url), 'utf8')));
      expect(data.words).toHaveLength(1000);
      expect(hash(data.words.map(w => w.word).join('\n') + '\n')).toBe(data.metadata.wordsSha256);
      expect(data.metadata.source).toMatchObject({ revision: ecdictSource.revision, csvSha256: ecdictSource.csvSha256 });
      words.push(...data.words.map(w => w.word));
    }
    expect(new Set(words).size).toBe(10000);
    expect(hash(readFileSync(new URL('../dictionary/sources/ECDICT-LICENSE.txt', import.meta.url), 'utf8'))).toBe(ecdictSource.licenseSha256);
  });
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
      expect(request.response_format).toEqual({ type: 'json_object' });
      return Response.json({ model: 'group/alias', usage: { prompt_tokens: 21, completion_tokens: 65 },
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(raw('fixture')) } }] },
      { headers: { 'X-Magpie-Model': 'fixture/model', 'X-Magpie-Provider': 'fixture' } });
    };
    const result = await new DictionaryGenerator(config, 'synthetic-key', fetcher).generate('fixture');
    expect(result.model).toBe('fixture/model'); expect(result.usage).toEqual({ input: 21, output: 65 });
  });
  it('uses bounded pinned public reference clues without accepting an unrelated spelling', async () => {
    const refs = parseReferences({ fixture: { source: 'ecdict-wordnet-v1', originalSpelling: 'Fixture', english: ['noun: A test object.'], chinese: '测试对象', forms: ['fixtures'] } });
    expect(() => new DictionaryGenerator(config, 'synthetic-key', fetch, 1000, refs)).toThrow('pinned');
    const generator = new DictionaryGenerator({ ...config, referenceHash: 'a'.repeat(64) }, 'synthetic-key', async (_url, init) => {
      expect(JSON.parse(String(init?.body)).messages[1].content).toContain('ecdict-wordnet-v1');
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(raw('Fixture')) } }] });
    }, 1000, refs);
    expect((await generator.generate('fixture')).entry.word).toBe('fixture');
    await expect(generator.generate('missing')).rejects.toMatchObject({ code: 'MISSING_REFERENCE' });
    expect(() => parseReferences({ fixture: { ...refs.fixture, secret: 'not-allowed' } })).toThrow('Invalid lexical reference');
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
  it('retains provider Retry-After without retaining response bodies', async () => {
    const before = Date.now();
    const generator = new DictionaryGenerator(config, 'synthetic-key', async () => new Response('private provider error', { status: 429, headers: { 'retry-after': '120' } }));
    const error = await generator.generate('fixture').catch(e => e);
    expect(error).toMatchObject({ code: 'HTTP_429', retryable: true });
    expect(error.retryAfter).toBeGreaterThanOrEqual(before + 120000);
    expect(error.message).not.toContain('private');
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
