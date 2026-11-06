# Dictionary build workspace

`pilot-1000.json` contains 1,000 unique, lowercase English spellings selected for
the first dictionary pilot. It is an original, LLM-assisted editorial selection:
core function words and common verbs first, then everyday-topic coverage. It is
**not** a corpus-ranked top 1,000, a lemmatized frequency list, an official exam
list, or evidence of a particular reading-coverage percentage. Some spellings
have multiple parts of speech; no automatic merging into other words occurs.

The file records selection rules, topic tags, version and the SHA-256 of the
ordered words (one per line, with a final newline). Array order is generation
priority, not frequency rank. No third-party frequency dataset was copied.
This project-authored selection and topic tags are dedicated under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
That dedication does not assign a license to provider-generated definitions.

Generated entries, SQLite databases, backups and review exports belong in
`backend/data/dictionary/` (ignored by Git), outside deployment release folders.
Do not put these records in the account/sync database or use user vocabulary as
test data. See [the operating guide](../docs/dictionary-build.md).
