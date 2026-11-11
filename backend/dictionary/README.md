# Dictionary build workspace

`pilot-1000.json` contains 1,000 unique, lowercase English spellings selected for
the first dictionary pilot. It is an original, LLM-assisted editorial selection:
core function words and common verbs first, then everyday-topic coverage. It is
**not** a corpus-ranked top 1,000, a lemmatized frequency list, an official exam
list, or evidence of a particular reading-coverage percentage. Some spellings
have multiple parts of speech; no automatic merging into other words occurs.

The file records selection rules, topic tags, version and the SHA-256 of the
ordered words (one per line, with a final newline). Array order is generation
priority, not frequency rank. No third-party frequency dataset was copied into this pilot selection.
This project-authored selection and topic tags are dedicated under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
That dedication does not assign a license to provider-generated definitions.

Generated entries, SQLite databases, backups and review exports belong in
`backend/data/dictionary/` (ignored by Git), outside deployment release folders.
Do not put these records in the account/sync database or use user vocabulary as
test data. See [the operating guide](../docs/dictionary-build.md).

`expansion-10000/` adds 9,000 exact spellings disjoint from the pilot. Its pinned
ECDICT source, license and limitations are in `sources/`. Selection prioritizes
source CET4/CET6 tags, frequent reading words and then IELTS/TOEFL tags; source
tags overlap. These are not official examination lists or 10,000 distinct lemmas.
The expansion uses the upstream MIT license; the pilot's CC0 statement does not
relicense third-party data. Lexical references remain reproducible ignored build
inputs, and no new selection becomes a shipped entry before semantic approval.

`categories/wordlists.json` stores independent, versioned KET / CET4 / CET6 /
TEM8 / TOEFL / IELTS memberships. They overlap; no lower-level inheritance is
inferred. `categories/selection.json` records 5,434 additional single-word keys
beyond the first 10,000-word selection (15,434 total). Unsupported source phrases
and abbreviations remain explicit exclusions. `baseline-1000.json` pins the
original pilot selection for reproducible generation after the active browser
manifest changes. The source spelling `barometre` was corrected to `barometer`,
with the evidence link recorded in source metadata.

Reproduce with `pdftotext -raw` on the pinned Cambridge PDF, then run
`scripts/build-dictionary-wordlists.py --sources data/dictionary/sources
--baseline dictionary/baseline-1000.json --existing-selection dictionary/expansion-10000
--out data/dictionary/NEW_SELECTION` from `backend/`. Raw reference files, PDFs
and generated draft/review data remain ignored.

The full 15,434-key plan is reviewed and packaged as of 2026-11-09, with zero
missing supported keys in each of the six pinned lists. See the
[completion receipt](../docs/verification/2026-11-09-dictionary-progress.md) for
coverage, exclusions, review limits, backup hashes and browser evidence.
