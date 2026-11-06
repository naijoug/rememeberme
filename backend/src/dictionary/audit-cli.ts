import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync, chmodSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs, parseEnv } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { AUDIT_PROMPT, AUDIT_PROMPT_HASH, parseAudit, parseAuditJSON, type AuditInput } from './audit';
import { hash, validateConfig } from './model';
import { responseRoute } from '../magpie-observation';

const { values } = parseArgs({ options: Object.fromEntries(['input', 'db', 'env', 'model', 'base-url', 'out', 'limit', 'concurrency', 'json-mode', 'max-requests', 'reasoning'].map(k => [k, { type: 'string' as const }])) });
const required = (key: string) => { const value = values[key]; if (typeof value !== 'string' || !value) throw new Error(`--${key} required`); return value; };
async function main() {
  process.umask(0o077);
  const inputs: AuditInput[] = JSON.parse(readFileSync(required('input'), 'utf8'));
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > 1000 || new Set(inputs.map(i => i.word)).size !== inputs.length
    || inputs.some(i => i.word !== i.entry.word || hash(JSON.stringify(i.entry)) !== i.inputHash)) throw new Error('Invalid frozen review input');
  const model = required('model'), baseURL = required('base-url');
  const jsonMode = values['json-mode'] === 'true', maxRequests = Number(values['max-requests'] ?? 160);
  const reasoning = String(values.reasoning ?? 'high');
  if (!['low', 'medium', 'high'].includes(reasoning)) throw new Error('Invalid reasoning setting');
  if (values['json-mode'] !== undefined && !['true', 'false'].includes(String(values['json-mode'])) || !Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 160) throw new Error('Invalid review configuration');
  validateConfig({ model, baseURL, maxRequests, maxOutputTokens: 8192, outputBudget: maxRequests * 8192, maxAttempts: 3 });
  const limit = Number(values.limit ?? 160), concurrency = Number(values.concurrency ?? 2);
  if (!Number.isInteger(limit) || limit < 0 || limit > 160 || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error('Invalid audit limits');
  const env = parseEnv(readFileSync(required('env'), 'utf8'));
  const key = env.DICTIONARY_API_KEY ?? env.MAGPIE_API_KEY;
  if (!key) throw new Error('Private model key missing');
  const identity = [inputs, model, baseURL, AUDIT_PROMPT_HASH];
  if (jsonMode || maxRequests !== 160) identity.push(JSON.stringify({ jsonMode, maxRequests }));
  if (reasoning !== 'high') identity.push(reasoning);
  const run = hash(JSON.stringify(identity));
  const path = required('db'); mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  try {
    const id = db.prepare('PRAGMA application_id').get()!.application_id;
    if (id !== 1380795460 && (id !== 0 || db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().length)) throw new Error('Not an audit database');
    db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    db.exec(`CREATE TABLE IF NOT EXISTS metadata(run TEXT PRIMARY KEY, prompt_hash TEXT NOT NULL, model TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS batches(id INTEGER PRIMARY KEY, input TEXT NOT NULL, result TEXT, tries INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY,batch INTEGER NOT NULL,started INTEGER NOT NULL,finished INTEGER,error TEXT,model TEXT,provider TEXT,input_tokens INTEGER,output_tokens INTEGER);
      CREATE TABLE IF NOT EXISTS lease(id INTEGER PRIMARY KEY,owner TEXT NOT NULL,expires INTEGER NOT NULL);
      INSERT OR IGNORE INTO lease(id,owner,expires) VALUES(1,'',0); PRAGMA application_id=1380795460;`);
    if (!db.prepare('PRAGMA table_info(attempts)').all().some(c => c.name === 'raw_content')) db.exec('ALTER TABLE attempts ADD COLUMN raw_content TEXT');
    if (!db.prepare('PRAGMA table_info(attempts)').all().some(c => c.name === 'recovered_at')) db.exec('ALTER TABLE attempts ADD COLUMN recovered_at INTEGER');
    if (!db.prepare('PRAGMA table_info(lease)').all().some(c => c.name === 'cooldown_until')) db.exec('ALTER TABLE lease ADD COLUMN cooldown_until INTEGER NOT NULL DEFAULT 0');
    const meta = db.prepare('SELECT * FROM metadata').get();
    if (meta && meta.run !== run) throw new Error('Audit inputs changed; use a new audit database');
    if (!meta) {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('INSERT INTO metadata VALUES(?,?,?)').run(run, AUDIT_PROMPT_HASH, model);
        for (let i = 0; i < inputs.length; i += 8) db.prepare('INSERT INTO batches(id,input) VALUES(?,?)').run(i / 8, JSON.stringify(inputs.slice(i, i + 8)));
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    chmodSync(path, 0o600);
    const cooldown = Number(db.prepare('SELECT cooldown_until FROM lease WHERE id=1').get()!.cooldown_until);
    if (cooldown > Date.now()) throw new Error('Provider cooldown until ' + new Date(cooldown).toISOString());
    const owner = randomUUID();
    const acquired = db.prepare("UPDATE lease SET owner=?,expires=? WHERE id=1 AND (owner='' OR expires<?)").run(owner, Date.now() + 180000, Date.now());
    if (!acquired.changes) throw new Error('Another audit runner is active');
    db.prepare("UPDATE attempts SET finished=?,error='INTERRUPTED' WHERE finished IS NULL").run(Date.now());
    for (const candidate of db.prepare(`SELECT a.id,a.batch,a.raw_content,b.input FROM attempts a JOIN batches b ON b.id=a.batch
      WHERE b.result IS NULL AND a.raw_content IS NOT NULL AND a.error IN ('INVALID_AUDIT','INVALID_JSON') ORDER BY a.started`).all()) {
      try {
        const result = parseAudit(parseAuditJSON(String(candidate.raw_content)), JSON.parse(String(candidate.input)));
        db.exec('BEGIN IMMEDIATE');
        try {
          const updated = db.prepare('UPDATE batches SET result=? WHERE id=? AND result IS NULL').run(JSON.stringify(result), candidate.batch);
          if (updated.changes) db.prepare('UPDATE attempts SET recovered_at=? WHERE id=?').run(Date.now(), candidate.id);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
      } catch { /* Incomplete or contradictory evidence still requires a fresh review. */ }
    }
    const controller = new AbortController(), stop = () => controller.abort();
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    const heartbeat = setInterval(() => { if (!db.prepare('UPDATE lease SET expires=? WHERE id=1 AND owner=?').run(Date.now() + 180000, owner).changes) stop(); }, 15000);
    let claimed = 0, consecutiveFailures = 0, draining = false;
    const drain = () => { draining = true; }; process.on('SIGUSR2', drain);
    const inFlight = new Set<number>();
    const worker = async () => {
      while (!controller.signal.aborted && !draining && claimed < limit) {
        if (Number(db.prepare('SELECT count(*) AS n FROM attempts').get()!.n) >= maxRequests) break;
        const batch = db.prepare('SELECT * FROM batches WHERE result IS NULL AND tries<3 ORDER BY tries,id').all().find(b => !inFlight.has(Number(b.id)));
        if (!batch) break;
        const batchId = Number(batch.id), attempt = randomUUID(), items: AuditInput[] = JSON.parse(String(batch.input));
        inFlight.add(batchId); claimed++;
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare('UPDATE batches SET tries=tries+1 WHERE id=?').run(batchId);
          db.prepare('INSERT INTO attempts(id,batch,started) VALUES(?,?,?)').run(attempt, batchId, Date.now()); db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        let route: ReturnType<typeof responseRoute>, inputTokens: number | null = null, outputTokens: number | null = null;
        let errorCode: string | null = null;
        let rawContent: string | null = null;
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(180000)]);
        try {
          const response = await fetch(new URL('chat/completions', baseURL), { method: 'POST', signal, redirect: 'error', credentials: 'omit',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Magpie-Session': 'rm-review-' + attempt },
            body: JSON.stringify({ model, stream: false, max_tokens: 8192, reasoning_effort: reasoning, ...(jsonMode ? { response_format: { type: 'json_object' } } : {}), messages: [
              { role: 'system', content: AUDIT_PROMPT }, { role: 'user', content: JSON.stringify(items.map(({ word, entry, reference }) => ({ word, entry, reference }))) },
            ] }) });
          route = responseRoute(response.headers);
          if (response.status === 429) {
            const retry = response.headers.get('retry-after');
            const until = retry && /^\d+$/.test(retry) ? Date.now() + Number(retry) * 1000 : retry ? Date.parse(retry) : NaN;
            db.prepare('UPDATE lease SET cooldown_until=? WHERE id=1').run(Number.isFinite(until) && until > Date.now() ? until : Date.now() + 60000);
            draining = true;
          }
          if (!response.ok) { void response.body?.cancel(); throw new Error('HTTP_' + response.status); }
          if (!response.body || !response.headers.get('content-type')?.includes('application/json')) { void response.body?.cancel(); throw new Error('CONTENT_TYPE'); }
          const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
          try { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > 256 * 1024) throw new Error('OVERSIZED'); chunks.push(next.value); } }
          finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
          const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
          inputTokens = Number.isSafeInteger(data.usage?.prompt_tokens) ? data.usage.prompt_tokens : null;
          outputTokens = Number.isSafeInteger(data.usage?.completion_tokens) ? data.usage.completion_tokens : null;
          const choice = data.choices?.[0];
          rawContent = typeof choice?.message?.content === 'string' ? choice.message.content : null;
          if (choice?.finish_reason !== 'stop' || choice.message?.tool_calls != null || typeof choice.message?.content !== 'string') throw new Error('COMPLETION');
          const results = parseAudit(parseAuditJSON(choice.message.content), items);
          if (signal.aborted) throw new Error('ABORTED');
          if (db.prepare('SELECT owner FROM lease WHERE id=1').get()!.owner !== owner) throw new Error('LEASE_LOST');
          db.prepare('UPDATE batches SET result=? WHERE id=?').run(JSON.stringify(results), batchId); consecutiveFailures = 0;
        } catch (error) {
          const message = error instanceof Error ? error.message : '';
          errorCode = /^(HTTP_\d{3}|CONTENT_TYPE|OVERSIZED|COMPLETION|INVALID_AUDIT|INVALID_ENTRY|ABORTED|LEASE_LOST)$/.test(message) ? message : signal.aborted ? 'TIMEOUT_OR_CANCELLED' : error instanceof SyntaxError ? 'INVALID_JSON' : 'INVALID_RESPONSE';
          consecutiveFailures++;
          if (['HTTP_400', 'HTTP_401', 'HTTP_403', 'HTTP_404', 'HTTP_422', 'LEASE_LOST'].includes(errorCode) || consecutiveFailures >= 5) stop();
        } finally {
          db.prepare('UPDATE attempts SET finished=?,error=?,model=?,provider=?,input_tokens=?,output_tokens=?,raw_content=? WHERE id=?')
            .run(Date.now(), errorCode, route?.selectedModel ?? null, route?.selectedProvider ?? null, inputTokens, outputTokens,
              errorCode && rawContent && !rawContent.includes(key) ? rawContent.slice(0, 65536) : null, attempt);
          inFlight.delete(batchId);
        }
        console.log(JSON.stringify({ batch: batchId, words: items.length, error: errorCode, actualModel: route?.selectedModel ?? null }));
        if (!controller.signal.aborted) await delay(errorCode ? 2000 : 250, undefined, { signal: controller.signal }).catch(() => {});
      }
    };
    try {
      const workers = await Promise.allSettled(Array.from({ length: concurrency }, () => worker().catch(error => { stop(); throw error; })));
      const failure = workers.find(w => w.status === 'rejected'); if (failure?.status === 'rejected') throw failure.reason;
      const batches = db.prepare('SELECT * FROM batches ORDER BY id').all();
      const results = batches.flatMap(b => b.result ? JSON.parse(String(b.result)) : []);
      const attempts = db.prepare('SELECT id,batch,started,finished,error,model,provider,input_tokens,output_tokens,recovered_at FROM attempts ORDER BY started').all();
      const report = { run, model, jsonMode, reasoning, promptHash: AUDIT_PROMPT_HASH, maxRequests, maxOutputTokens: 8192, reservedOutput: attempts.length * 8192,
        covered: results.length, expected: inputs.length, results, attempts };
      const out = required('out'); writeFileSync(out + '.tmp', JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
      const { renameSync } = await import('node:fs'); renameSync(out + '.tmp', out);
      console.log(JSON.stringify({ covered: results.length, expected: inputs.length, attempts: attempts.length }));
      if (results.length !== inputs.length) process.exitCode = 2;
    } finally {
      clearInterval(heartbeat); process.off('SIGINT', stop); process.off('SIGTERM', stop); process.off('SIGUSR2', drain);
      db.prepare("UPDATE lease SET owner='',expires=0 WHERE id=1 AND owner=?").run(owner);
    }
  } finally { db.close(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Audit failed'); process.exitCode = 1; });
