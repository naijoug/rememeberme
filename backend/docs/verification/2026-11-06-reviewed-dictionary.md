# Reviewed 1,000-word edition — 2026-11-06

## Outcome

Approved edition `a00fbaf0fcdcf2476b5c825d` contains all 1,000 pilot spellings and
2,850 senses. **203 entries were revised**: corrections include meanings,
examples/translations, forms, collocation alignment, regional labels and selected
missing common senses. This count is not a count of 203 independently measured
factual errors; some revisions improve clarity or compact learner coverage.

The browser now checks the reviewed pack before WordNet and before online Chinese
caches. All 1,000 English/Chinese lookups passed in disposable Chrome with external
lookup traffic blocked. English/Chinese online lookup calls: **zero**. A separate
sentence-explanation capability check was attempted and blocked; the app is not
claimed to be fully offline.

The live account/API deployment was not changed. The independent dictionary master
retains the original 999 draft/one rejected records, the generation ledger and
the new immutable approved edition. Native lookup providers remain unchanged;
current Apple imports and the existing wire format preserve the additive metadata.

## Review evidence and limitations

- 656 entries received complete independent GLM per-sense reviews.
- Codex directly reviewed 392 entries; 48 overlapped the model reviews.
- Their union covers exactly 1,000 entries and all 2,839 original senses.
- Every model-proposed revision was adjudicated; additional direct corrections
  were recorded with the original content hashes. No uncertain decision remains.
- Low-depth calibrations that missed the known `cat`/letter error were rejected.
  Accepted model review used per-sense example checks and high reasoning, with
  deterministic spelling/capitalization guards and direct editorial checks.
- Provider timeouts, format failures and HTTP 429 were recorded. Work resumed
  from checkpoints; rate-limit cooldowns were honored, concurrency reduced, and
  the final active requests drained before direct review closed the remaining gaps.
- Complete stored responses with omitted empty acceptance fields were recovered
  without new calls. Missing verdicts, reasons, sense checks or corrections were
  never fabricated. Truncated or contradictory evidence did not count as approval.

This is **AI-assisted editorial review**, not human expert certification, a
guarantee of error-free content, exhaustive sense coverage, or an official exam
word list. The compact four-sense limit can omit valid secondary uses. Removed
rare forms are not universally claimed to be nonexistent.

The accepted model-review runs made 122 requests; seven additional bounded
calibration requests are not approval evidence. Reported accepted-run usage was
295,997 input and 506,094 output tokens. Twenty-five attempts have incomplete
usage metadata, so these are not billing totals. See the
[structured receipt](2026-11-06-reviewed-dictionary.json).

## Representative corrections and cross-checks

- `a`: replaced the false claim that *cat* starts with *a*; `i`: corrected the
  pronoun examples/collocations and standard-capitalization explanation.
  [British Council capitalization guidance](https://takeielts.britishcouncil.org/blog/capital-letters-in-english-common-errors-and-how-to-fix-them).
- `draw`, `us`, `gate`, `offer`: corrected location or action translations that
  changed the English meaning; `patient`: removed nonstandard learner comparative
  forms; `almond`: distinguished the almond tree from the apricot tree.
- `table`, `pavement`, `chip`: clarified important British/American differences.
  [Cambridge table](https://dictionary.cambridge.org/us/dictionary/english/table),
  [Cambridge pavement](https://dictionary.cambridge.org/us/dictionary/english/pavement?topic=road-surfaces-and-features).
- `wound`: included the homographic past form of *wind* while preserving injury
  meanings. [Cambridge wound](https://dictionary.cambridge.org/us/dictionary/english/wound).
- `option`: distinguished acquiring an option from outright exercising rights.
  [Oxford option](https://www.oxfordlearnersdictionaries.com/definition/english/option_2).
- `tunnel`: removed an unconditional security guarantee; `stress`: corrected the
  mechanical quantity and included pronunciation stress.
  [RFC 2784](https://www.rfc-editor.org/info/rfc2784/),
  [OpenStax stress](https://openstax.org/books/university-physics-volume-1/pages/12-3-stress-strain-and-elastic-modulus).
- `cold`, `flu`, `infection`, `shock`, `depression`, `failure`: clarified ordinary
  versus clinical meanings without turning examples into treatment advice.
  [CDC cold](https://www.cdc.gov/common-cold/about/index.html),
  [NCI infection](https://www.cancer.gov/publications/dictionaries/cancer-terms/def/infection),
  [MedlinePlus shock](https://medlineplus.gov/shock.html),
  [NIMH depression](https://www.nimh.nih.gov/health/publications/depression),
  [NHLBI heart failure](https://www.nhlbi.nih.gov/health/heart-failure).

The cross-checks support selected facts; they do not imply those publishers
certified this dictionary. Examples and revised wording are project editorial
content, not copied dictionary entries.

## Storage and release integrity

- Source build: `e49d8bd831cac4d6caa719c3`.
- Edition/evidence/backup hashes are in the structured receipt.
- Dictionary schema v2 adds `editions` and `edition_entries` without rewriting
  original drafts. Each edition entry retains its original text, original hash,
  revised text/hash and editorial note.
- Approval required all 1,000 exact source hashes and an evidence file whose
  SHA-256 matched the decision packet. Repeated identical approval was idempotent.
- A pre-review master backup was created before the schema/edition update.
  The reviewed backup passed SQLite integrity/foreign-key checks and matched its
  server SHA-256 after download.
- Packaging verified review and content hashes and produced 251 approved shards
  totaling 1,057,860 bytes, plus manifest/notice. Client assets exclude private
  editorial notes and provider credentials.

Local generated artifacts (Git-ignored):

- `backend/data/dictionary/reviewed-1000.sqlite`
- `backend/data/dictionary/reviewed-1000.backup.sqlite`
- `backend/data/dictionary/reviewed-edition/decisions.json`
- `backend/data/dictionary/reviewed-edition/evidence.json`
- `backend/data/dictionary/reviewed-edition/revised-words.json`

The personal server master remains under
`/home/ubuntu/.local/share/rememberme-dictionary/pilot-20261105/`.
Local databases are independent snapshots, not synchronized master replicas.
The partial model audit runs are retained as evidence; the consolidated edition
completes their remaining coverage through direct review. Do not resume them
merely because their individual model-only counts are below 1,000.

## Executed validation

Local Node: `22.22.3`; generation/review host Node: `22.23.2`.

- Extension: 47 files / **411 tests passed**, `npm run compile`, Chrome build.
- Backend: 20 files / **123 tests passed**, typecheck, API and dictionary builds.
- After the final conservative review-default adjustment, its localhost
  cooldown/restart regression and typecheck passed again.
- Real disposable extension → HTTP → SQLite sync harness passed, including the
  new publication metadata and bilingual-example round trip.
- Shared Node contract fixtures and Python JSON Schema fixtures passed.
- Swift native codec: two focused compatibility/import-export tests passed.
- Chrome for Testing `151.0.7922.34`: all 1,000 bilingual lookups, actual selection
  card, literal/local provenance, synthetic save/export/reset/restart passed.
- Existing local feedback service remained healthy and its assets reachable.
- No everyday installed-Chrome update, production-account sync or Apple UI
  acceptance is claimed.

A new timeout test initially raced fake timers against native WebCrypto. The
successful retry now starts after restoring real timers; the complete extension
suite then passed without unhandled rejections. This was a test-clock issue, not
evidence of a production dictionary timeout.

## Verified pre-existing documentation/code differences

1. `frontend/browser-extension/docs/behavior.md` described a 300 ms selection
   debounce, while `entrypoints/content.ts` uses 120 ms. Corrected the document
   to match the implementation.
2. The documented `npm run test:browser` workflow failed because
   `backend/scripts/verify-browser-sync.mjs` supplied only the DEV build constant,
   while `frontend/browser-extension/config/backend.ts` also reads
   `import.meta.env.VITE_CONTEXT_EXPLANATION_ENABLED`. Added that explicit fixture
   constant and reran the HTTP/SQLite workflow successfully.
