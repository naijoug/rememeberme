import { afterEach, expect, it, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
import { LearnerDictionary, lookupPackagedDefinition, type LearnerManifest } from './learner-dictionary';
import { isRememberMeTranslation, isTranslation } from './definition-utils';

const entry = { word: 'fixture', contentHash: 'a'.repeat(64), reviewStatus: 'approved', senses: [
  { id: 'fixture:test', partOfSpeech: 'noun', en: 'A synthetic test object.', zh: '合成测试对象',
    example: { en: 'This is a test object.', zh: '这是一个测试对象。' }, collocations: ['test object'] },
] };
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
function setup(value: unknown = entry) {
  vi.stubGlobal('crypto', webcrypto);
  const body = JSON.stringify({ fixture: value });
  const manifest: LearnerManifest = { schemaVersion: 1, version: 'b'.repeat(24), entries: 1, reviewMethod: 'ai-assisted-v1', words: { fixture: 'ab' },
    shards: { ab: { sha256: hash(body), bytes: Buffer.byteLength(body) } } };
  const fetcher = vi.fn<typeof fetch>(async () => new Response(body)); vi.stubGlobal('fetch', fetcher);
  return { manifest, fetcher, dictionary: new LearnerDictionary(manifest, path => 'chrome-extension://fixture' + path) };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('coalesces local English/Chinese shard reads and produces compatible attributed snapshots', async () => {
  const { dictionary, fetcher } = setup();
  const [definition, translation] = await Promise.all([dictionary.getDefinition(' Fixture '), dictionary.getTranslation('fixture')]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe('chrome-extension://fixture/dictionary/rememberme/ab.json');
  expect(definition).toMatchObject({ word: 'fixture', source: 'rememberme-dict', meanings: [{ definitions: [{ glossZh: '合成测试对象', exampleTranslation: '这是一个测试对象。' }] }] });
  expect(isTranslation(translation)).toBe(true); expect(isRememberMeTranslation(translation)).toBe(true);
  expect(translation).toMatchObject({ source: 'magpie', dictionary: { id: 'rememberme-dict', version: 'b'.repeat(24), entryHash: 'a'.repeat(64) } });
  definition!.meanings[0].definitions[0].collocations![0] = 'mutated';
  expect((await dictionary.getDefinition('fixture'))!.meanings[0].definitions[0].collocations).toEqual(['test object']);
});
it('does not probe generated forms, unknown words or the network for catalog misses', async () => {
  const { dictionary, fetcher } = setup({ ...entry, forms: ['fixtures'] });
  expect(await dictionary.getDefinition('fixtures')).toBeNull(); expect(await dictionary.getTranslation('unknown')).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});
it('rejects corrupt, oversized and unapproved shards before returning entries', async () => {
  const f = setup(); f.fetcher.mockImplementation(async () => new Response('x'.repeat(2000)));
  await expect(f.dictionary.getDefinition('fixture')).rejects.toThrow('size mismatch');
  const g = setup(); g.manifest.shards.ab.sha256 = '0'.repeat(64);
  await expect(g.dictionary.getDefinition('fixture')).rejects.toThrow('checksum');
  const h = setup({ ...entry, reviewStatus: 'draft' });
  await expect(h.dictionary.getDefinition('fixture')).rejects.toThrow('reviewed');
});
it('bounds a stalled local response and permits recovery on the next call', async () => {
  vi.useFakeTimers(); const { dictionary, fetcher } = setup();
  fetcher.mockImplementationOnce(() => new Promise(() => {}));
  const failure = expect(dictionary.getDefinition('fixture')).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(1500); await failure;
  // Native WebCrypto is not driven by fake timers. Start the successful retry
  // only after restoring the real clock, so the fake deadline cannot race it.
  vi.useRealTimers(); await expect(dictionary.getDefinition('fixture')).resolves.toMatchObject({ word: 'fixture' });
});
it('does not trust malformed optional publication metadata in legacy imports', () => {
  const translation = { text: '示例', target: 'zh-CN', source: 'magpie', dictionary: { id: 'rememberme-dict', version: '<img>', review: 'human' } };
  expect(isTranslation(translation)).toBe(true); expect(isRememberMeTranslation(translation)).toBe(false);
});
it('keeps WordNet available after reviewed asset failure and skips it on a reviewed hit', async () => {
  const fallback = { getDefinition: vi.fn(async () => ({ word: 'fixture', source: 'wordnet' as const, phonetics: [], meanings: [] })) };
  expect((await lookupPackagedDefinition('fixture', { getDefinition: async () => { throw new Error('bad hash'); } }, fallback))?.source).toBe('wordnet');
  fallback.getDefinition.mockClear(); const { dictionary } = setup();
  expect((await lookupPackagedDefinition('fixture', dictionary, fallback))?.source).toBe('rememberme-dict');
  expect(fallback.getDefinition).not.toHaveBeenCalled();
});
