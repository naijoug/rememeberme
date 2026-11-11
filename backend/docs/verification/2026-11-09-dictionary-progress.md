# Dictionary completion — 2026-11-09

Completed: **15,434 approved exact spellings / 29,399 senses**, catalog
`627b40fb6ca5ca2e4c763b0e`. The same 16 immutable editions (amended pilot plus
15 expansions) are approved locally and on the personal server. The final
browser source assets are packaged, built and verified in disposable Chrome.
The 256 shards total 12,330,112 bytes, excluding manifest and notices.
The adjacent JSON contains version, coverage, test and backup receipts.

| Pinned category | Approved / supported source words | Missing | Excluded source items |
| --- | ---: | ---: | ---: |
| KET | 1,606 / 1,606 | 0 | 146 |
| CET4 / 四级 | 3,846 / 3,846 | 0 | 3 |
| CET6 / 六级 | 5,406 / 5,406 | 0 | 1 |
| TEM8 / 专八 | 12,197 / 12,197 | 0 | 0 |
| TOEFL / 托福 | 6,970 / 6,970 | 0 | 4 |
| IELTS / 雅思 | 5,038 / 5,038 | 0 | 2 |

These overlapping counts describe the pinned supported single-word lists, not
an exhaustive official exam syllabus or 15,434 distinct lemmas. Excluded phrases,
unsupported spellings/abbreviations and open-ended KET Appendix 1 sets remain
outside the denominators. Source versions and exact exclusions are retained in
the wordlist metadata. No remaining target word lacks an approved entry.

## Review and corrections

Remaining drafts were completed through the authorized Zhipu service, conservative
recovery of retained provider responses, or explicitly attributed editorial
drafts where no usable response remained. Draft admission never grants approval.
Independent semantic results, individual editorial resolutions, input hashes,
provider attempts, routes, errors and budget reservations remain in the ledgers.
Direct review means AI editorial review, not human expert certification.

| Expansion | Independent reviews | Full direct reviews for uncovered words | Entries changed | Senses |
| --- | ---: | ---: | ---: | ---: |
| 05 | 866 | 134 | 205 | 1,947 |
| 06 | 1,000 | 0 | 199 | 2,249 |
| 07 | 998 | 2 | 156 | 1,724 |
| 08 | 912 | 88 | 125 | 1,664 |
| 09 | 1,000 | 0 | 79 | 1,538 |
| 10 | 984 | 16 | 128 | 1,680 |
| 11 | 1,000 | 0 | 109 | 1,564 |
| 12 | 1,000 | 0 | 84 | 1,393 |
| 13 | 998 | 2 | 87 | 1,377 |
| 14 | 1,000 | 0 | 73 | 1,286 |
| 15 | 434 | 0 | 59 | 680 |

The sixth expansion's 1,000 independent reviews comprise 758 retained original
results and 242 separately budgeted supplemental results (27 attempts).
A provisional packet was refused because it accepted “apple starts with p”;
the corrected v2 packet uses pen. The refused packet was never published.
The 16 uncovered words in part 10 had recorded HTTP400 failures and explicit
hash-bound deferrals; deferral did not inflate independent coverage or approve
anything. Part 13's two uncovered words, alias and surrealist, received complete
direct entry review. All proposed revisions and mandatory watchlist concerns
were individually adjudicated, including rejecting incorrect model suggestions.

Final corrections include natural Chinese translations, separate unrelated
senses, appropriate inflections, examples that demonstrate the headword and
usage labels for dated or offensive terms. Specialized facts were checked
against primary sources: water hardness ([USGS](https://www.usgs.gov/water-science-school/science/hardness-water)),
inspiratory whoop ([CDC](https://www.cdc.gov/pertussis/signs-symptoms/)),
electrochemical cathode ([IUPAC](https://goldbook.iupac.org/terms/view/C00905/plain)),
Mesozoic boundaries ([ICS](https://stratigraphy.org/ICSchart/ChronostratChart2024-12.pdf)),
and prorogation ([UK Parliament](https://www.parliament.uk/site-information/glossary/prorogation/)).
Terminology checks include [AIATSIS](https://aiatsis.gov.au/explore/first-peoples-australia)
and [UAF](https://www.uaf.edu/anlc/research-and-resources/resources/archives/inuit_or_eskimo.php).
These targeted checks do not establish that arbitrary semantic errors are absent.

## Recovery behavior

Exact echoed words in indexed audit patches are accepted; wrong identifiers,
ambiguous indexes, missing checks and substantive unknown fields still fail.
Resume recovers only complete reviews from retained partial/invalid responses,
using the original attempt's requested words and profile. Results are not
overwritten, and recovery makes no new request or budget refund.

Generation can discard reference echoes only if they exactly match pinned
reference fields, and unknown metadata only if empty. Conflicting references,
nonempty warnings and ambiguous nested entries still fail. Successful recoveries
retain raw-response provenance. The initial attempt to change a wrapper to
8-word requests did not match its command text and still used 16; that was
reported and corrected before the verified eight-word continuation. Original
request counters were not reset.

A separately bounded Flash patch calibration recovered only 16 of 32 controls
and had a timeout. It was not adopted as a replacement for the full GLM review
route. Calibration and production ledgers remain separate.

## Verification and integration

- Node 22.22.3: backend **153/153 tests**, typecheck and dictionary build passed.
  The first sandboxed run had seven loopback-listen EPERM failures; the same
  complete suite passed with loopback permission.
- Final extension checks: **20/20 targeted tests**, compile and Chrome build
  passed. These cover learner lookup, translation precedence, category index,
  badges, saved-word filtering and unchanged vocabulary. Earlier helper testing
  recorded 12 Python tests and four disposable nested-response extraction cases.
- All final shard byte counts/hashes, approved statuses and list membership
  counts passed. Every entry in the preceding 12,000-entry catalog is unchanged
  at the complete entry-content level.
- Disposable **Chrome 151.0.7922.34** checked all **15,434 English and Chinese
  lookups**, the actual selection card's bilingual examples, and synthetic
  save/export/reset/restart. There were **zero external dictionary/translation
  requests** and no lookup-induced vocabulary writes. One independent sentence
  explanation capabilities request was attempted and blocked by the harness.
- The selection screenshot was inspected. Captures remain local under
  `frontend/browser-extension/.qa/learner-dictionary/`; they are not repository
  artifacts. The already-running local feedback service reports reachable
  Chrome development assets. No second watcher or everyday-profile reinstall
  was performed.
- No everyday installed-profile update, authenticated production sync or Apple
  UI acceptance is claimed. The existing additive snapshot/JSON compatibility
  contract is retained; no new provider enum or sync schema was introduced.

## Final backups

Both CLI-created SQLite backups passed integrity and foreign-key checks. Paths
are local operational records, not files available in a fresh clone.

- Personal server: `expansion-10000-20261106/final-15434-approved-20261109.sqlite`
  under `/home/ubuntu/.local/share/rememberme-dictionary/`;
  SHA-256 `d1810e152af784ea45b8223f02444693ffdbe49909eaa2520718c4ec6143b8fb`.
- Local: `backend/data/dictionary/final-15434-approved-local-20261109.sqlite`;
  SHA-256 `8d4251c4253fd2b8d8b01541e8b0249c3ce77f42ccf76ca7248e75e147d03127`.

The server master, all original drafts and review ledgers remain available.
Backend master data stays separate from user vocabulary and account/sync data.
This work is left on `main`, without a new commit, push or deployment.

## Verified documentation/code discrepancies resolved

- `backend/docs/dictionary-build.md` described the active browser integration as
  the pilot, while `frontend/browser-extension/public/dictionary/rememberme/manifest.json`
  already contained a composed 5,000-entry catalog at the start of this
  continuation. The guide now describes a catalog of pilot and expansion
  editions and links to the current count. Historical dated receipts stay historical.
- `backend/docs/dictionary-build.md` described `translation.source = 'magpie'`
  as original generation lineage, while
  `frontend/browser-extension/services/learner-dictionary.ts` assigns that value
  even to editorial drafts. The guide now identifies it as a legacy wire/native
  compatibility value and points to actual publication metadata in
  `translation.dictionary`.
