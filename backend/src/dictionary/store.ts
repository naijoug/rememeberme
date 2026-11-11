import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hash, parseEntry, PROMPT_HASH, PROMPT_VERSION, SCHEMA_VERSION, validateConfig, type BuildConfig, type Dataset, type Generated } from './model';
import { learnerQualityFlags } from './quality';
import { parseWordlists, wordlistDigest, type Wordlist } from './wordlists';

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
        let version = this.db.prepare('PRAGMA user_version').get()!.user_version;
        if (version === 1) { this.db.exec(EDITION_SQL + ' PRAGMA user_version=2;'); version = 2; }
        if (version === 2) { this.db.exec('CREATE TABLE catalogs(id TEXT PRIMARY KEY,edition_ids TEXT NOT NULL,word_count INTEGER NOT NULL,created_at INTEGER NOT NULL); ALTER TABLE lease ADD COLUMN cooldown_until INTEGER NOT NULL DEFAULT 0; PRAGMA user_version=3;'); version = 3; }
        if (version === 3) {
          this.db.exec(`ALTER TABLE catalogs ADD COLUMN wordlist_ids TEXT NOT NULL DEFAULT '[]';
            CREATE TABLE wordlists(id TEXT PRIMARY KEY,category TEXT NOT NULL,digest TEXT NOT NULL,definition TEXT NOT NULL,created_at INTEGER NOT NULL);
            CREATE TABLE wordlist_members(list_id TEXT NOT NULL REFERENCES wordlists(id),word TEXT NOT NULL,PRIMARY KEY(list_id,word));
            CREATE INDEX wordlist_members_word ON wordlist_members(word);
            CREATE TABLE editorial_drafts(build_id TEXT NOT NULL,word TEXT NOT NULL,entry_hash TEXT NOT NULL,editor TEXT NOT NULL,note TEXT NOT NULL,created_at INTEGER NOT NULL,
              PRIMARY KEY(build_id,word),FOREIGN KEY(build_id,word) REFERENCES jobs(build_id,word)); PRAGMA user_version=4;`);
          version = 4;
        }
        if (version === 4) {
          this.db.exec(`CREATE TABLE generation_routes(id TEXT PRIMARY KEY,build_id TEXT NOT NULL REFERENCES builds(id),model TEXT NOT NULL,prompt_hash TEXT NOT NULL,note TEXT NOT NULL,created_at INTEGER NOT NULL);
            ALTER TABLE attempts ADD COLUMN route_id TEXT REFERENCES generation_routes(id); PRAGMA user_version=5;`);
          version = 5;
        }
        if (version === 5) {
          this.db.exec(`CREATE TABLE generation_batches(id TEXT PRIMARY KEY,build_id TEXT NOT NULL REFERENCES builds(id),
            prompt_hash TEXT NOT NULL,requested_model TEXT NOT NULL,max_output_tokens INTEGER NOT NULL,started_at INTEGER NOT NULL,
            finished_at INTEGER,input_tokens INTEGER,output_tokens INTEGER,actual_model TEXT,provider TEXT,error TEXT,raw_content TEXT);
            ALTER TABLE attempts ADD COLUMN batch_id TEXT REFERENCES generation_batches(id); PRAGMA user_version=6;`);
          version = 6;
        }
        if (version !== 6) throw new Error('Unsupported dictionary database version');
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
    if (dataset.metadata.referenceSha256 !== undefined && dataset.metadata.referenceSha256 !== config.referenceHash) throw new Error('Dataset requires its pinned lexical references');
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
  importWordlists(input: unknown) {
    const lists = parseWordlists(input);
    return this.transaction(() => lists.map(list => {
      const digest = wordlistDigest(list), previous = this.db.prepare('SELECT digest FROM wordlists WHERE id=?').get(list.id);
      if (previous && previous.digest !== digest) throw new Error('Wordlist changed; assign a new version ID');
      this.db.prepare('INSERT OR IGNORE INTO wordlists VALUES(?,?,?,?,?)').run(list.id, list.category, digest, JSON.stringify(list), Date.now());
      const insert = this.db.prepare('INSERT OR IGNORE INTO wordlist_members VALUES(?,?)');
      for (const word of list.words) insert.run(list.id, word);
      return { id: list.id, category: list.category, words: list.words.length, excluded: list.excluded.length, digest };
    }));
  }
  wordlists(ids: string[]): Wordlist[] {
    if (!ids.length || new Set(ids).size !== ids.length) throw new Error('Distinct wordlist IDs required');
    return [...ids].sort().map(id => {
      const row = this.db.prepare('SELECT definition FROM wordlists WHERE id=?').get(id);
      if (!row) throw new Error('Unknown wordlist: ' + id);
      return JSON.parse(String(row.definition));
    });
  }
  wordlistCoverage(ids: string[]) {
    const approved = new Set(this.db.prepare('SELECT DISTINCT word FROM edition_entries').all().map(r => String(r.word)));
    const states = new Map<string, string>();
    const priority = ['pending', 'failed', 'generating', 'draft', 'rejected', 'approved'];
    for (const row of this.db.prepare('SELECT word,state FROM jobs').all()) {
      const word = String(row.word), state = String(row.state);
      if (priority.indexOf(state) > priority.indexOf(states.get(word) ?? '')) states.set(word, state);
    }
    return this.wordlists(ids).map(list => {
      const missing = list.words.filter(w => !approved.has(w) && !states.has(w));
      const unapproved = list.words.filter(w => !approved.has(w) && states.has(w));
      return { id: list.id, category: list.category, title: list.title, target: list.words.length,
        approved: list.words.filter(w => approved.has(w)).length, unapproved: unapproved.length,
        missing: missing.length, missingWords: missing, unapprovedWords: unapproved, excluded: list.excluded,
        source: list.source };
    });
  }
  supplyEditorialDraft(build: string, word: string, raw: unknown, editor: string, note: string) {
    if (!editor.trim() || editor.length > 100 || !note.trim() || note.length > 2000) throw new Error('Editorial attribution required');
    const entry = JSON.stringify(parseEntry(raw, word));
    return this.transaction(() => {
      const job = this.db.prepare('SELECT state,entry FROM jobs WHERE build_id=? AND word=?').get(build, word);
      if (!job || job.state !== 'failed' || job.entry !== null) throw new Error('Editorial supply requires a failed job without a draft');
      const digest = hash(entry), now = Date.now();
      this.db.prepare('INSERT INTO editorial_drafts VALUES(?,?,?,?,?,?)').run(build, word, digest, editor, note, now);
      this.db.prepare("UPDATE jobs SET entry=?,content_hash=?,state='draft',generated_at=?,actual_model=NULL,provider=NULL WHERE build_id=? AND word=?")
        .run(entry, digest, now, build, word);
      return { word, contentHash: digest, reviewStatus: 'draft', origin: 'editorial-supply' };
    });
  }
  config(build: string, requireCurrentGenerator = false): BuildConfig {
    const row = this.db.prepare('SELECT * FROM builds WHERE id=?').get(build);
    if (!row) throw new Error('Unknown build');
    if (requireCurrentGenerator && (row.prompt_hash !== PROMPT_HASH || row.schema_version !== SCHEMA_VERSION)) throw new Error('Build code changed; use original code or initialize a new build');
    const config = JSON.parse(String(row.config)); validateConfig(config); return config;
  }
  authorizeModel(build: string, model: string, note: string) {
    const config = this.config(build, true);
    validateConfig({ ...config, model });
    if (!note.trim() || note.length > 2000) throw new Error('Model-switch reason required');
    const id = hash(JSON.stringify([build, model, PROMPT_HASH])).slice(0, 24);
    return this.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO generation_routes VALUES(?,?,?,?,?,?)').run(id, build, model, PROMPT_HASH, note, Date.now());
      // A different authorized model can recover a billing-blocked word, within its original attempt cap.
      if (model !== config.model) this.db.prepare("UPDATE jobs SET retryable=1 WHERE build_id=? AND state='failed' AND error='HTTP_402' AND tries<?").run(build, config.maxAttempts);
      return id;
    });
  }
  routeConfig(build: string, routeId?: string): BuildConfig {
    const config = this.config(build, true);
    if (!routeId) return config;
    const route = this.db.prepare('SELECT model,prompt_hash FROM generation_routes WHERE id=? AND build_id=?').get(routeId, build);
    if (!route || route.prompt_hash !== PROMPT_HASH) throw new Error('Unknown model route for this build');
    return { ...config, model: String(route.model) };
  }
  acquire(now = Date.now()) {
    this.transaction(() => {
      const lease = this.db.prepare('SELECT * FROM lease WHERE id=1').get()!;
      if (Number(lease.cooldown_until) > now) throw new Error('Provider cooldown until ' + new Date(Number(lease.cooldown_until)).toISOString());
      if (lease.owner !== '' && Number(lease.expires_at) > now) throw new Error('Another dictionary worker holds the lease');
      this.db.prepare('UPDATE lease SET owner=?,expires_at=? WHERE id=1').run(this.owner, now + 180_000);
      this.db.prepare("UPDATE generation_batches SET finished_at=?,error='INTERRUPTED' WHERE finished_at IS NULL").run(now);
      this.db.prepare("UPDATE attempts SET state='interrupted',finished_at=?,error='INTERRUPTED' WHERE state='requested'").run(now);
      this.db.exec("UPDATE jobs SET state='failed',retryable=1,error='INTERRUPTED' WHERE state='generating'");
    });
  }
  heartbeat(now = Date.now()) {
    const result = this.db.prepare('UPDATE lease SET expires_at=? WHERE id=1 AND owner=? AND expires_at>?').run(now + 180_000, this.owner, now);
    if (!result.changes) throw new Error('Dictionary worker lease lost');
  }
  release() { this.db.prepare("UPDATE lease SET owner='',expires_at=0 WHERE id=1 AND owner=?").run(this.owner); }
  cooldown(until: number) {
    this.heartbeat();
    this.db.prepare('UPDATE lease SET cooldown_until=max(cooldown_until,?) WHERE id=1').run(until);
  }
  reserve(build: string, routeId?: string): { word: string; attempt: string } | null {
    const config = this.routeConfig(build, routeId);
    return this.transaction(() => {
      this.heartbeat();
      const spent = this.db.prepare('SELECT count(*) AS requests,coalesce(sum(reserved_output),0) AS output FROM attempts WHERE build_id=?').get(build)!;
      if (Number(spent.requests) >= config.maxRequests || Number(spent.output) + config.maxOutputTokens > config.outputBudget) return null;
      const job = this.db.prepare("SELECT word FROM jobs WHERE build_id=? AND state IN ('pending','failed') AND retryable=1 AND tries<? ORDER BY tries,rank LIMIT 1").get(build, config.maxAttempts);
      if (!job) return null;
      const word = String(job.word), attempt = randomUUID();
      this.db.prepare("INSERT INTO attempts(id,build_id,word,started_at,state,reserved_output,route_id) VALUES(?,?,?,?,'requested',?,?)").run(attempt, build, word, Date.now(), config.maxOutputTokens, routeId ?? null);
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
    return { build, routes: this.db.prepare('SELECT id,model,note,created_at FROM generation_routes WHERE build_id=? ORDER BY created_at').all(build),
      cooldownUntil: this.db.prepare('SELECT cooldown_until FROM lease WHERE id=1').get()!.cooldown_until,
      states: this.db.prepare('SELECT state,count(*) AS count FROM jobs WHERE build_id=? GROUP BY state').all(build),
      editions: this.db.prepare('SELECT e.id,e.reviewer,e.method,e.created_at,count(x.word) AS approved FROM editions e JOIN edition_entries x ON x.edition_id=e.id WHERE e.build_id=? GROUP BY e.id ORDER BY e.created_at').all(build),
      usage: this.db.prepare(`SELECT count(*) AS requests,coalesce(sum(reserved_output),0) AS reservedOutput,
        coalesce(sum(input_tokens),0) AS reportedInput,coalesce(sum(output_tokens),0) AS reportedOutput,
        coalesce(sum(CASE WHEN input_tokens IS NULL OR output_tokens IS NULL THEN 1 ELSE 0 END),0) AS unknownUsageRequests FROM attempts WHERE build_id=?`).get(build),
      batches: this.db.prepare(`SELECT count(*) AS requests,coalesce(sum(input_tokens),0) AS reportedInput,
        coalesce(sum(output_tokens),0) AS reportedOutput FROM generation_batches WHERE build_id=?`).get(build),
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
      provenance: { build, generatedAt: row.generated_at, model: row.actual_model, provider: row.provider, promptVersion: provenance.prompt_version, promptHash: provenance.prompt_hash,
        ...this.generationRoute(build, String(row.word)), ...this.editorialOrigin(build, String(row.word)) },
    }));
  }
  private editorialOrigin(build: string, word: string) {
    const editorial = this.db.prepare('SELECT editor,note,created_at FROM editorial_drafts WHERE build_id=? AND word=?').get(build, word);
    return editorial ? { origin: 'editorial-supply', editorial, promptVersion: null, promptHash: null } : {};
  }
  private generationRoute(build: string, word: string) {
    const route = this.db.prepare(`SELECT r.id,r.model,b.id AS batch_id,b.prompt_hash AS batch_prompt FROM attempts a
      LEFT JOIN generation_routes r ON r.id=a.route_id LEFT JOIN generation_batches b ON b.id=a.batch_id
      WHERE a.build_id=? AND a.word=? AND a.state='success' ORDER BY a.finished_at DESC LIMIT 1`).get(build, word);
    return { ...(route?.id ? { generationRoute: route.id, requestedModel: route.model } : {}),
      ...(route?.batch_id ? { generationBatch: route.batch_id, promptVersion: 'learner-dictionary-batch-v1', promptHash: route.batch_prompt } : {}) };
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
  private editionSnapshot(edition: string) {
      const review = this.db.prepare('SELECT * FROM editions WHERE id=?').get(edition);
      if (!review) throw new Error('Unknown reviewed edition');
      const source = this.db.prepare('SELECT datasets.* FROM builds JOIN datasets ON datasets.id=builds.dataset_id WHERE builds.id=?').get(review.build_id)!;
      const rows = this.db.prepare(`SELECT e.*,j.tags,j.actual_model,j.provider,j.generated_at FROM edition_entries e
        JOIN jobs j ON j.build_id=? AND j.word=e.word WHERE e.edition_id=? ORDER BY j.rank`).all(review.build_id, edition);
      const records = rows.map(row => ({ ...JSON.parse(String(row.entry)), contentHash: row.content_hash, tags: JSON.parse(String(row.tags)), reviewStatus: 'approved',
        provenance: { build: review.build_id, generatedAt: row.generated_at, model: row.actual_model, provider: row.provider,
          originalHash: row.input_hash, reviewMethod: review.method, reviewer: review.reviewer, evidenceHash: review.evidence_hash,
          ...this.generationRoute(String(review.build_id), String(row.word)), ...this.editorialOrigin(String(review.build_id), String(row.word)) } }));
      const reviews = rows.map(row => ({ word: row.word, originalHash: row.input_hash, contentHash: row.content_hash, note: row.note, ...review }));
      return { records, reviews, source: { ...source, metadata: JSON.parse(String(source.metadata)) } };
  }
  publishEdition(edition: string, target: string) {
    const snapshot = this.transaction(() => this.editionSnapshot(edition));
    return this.writeRelease(edition, target, snapshot);
  }
  publishCatalog(editionIds: string[], target: string, wordlistIds: string[] = []) {
    if (!Array.isArray(editionIds) || editionIds.length < 1 || editionIds.length > 100
      || editionIds.some(id => !/^[a-f0-9]{24}$/.test(id)) || new Set(editionIds).size !== editionIds.length) throw new Error('Catalog needs distinct approved edition IDs');
    const components = [...editionIds].sort();
    const { id, snapshot } = this.transaction(() => {
      const snapshots = components.map(edition => this.editionSnapshot(edition));
      const wordlists = wordlistIds.length ? this.wordlists(wordlistIds) : [];
      if (new Set(wordlists.map(l => l.category)).size !== wordlists.length) throw new Error('Choose one wordlist version per category');
      const records = snapshots.flatMap(s => s.records);
      if (new Set(records.map(r => r.word)).size !== records.length) throw new Error('Overlapping catalog words; choose non-overlapping approved editions explicitly');
      const identity: unknown[] = ['catalog-v1', components, [...records].sort((a, b) => a.word < b.word ? -1 : a.word > b.word ? 1 : 0).map(r => [r.word, r.contentHash])];
      if (wordlists.length) identity.push(wordlists.map(wordlistDigest));
      const id = hash(JSON.stringify(identity)).slice(0, 24);
      this.db.prepare('INSERT OR IGNORE INTO catalogs(id,edition_ids,word_count,created_at,wordlist_ids) VALUES(?,?,?,?,?)').run(id, JSON.stringify(components), records.length, Date.now(), JSON.stringify(wordlists.map(l => l.id)));
      return { id, snapshot: { records, reviews: snapshots.flatMap(s => s.reviews),
        source: { type: 'approved-catalog', editions: components, components: snapshots.map(s => s.source) }, wordlists } };
    });
    // Entries and their individual review IDs stay byte-for-byte unchanged.
    return this.writeRelease(id, target, snapshot, components);
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
  private writeRelease(version: string, target: string, snapshot: { records: { word: string; [key: string]: unknown }[]; source: unknown; reviews: unknown[]; wordlists?: Wordlist[] }, editions?: string[]) {
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
      const wordlists = snapshot.wordlists?.length ? JSON.stringify({ schemaVersion: 1, lists: snapshot.wordlists }) + '\n' : undefined;
      if (wordlists) writeFileSync(join(staging, 'wordlists.json'), wordlists);
      const manifest = { sourceId: 'rememberme-dict', schemaVersion: SCHEMA_VERSION, dictionaryVersion: version, count: snapshot.records.length,
        source: snapshot.source, ...(editions ? { editions } : {}), ...(wordlists ? { wordlistsSha256: hash(wordlists) } : {}), shardAlgorithm: 'sha256(word).slice(0,2)', files, reviewsSha256: hash(audit) };
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
