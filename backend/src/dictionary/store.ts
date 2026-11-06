import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hash, parseEntry, PROMPT_HASH, PROMPT_VERSION, SCHEMA_VERSION, validateConfig, type BuildConfig, type Dataset, type Generated } from './model';
import { learnerQualityFlags } from './quality';

const APPLICATION_ID = 1380795459;
const EDITION_SQL = `CREATE TABLE editions(id TEXT PRIMARY KEY,build_id TEXT NOT NULL REFERENCES builds(id),reviewer TEXT NOT NULL,
  method TEXT NOT NULL,evidence_hash TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE edition_entries(edition_id TEXT NOT NULL REFERENCES editions(id),word TEXT NOT NULL,input_hash TEXT NOT NULL,
  original_entry TEXT NOT NULL,entry TEXT NOT NULL,content_hash TEXT NOT NULL,note TEXT NOT NULL,PRIMARY KEY(edition_id,word));`;
const SQL = `
CREATE TABLE datasets(id TEXT PRIMARY KEY, digest TEXT NOT NULL, metadata TEXT NOT NULL);
CREATE TABLE builds(id TEXT PRIMARY KEY, dataset_id TEXT NOT NULL REFERENCES datasets(id), config TEXT NOT NULL,
  prompt_hash TEXT NOT NULL, prompt_version TEXT NOT NULL, schema_version INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE jobs(build_id TEXT NOT NULL REFERENCES builds(id), word TEXT NOT NULL, rank INTEGER NOT NULL, tags TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','generating','failed','draft','approved','rejected')) DEFAULT 'pending',
  tries INTEGER NOT NULL DEFAULT 0, retryable INTEGER NOT NULL DEFAULT 1, entry TEXT, content_hash TEXT, generated_at INTEGER,
  actual_model TEXT, provider TEXT, error TEXT, PRIMARY KEY(build_id,word));
CREATE TABLE attempts(id TEXT PRIMARY KEY, build_id TEXT NOT NULL, word TEXT NOT NULL, started_at INTEGER NOT NULL,
  finished_at INTEGER, state TEXT NOT NULL, reserved_output INTEGER NOT NULL, input_tokens INTEGER, output_tokens INTEGER,
  actual_model TEXT, provider TEXT, error TEXT, FOREIGN KEY(build_id,word) REFERENCES jobs(build_id,word));
CREATE INDEX attempts_build ON attempts(build_id);
CREATE TABLE reviews(id INTEGER PRIMARY KEY, build_id TEXT NOT NULL, word TEXT NOT NULL, content_hash TEXT NOT NULL,
  decision TEXT NOT NULL, reviewer TEXT NOT NULL, note TEXT NOT NULL, reviewed_at INTEGER NOT NULL,
  FOREIGN KEY(build_id,word) REFERENCES jobs(build_id,word));
CREATE TABLE lease(id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, expires_at INTEGER NOT NULL);
INSERT INTO lease VALUES(1,'',0);
`;
export class DictionaryStore {
  readonly db: DatabaseSync;
  private owner = randomUUID();
  constructor(readonly path: string) {
    if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    try {
      // Inspect before setting WAL or touching any existing database schema.
      const id = this.db.prepare('PRAGMA application_id').get()!.application_id;
      const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
      if (id !== APPLICATION_ID && (id !== 0 || tables.length)) throw new Error('Refusing non-dictionary database');
      this.db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
      this.transaction(() => {
        if (id === 0) this.db.exec(`${SQL} PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=1;`);
        const version = this.db.prepare('PRAGMA user_version').get()!.user_version;
        if (version === 1) this.db.exec(EDITION_SQL + ' PRAGMA user_version=2;');
        else if (version !== 2) throw new Error('Unsupported dictionary database version');
      });
      if (path !== ':memory:') chmodSync(path, 0o600);
    } catch (error) { this.db.close(); throw error; }
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  initialize(dataset: Dataset, config: BuildConfig) {
    validateConfig(config);
    const digest = hash(JSON.stringify(dataset));
    const id = hash(JSON.stringify([digest, config, PROMPT_HASH, SCHEMA_VERSION])).slice(0, 24);
    return this.transaction(() => {
      const previous = this.db.prepare('SELECT digest FROM datasets WHERE id=?').get(dataset.id);
      if (previous && previous.digest !== digest) throw new Error('Dataset changed; assign a new dataset version');
      this.db.prepare('INSERT OR IGNORE INTO datasets VALUES(?,?,?)').run(dataset.id, digest, JSON.stringify(dataset.metadata));
      this.db.prepare('INSERT OR IGNORE INTO builds VALUES(?,?,?,?,?,?,?)').run(id, dataset.id, JSON.stringify(config), PROMPT_HASH, PROMPT_VERSION, SCHEMA_VERSION, Date.now());
      const insert = this.db.prepare('INSERT OR IGNORE INTO jobs(build_id,word,rank,tags) VALUES(?,?,?,?)');
      dataset.words.forEach((item, rank) => insert.run(id, item.word, rank + 1, JSON.stringify(item.tags)));
      return id;
    });
  }
  config(build: string, requireCurrentGenerator = false): BuildConfig {
    const row = this.db.prepare('SELECT * FROM builds WHERE id=?').get(build);
    if (!row) throw new Error('Unknown build');
    if (requireCurrentGenerator && (row.prompt_hash !== PROMPT_HASH || row.schema_version !== SCHEMA_VERSION)) throw new Error('Build code changed; use original code or initialize a new build');
    const config = JSON.parse(String(row.config)); validateConfig(config); return config;
  }
  acquire(now = Date.now()) {
    this.transaction(() => {
      const lease = this.db.prepare('SELECT * FROM lease WHERE id=1').get()!;
      if (lease.owner !== '' && Number(lease.expires_at) > now) throw new Error('Another dictionary worker holds the lease');
      this.db.prepare('UPDATE lease SET owner=?,expires_at=? WHERE id=1').run(this.owner, now + 180_000);
      this.db.prepare("UPDATE attempts SET state='interrupted',finished_at=?,error='INTERRUPTED' WHERE state='requested'").run(now);
      this.db.exec("UPDATE jobs SET state='failed',retryable=1,error='INTERRUPTED' WHERE state='generating'");
    });
  }
  heartbeat(now = Date.now()) {
    const result = this.db.prepare('UPDATE lease SET expires_at=? WHERE id=1 AND owner=? AND expires_at>?').run(now + 180_000, this.owner, now);
    if (!result.changes) throw new Error('Dictionary worker lease lost');
  }
  release() { this.db.prepare("UPDATE lease SET owner='',expires_at=0 WHERE id=1 AND owner=?").run(this.owner); }
  reserve(build: string): { word: string; attempt: string } | null {
    const config = this.config(build, true);
    return this.transaction(() => {
      this.heartbeat();
      const spent = this.db.prepare('SELECT count(*) AS requests,coalesce(sum(reserved_output),0) AS output FROM attempts WHERE build_id=?').get(build)!;
      if (Number(spent.requests) >= config.maxRequests || Number(spent.output) + config.maxOutputTokens > config.outputBudget) return null;
      const job = this.db.prepare("SELECT word FROM jobs WHERE build_id=? AND state IN ('pending','failed') AND retryable=1 AND tries<? ORDER BY tries,rank LIMIT 1").get(build, config.maxAttempts);
      if (!job) return null;
      const word = String(job.word), attempt = randomUUID();
      this.db.prepare("INSERT INTO attempts(id,build_id,word,started_at,state,reserved_output) VALUES(?,?,?,?,'requested',?)").run(attempt, build, word, Date.now(), config.maxOutputTokens);
      this.db.prepare("UPDATE jobs SET state='generating',tries=tries+1,error=NULL WHERE build_id=? AND word=?").run(build, word);
      return { word, attempt };
    });
  }
  complete(build: string, job: { word: string; attempt: string }, result?: Generated,
    failure?: { code: string; retryable: boolean; observation?: Omit<Generated, 'entry'> }) {
    this.transaction(() => {
      this.heartbeat();
      const attempt = this.db.prepare("SELECT id FROM attempts WHERE id=? AND build_id=? AND word=? AND state='requested'").get(job.attempt, build, job.word);
      if (!attempt) throw new Error('Attempt is no longer active');
      const observation = result ?? failure?.observation;
      this.db.prepare('UPDATE attempts SET state=?,finished_at=?,input_tokens=?,output_tokens=?,actual_model=?,provider=?,error=? WHERE id=?')
        .run(result ? 'success' : 'failed', Date.now(), observation?.usage.input ?? null, observation?.usage.output ?? null,
          observation?.model ?? null, observation?.provider ?? null, failure?.code ?? null, job.attempt);
      if (result) {
        const entry = JSON.stringify(result.entry);
        this.db.prepare("UPDATE jobs SET state='draft',entry=?,content_hash=?,generated_at=?,actual_model=?,provider=?,error=NULL WHERE build_id=? AND word=?")
          .run(entry, hash(entry), Date.now(), result.model, result.provider, build, job.word);
      } else {
        this.db.prepare("UPDATE jobs SET state='failed',retryable=?,error=? WHERE build_id=? AND word=?")
          .run(failure?.retryable ? 1 : 0, failure?.code ?? 'UNKNOWN', build, job.word);
      }
    });
  }
  status(build: string) {
    this.config(build);
    return { build, states: this.db.prepare('SELECT state,count(*) AS count FROM jobs WHERE build_id=? GROUP BY state').all(build),
      editions: this.db.prepare('SELECT e.id,e.reviewer,e.method,e.created_at,count(x.word) AS approved FROM editions e JOIN edition_entries x ON x.edition_id=e.id WHERE e.build_id=? GROUP BY e.id ORDER BY e.created_at').all(build),
      usage: this.db.prepare(`SELECT count(*) AS requests,coalesce(sum(reserved_output),0) AS reservedOutput,
        coalesce(sum(input_tokens),0) AS reportedInput,coalesce(sum(output_tokens),0) AS reportedOutput,
        coalesce(sum(CASE WHEN input_tokens IS NULL OR output_tokens IS NULL THEN 1 ELSE 0 END),0) AS unknownUsageRequests FROM attempts WHERE build_id=?`).get(build),
      models: this.db.prepare('SELECT actual_model,provider,count(*) AS count FROM attempts WHERE build_id=? GROUP BY actual_model,provider').all(build),
      errors: this.db.prepare('SELECT error,count(*) AS count FROM attempts WHERE build_id=? AND error IS NOT NULL GROUP BY error').all(build) };
  }
  review(build: string, word: string, expectedHash: string, decision: 'approved' | 'rejected', reviewer: string, note: string) {
    if (!['approved', 'rejected'].includes(decision) || !reviewer.trim() || reviewer.length > 100 || !note.trim() || note.length > 2000) throw new Error('Reviewer, decision and review note required');
    this.transaction(() => {
      const updated = this.db.prepare("UPDATE jobs SET state=? WHERE build_id=? AND word=? AND content_hash=? AND state='draft'")
        .run(decision, build, word, expectedHash);
      if (updated.changes !== 1) throw new Error('Review must target the current unreviewed content hash');
      this.db.prepare('INSERT INTO reviews(build_id,word,content_hash,decision,reviewer,note,reviewed_at) VALUES(?,?,?,?,?,?,?)')
        .run(build, word, expectedHash, decision, reviewer.trim(), note.trim(), Date.now());
    });
  }
  records(build: string, approvedOnly = false) {
    this.config(build);
    const provenance = this.db.prepare('SELECT prompt_version,prompt_hash FROM builds WHERE id=?').get(build)!;
    return this.db.prepare(`SELECT * FROM jobs WHERE build_id=? AND entry IS NOT NULL ${approvedOnly ? "AND state='approved'" : ''} ORDER BY rank`).all(build).map(row => ({
      ...JSON.parse(String(row.entry)), contentHash: row.content_hash, tags: JSON.parse(String(row.tags)), reviewStatus: row.state,
      provenance: { build, generatedAt: row.generated_at, model: row.actual_model, provider: row.provider, promptVersion: provenance.prompt_version, promptHash: provenance.prompt_hash },
    }));
  }
  exportDrafts(build: string, target: string) {
    const records = this.records(build);
    mkdirSync(dirname(resolve(target)), { recursive: true, mode: 0o700 });
    writeFileSync(target, records.map(r => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''), { flag: 'wx', mode: 0o600 });
    return records.length;
  }
  approveEdition(build: string, decisions: {
    reviewer: string; method: 'ai-assisted-v1'; evidenceHash: string;
    items: { word: string; inputHash: string; decision: 'approved'; entry: unknown; note: string }[];
  }): string {
    if (!decisions.reviewer?.trim() || decisions.reviewer.length > 120 || decisions.method !== 'ai-assisted-v1'
      || !/^[a-f0-9]{64}$/.test(decisions.evidenceHash) || !Array.isArray(decisions.items)) throw new Error('Invalid edition review evidence');
    this.config(build);
    return this.transaction(() => {
      const originals = this.db.prepare('SELECT * FROM jobs WHERE build_id=? ORDER BY rank').all(build);
      if (decisions.items.length !== originals.length || new Set(decisions.items.map(i => i.word)).size !== originals.length) throw new Error('Every pilot word needs one decision');
      const byWord = new Map(decisions.items.map(i => [i.word, i]));
      const entries = originals.map(original => {
        const item = byWord.get(String(original.word));
        if (!item || item.decision !== 'approved' || item.inputHash !== original.content_hash || !original.entry
          || !['draft', 'rejected', 'approved'].includes(String(original.state)) || typeof item.note !== 'string' || !item.note.trim() || item.note.length > 4000) throw new Error('Stale, missing or unapproved edition decision');
        const parsed = parseEntry(item.entry, item.word);
        if (learnerQualityFlags(parsed).length) throw new Error('Unresolved deterministic learner quality issue: ' + item.word);
        const entry = JSON.stringify(parsed);
        if (original.state === 'rejected' && hash(entry) === original.content_hash) throw new Error('A rejected draft requires a correction');
        return { item, entry, original };
      });
      const id = hash(JSON.stringify([build, decisions])).slice(0, 24);
      if (this.db.prepare('SELECT id FROM editions WHERE id=?').get(id)) return id;
      this.db.prepare('INSERT INTO editions VALUES(?,?,?,?,?,?)').run(id, build, decisions.reviewer, decisions.method, decisions.evidenceHash, Date.now());
      for (const { item, entry, original } of entries) this.db.prepare('INSERT INTO edition_entries VALUES(?,?,?,?,?,?,?)')
        .run(id, item.word, item.inputHash, String(original.entry), entry, hash(entry), item.note.trim());
      return id;
    });
  }
  publishEdition(edition: string, target: string) {
    const snapshot = this.transaction(() => {
      const review = this.db.prepare('SELECT * FROM editions WHERE id=?').get(edition);
      if (!review) throw new Error('Unknown reviewed edition');
      const source = this.db.prepare('SELECT datasets.* FROM builds JOIN datasets ON datasets.id=builds.dataset_id WHERE builds.id=?').get(review.build_id)!;
      const rows = this.db.prepare(`SELECT e.*,j.tags,j.actual_model,j.provider,j.generated_at FROM edition_entries e
        JOIN jobs j ON j.build_id=? AND j.word=e.word WHERE e.edition_id=? ORDER BY j.rank`).all(review.build_id, edition);
      const records = rows.map(row => ({ ...JSON.parse(String(row.entry)), contentHash: row.content_hash, tags: JSON.parse(String(row.tags)), reviewStatus: 'approved',
        provenance: { build: review.build_id, generatedAt: row.generated_at, model: row.actual_model, provider: row.provider,
          originalHash: row.input_hash, reviewMethod: review.method, reviewer: review.reviewer, evidenceHash: review.evidence_hash } }));
      const reviews = rows.map(row => ({ word: row.word, originalHash: row.input_hash, contentHash: row.content_hash, note: row.note, ...review }));
      return { records, reviews, source: { ...source, metadata: JSON.parse(String(source.metadata)) } };
    });
    return this.writeRelease(edition, target, snapshot);
  }
  publish(build: string, target: string) {
    // Read a consistent approval snapshot before writing immutable release files.
    const snapshot = this.transaction(() => {
      if (this.db.prepare("SELECT count(*) AS n FROM jobs WHERE build_id=? AND state NOT IN ('approved','rejected')").get(build)!.n !== 0) throw new Error('All entries need an explicit review decision before publishing');
      const records = this.records(build, true);
      if (!records.length) throw new Error('No approved entries');
      const source = this.db.prepare('SELECT datasets.* FROM builds JOIN datasets ON datasets.id=builds.dataset_id WHERE builds.id=?').get(build)!;
      const reviews = this.db.prepare('SELECT * FROM reviews WHERE build_id=? ORDER BY id').all(build);
      return { records, source: { ...source, metadata: JSON.parse(String(source.metadata)) }, reviews };
    });
    return this.writeRelease(build, target, snapshot);
  }
  private writeRelease(version: string, target: string, snapshot: { records: { word: string; [key: string]: unknown }[]; source: unknown; reviews: unknown[] }) {
    const destination = resolve(target);
    if (existsSync(destination)) throw new Error('Release destination already exists');
    const staging = destination + '.tmp-' + randomUUID();
    mkdirSync(staging, { recursive: true, mode: 0o700 });
    try {
      const shards: Record<string, typeof snapshot.records> = {};
      for (const entry of snapshot.records) (shards[hash(entry.word).slice(0, 2)] ??= []).push(entry);
      const files: Record<string, { sha256: string; bytes: number; entries: number }> = {};
      for (const [shard, records] of Object.entries(shards).sort()) {
        const body = JSON.stringify(Object.fromEntries(records.map(r => [r.word, r]))) + '\n';
        const file = shard + '.json'; writeFileSync(join(staging, file), body);
        files[file] = { sha256: hash(body), bytes: Buffer.byteLength(body), entries: records.length };
      }
      const audit = JSON.stringify(snapshot.reviews) + '\n'; writeFileSync(join(staging, 'reviews.json'), audit);
      const manifest = { sourceId: 'rememberme-dict', schemaVersion: SCHEMA_VERSION, dictionaryVersion: version, count: snapshot.records.length,
        source: snapshot.source, shardAlgorithm: 'sha256(word).slice(0,2)', files, reviewsSha256: hash(audit) };
      writeFileSync(join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
      for (const [file, info] of Object.entries(files)) if (hash(readFileSync(join(staging, file), 'utf8')) !== info.sha256) throw new Error('Release verification failed');
      // Destination must remain new: never replace a previous release or point clients at drafts.
      if (existsSync(destination)) throw new Error('Release destination appeared during export');
      renameSync(staging, destination); return manifest;
    } finally { if (existsSync(staging)) rmSync(staging, { recursive: true }); }
  }
  backup(target: string) {
    if (existsSync(target)) throw new Error('Backup destination must be new');
    this.db.prepare('VACUUM INTO ?').run(resolve(target)); chmodSync(target, 0o600);
    const copy = new DatabaseSync(target, { readOnly: true });
    try {
      if (copy.prepare('PRAGMA integrity_check').get()!.integrity_check !== 'ok' || copy.prepare('PRAGMA foreign_key_check').all().length
        || copy.prepare('PRAGMA application_id').get()!.application_id !== APPLICATION_ID) throw new Error('Backup verification failed');
    } finally { copy.close(); }
  }
  close() { this.db.close(); }
}
