import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync, chmodSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs, parseEnv } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { AUDIT_PROMPT, AUDIT_PROMPT_HASH, CROSS_CHECK_PROMPT, PATCH_CHECK_PROMPT, BLIND_PATCH_PROMPT, parsePatchAudit, parseAudit, parsePartialAudit, parseAuditJSON, pendingAuditItems, type AuditInput, type AuditResult } from './audit';
import { hash, validateConfig } from './model';
import { responseRoute } from '../magpie-observation';

const { values } = parseArgs({ options: Object.fromEntries(['input', 'db', 'env', 'model', 'base-url', 'out', 'limit', 'concurrency', 'json-mode', 'max-requests', 'max-output-tokens', 'reasoning', 'batch-size', 'request-size', 'temperature', 'profile', 'profile-note', 'only-word', 'defer-words', 'defer-note'].map(k => [k, { type: 'string' as const }])) });
const required = (key: string) => { const value = values[key]; if (typeof value !== 'string' || !value) throw new Error(`--${key} required`); return value; };
async function main() {
  process.umask(0o077);
  const inputs: AuditInput[] = JSON.parse(readFileSync(required('input'), 'utf8'));
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > 1000 || new Set(inputs.map(i => i.word)).size !== inputs.length
    || inputs.some(i => i.word !== i.entry.word || hash(JSON.stringify(i.entry)) !== i.inputHash)) throw new Error('Invalid frozen review input');
  const model = required('model'), baseURL = required('base-url');
  const onlyWord = values['only-word'] as string | undefined;
  if (onlyWord !== undefined && !inputs.some(i => i.word === onlyWord)) throw new Error('Diagnostic word is not in the frozen input');
  const deferWords = values['defer-words'] === undefined ? [] : String(values['defer-words']).split(',');
  const deferNote = String(values['defer-note'] ?? '').trim();
  if (deferWords.length > 16 || new Set(deferWords).size !== deferWords.length || deferWords.some(w => !inputs.some(i => i.word === w))
    || deferWords.length && (!deferNote || deferNote.length > 2000) || !deferWords.length && deferNote) throw new Error('Deferral requires 1–16 frozen words and an explicit note');
  const profile = values.profile ?? 'original';
  if (!['original', 'cross-check-v1', 'patch-check-v1', 'blind-patch-v1'].includes(String(profile))) throw new Error('Invalid audit profile');
  const patchProfile = profile === 'patch-check-v1' || profile === 'blind-patch-v1';
  const prompt = profile === 'original' ? AUDIT_PROMPT : profile === 'blind-patch-v1' ? BLIND_PATCH_PROMPT : profile === 'patch-check-v1' ? PATCH_CHECK_PROMPT : CROSS_CHECK_PROMPT;
  const promptHash = profile === 'original' ? AUDIT_PROMPT_HASH : hash(prompt);
  const jsonMode = values['json-mode'] === 'true', maxRequests = Number(values['max-requests'] ?? 160);
  const reasoning = String(values.reasoning ?? 'high');
  const batchSize = Number(values['batch-size'] ?? 8);
  // An operational reduction only: original batches, tries and total reservations remain intact.
  const requestSize = Number(values['request-size'] ?? batchSize);
  const maxOutputTokens = Number(values['max-output-tokens'] ?? 8192);
  // The original total budget is fixed, even when fewer requests reserve larger responses.
  const outputBudget = maxRequests * 8192;
  const temperature = values.temperature === undefined ? undefined : Number(values.temperature);
  if (!['low', 'medium', 'high', 'max'].includes(reasoning)) throw new Error('Invalid reasoning setting');
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 16 || temperature !== undefined && (!Number.isFinite(temperature) || temperature < 0 || temperature > 1)) throw new Error('Invalid audit batch/sampling configuration');
  if (!Number.isInteger(requestSize) || requestSize < 1 || requestSize > batchSize) throw new Error('Invalid audit request size');
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 8192 || maxOutputTokens > 16384) throw new Error('Invalid audit output limit');
  if (values['json-mode'] !== undefined && !['true', 'false'].includes(String(values['json-mode'])) || !Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 160) throw new Error('Invalid review configuration');
  validateConfig({ model, baseURL, maxRequests, maxOutputTokens: 8192, outputBudget: maxRequests * 8192, maxAttempts: 3 });
  const limit = Number(values.limit ?? 160), concurrency = Number(values.concurrency ?? 2);
  if (!Number.isInteger(limit) || limit < 0 || limit > 160 || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('Invalid audit limits');
  const env = parseEnv(readFileSync(required('env'), 'utf8'));
  const key = env.DICTIONARY_API_KEY ?? env.MAGPIE_API_KEY;
  if (!key) throw new Error('Private model key missing');
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
    if (!db.prepare('PRAGMA table_info(attempts)').all().some(c => c.name === 'requested_words')) db.exec('ALTER TABLE attempts ADD COLUMN requested_words TEXT');
    if (!db.prepare('PRAGMA table_info(attempts)').all().some(c => c.name === 'reserved_output')) db.exec('ALTER TABLE attempts ADD COLUMN reserved_output INTEGER NOT NULL DEFAULT 8192');
    db.exec('CREATE TABLE IF NOT EXISTS audit_routes(id TEXT PRIMARY KEY,prompt_hash TEXT NOT NULL,model TEXT NOT NULL,profile TEXT NOT NULL,note TEXT NOT NULL,created_at INTEGER NOT NULL)');
    if (!db.prepare('PRAGMA table_info(attempts)').all().some(c => c.name === 'route_id')) db.exec('ALTER TABLE attempts ADD COLUMN route_id TEXT');
    db.exec('CREATE TABLE IF NOT EXISTS audit_deferrals(word TEXT PRIMARY KEY,input_hash TEXT NOT NULL,attempt_id TEXT NOT NULL,note TEXT NOT NULL,created_at INTEGER NOT NULL)');
    if (!db.prepare('PRAGMA table_info(lease)').all().some(c => c.name === 'cooldown_until')) db.exec('ALTER TABLE lease ADD COLUMN cooldown_until INTEGER NOT NULL DEFAULT 0');
    const meta = db.prepare('SELECT * FROM metadata').get();
    const baseModel = String(meta?.model ?? model), basePromptHash = String(meta?.prompt_hash ?? promptHash);
    const identity = [inputs, baseModel, baseURL, basePromptHash];
    if (jsonMode || maxRequests !== 160) identity.push(JSON.stringify({ jsonMode, maxRequests }));
    if (reasoning !== 'high') identity.push(reasoning);
    if (batchSize !== 8 || temperature !== undefined) identity.push(JSON.stringify({ batchSize, temperature }));
    const run = hash(JSON.stringify(identity));
    if (meta && meta.run !== run) throw new Error('Audit inputs changed; use a new audit database');
    const baseRoute = hash(JSON.stringify([run, baseModel, basePromptHash])).slice(0, 24);
    const routeId = hash(JSON.stringify([run, model, promptHash])).slice(0, 24);
    const routeNote = String(values['profile-note'] ?? '').trim();
    if (routeNote.length > 2000) throw new Error('Audit profile note too long');
    if (routeId !== baseRoute && !db.prepare('SELECT id FROM audit_routes WHERE id=?').get(routeId) && !routeNote) throw new Error('New audit profile/model requires --profile-note; original budget is retained');
    if (!meta) {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('INSERT INTO metadata VALUES(?,?,?)').run(run, promptHash, model);
        for (let i = 0; i < inputs.length; i += batchSize) db.prepare('INSERT INTO batches(id,input) VALUES(?,?)').run(i / batchSize, JSON.stringify(inputs.slice(i, i + batchSize)));
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    const baseProfile = basePromptHash === AUDIT_PROMPT_HASH ? 'original' : basePromptHash === hash(CROSS_CHECK_PROMPT) ? 'cross-check-v1' : basePromptHash === hash(PATCH_CHECK_PROMPT) ? 'patch-check-v1' : basePromptHash === hash(BLIND_PATCH_PROMPT) ? 'blind-patch-v1' : 'legacy';
    db.prepare('INSERT OR IGNORE INTO audit_routes VALUES(?,?,?,?,?,?)').run(baseRoute, basePromptHash, baseModel, baseProfile, 'Initial audit profile; original run identity and budget.', Date.now());
    db.prepare('INSERT OR IGNORE INTO audit_routes VALUES(?,?,?,?,?,?)').run(routeId, promptHash, model, profile, routeNote || 'Initial audit profile.', Date.now());
    db.prepare('UPDATE attempts SET route_id=? WHERE route_id IS NULL').run(baseRoute);
    chmodSync(path, 0o600);
    const cooldown = Number(db.prepare('SELECT cooldown_until FROM lease WHERE id=1').get()!.cooldown_until);
    if (cooldown > Date.now()) throw new Error('Provider cooldown until ' + new Date(cooldown).toISOString());
    const owner = randomUUID();
    const acquired = db.prepare("UPDATE lease SET owner=?,expires=? WHERE id=1 AND (owner='' OR expires<?)").run(owner, Date.now() + 180000, Date.now());
    if (!acquired.changes) throw new Error('Another audit runner is active');
    try {
      db.exec('BEGIN IMMEDIATE');
      const completed = new Set(db.prepare('SELECT result FROM batches WHERE result IS NOT NULL').all()
        .flatMap(b => (JSON.parse(String(b.result)) as AuditResult[]).map(r => r.word)));
      for (const word of deferWords) {
        const item = inputs.find(i => i.word === word)!;
        const existing = db.prepare('SELECT * FROM audit_deferrals WHERE word=?').get(word);
        if (existing) {
          if (existing.input_hash !== item.inputHash || existing.note !== deferNote) throw new Error('Deferral is immutable');
          continue;
        }
        if (completed.has(word)) throw new Error('Cannot defer a completed word review');
        const failed = db.prepare("SELECT id,requested_words FROM attempts WHERE finished IS NOT NULL AND error='HTTP_400' ORDER BY started DESC").all()
          .find(a => a.requested_words !== null && (JSON.parse(String(a.requested_words)) as string[]).includes(word));
        if (!failed) throw new Error('Deferral requires a recorded HTTP 400 attempt for that word');
        db.prepare('INSERT INTO audit_deferrals VALUES(?,?,?,?,?)').run(word, item.inputHash, failed.id, deferNote, Date.now());
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK'); db.prepare("UPDATE lease SET owner='',expires=0 WHERE id=1 AND owner=?").run(owner); throw error;
    }
    const deferred = db.prepare('SELECT * FROM audit_deferrals ORDER BY word').all();
    const deferredWords = deferred.map(i => ({ word: String(i.word) }));
    db.prepare("UPDATE attempts SET finished=?,error='INTERRUPTED' WHERE finished IS NULL").run(Date.now());
    for (const candidate of db.prepare(`SELECT a.id,a.batch,a.raw_content,a.requested_words,a.route_id,b.input,r.profile
      FROM attempts a JOIN batches b ON b.id=a.batch LEFT JOIN audit_routes r ON r.id=a.route_id
      WHERE a.raw_content IS NOT NULL AND a.error IN ('INVALID_AUDIT','INVALID_JSON','PARTIAL_AUDIT') ORDER BY a.started`).all()) {
      try {
        const allItems: AuditInput[] = JSON.parse(String(candidate.input));
        const words: string[] = candidate.requested_words === null ? allItems.map(i => i.word) : JSON.parse(String(candidate.requested_words));
        if (!Array.isArray(words) || !words.length || new Set(words).size !== words.length || words.some(w => !allItems.some(i => i.word === w))) continue;
        const requested = allItems.filter(i => words.includes(i.word));
        const prior: AuditResult[] = JSON.parse(String(db.prepare('SELECT result FROM batches WHERE id=?').get(candidate.batch)!.result ?? '[]'));
        if (requested.every(i => prior.some(p => p.word === i.word))) continue;
        const value = parseAuditJSON(String(candidate.raw_content));
        const result = candidate.profile === 'patch-check-v1' || candidate.profile === 'blind-patch-v1'
          ? parsePatchAudit(value, requested) : parsePartialAudit(value, requested);
        const recovered = result.filter(i => !prior.some(p => p.word === i.word))
          .map(i => ({ ...i, auditAttempt: String(candidate.id), auditRoute: String(candidate.route_id) }));
        if (!recovered.length) continue;
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare('UPDATE batches SET result=? WHERE id=?').run(JSON.stringify([...prior, ...recovered]), candidate.batch);
          db.prepare('UPDATE attempts SET recovered_at=? WHERE id=?').run(Date.now(), candidate.id);
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
        if (Number(db.prepare('SELECT coalesce(sum(reserved_output),0) AS n FROM attempts').get()!.n) + maxOutputTokens > outputBudget) break;
        const rows = db.prepare('SELECT * FROM batches ORDER BY tries,id').all();
        let selected: { batch: typeof rows[number]; allItems: AuditInput[]; previous: AuditResult[]; items: AuditInput[] } | undefined;
        for (const batch of rows) {
          if (inFlight.has(Number(batch.id))) continue;
          const allItems: AuditInput[] = JSON.parse(String(batch.input)), previous: AuditResult[] = JSON.parse(String(batch.result ?? '[]'));
          if (previous.length >= allItems.length) continue;
          const history = db.prepare('SELECT requested_words FROM attempts WHERE batch=? ORDER BY started').all(batch.id)
            .map(a => a.requested_words === null ? null : JSON.parse(String(a.requested_words)) as string[]);
          const items = pendingAuditItems(allItems, [...previous, ...deferredWords], history, requestSize, onlyWord);
          if (items.length) { selected = { batch, allItems, previous, items }; break; }
        }
        if (!selected) break;
        const { batch, allItems, previous, items } = selected, batchId = Number(batch.id), attempt = randomUUID();
        inFlight.add(batchId); claimed++;
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare('UPDATE batches SET tries=tries+1 WHERE id=?').run(batchId);
          db.prepare('INSERT INTO attempts(id,batch,started,requested_words,reserved_output,route_id) VALUES(?,?,?,?,?,?)').run(attempt, batchId, Date.now(), JSON.stringify(items.map(i => i.word)), maxOutputTokens, routeId); db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        let route: ReturnType<typeof responseRoute>, inputTokens: number | null = null, outputTokens: number | null = null;
        let errorCode: string | null = null;
        let rawContent: string | null = null;
        // Larger high-reasoning responses can legitimately outlast the old three-minute deadline.
        // The 15-second heartbeat retains the lease; request/output reservations remain unchanged.
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(300000)]);
        try {
          const response = await fetch(new URL('chat/completions', baseURL), { method: 'POST', signal, redirect: 'error', credentials: 'omit',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Magpie-Session': 'rm-review-' + attempt },
            body: JSON.stringify({ model, stream: false, max_tokens: maxOutputTokens, reasoning_effort: reasoning,
              ...(temperature !== undefined ? { temperature } : {}), ...(jsonMode ? { response_format: { type: 'json_object' } } : {}), messages: [
              { role: 'system', content: prompt }, { role: 'user', content: JSON.stringify(items.map(({ word, entry, reference }) => profile === 'blind-patch-v1' ? { word, entry } : { word, entry, reference })) },
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
          if (rawContent?.includes(key)) { rawContent = null; throw new Error('UNSAFE_PROVIDER_RESPONSE'); }
          if (choice?.finish_reason !== 'stop' || choice.message?.tool_calls != null || typeof choice.message?.content !== 'string') throw new Error('COMPLETION');
          const results = (patchProfile ? parsePatchAudit : parsePartialAudit)(parseAuditJSON(choice.message.content), items);
          if (signal.aborted) throw new Error('ABORTED');
          if (db.prepare('SELECT owner FROM lease WHERE id=1').get()!.owner !== owner) throw new Error('LEASE_LOST');
          const combined = new Map([...previous, ...results.map(item => ({ ...item, auditAttempt: attempt, auditRoute: routeId }))].map(item => [item.word, item]));
          db.prepare('UPDATE batches SET result=? WHERE id=?').run(JSON.stringify(allItems.flatMap(item => combined.has(item.word) ? [combined.get(item.word)!] : [])), batchId);
          if (results.length !== items.length) errorCode = 'PARTIAL_AUDIT';
          consecutiveFailures = 0;
        } catch (error) {
          const message = error instanceof Error ? error.message : '';
          errorCode = /^(HTTP_\d{3}|CONTENT_TYPE|OVERSIZED|COMPLETION|INVALID_AUDIT|INVALID_ENTRY|ABORTED|LEASE_LOST|UNSAFE_PROVIDER_RESPONSE)$/.test(message) ? message : signal.aborted ? 'TIMEOUT_OR_CANCELLED' : error instanceof SyntaxError ? 'INVALID_JSON' : 'INVALID_RESPONSE';
          consecutiveFailures++;
          if (['HTTP_400', 'HTTP_401', 'HTTP_402', 'HTTP_403', 'HTTP_404', 'HTTP_422', 'LEASE_LOST', 'UNSAFE_PROVIDER_RESPONSE'].includes(errorCode) || consecutiveFailures >= 5) stop();
        } finally {
          db.prepare('UPDATE attempts SET finished=?,error=?,model=?,provider=?,input_tokens=?,output_tokens=?,raw_content=? WHERE id=?')
            .run(Date.now(), errorCode, route?.selectedModel ?? null, route?.selectedProvider ?? null, inputTokens, outputTokens,
              rawContent && !rawContent.includes(key) ? rawContent : null, attempt);
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
      const attempts = db.prepare('SELECT id,batch,started,finished,error,model,provider,input_tokens,output_tokens,recovered_at,requested_words,reserved_output,route_id FROM attempts ORDER BY started').all();
      const reservedOutput = attempts.reduce((sum, attempt) => sum + Number(attempt.reserved_output), 0);
      const report = { run, model: baseModel, profile: baseProfile, promptHash: basePromptHash, activeModel: model, activeProfile: profile, activePromptHash: promptHash,
        routes: db.prepare('SELECT * FROM audit_routes ORDER BY created_at,id').all(), retryPolicy: 'three-per-word', jsonMode, reasoning, batchSize, requestSize, ...(temperature !== undefined ? { temperature } : {}), maxRequests, maxOutputTokens, outputBudget, reservedOutput,
        covered: results.length, expected: inputs.length, results, attempts, deferred };
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
