// Explicit live-provider comparison. No server listener, runtime, DB or vocabulary.
// Pass standalone bundles exporting MagpieTranslator, MyMemoryTranslator and ServerTranslator.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

export async function compareWordTranslation(before, after, environmentFile, emit = value => console.log(JSON.stringify(value))) {
  const configured = parseEnv(await readFile(environmentFile, 'utf8'));
  assert.equal(configured.TRANSLATION_PROVIDER, 'magpie');
  assert.equal(configured.MAGPIE_BASE_URL, 'http://127.0.0.1:3425/v1');
  assert.equal(configured.MAGPIE_MODEL, 'group/translator');
  assert.equal(configured.MYMEMORY_ENABLED, 'true');
  const options = { baseURL: configured.MAGPIE_BASE_URL, key: configured.MAGPIE_API_KEY, model: configured.MAGPIE_MODEL };
  const samples = [];
  const make = (library, injectedStall) => {
    let primaryCalls = 0;
    const primary = new library.MagpieTranslator({ ...options, fetch: (url, init) => {
      primaryCalls++;
      if (!injectedStall) return fetch(url, init);
      return new Promise((_, reject) => {
        const abort = () => reject(new DOMException('Injected stalled provider', 'AbortError'));
        if (init.signal.aborted) abort(); else init.signal.addEventListener('abort', abort, { once: true });
      });
    } });
    return { server: new library.ServerTranslator(primary, new library.MyMemoryTranslator()), calls: () => primaryCalls };
  };
  emit({ kind: 'scope', model: configured.MAGPIE_MODEL, natural: 'real Magpie and MyMemory, alternating order',
    fault: 'injected stalled Magpie, real MyMemory', productionDatabaseUsed: false,
    cache: 'fresh independent server caches per phase; each word queried once per variant', publicNetworkIncluded: false });
  for (const phase of ['natural', 'injected-primary-stall']) {
    const services = { before: make(before, phase !== 'natural'), after: make(after, phase !== 'natural') };
    const words = phase === 'natural' ? ['test', 'latency', 'benchmark', 'quartz', 'sapphire'] : ['latency', 'quartz', 'benchmark'];
    for (const [index, word] of words.entries()) {
      for (const variant of index % 2 ? ['after', 'before'] : ['before', 'after']) {
        const service = services[variant], calls = service.calls(), start = performance.now();
        let result;
        try {
          const translation = await service.server.translate(word);
          assert.equal(translation.target, 'zh-CN'); assert.match(translation.text, /[\u3400-\u9fff]/u);
          result = { ok: true, source: translation.source };
        } catch (error) { result = { ok: false, code: error.code ?? error.name }; }
        const sample = { kind: 'sample', phase, variant, word, ms: Math.round(performance.now() - start),
          primaryCalls: service.calls() - calls, ...result };
        samples.push(sample); emit(sample);
      }
    }
  }
  for (const phase of ['natural', 'injected-primary-stall']) for (const variant of ['before', 'after']) {
    const rows = samples.filter(row => row.phase === phase && row.variant === variant);
    const times = rows.map(row => row.ms).sort((a, b) => a - b);
    emit({ kind: 'summary', phase, variant, samples: rows.length, successes: rows.filter(row => row.ok).length,
      medianMs: times[Math.floor(times.length / 2)], maximumMs: times.at(-1),
      primaryCalls: rows.reduce((sum, row) => sum + row.primaryCalls, 0) });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [beforePath, afterPath, environmentFile] = process.argv.slice(2);
  if (!beforePath || !afterPath || !environmentFile) throw new Error('Usage: node compare-word-translation.mjs BEFORE_BUNDLE AFTER_BUNDLE PRIVATE_ENV_FILE');
  await compareWordTranslation(await import(pathToFileURL(resolve(beforePath))), await import(pathToFileURL(resolve(afterPath))), environmentFile);
}
