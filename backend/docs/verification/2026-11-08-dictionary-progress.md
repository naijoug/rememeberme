# Dictionary continuation — 2026-11-08

Status: work continues toward 15,434 unique selected spellings. The browser
package currently contains 5,000 approved entries / 12,297 senses, catalog
`0ab8942e9e253786b6bde307`. See the adjacent JSON for exact coverage and editions.

The third expansion received 996 independent reviews across two retained audit
ledgers plus four full direct editorial reviews. All proposed revisions were
adjudicated; 187 entries changed. The fourth expansion received 948 independent
reviews plus 52 full direct reviews; 185 entries changed. Each published entry
has a frozen original hash and explicit decision. Direct review is AI editorial
review, not a human certification.

May and Turkey received one additional capitalized proper-name sense each,
because the existing lookup folds input to lowercase. Their original senses,
forms and saved vocabulary snapshots remain intact. Polish now includes the
language and Poland-related meanings. Case folding does not imply that every
possible meaning has been exhaustively catalogued. The new pilot edition
inherits the original 1,000 approvals and explicitly reviews only its two additions.

The provisional 5,000-word export was superseded before local packaging: two
evidence notes incorrectly linked Turkey/Polish to the finite KET alphabetical
list. The corrected v2 notes distinguish common reading meanings from KET
membership; content is identical between these two provisional exports.

Real disposable Chrome checked all 5,000 English and Chinese lookups, selection
card provenance and bilingual examples, and synthetic save/export/reset/restart.
No online dictionary/translation requests or lookup-induced vocabulary writes
occurred. A separate capabilities GET was attempted; this is not zero networking.
No everyday-profile update, live authenticated sync or Apple UI is claimed.

Generation now supports bounded eight-word HTTP batches. SQLite schema v6 keeps
individual word reservations/retries and separately records shared provider
usage and prompt provenance. Raw completed batch content remains private.
Formatting-only recovery does not approve meanings. The initial full backend
suite passed 142 tests; subsequent batch/build regressions passed 35 tests, and
audit HTTP regressions passed two tests. Typecheck passed.

A separate supplemental audit was explicitly budgeted after the user's renewed
continue-to-completion instruction: only 230 uncovered third-batch words were
requested, with an additional 82-request / 671,744-token reservation ceiling.
It completed 226 words in 74 attempts; four were directly reviewed. Original
113 attempts and spent reservations were preserved. Fourth-batch missing words
were directly reviewed, so its planned supplemental requests were not sent.

## Documentation/code discrepancies resolved

- `frontend/browser-extension/docs/dictionary.md` described exact spellings
  without making case folding explicit. `services/learner-dictionary.ts` already
  trims and lowercases input. The guide now states the actual matching behavior;
  May/Turkey/Polish meaning gaps were corrected in immutable reviewed editions.
- Existing historical review records described the old 1,000 or 3,000 snapshots.
  Those records remain historical; the current dictionary guide and this receipt
  name the actual 5,000-word package. This is a version update, not evidence that
  historical test claims were wrong.

Earlier verified discrepancies (sense-ID hashing, legacy magpie attribution,
manifest-driven acceptance counts) and their exact locations remain recorded in
[the November 6 receipt](2026-11-06-dictionary-categories.md).
