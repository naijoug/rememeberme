import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { parseEntry, hash } from '../src/dictionary/model';

it('honors a persisted Retry-After, resumes its audit schema, and never approves the source database', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dictionary-audit-http-'));
  const entry = parseEntry({ word: 'fixture', forms: [], senses: [{ partOfSpeech: 'noun', en: 'A test object.', zh: '测试对象',
    example: { en: 'This is a test object.', zh: '这是一个测试对象。' }, collocations: [] }] }, 'fixture');
  const input = join(directory, 'input.json'), env = join(directory, 'private.env'), dbPath = join(directory, 'audit.sqlite');
  writeFileSync(input, JSON.stringify([{ word: 'fixture', inputHash: hash(JSON.stringify(entry)), entry, reference: [] }]));
  writeFileSync(env, 'DICTIONARY_API_KEY=synthetic-key\n');
  let calls = 0, allow = false, unsafe = false;
  const server = createServer(async (request, response) => {
    calls++; expect(request.headers.authorization).toBe('Bearer synthetic-key');
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    expect(body.model).toBe(calls === 1 ? 'fixture/reviewer' : 'fixture/backup');
    expect(Object.hasOwn(JSON.parse(body.messages[1].content)[0], 'reference')).toBe(calls === 1);
    if (!allow) { response.writeHead(429, { 'Retry-After': '60' }); response.end(); return; }
    response.writeHead(200, { 'Content-Type': 'application/json', 'X-Magpie-Model': 'fixture/reviewer', 'X-Magpie-Provider': 'fixture' });
    response.end(JSON.stringify({ usage: { prompt_tokens: 100, completion_tokens: 100 }, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ results: [{
      word: 'fixture', verdict: 'accept', reason: unsafe ? 'synthetic-key' : 'Synthetic meaning and example agree.', issues: [], entry: null,
      checks: [{ sense: 0, example: entry.senses[0].example.en, verdict: 'ok', reason: 'The test object is correctly described.' }],
    }] }) } }] }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const bundle = join(directory, 'audit.mjs');
    await build({ entryPoints: ['src/dictionary/audit-cli.ts'], outfile: bundle, bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent' });
    const args = [bundle, '--input', input, '--db', dbPath, '--env', env, '--model', 'fixture/reviewer', '--base-url',
      `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/`, '--out', join(directory, 'report.json'), '--limit', '1', '--concurrency', '8', '--max-requests', '3'];
    const run = () => promisify(execFile)(process.execPath, args, { timeout: 10000 });
    await expect(run()).rejects.toMatchObject({ code: 2 }); expect(calls).toBe(1);
    await expect(run()).rejects.toMatchObject({ code: 1 }); expect(calls).toBe(1);
    const db = new DatabaseSync(dbPath); db.exec('UPDATE lease SET cooldown_until=0'); db.close(); allow = true;
    args.push('--max-output-tokens', '16384');
    args.push('--profile', 'blind-patch-v1', '--profile-note', 'Explicit synthetic continuation; retain original budget.');
    args[args.indexOf('--model') + 1] = 'fixture/backup';
    await run(); expect(calls).toBe(2);
    unsafe = true;
    const unsafeArgs = [...args], unsafeDb = join(directory, 'unsafe.sqlite'), unsafeOut = join(directory, 'unsafe-report.json');
    unsafeArgs[unsafeArgs.indexOf('--db') + 1] = unsafeDb; unsafeArgs[unsafeArgs.indexOf('--out') + 1] = unsafeOut;
    await expect(promisify(execFile)(process.execPath, unsafeArgs, { timeout: 10000 })).rejects.toMatchObject({ code: 2 });
    const rejected = JSON.parse(readFileSync(unsafeOut, 'utf8'));
    expect(rejected.covered).toBe(0); expect(rejected.attempts[0].error).toBe('UNSAFE_PROVIDER_RESPONSE');
    expect(JSON.stringify(rejected)).not.toContain('synthetic-key');
    const unsafeStore = new DatabaseSync(unsafeDb);
    expect(unsafeStore.prepare('SELECT raw_content FROM attempts').get()!.raw_content).toBeNull(); unsafeStore.close();
    const report = JSON.parse(readFileSync(join(directory, 'report.json'), 'utf8'));
    expect(report.covered).toBe(1); expect(report.results[0].verdict).toBe('accept');
    expect(report.reservedOutput).toBe(8192 + 16384); expect(report.outputBudget).toBe(3 * 8192);
    expect(report.attempts.map((a: { reserved_output: number }) => a.reserved_output)).toEqual([8192, 16384]);
    expect(report.profile).toBe('original'); expect(report.activeProfile).toBe('blind-patch-v1');
    expect(readFileSync(input, 'utf8')).toContain('"reference":[]');
    expect(report.model).toBe('fixture/reviewer'); expect(report.activeModel).toBe('fixture/backup');
    expect(report.routes).toHaveLength(2); expect(report.results[0].auditRoute).toBe(report.attempts[1].route_id);
    await run(); expect(calls).toBe(3);
  } finally { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); rmSync(directory, { recursive: true, force: true }); }
});

it('persists complete word reviews and retries only the invalid word without resetting the audit ledger', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dictionary-partial-http-'));
  const inputs = ['fixture', 'other'].map(word => {
    const entry = parseEntry({ word, forms: [], senses: [{ partOfSpeech: 'noun', en: 'A test object.', zh: '测试对象',
      example: { en: 'This is a test object.', zh: '这是一个测试对象。' }, collocations: [] }] }, word);
    return { word, inputHash: hash(JSON.stringify(entry)), entry, reference: [] };
  });
  const input = join(directory, 'input.json'), env = join(directory, 'private.env'), dbPath = join(directory, 'audit.sqlite');
  const inputText = JSON.stringify(inputs); writeFileSync(input, inputText); writeFileSync(env, 'DICTIONARY_API_KEY=synthetic-key\n');
  const requests: string[][] = [];
  const server = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString()), items = JSON.parse(body.messages[1].content);
    expect(body.temperature).toBe(0.2);
    requests.push(items.map((item: { word: string }) => item.word));
    const results = items.map((item: { word: string; entry: typeof inputs[number]['entry'] }) => ({ word: item.word,
      verdict: 'accept', reason: 'Synthetic meaning and example agree.', issues: [], entry: null,
      checks: requests.length === 1 && item.word === 'other' ? [] : [{ sense: 0, example: item.entry.senses[0].example.en,
        verdict: 'ok', reason: 'The test object is correctly described.' }],
    }));
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ usage: { prompt_tokens: 100, completion_tokens: 100 }, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ results }) } }] }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const bundle = join(directory, 'audit.mjs');
    await build({ entryPoints: ['src/dictionary/audit-cli.ts'], outfile: bundle, bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent' });
    const args = [bundle, '--input', input, '--db', dbPath, '--env', env, '--model', 'fixture/reviewer', '--base-url',
      `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/`, '--out', join(directory, 'report.json'), '--limit', '1', '--concurrency', '8', '--batch-size', '12', '--temperature', '0.2', '--max-requests', '2'];
    const run = () => promisify(execFile)(process.execPath, args, { timeout: 10000 });
    await expect(run()).rejects.toMatchObject({ code: 2 });
    expect(JSON.parse(readFileSync(join(directory, 'report.json'), 'utf8')).covered).toBe(1);
    await expect(promisify(execFile)(process.execPath, [...args, '--max-output-tokens', '16384'], { timeout: 10000 })).rejects.toMatchObject({ code: 2 });
    expect(requests).toHaveLength(1); // Larger reservations cannot overdraw the original total budget.
    // Shrink the resumed request while retaining the original run/batch identity.
    args.push('--request-size', '1');
    await run(); await run();
    expect(requests).toEqual([['fixture', 'other'], ['other']]);
    const report = JSON.parse(readFileSync(join(directory, 'report.json'), 'utf8'));
    expect(report.covered).toBe(2); expect(report.attempts).toHaveLength(2);
    expect(report.attempts[0].error).toBe('PARTIAL_AUDIT'); expect(report.reservedOutput).toBe(2 * 8192);
    expect(report.batchSize).toBe(12); expect(report.temperature).toBe(0.2);
    expect(report.requestSize).toBe(1);
    expect(report.outputBudget).toBe(2 * 8192);
    expect(JSON.parse(report.attempts[1].requested_words)).toEqual(['other']);
    const ledger = new DatabaseSync(dbPath);
    expect(ledger.prepare('SELECT tries FROM batches').get()!.tries).toBe(2); ledger.close();
    const changed = [...args]; changed[changed.indexOf('--temperature') + 1] = '0.1';
    await expect(promisify(execFile)(process.execPath, changed, { timeout: 10000 })).rejects.toMatchObject({ code: 1 });
    await expect(promisify(execFile)(process.execPath, [...args, '--profile', 'cross-check-v1'], { timeout: 10000 })).rejects.toMatchObject({ code: 1 });
    expect(requests).toHaveLength(2);
    expect(readFileSync(input, 'utf8')).toBe(inputText);
  } finally { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); rmSync(directory, { recursive: true, force: true }); }
});

it('recovers recorded partial patches with the original route without new requests or reservations', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dictionary-patch-recovery-'));
  const inputs = ['fixture', 'other'].map(word => {
    const entry = parseEntry({ word, forms: [], senses: [{ partOfSpeech: 'noun', en: 'A test object.', zh: '测试对象',
      example: { en: 'This is a test object.', zh: '这是一个测试对象。' }, collocations: [] }] }, word);
    return { word, entry, inputHash: hash(JSON.stringify(entry)), reference: [] };
  });
  const accepted = (word: string) => ({ word, verdict: 'accept', reason: 'All senses checked.', issues: [], entry: null,
    checks: [{ sense: 0, example: inputs[0].entry.senses[0].example.en, verdict: 'ok', reason: 'Correct example and meaning.' }] });
  let requests = 0;
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) { /* drain disposable request */ }
    requests++; response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ results: [
      accepted('fixture'), { ...accepted('other'), checks: [] },
    ] }) } }] }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const input = join(directory, 'input.json'), env = join(directory, 'private.env'), dbPath = join(directory, 'audit.sqlite');
    const output = join(directory, 'report.json'), bundle = join(directory, 'audit.mjs');
    writeFileSync(input, JSON.stringify(inputs)); writeFileSync(env, 'DICTIONARY_API_KEY=synthetic-key\n');
    await build({ entryPoints: ['src/dictionary/audit-cli.ts'], outfile: bundle, bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent' });
    const args = [bundle, '--input', input, '--db', dbPath, '--env', env, '--model', 'fixture/reviewer', '--base-url',
      `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/`, '--out', output, '--max-requests', '1', '--limit', '1', '--profile', 'patch-check-v1'];
    await expect(promisify(execFile)(process.execPath, args)).rejects.toMatchObject({ code: 2 });
    const ledger = new DatabaseSync(dbPath), attempt = ledger.prepare('SELECT * FROM attempts').get()!;
    const prior = JSON.parse(String(ledger.prepare('SELECT result FROM batches').get()!.result))[0];
    const revise = (word: string) => ({ ...accepted(word), verdict: 'revise', issues: ['Translation correction.'],
      entry: { word, senses: [{ index: 0, example: { zh: '这是测试用的对象。' } }] } });
    // Simulate the former parser rejecting an exact echoed identifier in the raw patch.
    const raw = JSON.stringify({ results: [revise('fixture'), revise('other')] });
    ledger.prepare('UPDATE attempts SET raw_content=?').run(raw); ledger.close();
    args[args.indexOf('--limit') + 1] = '0'; args[args.indexOf('--profile') + 1] = 'original';
    args.push('--profile-note', 'Synthetic current route differs; recover using the recorded patch route.');
    await promisify(execFile)(process.execPath, args); await promisify(execFile)(process.execPath, args);
    const report = JSON.parse(readFileSync(output, 'utf8'));
    expect(requests).toBe(1); expect(report.covered).toBe(2); expect(report.reservedOutput).toBe(8192);
    expect(report.attempts).toHaveLength(1); expect(report.attempts[0].error).toBe('PARTIAL_AUDIT');
    expect(report.results.find((r: { word: string }) => r.word === 'fixture')).toEqual(prior);
    expect(report.results.find((r: { word: string }) => r.word === 'other')).toMatchObject({ verdict: 'revise', auditAttempt: attempt.id, auditRoute: attempt.route_id });
    const final = new DatabaseSync(dbPath);
    expect(final.prepare('SELECT raw_content FROM attempts').get()!.raw_content).toBe(raw);
    expect(final.prepare('SELECT recovered_at FROM attempts').get()!.recovered_at).toBeGreaterThan(0);
    expect(final.prepare('SELECT tries FROM batches').get()!.tries).toBe(1); final.close();
  } finally { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); rmSync(directory, { recursive: true, force: true }); }
});

it('defers only explicitly named HTTP400 words and keeps them unreviewed while other work continues', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dictionary-audit-deferral-'));
  const inputs = ['alpha', 'beta'].map(word => {
    const entry = parseEntry({ word, forms: [], senses: [{ partOfSpeech: 'noun', en: 'A test object.', zh: '测试对象',
      example: { en: 'This is a test object.', zh: '这是一个测试对象。' }, collocations: [] }] }, word);
    return { word, entry, inputHash: hash(JSON.stringify(entry)), reference: [] };
  });
  const requests: string[][] = [];
  const server = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString()), items = JSON.parse(body.messages[1].content);
    requests.push(items.map((i: { word: string }) => i.word));
    if (items[0].word === 'alpha') { response.writeHead(400); response.end('Synthetic provider policy block'); return; }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ results: [{
      word: 'beta', verdict: 'accept', reason: 'Meaning and example checked.', issues: [], entry: null,
      checks: [{ sense: 0, example: inputs[1].entry.senses[0].example.en, verdict: 'ok', reason: 'Correct test object.' }],
    }] }) } }] }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const input = join(directory, 'input.json'), env = join(directory, 'private.env'), dbPath = join(directory, 'audit.sqlite');
    const output = join(directory, 'report.json'), bundle = join(directory, 'audit.mjs');
    writeFileSync(input, JSON.stringify(inputs)); writeFileSync(env, 'DICTIONARY_API_KEY=synthetic-key\n');
    await build({ entryPoints: ['src/dictionary/audit-cli.ts'], outfile: bundle, bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent' });
    const args = [bundle, '--input', input, '--db', dbPath, '--env', env, '--model', 'fixture/reviewer', '--base-url',
      `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/`, '--out', output, '--max-requests', '3', '--limit', '1', '--batch-size', '1', '--concurrency', '1'];
    const run = (extra: string[] = []) => promisify(execFile)(process.execPath, [...args, ...extra]);
    await expect(run()).rejects.toMatchObject({ code: 2 });
    await expect(run(['--defer-words', 'beta', '--defer-note', 'Not a blocked word.'])).rejects.toMatchObject({ code: 1 });
    await expect(run(['--defer-words', 'alpha'])).rejects.toMatchObject({ code: 1 });
    const defer = ['--defer-words', 'alpha', '--defer-note', 'Provider block observed; retain for explicit direct editorial review.'];
    await expect(run(defer)).rejects.toMatchObject({ code: 2 });
    await expect(run([...defer, '--limit', '0'])).rejects.toMatchObject({ code: 2 });
    const report = JSON.parse(readFileSync(output, 'utf8'));
    expect(requests).toEqual([['alpha'], ['beta']]); expect(report.covered).toBe(1); expect(report.expected).toBe(2);
    expect(report.results.map((r: { word: string }) => r.word)).toEqual(['beta']); expect(report.attempts).toHaveLength(2);
    expect(report.reservedOutput).toBe(16384); expect(report.attempts[0].error).toBe('HTTP_400');
    expect(report.deferred).toEqual([expect.objectContaining({ word: 'alpha', input_hash: inputs[0].inputHash, attempt_id: report.attempts[0].id })]);
    await expect(run(['--defer-words', 'alpha', '--defer-note', 'Replace the history.'])).rejects.toMatchObject({ code: 1 });
    const ledger = new DatabaseSync(dbPath); expect(ledger.prepare('SELECT owner FROM lease').get()!.owner).toBe('');
    expect(ledger.prepare('SELECT count(*) AS n FROM audit_deferrals').get()!.n).toBe(1); ledger.close();
  } finally { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); rmSync(directory, { recursive: true, force: true }); }
});
