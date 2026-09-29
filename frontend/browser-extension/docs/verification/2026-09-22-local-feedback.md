# Local automatic-update verification — 2026-09-22

Scope: add an everyday-Chrome feedback build and macOS background watcher on top of the concurrency/large-list changes from the same working tree. Environment: macOS, Node 22.22.3, WXT 0.20.11, Vite 7.2.2, Vitest 4.0.8. Dependencies were unchanged; the existing clean installation from this session was reused.

## Executed

- `npm test`: 12 files, 80 tests passed, including actual WXT content-context cleanup under a mocked browser and deterministic postMessage delivery, plus mocked script refresh/reconnection tests.
- `npm run compile`: passed after correcting the feedback hook's callback signature and optional dev-server guard.
- `npm run build` and `npm run build:firefox`: passed. Both production bundles were checked to exclude the feedback WebSocket event strings and temporary test marker. Release manifest permissions remain unchanged.
- `node --check scripts/local-feedback-service.mjs`: passed. The installer also validated its generated plist with `plutil -lint` before loading it.
- Started the foreground feedback server and connected a Node WebSocket probe. A temporary change to the content script's console message rebuilt the output and emitted `rememberme:refresh-content`, with zero `wxt:reload-content-script` events. The source was restored afterward.
- The first immediate-restoration check exposed WXT 0.20's leading-only debounce dropping the final change. Feedback configuration now sets `watchDebounce` to zero while retaining WXT's build mutex. Rerunning the edit/immediate-restore probe passed both rebuilds. Source and output were checked for removal of the temporary marker.
- Stopped the foreground server, then ran `npm run local:start`. A checkout-specific LaunchAgent was installed and registered for login startup. `npm run local:status` reported a running process. The generated manifest identifies **Remember Me · Local** under `.output/chrome-mv3-feedback/`.
- Fetched the actual development asset URLs referenced by the generated popup: `/@vite/client` and `/entrypoints/popup/main.ts` both returned HTTP 200 at `127.0.0.1:3937`. `/popup.html` is not served by WXT at that root URL; the popup HTML is loaded from the unpacked extension directory.
- `git diff --check` and current documentation link checks passed.

## Limits and handoff

The browser tool's URL security policy blocked opening `chrome://extensions/`. No alternate automation path was used. The user must perform the first **Load unpacked** step described in [local-feedback.md](../local-feedback.md). Installation/enabling in the user's Chrome, actual reinjection into their tabs, page-input preservation and native runtime behavior are not claimed as verified. The source watcher and simulated update protocol were verified independently.

The local service is intentionally left running for the user's feedback workflow. `npm run local:stop` stops it and removes login startup without changing vocabulary. Login startup is configured, but a full logout/login was not performed. This development build needs its localhost service running and has a separate browser extension identity from the release directory.
