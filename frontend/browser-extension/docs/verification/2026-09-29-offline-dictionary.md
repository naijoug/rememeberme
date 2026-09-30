# Local-first dictionary — 2026-09-29

Scope: resolve the user's repeated dictionary timeout by adding a packaged English dictionary before online fallback. Based on `9672649` with existing footer-removal, runtime-inspection and release-preparation edits preserved. No commit or push was performed.

Environment: macOS, Node 22.22.3, WXT 0.20.11, existing local feedback watcher and user's Google Chrome. Browser version was not recorded. No extra npm dependency, API key, remote service or watcher was introduced.

## Reproduction and data

- A host-network curl request for the reported fixture `serendipity` reached its 12-second deadline with HTTP 000 and zero response bytes. Existing UI deadlines correctly exposed the failure; increasing retries would not create a response.
- Retrieved `wordnet-db@3.1.14` from the npm registry and checked its SHA-512 against registry integrity metadata. Only the data and notices were read; no package script was executed.
- Built 82,810 indexed English headwords into 256 shards, totaling 13,834,625 bytes after separating multiple examples with semicolons. Original WordNet 3.0 distribution and 3.1 data notices, attribution and source-integrity metadata are packaged too.
- Online fallback remains for absent words or unavailable local files. No network lookup occurs for a local hit. This does not claim full English-word coverage, pronunciations, Chinese translations, or a wholly offline product.

## Checks executed

- `npm test`: **132 tests passed in 19 files**, including packaged data, local-hit network avoidance, online fallback/recovery and optional source metadata round-tripping beside legacy definitions.
- `npm run compile`: **passed**.
- After refining the generated example separator, `npm test -- services/offline-dictionary.test.ts`: **14 passed**; Chrome and Firefox builds were rerun and passed.
- `npm run build` and `npm run build:firefox`: **passed**, each about 14.09 MB unpacked. Every one of the 260 dictionary/notice/metadata files matches the source bytes in Chrome, Firefox and local-feedback output.
- `git diff --check`: **passed**. The optional release smoke script's assertions were updated for offline hits and current popup text, but that standalone script was not executed.

## Actual installed Chrome checks

Used the existing local selection-test page and installed Remember Me extension, not the component preview. The existing watcher rebuilt source/data edits. No reinstall or second watcher was used.

- Double-clicked `serendipity`. The actual extension card displayed its noun definition, **Offline dictionary · WordNet**, Remember and enabled Forget. A screenshot was inspected in the task.
- Clicked Remember to close without saving, then double-clicked `meticulous`. The card displayed two real adjective senses with examples and offline-source attribution. A screenshot was inspected in the task.
- No real vocabulary was read, imported, saved, reset or deleted. Save/export/import compatibility was verified with disposable mocked storage, not the user's vocabulary.
- The OS/browser network was not disabled; external-network avoidance is established by the local-source implementation and automated request assertions. Browser captures establish real extension activation and successful definitions, not a separately measured request latency or a browser-network trace.
- Native context-menu saving and Firefox runtime were not rerun. The failing online provider was not declared repaired.
