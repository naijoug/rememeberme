import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hash, parseEntry } from './model';
import { learnerQualityFlags } from './quality';

/** Only reviewed editions can become shipped assets; drafts and model audit suggestions are not inputs. */
export function packageEdition(releaseDirectory: string, destination: string) {
  const release = resolve(releaseDirectory), target = resolve(destination);
  const manifest = JSON.parse(readFileSync(join(release, 'manifest.json'), 'utf8'));
  if (manifest.sourceId !== 'rememberme-dict' || manifest.schemaVersion !== 1 || !/^[a-f0-9]{24}$/.test(manifest.dictionaryVersion)
    || !Number.isInteger(manifest.count) || manifest.count < 1 || !manifest.files) throw new Error('Invalid reviewed release manifest');
  if (hash(readFileSync(join(release, 'reviews.json'), 'utf8')) !== manifest.reviewsSha256) throw new Error('Review audit checksum mismatch');
  const reviews = JSON.parse(readFileSync(join(release, 'reviews.json'), 'utf8'));
  if (!Array.isArray(reviews) || reviews.length !== manifest.count || reviews.some(r => r.method !== 'ai-assisted-v1' || r.id !== manifest.dictionaryVersion)) throw new Error('Not an approved edition');
  const reviewMap = new Map(reviews.map(r => [r.word, r]));
  if (reviewMap.size !== manifest.count) throw new Error('Duplicate review decisions');
  if (existsSync(target)) throw new Error('Package destination must be new');
  const staging = target + '.tmp-' + randomUUID(); mkdirSync(staging, { recursive: true });
  const words: Record<string, string> = {}, shards: Record<string, { sha256: string; bytes: number }> = {};
  try {
    for (const [file, expected] of Object.entries(manifest.files) as [string, { sha256: string; bytes: number; entries: number }][]) {
      if (!/^[a-f0-9]{2}\.json$/.test(file)) throw new Error('Unsafe shard filename');
      const source = readFileSync(join(release, file), 'utf8');
      if (hash(source) !== expected.sha256 || Buffer.byteLength(source) !== expected.bytes) throw new Error('Release shard checksum mismatch');
      const values = JSON.parse(source), clean: Record<string, unknown> = {};
      if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length !== expected.entries) throw new Error('Shard count mismatch');
      for (const [word, entry] of Object.entries(values) as [string, any][]) {
        const review = reviewMap.get(word);
        if (Object.hasOwn(words, word) || entry.reviewStatus !== 'approved' || !review || review.contentHash !== entry.contentHash
          || entry.provenance?.reviewMethod !== 'ai-assisted-v1' || entry.provenance.evidenceHash !== review.evidence_hash) throw new Error('Entry lacks matching approval evidence');
        const parsed = parseEntry({ word: entry.word, forms: entry.forms, senses: entry.senses.map(({ id: _id, ...s }: any) => s) }, word);
        if (learnerQualityFlags(parsed).length) throw new Error('Unresolved learner quality issue');
        if (hash(JSON.stringify(parsed)) !== entry.contentHash || hash(word).slice(0, 2) + '.json' !== file) throw new Error('Entry content or shard mismatch');
        clean[word] = { ...parsed, contentHash: entry.contentHash, reviewStatus: 'approved' };
        words[word] = file.slice(0, 2);
      }
      const body = JSON.stringify(clean) + '\n'; writeFileSync(join(staging, file), body);
      shards[file.slice(0, 2)] = { sha256: hash(body), bytes: Buffer.byteLength(body) };
    }
    if (Object.keys(words).length !== manifest.count) throw new Error('Release count mismatch');
    const output = { schemaVersion: 1, version: manifest.dictionaryVersion, entries: manifest.count, reviewMethod: 'ai-assisted-v1', words, shards };
    writeFileSync(join(staging, 'manifest.json'), JSON.stringify(output, null, 2) + '\n');
    writeFileSync(join(staging, 'NOTICE.txt'), `Remember Me learner dictionary\nEdition: ${manifest.dictionaryVersion}\n${manifest.count} reviewed English entries.\nAI-generated through Magpie, independently reviewed with AI assistance and editorial checks.\nThis is not an official examination list or a claim of error-free human lexicography.\nOriginal selection and complete review provenance are retained in the project dictionary database.\nExisting WordNet assets are separate and retain their own notices.\n`);
    if (existsSync(target)) throw new Error('Package destination appeared during export');
    renameSync(staging, target); return output;
  } finally { if (existsSync(staging)) rmSync(staging, { recursive: true }); }
}
