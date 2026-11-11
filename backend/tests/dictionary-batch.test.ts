import { expect, it } from 'vitest';
import { DictionaryBatchGenerator, runBatchBuild, BATCH_PROMPT_HASH, normalizeBatchEntry } from '../src/dictionary/batch';
import { DictionaryStore } from '../src/dictionary/store';
import { parseDataset, parseEntry, type BuildConfig } from '../src/dictionary/model';
const config: BuildConfig = { model: 'fixture/model', baseURL: 'http://127.0.0.1:1234/v1/', maxRequests: 4, maxOutputTokens: 1000, outputBudget: 4000, maxAttempts: 3 };
const raw = (word: string) => ({ word, forms: [], senses: [{ partOfSpeech: 'noun', en: 'A synthetic test object.', zh: '测试对象', example: { en: 'This is a test object.', zh: '这是一个测试对象。' }, collocations: [] }] });
function response(entries: unknown[]) { return new Response(JSON.stringify({ usage: { prompt_tokens: 50, completion_tokens: 100 }, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ entries }) } }] }),
  { headers: { 'Content-Type': 'application/json', 'X-Magpie-Model': 'fixture/model', 'X-Magpie-Provider': 'fixture' } }); }
function setup(options = config) { const store = new DictionaryStore(':memory:'); const build = store.initialize(parseDataset({ id: 'batch-test', metadata: {}, words: ['alpha', 'beta'].map(word => ({ word, tags: [] })) }), options); return { store, build }; }

it('canonicalizes redundant form formatting without inventing senses or swallowing substantive notes', () => {
  const original = { ...raw('fixture'), forms: ['fixture', 'more fixture', 'most fixture', 'Fixtures', 'fixtures'], note: '', placeholder: null, collocations: [], references: [], reference: {} };
  const normalized = parseEntry(normalizeBatchEntry(original, 'fixture'), 'fixture');
  expect(normalized.forms).toEqual(['fixtures']); expect(normalized.senses[0].en).toBe(original.senses[0].en);
  expect(original.forms).toHaveLength(5); expect(original.note).toBe('');
  expect(original.references).toEqual([]); expect(original.reference).toEqual({});
  expect(() => parseEntry(normalizeBatchEntry({ ...original, note: 'Meaning is uncertain.' }, 'fixture'), 'fixture')).toThrow();
  expect(() => parseEntry(normalizeBatchEntry({ ...original, references: ['Unverified claim'] }, 'fixture'), 'fixture')).toThrow();
  expect(() => parseEntry(normalizeBatchEntry({ ...raw('us'), word: 'US' }, 'us'), 'us')).toThrow();
  expect(() => parseEntry(normalizeBatchEntry({ ...raw('fixture'), forms: ['not an inflection'] }, 'fixture'), 'fixture')).toThrow();
});

it('keeps valid siblings, retries only invalid words and records batch usage without multiplying tokens', async () => {
  const { store, build } = setup(); const requests: string[][] = [];
  const provider = new DictionaryBatchGenerator(config, 'synthetic-key', undefined, async (_url, init) => {
    const body = JSON.parse(String(init?.body)); const words = JSON.parse(body.messages[1].content).items.map((i: { word: string }) => i.word);
    requests.push(words); expect(body.max_tokens).toBe(words.length * 1000);
    return response(words.map((word: string) => word === 'beta' && requests.length === 1 ? { ...raw(word), forms: ['INVALID FORM'] } : raw(word)));
  });
  try {
    await runBatchBuild(store, build, provider, { limit: 2, delayMs: 0 });
    expect(store.status(build).states).toEqual([{ state: 'draft', count: 1 }, { state: 'failed', count: 1 }]);
    await runBatchBuild(store, build, provider, { delayMs: 0 }); await runBatchBuild(store, build, provider, { delayMs: 0 });
    expect(requests).toEqual([['alpha', 'beta'], ['beta']]);
    expect(store.status(build).usage).toMatchObject({ requests: 3, reservedOutput: 3000, reportedOutput: 0 });
    expect(store.status(build).batches).toMatchObject({ requests: 2, reportedInput: 100, reportedOutput: 200 });
    expect(store.db.prepare('SELECT count(*) AS n FROM edition_entries').get()!.n).toBe(0);
    expect(store.records(build)[0].provenance).toMatchObject({ promptHash: BATCH_PROMPT_HASH, promptVersion: 'learner-dictionary-batch-v1' });
    expect(store.db.prepare("SELECT raw_content FROM generation_batches WHERE error='PARTIAL_BATCH'").get()!.raw_content).toContain('INVALID FORM');
  } finally { store.close(); }
});

it('removes only exact pinned reference echoes while preserving meanings and raw provenance', async () => {
  const reference = { source: 'ecdict-wordnet-v1' as const, originalSpelling: 'alpha', english: ['noun: test object'], chinese: '测试对象', forms: [] };
  for (const echo of [reference, { source: reference.source }]) {
    const value = { ...raw('alpha'), reference: echo };
    expect(parseEntry(normalizeBatchEntry(value, 'alpha', reference), 'alpha')).toEqual(parseEntry(raw('alpha'), 'alpha'));
    expect(value.reference).toEqual(echo);
  }
  for (const echo of [{ source: 'different' }, { english: ['different meaning'] }, { note: 'Meaning is uncertain.' }]) {
    expect(() => parseEntry(normalizeBatchEntry({ ...raw('alpha'), reference: echo }, 'alpha', reference), 'alpha')).toThrow();
  }
  expect(() => parseEntry(normalizeBatchEntry({ ...raw('alpha'), reference }, 'alpha'), 'alpha')).toThrow();
  const provider = new DictionaryBatchGenerator({ ...config, referenceHash: 'a'.repeat(64) }, 'synthetic-key', { alpha: reference },
    async () => response([{ ...raw('alpha'), reference: { source: reference.source } }]));
  const result = await provider.generate(['alpha']);
  expect(result.entries.get('alpha')!.entry).toEqual(parseEntry(raw('alpha'), 'alpha'));
  expect(result.raw).toContain('reference'); expect(result.invalid).toEqual([]);
});

it('ignores empty envelope placeholders but rejects substantive envelope metadata', async () => {
  for (const note of [null, [], {}, '']) {
    const provider = new DictionaryBatchGenerator(config, 'synthetic-key', undefined, async () => new Response(JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ entries: [raw('alpha')], note }) } }],
    }), { headers: { 'Content-Type': 'application/json' } }));
    expect((await provider.generate(['alpha'])).entries.get('alpha')!.entry).toEqual(parseEntry(raw('alpha'), 'alpha'));
  }
  for (const note of [['Uncertain meaning'], { uncertain: true }]) {
    const provider = new DictionaryBatchGenerator(config, 'synthetic-key', undefined, async () => new Response(JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ entries: [raw('alpha')], note }) } }],
    }), { headers: { 'Content-Type': 'application/json' } }));
    await expect(provider.generate(['alpha'])).rejects.toMatchObject({ code: 'INVALID_BATCH' });
  }
});

it('does not reserve more words or output than the original remaining build budget', async () => {
  const { store, build } = setup({ ...config, maxRequests: 1, outputBudget: 1000 });
  let calls = 0;
  const provider = new DictionaryBatchGenerator(config, 'synthetic-key', undefined, async (_url, init) => {
    calls++; const body = JSON.parse(String(init?.body)); expect(body.max_tokens).toBe(1000);
    return response([raw('alpha')]);
  });
  try {
    await runBatchBuild(store, build, provider, { delayMs: 0 }); await runBatchBuild(store, build, provider, { delayMs: 0 });
    expect(calls).toBe(1); expect(store.status(build).usage).toMatchObject({ requests: 1, reservedOutput: 1000 });
    expect(store.status(build).states).toEqual([{ state: 'draft', count: 1 }, { state: 'pending', count: 1 }]);
  } finally { store.close(); }
});

it('drains after the in-flight batch without aborting its response or reserving another word', async () => {
  const { store, build } = setup(), drain = new AbortController(); let calls = 0;
  const provider = new DictionaryBatchGenerator(config, 'synthetic-key', undefined, async (_url, init) => {
    calls++; drain.abort(); expect(init?.signal?.aborted).toBe(false); return response([raw('alpha')]);
  });
  try {
    const result = await runBatchBuild(store, build, provider, { batchSize: 1, delayMs: 0, drainSignal: drain.signal });
    expect(result.stopped).toBe('drained'); expect(calls).toBe(1);
    expect(result.states).toEqual([{ state: 'draft', count: 1 }, { state: 'pending', count: 1 }]);
    expect(result.usage).toMatchObject({ requests: 1, reservedOutput: 1000 });
  } finally { store.close(); }
});

it('rejects unknown, duplicate or missing word keys instead of assigning entries by position', async () => {
  const { word: _word, ...withoutWord } = raw('alpha');
  for (const rows of [[raw('unknown')], [raw('alpha'), raw('alpha')], [withoutWord]]) {
    const provider = new DictionaryBatchGenerator(config, 'synthetic-key', undefined, async () => response(rows));
    await expect(provider.generate(['alpha', 'beta'])).rejects.toMatchObject({ code: 'INVALID_BATCH', rawContent: expect.stringContaining('entries') });
  }
});

it('does not retain or admit a response that echoes the private credential', async () => {
  const entry = raw('alpha'); entry.senses[0].en = 'synthetic-key';
  const provider = new DictionaryBatchGenerator(config, 'synthetic-key', undefined, async () => response([entry]));
  await expect(provider.generate(['alpha'])).rejects.toMatchObject({ code: 'UNSAFE_PROVIDER_RESPONSE', retryable: false, rawContent: undefined });
});

it('persists a shared provider cooldown while charging each reserved word only once', async () => {
  const { store, build } = setup(); let calls = 0;
  const provider = new DictionaryBatchGenerator(config, 'synthetic-key', undefined, async () => { calls++; return new Response('', { status: 429, headers: { 'Retry-After': '60' } }); });
  try {
    const result = await runBatchBuild(store, build, provider, { delayMs: 0 }); expect(result.stopped).toBe('provider-cooldown');
    await expect(runBatchBuild(store, build, provider)).rejects.toThrow('cooldown');
    expect(calls).toBe(1); expect(result.usage).toMatchObject({ requests: 2, reservedOutput: 2000 });
  } finally { store.close(); }
});

it('times out even when a transport ignores AbortSignal, and never publishes truncated output', async () => {
  const stalled = new DictionaryBatchGenerator(config, 'synthetic-key', undefined, async () => new Promise<Response>(() => {}), 5);
  await expect(stalled.generate(['alpha'])).rejects.toMatchObject({ code: 'TIMEOUT' });
  const truncated = new DictionaryBatchGenerator(config, 'synthetic-key', undefined, async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: JSON.stringify({ entries: [raw('alpha')] }) } }] }), { headers: { 'Content-Type': 'application/json' } }));
  await expect(truncated.generate(['alpha'])).rejects.toMatchObject({ code: 'INVALID_COMPLETION' });
});
