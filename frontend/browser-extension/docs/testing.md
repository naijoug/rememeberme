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
- `services/word-utils.test.ts` and `services/context-extractor.test.ts`: validation, ordinals and sentence extraction.
- `services/context-menu-handler.test.ts`: handler behavior using fake dictionary, storage and tab-message dependencies. This does not exercise a browser's native context menu.
- `services/background-handler.test.ts`: lookup success/failure and rejection of malformed or obsolete messages.
- `components/HistoryItem.test.ts`: real Vue rendering of untrusted text, literal matching and source-link protocols.
- `entrypoints/popup/App.test.ts`: mounted popup and child components, including sorting, delete/cancel, reset and import. Only browser storage is mocked.
- `tests/content.test.ts`: content entrypoint with real DOM selection and popup components, but a mocked browser runtime; reopening, saving and out-of-order lookup responses. Keep entrypoint tests outside the top level of `entrypoints/` so WXT does not discover them as extension entrypoints.

These are not installed-extension E2E tests. A successful build also does not prove runtime browser compatibility, native menu behavior, live API availability or real storage quotas. The project currently has no Playwright or MSW test setup.

## Manual browser checklist

Use a disposable browser profile and fixture vocabulary. Build the target and load the path documented in [README](../README.md). Serve this package locally with `python3 -m http.server 8000 --bind 127.0.0.1`, then open `http://127.0.0.1:8000/test-selection.html`. Live definition checks need internet access. Stop the local server when finished.

Mark each case **Not run**, **Pass**, **Fail**, or **Blocked**, with evidence. The checklist itself does not mean any case passed.

| Case | Expected result |
| --- | --- |
| Select a valid word, close with Remember, then select another | Correct card, position and definition on each selection; Remember does not save |
| Select words in quick succession | Late results and errors do not replace the latest word's definition |
| Click Forget twice for the same word | Count increases twice and both contexts are recorded |
| Select text and open its right-click menu | Remember Me appears; a valid word saves and reports the new count |
| Select multiple words or non-English text, then use the menu | Validation error; no lookup or save |
| Open the context menu without selected text | Remember Me selection item is absent |
| Look up an unknown word or simulate a network failure | Error shown, no word saved |
| Open the toolbar popup, sort, expand, reset, cancel deletion, confirm deletion | Display and stored data agree; reset preserves history and cancel preserves the word |
| Export fixtures, import into an empty disposable profile | Counts and history survive the round trip |
| Import a malformed file | Clear error and existing vocabulary remains intact |
| Import context containing HTML and a non-HTTP(S) URL | Markup displays literally; the URL does not become a link |
| Try a browser-internal or otherwise restricted page | Record the limitation; do not claim all-page support |

## Record an actual run

Create a dated record under `docs/verification/` only after executing checks. Include:

- Date, commit or working-tree description, Node version, OS and browser versions.
- Commands actually run and their results.
- Manual case outcomes and evidence, including blocked or unexecuted cases.
- Failures caused by the change, their fixes, and the affected checks rerun.

The [archived test template](archive/context-menu-test-template.md) has an unfilled date and result boxes. It is historical planning material and provides no verified browser results.

Recorded runs: [2026-09-20 documentation and safety changes](verification/2026-09-20-documentation-and-safety.md).
