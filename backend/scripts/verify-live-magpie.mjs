// Explicit live-provider diagnostic. Uses only synthetic words and a disposable DB.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';

const [runtimeArgument, environmentFile] = process.argv.slice(2);
if (!runtimeArgument || !environmentFile) throw new Error('Usage: node verify-live-magpie.mjs RUNTIME PRIVATE_ENV_FILE');
const directory = resolve(runtimeArgument);
const { app, createRuntime, MagpieTranslator, MyMemoryTranslator, ServerTranslator } = await import(pathToFileURL(join(directory, 'library.mjs')));
const configured = parseEnv(await readFile(environmentFile, 'utf8'));
assert.equal(configured.TRANSLATION_PROVIDER, 'magpie');
assert.equal(configured.MAGPIE_BASE_URL, 'http://127.0.0.1:3425/v1');
assert.equal(configured.MAGPIE_MODEL, 'zhipu/glm-5.3-flash');
assert.equal(configured.MYMEMORY_ENABLED, 'true');
const temporary = await mkdtemp(join(tmpdir(), 'rememberme-magpie-live-'));
let runtime;
try {
  const configuration = Object.fromEntries(['TRANSLATION_PROVIDER', 'MAGPIE_BASE_URL', 'MAGPIE_API_KEY', 'MAGPIE_MODEL', 'MYMEMORY_ENABLED'].map(key => [key, configured[key]]));
  runtime = createRuntime({ databasePath: join(temporary, 'fixture.sqlite'), migrations: join(directory, 'migrations'),
    publicDirectory: join(directory, 'public'), configuration: { ...configuration, ENVIRONMENT: 'local', PUBLIC_ORIGIN: 'http://127.0.0.1' } });
  const start = Date.now();
  const response = await app.fetch(new Request('http://127.0.0.1/api/v1/public/lookup/translation', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ word: 'synthetic', target: 'zh-CN' }),
  }), runtime);
  assert.equal(response.status, 200, 'Live Magpie route must return 200');
  const { translation } = await response.json();
  assert.equal(translation.source, 'magpie'); assert.equal(translation.target, 'zh-CN'); assert.match(translation.text, /[\u3400-\u9fff]/u);
  console.log(JSON.stringify({ check: 'live-magpie', source: translation.source, elapsedMs: Date.now() - start, productionDatabaseUsed: false }));
  const unavailable = new MagpieTranslator({ baseURL: configured.MAGPIE_BASE_URL, key: 'synthetic-fixture', model: configured.MAGPIE_MODEL,
    fetch: async () => new Response('', { status: 503 }) });
  const fallback = await new ServerTranslator(unavailable, new MyMemoryTranslator()).translate('synthetic');
  assert.equal(fallback.source, 'mymemory'); assert.match(fallback.text, /[\u3400-\u9fff]/u);
  console.log(JSON.stringify({ check: 'live-mymemory-after-synthetic-magpie-failure', source: fallback.source, productionDatabaseUsed: false }));
  for (const table of ['users', 'sessions', 'vocabulary_entries']) {
    assert.equal((await runtime.DB.prepare('SELECT count(*) AS n FROM ' + table).first()).n, 0);
  }
} finally { runtime?.DB.close(); await rm(temporary, { recursive: true, force: true }); }
