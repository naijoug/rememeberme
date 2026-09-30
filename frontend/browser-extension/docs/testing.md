# Verification and browser checklist

Run commands from `frontend/browser-extension/` after the setup in [README](../README.md). Automated tests use happy-dom and disposable browser/storage mocks. They have no production access and do not call the live dictionary API.

## Choose checks for the change

| Change | Verification |
| --- | --- |
| Prose or links only | Review changed facts and resolve local links; no application test suite required |
| Service logic | Run the affected test files and `npm run compile`; add cases for changed behavior or reproduced bugs |
| Vue behavior or rendering | Mount the affected component, exercise its interactions and run `npm run compile` |
| Content/background entrypoints, messaging, runtime or build configuration | Relevant tests, `npm run compile`, a Chrome build, and browser checks for affected flows when available |
| Release or cross-browser behavior | Complete suite, Chrome and Firefox builds, then record actual browser checks for each claimed target |

For example: `npm test -- components/HistoryItem.test.ts`. Run `npm test` for shared changes spanning several flows. Repeat or broaden verification when changes or failures justify it; passing checks do not need repeated runs without a reason.

## What the automated tests establish

- `services/storage.test.ts`: import/export, merging and invalid-data rejection using mocked WXT storage.
- `services/storage-concurrency.test.ts`: overlapping saves, mixed mutations/reads and recovery after write/import failures. Storage reads/writes clone values to model independent browser storage snapshots.
- `services/storage-client.test.ts`: real client, background handler and storage service over a mocked message transport; simultaneous page requests and context-menu writes, completed-write acknowledgements and failures without local fallback.
- `services/word-utils.test.ts` and `services/context-extractor.test.ts`: validation, ordinals and sentence extraction.
- `services/context-menu-handler.test.ts`: handler behavior using fake dictionary, storage and tab-message dependencies. This does not exercise a browser's native context menu.
- Context-menu regression tests cover connection checks before dictionary requests, frame/URL targeting, one local reconnect attempt, restricted-page rejection, and toolbar fallback without duplicate saves. `services/context-menu-status.test.ts` checks action/browserAction badge/title calls using mocks.
- `services/dictionary.test.ts`: local-hit network avoidance, online fallback after local failure, mocked slow responses, deadlines covering stalled JSON bodies, coalesced requests, network-error recovery and non-retried 404/429 responses. Live service access is a separate diagnostic, not part of automated tests.
- `services/offline-dictionary.test.ts`: real packaged data for the reported word and other fixtures, verified regular word forms, exact-match priority, part-of-speech checks, index/shard completeness, sense ordering/examples, bounded full local lookup and failed-read recovery; fetch reads disposable local fixtures with no external network access.
- `services/background-handler.test.ts`: lookup success/failure, vocabulary request validation and legacy imported-word compatibility.
- `components/HistoryItem.test.ts`: real Vue rendering of untrusted text, literal matching and source-link protocols.
- `entrypoints/popup/App.test.ts`: mounted popup and child components, including sorting, search, reading-view navigation, theme persistence, delete/cancel, reset and import, using the real background handler with mocked transport and storage.
- `components/WordList.test.ts`: bounded virtual rows, scrolling to the final word, selection into a separate reading view and list replacement. Details no longer expand within virtual rows.
- `components/SelectionPopup.test.ts`: viewport clamping/flipping, loading-save restrictions and retry affordances using mocked geometry.
- `services/theme.test.ts`: system preference changes, cross-surface storage notifications, stale initial-read protection, separate preference storage and cleanup after extension invalidation.
- `components/HighlightedText.test.ts`: literal untrusted examples and malformed legacy optional example values.
- `tests/content.test.ts`: content entrypoint with real DOM selection and popup components, but a mocked browser runtime; ShadowRoot isolation, reopening, saving, out-of-order responses, UI deadline/retry, Escape, duplicate-save protection and theme updates. Keep entrypoint tests outside the top level of `entrypoints/` so WXT does not discover them as extension entrypoints.
- Content tests also exercise the real WXT context's invalidation and reinjection cleanup (with deterministic postMessage delivery). `services/local-feedback.test.ts` covers script registration/replacement without tab reloads, restricted-tab failures and server reconnection with mocked browser/WebSocket APIs.
- `scripts/local-feedback-health.test.mjs`: a registered job with `state = not running` / exit code 0 is recovered, healthy jobs are reused, permission failures are not mistaken for absent jobs, and both popup development assets must be reachable as JavaScript. These tests do not start real LaunchAgents or enable browser extensions.

These are not installed-extension E2E tests. A successful build also does not prove runtime browser compatibility, native menu behavior, live API availability or real storage quotas. The project currently has no Playwright or MSW test setup.

## Manual browser checklist

Use a disposable browser profile and fixture vocabulary. Build the target and load the path documented in [README](../README.md). Serve this package locally with `python3 -m http.server 8000 --bind 127.0.0.1`, then open `http://127.0.0.1:8000/test-selection.html`. Packaged definitions need no external network; live online-fallback checks need internet access. Stop the local server when finished.

Mark each case **Not run**, **Pass**, **Fail**, or **Blocked**, with evidence. The checklist itself does not mean any case passed.

| Case | Expected result |
| --- | --- |
| Select a valid word, close with Remember, then select another | Correct card, position and definition on each selection; Remember does not save |
| Select words in quick succession | Late results and errors do not replace the latest word's definition |
| Click Forget twice for the same word | Count increases twice and both contexts are recorded |
| Save fixture words concurrently from two pages and the context menu | Every save survives; same-word counts/history include every successful operation |
| Interleave a fixture import, reset, delete and save | Final state follows the background's queue order; unrelated entries survive |
| Select text and open its right-click menu | Remember Me appears; a valid word saves and reports the new count |
| Select multiple words or non-English text, then use the menu | Validation error; no lookup or save |
| Open the context menu without selected text | Remember Me selection item is absent |
| Select `serendipity` when the external dictionary is unavailable | Real packaged definition with Offline dictionary · WordNet attribution; no remote dictionary request |
| Select Having, then close and select it again | Offline `have` verb definition, Having title and Base form: have caption; no Vue attribute warning; saving retains the selected word |
| Look up a word absent from the local index and fail its online request | Retryable error shown, no word saved |
| Right-click on a page without a receiving script, or navigate away during lookup | Connection checked before lookup; feedback mode retries page connection once; toolbar fallback preserves the original failure or completed-save result |
| Open the toolbar popup, sort, open a word, reset, cancel deletion, confirm deletion | Display and stored data agree; reset preserves history and cancel preserves the word |
| Load over 100 fixture words, open a long history, go back and scroll to the final word | Detail scroll does not affect virtual rows; list position restores on back and the last word is reachable |
| Switch Light / Dark using the toolbar header sun/moon button | Toolbar and open page card update consistently; the choice persists without changing vocabulary; no footer theme selector appears |
| Stop an online fallback response for a word absent from the local index | Within 10 seconds the loading UI becomes a retryable error; Forget remains unavailable without a definition |
| Delete a word after scrolling deep into a large vocabulary list | Confirmation covers the viewport; cancel preserves the entry and confirm deletes it |
| Export fixtures, import into an empty disposable profile | Counts and history survive the round trip |
| Import a malformed file | Clear error and existing vocabulary remains intact |
| Import context containing HTML and a non-HTTP(S) URL | Markup displays literally; the URL does not become a link |
| Try a browser-internal or otherwise restricted page | Record the limitation; do not claim all-page support |
| Load the local feedback build, keep text in a page input and edit a content source | New behavior appears without a page reload or duplicate selection/save listeners; input and scroll position survive |
| Stop/restart the local feedback server | The extension reconnects; the popup and subsequent content updates work again |

## Record an actual run

Create a dated record under `docs/verification/` only after executing checks. Include:

- Date, commit or working-tree description, Node version, OS and browser versions.
- Commands actually run and their results.
- Manual case outcomes and evidence, including blocked or unexecuted cases.
- Failures caused by the change, their fixes, and the affected checks rerun.

The [archived test template](archive/context-menu-test-template.md) has an unfilled date and result boxes. It is historical planning material and provides no verified browser results.

Recorded runs: [2026-09-20 documentation and safety changes](verification/2026-09-20-documentation-and-safety.md), [2026-09-22 concurrency and large lists](verification/2026-09-22-concurrency-and-large-lists.md), [2026-09-22 local feedback](verification/2026-09-22-local-feedback.md).

Latest error-handling run: [2026-09-29 dictionary and page-connection errors](verification/2026-09-29-dictionary-and-page-errors.md).

Local service recovery: [2026-09-29 local Chrome service recovery](verification/2026-09-29-local-service-recovery.md), including real everyday-Chrome observations and the remaining extension-enable step.

Paper & Sage redesign: [2026-09-29 UI, themes and lookup states](verification/2026-09-29-paper-sage.md), including actual light/dark visual comparisons, automated checks and remaining installed-extension browser gaps.

Local-first dictionary: [2026-09-29 packaged WordNet and online fallback](verification/2026-09-29-offline-dictionary.md), including real installed-Chrome lookups for serendipity/meticulous, packaged-data checks and legacy backup compatibility.

Repeated warning inspection: [2026-09-30 GitHub warning records and Having lookup](verification/2026-09-30-warning-records-and-word-forms.md).
