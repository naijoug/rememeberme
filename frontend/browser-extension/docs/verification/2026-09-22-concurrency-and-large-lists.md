# Vocabulary concurrency and large-list verification — 2026-09-22

Scope: working-tree changes based on `bbb4dd0`. Route vocabulary operations through the background queue, retain all concurrent saves, and measure expanded virtual-list rows. Preserve JSON backup compatibility, count-reset history and deletion confirmation.

Environment: macOS, Node `v22.22.3`, WXT `0.20.11`, Vite `7.2.2`, Vitest `4.0.8`. Dependencies came from the clean `npm ci --prefer-offline --no-audit --no-fund --fetch-retries=0 --fetch-timeout=20000` run earlier in this session; dependency manifests did not change. Browser fixture checks used an isolated Chrome context (reported user agent: Chrome `153.0.0.0`).

## Executed checks

| Check | Result |
| --- | --- |
| New concurrency tests before the fix | Reproduced 3 failures: lost distinct word, lost same-word increment/history, and overlapping save/reset/delete/import/read results |
| New large-list tests before the fix | Reproduced disappearing long detail at the beginning/middle, stale expanded height, and confirmation inside translated rows |
| `npm test` after implementation | Passed: 11 files, 73 tests |
| `npm run compile` | Passed |
| `npm run build` | Passed: Chrome MV3 |
| `npm run build:firefox` | Passed: Firefox MV2 |
| `git diff --check` | Passed |

Storage tests use cloned, disposable snapshots rather than shared object references. They cover queue ordering, reads after earlier mutations, write/import failures without poisoning the queue, save acknowledgements after persistence, and message failures without local fallback. Client integration tests combine the actual client, handler, storage service and context-menu handler over mocked browser transport/storage.

## Chrome layout and fixture interactions

Served the actual popup component, its child components and CSS from a temporary Vite harness at `http://127.0.0.1:5186/`. The harness routed the actual storage client to the actual background handler/service, replacing browser storage with an in-memory cloned map. It used 200 disposable entries and 80 history records on the first entry. No user vocabulary or live dictionary requests were used.

| Case | Observed result |
| --- | --- |
| Initial collapsed list | Row height 70 px; scroll area 496 px high; total scroll height 14,000 px |
| Scroll through long expanded history | Expanded row height 15,166 px; at scrollTop 7,583 the word and all 80 history records remained mounted; only 6 vocabulary rows rendered |
| Scroll to the last word | `word-199` visible; measured gap below the last row was 0 px |
| Switch from an earlier long expansion to `word-195` | Clicked header stayed at viewport y=250 px; no shift |
| Open deletion confirmation after deep scrolling | Overlay covered the viewport and was outside translated rows; visually inspected the dialog and buttons |
| Cancel then confirm deletion | Cancel retained the entry; confirming removed it |
| Submit 20 overlapping saves through the fixture client | Count increased from 200 to 220; history increased from 80 to 100 |
| Console after interactions | No warnings or errors |

These establish actual Chrome layout and component interactions with a simulated transport/storage layer. They are **not installed-extension E2E checks**. The temporary page and server were closed after verification.

## Not executed

Installed-extension messaging across real tabs, native context-menu interaction, real browser storage, service-worker restarts, live dictionary availability and Firefox runtime checks were not executed. No store publication or distribution-archive validation is claimed. The full [manual browser checklist](../testing.md) remains necessary before claiming release readiness.

After reloading an updated extension, reload existing webpages to replace older content scripts that still use direct storage writes. The operation queue is in memory and does not provide durable transactions or automatic mutation retries.
