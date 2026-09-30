# Installed local extension error inspection — 2026-09-29

Environment: macOS, Node 22.22.3, WXT 0.20.11, user's existing Google Chrome profile. The working tree advanced to `9672649` during inspection; existing release-preparation edits were preserved. Dependencies were already installed and the running watcher was reused.

## Observed errors and recovery

- Computer use opened the actual **Remember Me · Local** Errors view. Initially it contained four Vue warnings about undeclared `context, theme` attributes forwarded to `IconoirProvider`, and one uncaught `Extension context invalidated` error at `content-scripts/content.js:8838`, the storage listener removal operation.
- The extension was disabled. The current source already explicitly passes declared popup props, applies theme on the wrapper, and catches invalid-context errors during theme listener cleanup. Those runtime fixes were already present; this inspection did not rewrite them.
- Enabled and reloaded the existing extension from its existing `.output/chrome-mv3-feedback` path. Chrome confirmed **On, extension enabled** and **Reloaded**. No reinstall, second watcher, vocabulary mutation, or broad webpage refresh was performed.
- Added a content regression test covering a lookup followed by a dark-theme update without Vue warnings or leaked `context/theme` DOM attributes. Added troubleshooting guidance distinguishing retained error records from current behavior.

## Executed checks

- `npm run local:status`: healthy; both development assets reachable. The initial sandboxed check could not reach localhost; the host-network check succeeded.
- `npm test -- tests/content.test.ts services/theme.test.ts components/SelectionPopup.test.ts services/local-feedback.test.ts`: **22 tests passed** across four files, including existing invalidated-storage-listener cleanup coverage.
- `npm run compile`: **passed**.
- `npm run build`: **Chrome production build passed**. The installed browser continues to use the separate feedback output.
- `git diff --check`: **passed**.

## Browser results and limits

- Refreshed only the local selection test page. Its console confirmed the current extension content script loaded.
- Double-clicked fixture word `serendipity`: the dark-theme definition card appeared, showed loading with Forget disabled, then showed the bounded timeout and Try again action. Retrying returned to loading and then the timeout state. Captured test-page warning/error logs were empty.
- Live definitions remain **unverified**: the lookup exceeded the 10-second budget. An independent command-line request for fixture word `apple` timed out after 15 seconds without response bytes. A separate Chrome navigation initially exceeded the automation navigation deadline but eventually displayed the API's `apple` JSON. Thus the provider was not completely unreachable; latency/network behavior remains unresolved. No provider or network settings were changed.
- Reopening the extension Errors view after reload showed additional invalidated-context records from the existing profile. Selecting those newer entries left Chrome's detail view blank, so their individual contexts could not be established. Old open-page scripts are a possible source, but this run does **not** establish that all profile-wide errors are eliminated. Retained logs were not cleared.
- No real vocabulary was read, imported, saved, reset, or deleted. Firefox and full-profile reload behavior were not tested.
