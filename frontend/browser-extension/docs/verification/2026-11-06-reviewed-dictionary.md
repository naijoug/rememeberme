# Reviewed local dictionary acceptance — 2026-11-06

Edition `a00fbaf0fcdcf2476b5c825d` contains 1,000 exact spellings and 2,850 senses.
203 entries changed after AI-assisted review. Original drafts and all approval
evidence remain in the independent backend dictionary database. This is not human
expert certification or exhaustive dictionary coverage.

## Observed behavior

- English and Chinese hits use the same approved packaged entry before WordNet
  or older online translation caches.
- All 1,000 bilingual queries passed in a fresh Chrome for Testing profile with
  external lookup calls blocked. Online dictionary/translation requests: **0**.
- The actual closed-shadow selection card showed Local dictionary · Remember Me
  and bilingual examples. All compact senses remain accessible by scrolling.
- Synthetic save, legacy export, count reset and process restart preserved
  edition/version/hash metadata, examples and history.
- A separate sentence-explanation capability check was attempted. No claim is
  made that the entire extension is offline.

## Checks

- Node `22.22.3`; Chrome for Testing `151.0.7922.34`.
- Extension: 47 files / 411 tests passed; typecheck and production Chrome build.
- Backend: 123 tests passed; real disposable HTTP/SQLite sync round trip passed.
- Native codec: two focused import/export compatibility tests passed.
- Shared Node and JSON Schema fixtures passed.
- The already-running local feedback service remained healthy; no second watcher
  or user-profile reinstall was used.

`scripts/verify-learner-dictionary.cjs` used an isolated profile and a copy of the
production build. Its local-only screenshot is `.qa/learner-dictionary/selection.png`;
the local machine receipt is `.qa/learner-dictionary/receipt.json`. These files are
not available in a fresh clone. The screenshot was inspected for source labels,
bilingual-example rendering, wrapping and the bounded scrolling card.

The [structured receipt](2026-11-06-reviewed-dictionary.json) records the browser
results. The [complete review record](../../../../backend/docs/verification/2026-11-06-reviewed-dictionary.md)
records review coverage, revisions, source checks, backups and known limitations.

The actual everyday installed Chrome loading state, production-account sync and
Apple UI were not exercised. Existing snapshots are not silently rewritten.

## Differences corrected

The selection-debounce description in `docs/behavior.md` was 300 ms, but
`entrypoints/content.ts` uses 120 ms; the document now matches the code. The
documented backend browser-sync harness also needed an explicit
`VITE_CONTEXT_EXPLANATION_ENABLED` build constant to match `config/backend.ts`;
the harness was repaired and passed. The first full extension run exposed a
fake-timer/WebCrypto race in the new test; restoring the real clock before its
successful retry fixed the test, and all 411 checks passed afterward.
