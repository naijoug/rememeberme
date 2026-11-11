# SQLite dictionary and batch generation

## Implemented scope

The standalone Node CLI owns an independent SQLite dictionary database. It seeds
versioned word selections, generates bilingual drafts through a private
chat-completions endpoint, resumes interrupted work, records review decisions,
exports drafts for review, preserves immutable approved editions, publishes JSON
shards, and creates verified SQLite backups. Generation/audit commands do not
activate client lookup. A separate packaging step produces reviewed browser
assets; the browser integration is active for the approved catalog (pilot plus
reviewed expansion editions). See the browser dictionary guide for its current
packaged count and version. The live
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

The offline builder sends the selected public word with the fixed dictionary prompt. Reference-pinned builds also send bounded public ECDICT/WordNet lexical clues; their exact file SHA-256 is part of the build identity. Interactive lookup API requests remain word-only. User
history, sentences, page URLs and personal vocabulary are never used. Results
remain inert text; the schema rejects markup/control characters, unexpected
fields, mismatched words, missing Chinese, duplicate senses and oversized
content. Uppercase `I` is normalized for input `i`. A reference-pinned build additionally accepts the recorded source spelling or title case for keys longer than two letters; arbitrary acronym case folding is rejected. The selector prefers actual lowercase homographs to acronyms.

Default durable limits per build:

- At most 1,200 provider attempts, across every invocation and restart.
- At most 1,600 requested output tokens per attempt.
- At most 1,920,000 reserved output tokens, including failed/interrupted calls.
- At most three attempts per word; first attempts precede retries.
- Default concurrency one, configurable from one to sixteen; default per-worker
  delay one second. The pilot used two/four workers. The initial DeepSeek expansion used twelve after calibration. The user-authorized Zhipu continuation uses two with a 500 ms delay while its independent reviewer also uses two, after shared rate limiting was observed; total durable request budgets do not change.
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
stop the run. HTTP 429 drains in-flight calls, persists Retry-After (60 seconds when absent/invalid), and prevents an early restart. Resume explicitly after investigating. CLI exit `2` means some
jobs remain pending/failed; exit `1` indicates a command error. A successful
generation run does not certify semantic correctness or publication readiness.

## Data and review

Tables: `datasets`, `builds`, `jobs`, `attempts`, `reviews`, `lease`, `editions`, and
`edition_entries`, `catalogs`, `wordlists`, `wordlist_members`, `editorial_drafts`, `generation_routes`, and `generation_batches`. Schema v2 adds immutable editions; v3 adds catalog composition and a persisted provider cooldown; v4 adds versioned word lists, many-to-many memberships and explicit editorial draft provenance; v5 adds immutable model-switch records and per-attempt route IDs; v6 adds shared HTTP batch records and per-word attempt links. Migrations preserve drafts, reviews and attempts transactionally.
Each build preserves its own entries. `jobs` holds exact spelling, topic tags,
state, senses, forms, hash and provenance. `attempts` records request counts,
reservations, timings, actual upstream model/provider headers, usage and bounded
error codes. Missing actual-model headers remain unknown; the response's routing
alias is not treated as an actual upstream identity. Response bodies from failed
calls and raw credentials are not retained.

Each sense includes part of speech, simple English definition, Chinese gloss,
original bilingual example and collocations. Sense IDs derive from spelling, part of speech, and the English/Chinese definitions.
Changing only an example or collocation preserves the sense ID, but changes the
entry content hash. Editing a definition or part of speech changes the sense ID. Forms are generated suggestions requiring review, not trusted lookup
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
unresolved uncertainty do not become approvals. A complete, individually validated
word review can be retained when another word in the response is malformed;
`PARTIAL_AUDIT` records this explicitly, and retries request only remaining words.
Unknown response words reject the response mapping. Identical duplicate records
are collapsed; conflicting copies of a word are all excluded while independently
valid neighboring words remain usable. Batch progress
and the total budget are preserved; partial evidence never becomes a complete edition. JSON mode still needs these
semantic/structural checks; it is not proof of correctness.

The independent audit database has its own application ID, lease, durable batch
attempts and request cap (at most 160 per run). Batches default to eight words; `--batch-size` explicitly selects one to sixteen and is part of the immutable run identity. Requests default to 8,192 output tokens (up to 16,384 explicitly) and have a
300-second deadline. Optional `--temperature` (0–1) is likewise hash-bound, not silently changed on resume. Default
concurrency is two, configurable from one to eight. Use the concurrency supported by the shared provider account; generation and review share capacity, and the live expansion reduces concurrent
work after shared rate limiting. HTTP 429 drains active work,
persists `Retry-After` (60 seconds when absent/unusable), and prevents early resume.
SIGUSR2 drains active requests without starting more; SIGINT/SIGTERM cancels.
Provider/configuration failures stop the run. Completed evidence is reused.

Only bounded formatting differences are normalized: a single JSON fence,
quote/whitespace variants in otherwise identical examples, consistent one-based
sense numbering where no indexed patch is applied, and omitted empty fields on
explicit accepted results. Indexed patches require zero-based checks. The explicit self-correction `ok->issue` is conservatively normalized to `issue`; `issue->ok` remains invalid. Missing verdicts, reasons, checks and corrections are never synthesized. Private model-response
content is bounded and retained for diagnosis and excluded from the exported audit report and
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
additive; `translation.source = 'magpie'` is retained as a legacy wire/native
compatibility value, not the actual generation provider of every entry.
`translation.dictionary` identifies the reviewed publication. See
[the completed review/integration record](verification/2026-11-06-reviewed-dictionary.md).

## Expansion to 10,000 spellings

The checked-in [expansion selection](../dictionary/expansion-10000/selection.json)
contains nine disjoint 1,000-word batches. It preserves the original approved
1,000-word edition. The [selector](../scripts/select-dictionary-expansion.py)
verifies a pinned ECDICT CSV digest and produces bounded public references.
See [source metadata](../dictionary/sources/ecdict.json) and its MIT license.
Source exam tags overlap and are not official/current examination certification.

```sh
python3 scripts/select-dictionary-expansion.py data/dictionary/sources/ecdict-pinned.csv \
  --baseline dictionary/baseline-1000.json \
  --target 10000 --output data/dictionary/new-selection
node .build/dictionary-cli.mjs init --db data/dictionary/master.sqlite \
  --dataset dictionary/expansion-10000/expansion-10000-part-01.json \
  --references data/dictionary/new-selection/expansion-10000-part-01.references.json \
  --model deepseek/deepseek-flash --base-url http://127.0.0.1:3425/v1/ \
  --max-requests 1200 --max-output-tokens 2048 --output-budget 2457600
```

Use the same `--references` file for `run`; missing or changed references fail
before a request. Frozen selections are inputs, **not approved dictionary entries**.
Each batch still needs independent semantic review, editorial resolution and a
complete hash-bound decisions manifest before `approve-edition`.

After all batches are approved, compose them with the existing approved base:

```sh
node .build/dictionary-cli.mjs publish-catalog --db data/dictionary/master.sqlite \
  --editions BASE_EDITION,APPROVED_PART_01,APPROVED_PART_02 --out data/dictionary/releases/NEW_CATALOG
npm run dict:package -- data/dictionary/releases/NEW_CATALOG NEW_ASSET_DIRECTORY
```

Supply every approved component (the example is abbreviated). Catalog composition
rejects overlapping words and unapproved/unknown editions, preserves per-entry
content hashes and review provenance, and derives a stable catalog version from
the sorted components. Packaging carries the ECDICT attribution/license. It
does not activate assets automatically. Verify exactly 10,000 unique words, all
base content hashes unchanged, and local lookup before replacing browser source
assets. The browser acceptance script defaults to the packaged manifest count;
set `REMEMBERME_EXPECTED_WORDS=10000` to pin the expected expansion size.

## Exam categories and missing-word coverage

The selected six-list expansion is complete: 15,434 reviewed keys, with zero
missing supported words in each pinned list. For this complete catalog use
`REMEMBERME_EXPECTED_WORDS=15434` in browser acceptance. The preceding section
records the initial 10,000-word milestone. See the
[completion receipt](verification/2026-11-09-dictionary-progress.md) for exact
versions, exclusions and validation.

Categories are independent versioned word lists: `ket`, `cet4`, `cet6`, `tem8`,
`toefl`, and `ielts`. The same spelling can belong to several lists; membership
does not duplicate entries or alter their content hashes. Membership is based
on pinned sources, never guessed by a generation model or inherited from a
supposed difficulty hierarchy. See `dictionary/categories/selection.json` and
`dictionary/sources/wordlists.json` for exact scope and source limitations.

KET uses the August 2025 Cambridge alphabetical headword index with spelling
variants expanded. Phrases, unsupported spellings and abbreviations are retained
as excluded items, and the open-ended Appendix 1 word sets are outside this
finite index. Other lists are source-provided study lists/tags, not current
official examination syllabi. Single-word coverage never means every possible
examination word or phrase is covered.

```sh
node .build/dictionary-cli.mjs import-wordlists --db data/dictionary/master.sqlite \
  --input dictionary/categories/wordlists.json
node .build/dictionary-cli.mjs wordlist-coverage --db data/dictionary/master.sqlite \
  --wordlists ket-cambridge-2025-alphabetical-v1,cet4-ecdict-39cfb967-v1
```

Coverage distinguishes immutable approved-edition words, queued/unapproved
words, and missing words, with exact missing lists and unsupported source items.
The additional generation plan is the deduplicated union minus the existing
10,000-word selection, not a claim that those 10,000 are already approved.
Pass all selected `--wordlists ID,...` to `publish-catalog`; their digests become
part of the catalog identity. Packaging verifies the wordlist checksum and emits
per-category target/covered/missing counts with only approved covered words.

For a failed job with no draft, `supply-editorial-draft --entry FILE --reviewer
EDITOR --note REASON` can supply an explicit AI editorial draft. It preserves
every failed attempt and charged budget, records the editor and reason, sets
provider/model attribution to unknown, and does **not** approve the entry. It
cannot overwrite a successful draft or approved content. The supplied draft
still requires the same independent semantic audit and edition approval.

### Authorized model recovery

`run --model MODEL --note REASON` records an explicit alternative model for the
same build and gateway. It preserves the dataset, references, prompt, existing
drafts, per-word attempt counters, request cap and reserved-output budget. Each
new attempt points to its recorded route; original attempts/configuration remain
unchanged. A billing-blocked HTTP 402 word becomes eligible under the alternative
model only while its original attempt limit permits. A model switch cannot
replenish a spent budget or approve content. The 2026-11-06 expansion switched to
`zhipu/glm-5.3-flash` after the user explicitly chose the existing Zhipu service;
`flashx` calibration returned HTTP 429 and its cooldown was honored.

### Preparing an edition decision file

`python3 scripts/prepare-dictionary-review.py --db MASTER --build ID
--references EXACT_REFERENCES --out NEW_FROZEN_INPUT` exports only a complete
batch and verifies every draft/reference hash. It never uses account vocabulary.

After inspecting every proposed revision and directly covering any missing
audit entries, place explicit `{ inputHash, entry, note }` resolutions in an
adjudications object keyed by word. Then prepare a reviewable manifest:

```sh
python3 scripts/prepare-dictionary-decisions.py --input FROZEN_INPUT \
  --audit AUDIT_REPORT --adjudications EDITORIAL_JSON --reviewer EDITOR \
  --out-prefix data/dictionary/NEW_EDITION_REVIEW
```

The helper fails on stale hashes, unexpected words, missing sense checks or
unresolved revisions/uncertainty. It creates new evidence/decision files and
prints coverage counts, but never opens or approves a database. The separate
`approve-edition` command performs schema/quality checks and hash-bound admission.

The `reasoning` report field records the **requested** gateway setting. Current
[Zhipu parameter documentation](https://docs.bigmodel.cn/cn/guide/start/concept-param)
lists `low`, `high`, and `max` for GLM 5.3. Historical `medium` requests remain
frozen as recorded; the gateway’s effective mapping was not independently
observed. New configurations must use supported settings and pass semantic
controls. JSON-object mode does not enforce the whole schema: local structural
and semantic validation remains mandatory.

Audit recovery can reduce `--request-size` below the original `--batch-size`
without changing frozen inputs, sampling or batch boundaries. Each request still
charges the original request/output ledger. Attempts are counted per actually
requested word, with at most three per word in a run. Legacy attempts without a
word list conservatively count against the whole batch. Already checked words
are omitted, and never-requested words take priority over retries. Physical batch
try counters remain monotonic; splitting a batch does not spend the retries of
words that were never sent. Global caps remain unchanged.

`--max-output-tokens` can reserve 8,192–16,384 tokens per request to recover from
truncated completions. The total reservation cap remains the original
`maxRequests * 8192`, and every old attempt retains its 8,192 reservation. New
attempts persist `reserved_output`; neither unused reported tokens nor failed
requests replenish this ledger. The runner stops before either cap is exceeded.
Thus larger completions trade fewer requests for more output space within the
same budget, without changing prompt/model/sampling or approving partial output.

### Small-batch generation

`run-batch` defaults to eight words and allows at most sixteen per HTTP request. It reserves each word
through the same original `jobs`/`attempts` ledger before sending, so request caps
remain conservative **word-attempt** limits and the total output reservation is
unchanged. The HTTP `max_tokens` is the sum of those word reservations. Existing
successful drafts are skipped, and every failed word retains its retry history.

Each request records its batch prompt hash, model, word-attempt links, reserved
output and actual provider usage in `generation_batches`. Shared token usage is
reported separately in `status.batches`, never divided or multiplied across
word attempts (`status.usage` retains the legacy per-word statistics). Published
provenance identifies the actual batch prompt. Partial responses retain only
individually valid, explicitly named entries; unknown/duplicate word keys or a
truncated response are rejected. Invalid entry content is retained privately for
editorial diagnosis. A persisted rate-limit cooldown stops new requests.

```sh
npm run dict -- run-batch --db MASTER --build ID --references EXACT_REFERENCES \
  --env PRIVATE_ENV --model zhipu/glm-5.3-flash --note AUTHORIZATION_REASON \
  --batch-size 8 --limit 1000 --delay-ms 500
```

Batching creates drafts only. Independent review, explicit correction decisions
and immutable edition approval are still required before packaging.

Batch formatting canonicalization removes duplicate/headword forms, analytic
`more/most/less/least HEADWORD` phrases from the single-word inflection field,
empty extra fields (including empty lists/objects), and title-case inflections of the same lexical stem. It never
invents meanings or examples, drops substantive warnings, or folds arbitrary
acronyms. A nonempty echoed `reference` object may also be stripped when every
field exactly matches the same word's pinned input reference. Changed references,
extra notes and mismatched fields still fail validation. The batch envelope likewise ignores only empty extra placeholders. The original response
stays in the private batch ledger; semantic review is still required.
Interrupted batch records retain their reservations and are
marked interrupted when an expired/free lease is recovered.

Independent audit requests now have a five-minute deadline for larger high-reasoning responses. The lease is still renewed every 15 seconds, and neither the deadline nor concurrency changes reset any request/output reservation.

### Review profiles and explicit continuation

`--profile patch-check-v1` retains complete original per-sense checks but lets
reviewers send bounded field patches for corrections. The parser reconstructs
unchanged content from the frozen entry, rejects conflicting/out-of-range indexes
and validates the complete candidate. It never invents missing review checks.
All revisions still require editorial adjudication before edition approval.
An exact echoed `word` is permitted in an indexed patch; a different word,
unknown fields, conflicting indexes or missing original checks remain invalid.

On resume, retained invalid/partial responses are revalidated against the exact
words requested by that attempt and its recorded review profile. Complete newly
recoverable word reviews are appended without replacing existing results.
Recovery records the original attempt/route and `recovered_at`, preserves raw
content, errors, usage, tries and reservations, and makes no provider call.
`--limit 0` performs this recovery and exports the report without new requests.

After inspecting a provider-policy failure, `--defer-words WORD,WORD
--defer-note REASON` records up to sixteen still-unreviewed words for direct
editorial review. Each word must belong to a recorded, completed HTTP 400 request.
The append-only `audit_deferrals` table binds its frozen input hash, original
attempt and editorial reason. Resume continues other words while preserving all
attempts and reservations. Audit reports continue to count deferred words as
unreviewed. Completing an edition requires a separate full editorial decision
for each deferred word. These records never grant approval or
remove words from the source selection.

`--profile blind-patch-v1` uses the same review contract but sends only the entry
and word to the model. Original lexical references remain frozen in the input
and evidence; withholding them is explicit in the profile and prompt hash.
This supports independent verification without sharing a fallible reference.

A new profile or requested model in an existing audit database requires an
explicit `--profile-note` the first time. `audit_routes`, per-attempt route IDs,
and per-result source attempt/route IDs retain the original and new provenance.
The original run identity, inputs, batch boundaries, sampling and global budgets
remain fixed. A previously recorded route can resume without another note.
`--only-word KEY` limits a diagnostic invocation to that still-unreviewed word
inside the same ledger; it neither approves it nor replenishes attempts.

The decisions helper requires explicit editorial resolutions for the known
reference errata and `dictionary/sources/review-watchlist.json`. An adjudication
marked pending cannot be used to prepare approval evidence.

`run-batch` also honors SIGUSR2: the current shared request completes, all word
results are committed, and the CLI returns a drained status without claiming
more words. Its request deadline is five minutes, including for sixteen words.
