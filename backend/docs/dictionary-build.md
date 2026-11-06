# SQLite dictionary and batch generation

## Implemented scope

The standalone Node CLI owns an independent SQLite dictionary database. It seeds
versioned word selections, generates bilingual drafts through a private
chat-completions endpoint, resumes interrupted work, records review decisions,
exports drafts for review, preserves immutable approved editions, publishes JSON
shards, and creates verified SQLite backups. Generation/audit commands do not
activate client lookup. A separate packaging step produces reviewed browser
assets; the browser integration is now active for the approved pilot. The live
API routes, account database, Apple lookup providers and legacy wire shape stay
separate from this pipeline.

The pilot selection is [1,000 common spellings](../dictionary/pilot-1000.json),
with [explicit selection limitations](../dictionary/README.md). Generated content
is unreviewed even when JSON and text validation passes. A model can produce a
fluent but factually incorrect example; every record needs an explicit review
decision before a release can be published.

## Build and initialize

Use the Node version in `backend/.nvmrc` and run from `backend/`:

```sh
nvm use
npm ci
npm run dict:build
npm run dict -- init \
  --db data/dictionary/pilot.sqlite \
  --dataset dictionary/pilot-1000.json \
  --model deepseek/deepseek-flash \
  --base-url http://127.0.0.1:3425/v1/
```

The loopback example requires the private gateway on the same host. No gateway
route/group is created or changed. For a different environment, explicitly
select its verified endpoint and model. The URL must be HTTPS, except loopback
HTTP; redirects, URL credentials, queries and fragments are rejected.

`init` makes no provider calls. It prints a build ID; use that ID in subsequent
commands. Repeating an identical initialization is idempotent. A dataset ID
cannot silently change content. A build identity includes the dataset digest,
prompt hash, schema version, endpoint, requested model and persistent limits.
Changed inputs create a new build rather than overwriting an old one. Do not
initialize another build merely to get around a spent budget.

The database has an application ID and separate schema version. Existing
non-dictionary databases are rejected before schema changes or WAL activation.
SQLite uses WAL, foreign keys, FULL synchronous commits, a busy timeout and
`BEGIN IMMEDIATE` for related state changes. Persist the database outside a
release directory; on a server, use a dedicated dictionary data directory owned
by the operator. The CLI sets a private file mask and database mode `0600`.

## Generate and resume

```sh
npm run dict -- run --db data/dictionary/pilot.sqlite --build BUILD_ID \
  --env /absolute/private/dictionary.env --limit 10
npm run dict -- status --db data/dictionary/pilot.sqlite --build BUILD_ID
npm run dict -- run --db data/dictionary/pilot.sqlite --build BUILD_ID \
  --env /absolute/private/dictionary.env --limit 1190 --concurrency 2 --delay-ms 500
```

Use a private environment file with `DICTIONARY_API_KEY`. For this project's
verified personal server, an explicitly provided existing private environment
file may supply `MAGPIE_API_KEY` instead. A supplied file is authoritative; the
CLI never falls back to an inherited key if the file lacks one. Without `--env`,
only the process's `DICTIONARY_API_KEY` is read. Keys stay out of SQLite, logs,
command arguments, repository files and exports.

Only the selected public word is sent with the fixed dictionary prompt. User
history, sentences, page URLs and personal vocabulary are never used. Results
remain inert text; the schema rejects markup/control characters, unexpected
fields, mismatched words, missing Chinese, duplicate senses and oversized
content. Uppercase `I` is normalized only for the input `i`; other case changes
are rejected to avoid conflating `US` and `us`.

Default durable limits per build:

- At most 1,200 provider attempts, across every invocation and restart.
- At most 1,600 requested output tokens per attempt.
- At most 1,920,000 reserved output tokens, including failed/interrupted calls.
- At most three attempts per word; first attempts precede retries.
- Default concurrency one, configurable from one to four; default per-worker
  delay one second. The pilot starts with two workers, then uses four with a 500 ms delay.
- A 60-second provider deadline and a 128 KiB response bound.

Set durable limits at `init` with `--max-requests`, `--max-output-tokens`,
`--output-budget` and `--max-attempts`. `run --limit` caps requests in that
invocation, not successful entries. Output reservations are conservative and
never refunded. These are request/token guards, **not a monetary billing cap**:
input tokens, model prices, reasoning billing and vendor accounting vary.
Reported input/output usage is recorded, and unknown usage remains explicitly
unknown, including calls interrupted after the provider may have processed them.

The CLI journals an attempt before calling the provider. Successful entries
are skipped on resume. A database-wide worker lease prevents separate processes
from generating concurrently; workers within the owner share transactional
reservations. The lease lasts three minutes and renews every 15 seconds.
After an abrupt process loss, wait for lease expiry and rerun the same command.
Interrupted attempts retain their budget charge. A late worker cannot commit
after another worker takes its expired lease. SIGINT/SIGTERM cancels requests
and releases the lease after recording their results.

Transient network, timeout, truncation and schema failures are retryable within
the limits. Authentication/configuration failures or five consecutive failures
stop the run. Resume explicitly after investigating. CLI exit `2` means some
jobs remain pending/failed; exit `1` indicates a command error. A successful
generation run does not certify semantic correctness or publication readiness.

## Data and review

Tables: `datasets`, `builds`, `jobs`, `attempts`, `reviews`, `lease`, `editions`, and
`edition_entries`. Dictionary schema v2 adds the last two tables transactionally
while preserving v1 drafts and attempts.
Each build preserves its own entries. `jobs` holds exact spelling, topic tags,
state, senses, forms, hash and provenance. `attempts` records request counts,
reservations, timings, actual upstream model/provider headers, usage and bounded
error codes. Missing actual-model headers remain unknown; the response's routing
alias is not treated as an actual upstream identity. Response bodies from failed
calls and raw credentials are not retained.

Each sense includes part of speech, simple English definition, Chinese gloss,
original bilingual example and collocations. Sense IDs derive from the spelling
and sense content: unchanged content keeps its ID, while an edited sense gets a
new ID. Forms are generated suggestions requiring review, not trusted lookup
aliases. IPA and exam classifications are not generated.

```sh
npm run dict -- export-drafts --db data/dictionary/pilot.sqlite \
  --build BUILD_ID --out data/dictionary/review-001.jsonl
npm run dict -- review --db data/dictionary/pilot.sqlite --build BUILD_ID \
  --word WORD --hash CONTENT_HASH --decision approved \
  --reviewer REVIEWER --note 'Checked meanings, examples, forms and collocations'
```

Use the exact `contentHash` from the review export. Decisions are `approved` or
`rejected`; reviewer and note are required. A decision must target a current
draft with that hash. Generation never approves its own content. Review history
is append-only through the CLI. Original drafts are not edited in place and rejected drafts are not retried by
`run`. Corrected content is admitted through a separate, explicit reviewed-edition
manifest; the original generation and rejection history remain intact.

```sh
npm run dict -- publish --db data/dictionary/pilot.sqlite --build BUILD_ID \
  --out data/dictionary/releases/RELEASE_ID
```

Publication refuses pending, failed, generating or draft records. It requires
at least one approved entry and explicit decisions for every job; rejected
entries are excluded. It writes a new directory with SHA-256 sharded JSON,
manifest, source selection metadata and review audit. It verifies shard hashes
before renaming the staging directory into place. Existing releases are never
overwritten. No active release pointer is changed. This is a build artifact. The separate approved-edition packaging step below
produces the browser runtime format; Apple local lookup is not changed.

## Backup and verification

```sh
npm run dict -- backup --db data/dictionary/pilot.sqlite \
  --out data/dictionary/backup-001.sqlite
npm run dict -- status --db data/dictionary/backup-001.sqlite --build BUILD_ID
npm run typecheck
npm test -- tests/dictionary-build.test.ts
```

Backup uses `VACUUM INTO` and checks integrity, foreign keys and application ID.
It creates a new file and leaves the source untouched. Opening the backup with
the CLI verifies a usable independent copy. Do not use the account database's
restore script: dictionary data has no account epochs. Local tests use disposable
SQLite databases and injected model responses, without any provider access.

The pilot's live receipt documents actual generation separately from mocked
tests. Only explicit semantic review decisions permit client packaging. The reviewed
pilot is now integrated into the browser through an additive snapshot adapter;
no client receives raw model audit responses as approved dictionary data.

Completed pilot: [1,000-word live execution and backup receipt](verification/2026-11-05-dictionary-pilot.md).

## Independent semantic review and immutable editions

The review CLI is built by `npm run dict:build`:

```sh
node .build/dictionary-audit.mjs \
  --input data/dictionary/frozen-review-input.json \
  --db data/dictionary/review.sqlite \
  --env /absolute/private/dictionary.env \
  --model zhipu/glm-5.3-flash --base-url http://127.0.0.1:3425/v1/ \
  --json-mode true --reasoning high --max-requests 104 --limit 104 --concurrency 2 \
  --out data/dictionary/review.json
```

A frozen input array contains `{ word, inputHash, entry, reference }` per word.
Each hash identifies the exact generated entry; references may include bounded
WordNet clues, which are not treated as an exhaustive lexical authority. The
review prompt requires a verdict and checks for every original sense/example.
Missing coverage, contradictory acceptance, wrong words, malformed revisions and
unresolved uncertainty do not become approvals. JSON mode still needs these
semantic/structural checks; it is not proof of correctness.

The independent audit database has its own application ID, lease, durable batch
attempts and request cap (at most 160 per run). Batches contain up to eight words,
request at most 8,192 output tokens, and have a 180-second deadline. Default
concurrency is two, configurable from one to four. HTTP 429 drains active work,
persists `Retry-After` (60 seconds when absent/unusable), and prevents early resume.
SIGUSR2 drains active requests without starting more; SIGINT/SIGTERM cancels.
Provider/configuration failures stop the run. Completed evidence is reused.

Only harmless formatting differences are normalized: a single JSON fence,
quote/whitespace variants in otherwise identical examples, consistent one-based
sense numbering, and omitted empty fields on explicit accepted results. Verdicts,
reasons, checks and corrections are never synthesized. Private failed-response
content is bounded for diagnosis and excluded from the exported audit report and
client assets. Recovering a complete stored response records `recovered_at` and
keeps its original error and usage ledger; it makes no new provider request.

Model reports are suggestions. An editor must inspect revisions, resolve issues,
and supply a complete decisions file. Direct AI editorial review can also cover
entries, with that method recorded separately. The pilot used calibrated
independent GLM reviews plus Codex direct review and targeted primary-source
cross-checks; it is explicitly AI-assisted, not human expert certification.

```sh
npm run dict -- approve-edition --db data/dictionary/master.sqlite --build BUILD_ID \
  --decisions data/dictionary/decisions.json --evidence data/dictionary/evidence.json
npm run dict -- publish-edition --db data/dictionary/master.sqlite --edition EDITION_ID \
  --out data/dictionary/releases/EDITION_ID
npm run dict:package -- data/dictionary/releases/EDITION_ID NEW_ASSET_DIRECTORY
```

The decisions object has `{ reviewer, method: 'ai-assisted-v1', evidenceHash, items }`.
Every item explicitly supplies `{ word, inputHash, decision: 'approved', entry, note }`;
`entry` is the raw validated dictionary entry shape. The CLI verifies the evidence
file hash. Admission requires every source word exactly once and rejects stale
hashes, incomplete decisions, unchanged rejected drafts, invalid content and the
known deterministic quality defects (false first/last-letter claims and lowercase
personal-I examples). These narrow checks supplement, not replace, semantic review.

An edition stores both original and revised entry text and notes. Its ID derives
from the complete approval packet; repeated identical approval is idempotent.
`status --build BUILD_ID` reports approved editions alongside untouched draft
states. Publishing and packaging never overwrite an existing directory. Stage
future packs into a new directory, review the source-asset diff, then update the
checked-in browser asset directory deliberately. Previous releases and backups
remain available for rollback.

The packer accepts only complete reviewed editions with matching review/content
hashes. It strips private editorial notes from client data and writes the pinned
manifest and shards. The browser checks exact spellings, bytes and SHA-256, then
maps entries into compatible `Definition` snapshots. Publication metadata is
additive; original Magpie generation lineage remains in the legacy translation
provider field. See [the completed review/integration record](verification/2026-11-06-reviewed-dictionary.md).
