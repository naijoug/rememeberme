// Explicit live diagnostic: fixed fixture words, no application runtime or vocabulary DB.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { createHash } from 'node:crypto';

const [runtimePath, privateEnvironment, mode = 'candidates', trialGroup] = process.argv.slice(2);
if (!runtimePath || !privateEnvironment || !['candidates', 'trial', 'group-check'].includes(mode)) {
  throw new Error('Usage: node benchmark-magpie-routing.mjs RUNTIME PRIVATE_ENV_FILE [candidates|trial|group-check] [group/TRIAL_ID]');
}
if (mode === 'trial') assert.match(trialGroup ?? '', /^group\/[a-z0-9][a-z0-9-]{0,100}$/);
const { MagpieTranslator, WORD_TRANSLATION_PROMPT } = await import(pathToFileURL(join(resolve(runtimePath), 'library.mjs')));
assert.equal(typeof WORD_TRANSLATION_PROMPT, 'string');
const config = parseEnv(await readFile(privateEnvironment, 'utf8'));
assert.equal(config.TRANSLATION_PROVIDER, 'magpie');
assert.equal(config.MAGPIE_BASE_URL, 'http://127.0.0.1:3425/v1');
assert.equal(config.MAGPIE_MODEL, 'group/translator');
const variants = mode === 'candidates' ? ['group/translator', 'deepseek/deepseek-flash', 'zhipu/glm-5.3-flash']
  : mode === 'trial' ? ['group/translator', trialGroup] : ['group/translator'];
const fixtures = [
  ['bank', /银行|河岸/u], ['charge', /费用|收费|充电|指控|控告|冲锋/u], ['issue', /问题|发行|发布|期/u],
  ['stalactite', /钟乳石/u], ['meticulous', /细致|细心|一丝不苟|严谨/u], ['tamarind', /罗望子|酸角/u],
  ['resilient', /韧|弹性|复原|恢复/u], ['benchmark', /基准|标杆|标准/u],
];
const emit = value => console.log(JSON.stringify(value));
emit({ kind: 'scope', mode, samplesPerVariant: fixtures.length, timeoutMs: 3000,
  promptSha256: createHash('sha256').update(WORD_TRANSLATION_PROMPT).digest('hex'),
  cache: 'Each call uses a fresh adapter; no server/client result cache. Vendor prompt caching remains outside this test.',
  productionDatabaseUsed: false, order: 'Rotate candidate order for each word; calls are sequential.' });
const rows = [];
for (const [i, [word, expected]] of fixtures.entries()) {
  const order = [...variants.slice(i % variants.length), ...variants.slice(0, i % variants.length)];
  for (const model of order) {
    let observation;
    let done;
    const recorded = new Promise(resolve => { done = resolve; });
    const service = new MagpieTranslator({ baseURL: config.MAGPIE_BASE_URL, key: config.MAGPIE_API_KEY, model,
      observe: value => { observation = value; done(); } });
    const started = performance.now(); let result;
    try {
      const translation = await service.translate(word);
      result = { ok: true, source: translation.source, text: translation.text, meaningCheck: expected.test(translation.text) };
    } catch (error) { result = { ok: false, errorCode: error.code ?? error.name, meaningCheck: false }; }
    const ms = Math.round(performance.now() - started);
    let timer;
    await Promise.race([recorded, new Promise(resolve => { timer = setTimeout(resolve, 400); })]); clearTimeout(timer);
    const row = { kind: 'sample', word, model, ms, ...result, observation };
    rows.push(row); emit(row);
  }
}
for (const model of variants) {
  const samples = rows.filter(row => row.model === model), times = samples.map(row => row.ms).sort((a, b) => a - b);
  const middle = times.length / 2;
  emit({ kind: 'summary', model, samples: samples.length, valid: samples.filter(row => row.ok).length,
    meaningChecks: samples.filter(row => row.meaningCheck).length,
    medianMs: (times[Math.floor(middle)] + times[Math.ceil(middle) - 1]) / 2, maximumMs: times.at(-1),
    selectedModels: [...new Set(samples.map(row => row.observation?.selectedModel ?? 'unknown'))] });
}
