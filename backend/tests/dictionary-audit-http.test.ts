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
  let calls = 0, allow = false;
  const server = createServer(async (request, response) => {
    calls++; expect(request.headers.authorization).toBe('Bearer synthetic-key');
    for await (const _chunk of request) { /* Consume fixture request. */ }
    if (!allow) { response.writeHead(429, { 'Retry-After': '60' }); response.end(); return; }
    response.writeHead(200, { 'Content-Type': 'application/json', 'X-Magpie-Model': 'fixture/reviewer', 'X-Magpie-Provider': 'fixture' });
    response.end(JSON.stringify({ usage: { prompt_tokens: 100, completion_tokens: 100 }, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ results: [{
      word: 'fixture', verdict: 'accept', reason: 'Synthetic meaning and example agree.', issues: [], entry: null,
      checks: [{ sense: 0, example: entry.senses[0].example.en, verdict: 'ok', reason: 'The test object is correctly described.' }],
    }] }) } }] }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const bundle = join(directory, 'audit.mjs');
    await build({ entryPoints: ['src/dictionary/audit-cli.ts'], outfile: bundle, bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent' });
    const args = [bundle, '--input', input, '--db', dbPath, '--env', env, '--model', 'fixture/reviewer', '--base-url',
      `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/`, '--out', join(directory, 'report.json'), '--limit', '1', '--concurrency', '1'];
    const run = () => promisify(execFile)(process.execPath, args, { timeout: 10000 });
    await expect(run()).rejects.toMatchObject({ code: 2 }); expect(calls).toBe(1);
    await expect(run()).rejects.toMatchObject({ code: 1 }); expect(calls).toBe(1);
    const db = new DatabaseSync(dbPath); db.exec('UPDATE lease SET cooldown_until=0'); db.close(); allow = true;
    await run(); expect(calls).toBe(2);
    const report = JSON.parse(readFileSync(join(directory, 'report.json'), 'utf8'));
    expect(report.covered).toBe(1); expect(report.results[0].verdict).toBe('accept');
    await run(); expect(calls).toBe(2);
  } finally { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); rmSync(directory, { recursive: true, force: true }); }
});
