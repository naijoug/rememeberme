import { existsSync, readFileSync } from 'node:fs';
import { parseArgs, parseEnv } from 'node:util';
import { DictionaryStore } from './store';
import { hash, parseDataset } from './model';
import { DictionaryGenerator } from './provider';
import { runBuild } from './runner';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  db: { type: 'string' }, dataset: { type: 'string' }, build: { type: 'string' }, env: { type: 'string' },
  model: { type: 'string' }, 'base-url': { type: 'string' }, 'max-requests': { type: 'string' },
  'max-output-tokens': { type: 'string' }, 'output-budget': { type: 'string' }, 'max-attempts': { type: 'string' },
  limit: { type: 'string' }, 'delay-ms': { type: 'string' }, concurrency: { type: 'string' }, out: { type: 'string' }, word: { type: 'string' },
  hash: { type: 'string' }, decision: { type: 'string' }, reviewer: { type: 'string' }, note: { type: 'string' },
  decisions: { type: 'string' }, evidence: { type: 'string' }, edition: { type: 'string' },
  help: { type: 'boolean' },
} });
const help = `Dictionary build CLI (separate from the API database)
  init --db PATH --dataset FILE --model MODEL --base-url URL
       [--max-requests 1200 --max-output-tokens 1600 --output-budget 1920000 --max-attempts 3]
  run --db PATH --build ID [--env PRIVATE_ENV --limit 1000 --delay-ms 1000 --concurrency 1]
  status --db PATH --build ID
  export-drafts --db PATH --build ID --out NEW_JSONL
  review --db PATH --build ID --word WORD --hash HASH --decision approved|rejected --reviewer NAME --note TEXT
  publish --db PATH --build ID --out NEW_DIRECTORY
  approve-edition --db PATH --build ID --decisions REVIEWED_JSON --evidence EVIDENCE_JSON
  publish-edition --db PATH --edition ID --out NEW_DIRECTORY
  backup --db PATH --out NEW_SQLITE
Run reads DICTIONARY_API_KEY (or explicitly supplied env file's MAGPIE_API_KEY).
init never calls a provider. run never approves/publishes or touches vocabulary.`;
function required(name: keyof typeof values): string {
  const v = values[name]; if (typeof v !== 'string' || !v.trim()) throw new Error(`--${name} is required`); return v;
}
const number = (name: keyof typeof values, fallback: number) => values[name] === undefined ? fallback : Number(values[name]);
async function main() {
  if (values.help) { console.log(help); return; }
  const command = positionals[0];
  if (positionals.length !== 1 || !['init', 'run', 'status', 'export-drafts', 'review', 'publish', 'backup', 'approve-edition', 'publish-edition'].includes(command)) throw new Error(help);
  process.umask(0o077);
  if (command !== 'init' && !existsSync(required('db'))) throw new Error('Dictionary database does not exist; run init first');
  const store = new DictionaryStore(required('db'));
  try {
    if (command === 'init') {
      const dataset = parseDataset(JSON.parse(readFileSync(required('dataset'), 'utf8')));
      const build = store.initialize(dataset, { model: required('model'), baseURL: required('base-url'),
        maxRequests: number('max-requests', 1200), maxOutputTokens: number('max-output-tokens', 1600),
        outputBudget: number('output-budget', 1_920_000), maxAttempts: number('max-attempts', 3) });
      console.log(JSON.stringify(store.status(build))); return;
    }
    if (command === 'backup') { store.backup(required('out')); console.log(JSON.stringify({ backupVerified: true })); return; }
    if (command === 'publish-edition') { console.log(JSON.stringify(store.publishEdition(required('edition'), required('out')))); return; }
    const build = required('build');
    if (command === 'approve-edition') {
      const decisions = JSON.parse(readFileSync(required('decisions'), 'utf8'));
      if (hash(readFileSync(required('evidence'), 'utf8')) !== decisions.evidenceHash) throw new Error('Review evidence checksum mismatch');
      console.log(JSON.stringify({ edition: store.approveEdition(build, decisions) })); return;
    }
    if (command === 'run') {
      const env = values.env ? parseEnv(readFileSync(values.env, 'utf8')) : {};
      // Explicit file is authoritative; never silently substitute an inherited key.
      const key = values.env ? env.DICTIONARY_API_KEY ?? env.MAGPIE_API_KEY : process.env.DICTIONARY_API_KEY;
      const generator = new DictionaryGenerator(store.config(build), key ?? '');
      const controller = new AbortController();
      const stop = () => controller.abort();
      process.on('SIGINT', stop); process.on('SIGTERM', stop);
      try {
        const report = await runBuild(store, build, generator, { limit: number('limit', 1000), delayMs: number('delay-ms', 1000), concurrency: number('concurrency', 1),
          signal: controller.signal, emit: event => console.log(JSON.stringify(event)) });
        console.log(JSON.stringify(report));
        if (report.states.some(row => ['pending', 'failed', 'generating'].includes(String(row.state)))) process.exitCode = 2;
      } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
    } else if (command === 'status') console.log(JSON.stringify(store.status(build)));
    else if (command === 'export-drafts') console.log(JSON.stringify({ drafts: store.exportDrafts(build, required('out')) }));
    else if (command === 'publish') console.log(JSON.stringify(store.publish(build, required('out'))));
    else if (command === 'review') {
      const decision = required('decision');
      if (decision !== 'approved' && decision !== 'rejected') throw new Error('Invalid review decision');
      store.review(build, required('word'), required('hash'), decision, required('reviewer'), required('note'));
      console.log(JSON.stringify({ reviewed: required('word'), decision }));
    }
  } finally { store.close(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Dictionary command failed'); process.exitCode = 1; });
