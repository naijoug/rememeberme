# Classified dictionary expansion — 2026-11-06

Status: partial rollout; generation and review continue toward **15,434 unique
single-word spellings**. The shipped catalog currently contains **3,000 reviewed
entries / 7,746 senses**, not the full planned coverage.

## Sources and coverage

- KET: pinned August 2025 Cambridge alphabetical headword index (1,606 normalized
  single-word keys; 146 phrase/unsupported entries tracked separately). Open-ended
  Appendix 1 sets are outside this finite index.
- CET4/CET6/TOEFL/IELTS: pinned ECDICT source tag membership, not current official
  examination syllabi.
- TEM8: pinned community list from lslab/words-learner-vscode (12,197 keys).
  `barometre` was corrected to `barometer` using the Cambridge English headword.
- Lists overlap. No difficulty hierarchy is inferred. The union of category lists
  has 15,011 keys; another 423 selected reading/common words are retained.
- The new category plan adds 5,434 unique words beyond the existing 10,000 selection.
  Selection/queued counts do not mean generation or semantic approval is complete.

Exact revisions, hashes, licenses, exclusions and counts are checked in under
`backend/dictionary/sources/`, `backend/dictionary/categories/`, and the accompanying
[structured receipt](2026-11-06-dictionary-categories.json).

## Published review and compatibility

Catalog `f5b41d0c1d6f704900313972` combines original edition
`a00fbaf0fcdcf2476b5c825d` and expansion editions `3b9867b8cbbfd3a72767eff8` and
`215b3bb51300b1f2ff99b7ba`.
The original 1,000 entries remain content-identical. The next 1,000 have 984
independent per-sense GLM 5.3 Flash reviews plus 16 full direct AI editorial
reviews after malformed audit responses. All 44 proposed revisions were
adjudicated; 52 entries changed overall. Review is explicitly AI-assisted, not
human expert certification. Raw drafts, attempts and private evidence are retained
in the independent SQLite master and are not shipped.

Direct adjudication corrected reviewer suggestions as well as generator output:
`potential` now distinguishes electric potential from charge/potential difference
([OpenStax](https://openstax.org/books/university-physics-volume-2/pages/7-2-electric-potential-and-potential-difference));
`Indian` avoids prescribing one universal naming preference
([Smithsonian NMAI](https://americanindian.si.edu/nk360/faq/did-you-know/));
`toss` correctly assigns the innings choice to a captain
([MCC Laws](https://www.lords.org/getmedia/a4ef9f77-2a25-4f5b-a286-4601f08e6334/Laws-of-Cricket-2017-Code-4th-Edition-%282026%29_5.pdf)).

Real disposable Chrome 151 checked all 3,000 English/Chinese lookups: approved
local hits, zero online dictionary/translation calls, no lookup-induced vocabulary
writes. A separate capability GET was attempted; this is not a claim of zero
network activity. Synthetic save/export/reset/restart retained metadata and history.
Agent-browser checked category badges, filtering, source links and coverage rows
in an isolated profile. Local screenshots are under
`frontend/browser-extension/.qa/dictionary-categories/` and
`frontend/browser-extension/.qa/learner-dictionary/`.

Extension: 416 tests and typecheck passed. Backend: all 137 tests and typecheck passed after model-route and partial-audit
changes. Twelve Python selection/review-helper tests passed. Apple’s reviewed-dictionary import fixture
passed (one Swift Testing test). No live authenticated sync or Apple UI check.

## Execution and recovery

DeepSeek returned HTTP 402 after 1,796 new drafts had been retained. The user
explicitly selected the existing Zhipu service. Schema v5 journals each model
switch and attaches it to new attempts, retaining original jobs, successes,
per-word retries and durable request/output reservations. No budget was reset.
FlashX calibration returned HTTP 429; its cooldown was honored. Flash generation
then succeeded. Remaining generation uses `zhipu/glm-5.3-flash`; independent review
uses `zhipu/glm-5.3`. The second expansion used requested medium reasoning;
new audits use supported high reasoning. Low reasoning missed the deliberately
wrong physical definition in the extended controls and was rejected for approval.

The master remains under the personal server’s dictionary directory. Generation
and audit queues stop on provider faults rather than silently retry without bound.
Provider credentials never enter repository artifacts or reports.

## Documentation/code discrepancies resolved

1. `backend/docs/dictionary-build.md` said any edited sense gets a new sense ID.
   `backend/src/dictionary/model.ts` hashes only word/POS/English/Chinese definitions.
   Documentation now states that example/collocation-only edits preserve the sense
   ID while changing the entry hash; the code and original IDs were preserved.
2. The original source-lineage wording in extension dictionary/architecture docs
   no longer described explicit editorial drafts accurately.
   `services/learner-dictionary.ts` retains `translation.source = magpie` for
   compatibility while `Definition.source`/dictionary metadata identify local
   publication. Documentation now describes the legacy value as compatibility
   metadata, not the generator identity of every entry.

A deterministic quality-check bug was also corrected: `a silent K` was parsed
as a claim about the letter `a`. The checker now distinguishes the article from
the letter, with valid/invalid silent-letter regression cases.

The 2,000-word upgrade was also verified in the reused disposable Chrome profile:
old history retained catalog `1e13dd4a3201b38e665d7c3e`, new `state` lookup used
`9180770b093e9ea134815569`, and CET4 filtering showed only the matching fixture
with a `1 of 4` count. Chrome required developer mode for reloading this local
test extension; the everyday user profile was not changed.

Higher combined generation/review concurrency triggered shared Zhipu rate
limiting. Both queues were reduced to two workers. Known HTTP 429 responses
permit at most three cooldown resumes per task-runner invocation, always within
the original durable budgets; other incomplete/failure states stop for inspection.

The second expansion has 924 independent word reviews and 76 full direct
editorial reviews; all 72 proposed revisions were adjudicated, with 118 entries
changed. The 3,000-entry package preserves all previously shipped 2,000 entries
byte-for-byte at the entry-content level.

A third documentation discrepancy was corrected: extension `docs/testing.md`
still said the acceptance harness reads 1,000 entries, while
`scripts/verify-learner-dictionary.cjs` now reads the packaged manifest count.
The guide now describes the actual manifest-driven coverage.

GLM 5.3 high/0.2 at 12 words per request exhausted the 8,192 output-token
limit on real batches. Recovery reduced each request to at most eight words,
retaining the existing 60 valid results, 17 attempts and original 160-request
cap. It does not reset batch tries or infer acceptance from truncated output.
The calibration model missed the deliberately wrong `potential` definition;
known physics reference errors now require direct editorial adjudication.

The eight-word retry still truncated some completions. Subsequent recovery
reserves 12,288 tokens per request within the same original 1,310,720-token
total; the first 21 reservations remain charged at 8,192 each. Later independent
audits use GLM 5.3 Flash/high with the same bounded ledger and semantic gates.
Its 12-item calibration found seven of eight injected errors and accepted all
four clean controls; the remaining known physics error is blocked by the
deterministic guard and mandatory direct adjudication. This is not evidence
that arbitrary semantic errors are all detected.
