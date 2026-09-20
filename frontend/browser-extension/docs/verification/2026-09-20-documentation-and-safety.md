# Documentation and safety verification — 2026-09-20

Scope: working-tree changes based on commit `6cf7be5`, covering documentation reconciliation, local agent guidance, runtime metadata, safe history rendering, background request validation and stale lookup responses.

Environment: macOS (`darwin arm64`), Node `v22.22.3`, WXT `0.20.11`, Vite `7.2.2`, Vitest `4.0.8`. Dependencies already existed locally; a clean `npm ci` was not performed in this run. Package/lock names, versions, dependencies and engines were checked for agreement.

## Executed checks

| Check | Result |
| --- | --- |
| `npm test` | Passed: 8 files, 50 tests |
| `npm test -- tests/content.test.ts` after relocation | Passed: 3 tests |
| `npm test -- components/HistoryItem.test.ts entrypoints/popup/App.test.ts` after template formatting | Passed: 13 tests |
| `npm run compile` | Passed |
| `npm run build` | Passed: Chrome MV3 output |
| `npm run build:firefox` | Passed: Firefox MV2 output |
| `git diff --check` | Passed |
| Local Markdown link and package/lock metadata checks | Passed |
| Archived document body comparison with `HEAD` originals | Passed: all 5 bodies preserved, with archive notices added |

## Regressions reproduced and corrected

- Two new content-flow tests initially failed: an older lookup result replaced the current word, and an older failure replaced a newer success. Request-version checks corrected both failures; the affected tests passed afterward.
- The first build detected the content test as a duplicate WXT entrypoint. Moving it from the top level of `entrypoints/` to `tests/` corrected discovery, and the relocated test and builds passed.
- The first type check rejected the test spy's generic annotation. Using Vitest's `MockInstance<Document['addEventListener']>` corrected it, and the type check passed.
- Mounted component tests verify that imported markup remains text, regex metacharacters are literal, unsafe source URL schemes are not navigable, and popup deletion requires confirmation. The previous popup tests exercised storage without mounting the popup; they have been replaced with component interactions.

## Not executed

All manual cases in [the browser checklist](../testing.md) are **Not run** for this change. No browser version is claimed as runtime-verified. Native context-menu visibility, real browser storage, live dictionary calls, installation, visual layout, packaging archives and store publication were not exercised. Build success and mocked runtime tests do not establish those results.

Product differences such as single-word lookup and click-time context-menu validation remain explicitly tracked in [behavior.md](../behavior.md). This record does not mark those original requirements as satisfied.
