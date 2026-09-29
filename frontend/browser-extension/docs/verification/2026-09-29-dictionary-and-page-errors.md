# Dictionary and page-connection errors — 2026-09-29

Scope: respond to a screenshot showing a context-menu dictionary timeout followed by a missing receiving content script. The user reported seeing it on the plugin page; it was not established whether that was the original lookup location or only the error viewer. Changes build on the existing uncommitted concurrency/local-feedback work.

Environment: macOS, Node 22.22.3, WXT 0.20.11, Vite 7.2.2, Vitest 4.0.8. Existing dependencies and the already-running local feedback service were reused. No vocabulary fixtures were written to real browser storage.

## Changes

- Extend the dictionary deadline from 3 to 8 seconds per attempt and retain it until the JSON body is read. Coalesce simultaneous lookups for the same normalized word, preserve the existing retry limit and non-retried 404/429 behavior, and distinguish unavailable network access from invalid response data.
- Capture the clicked frame's context before dictionary lookup. Reject browser-internal page clicks before lookup/injection, and restrict menu registration to HTTP(S)/file documents. File access still depends on the browser's permission setting.
- In local feedback builds, attempt one targeted script reconnection if the receiving content script is missing. Do not reload the page or retry a storage write.
- Fall back to the toolbar badge/title when page notifications cannot be delivered. Preserve the original error, or report an already-completed save as successful. Release permissions and the dictionary provider remain unchanged.

## Executed checks

| Check | Result |
| --- | --- |
| Initial dictionary regression tests | Reproduced slow-response cancellation, duplicate simultaneous requests, unbounded body reading and raw network errors |
| Targeted dictionary, context-menu, toolbar, local-feedback and storage-client tests | Passed: 27 tests before adding restricted-page coverage |
| Final `npm test` | Passed: 14 files, 96 tests |
| `npm run compile` | Passed |
| `npm run build` | Passed: Chrome MV3 |
| `npm run build:firefox` | Passed: Firefox MV2 |
| `git diff --check` and current documentation links | Passed |
| Existing local feedback watcher | Logged successful extension rebuilds; generated background contains the updated deadline, page restrictions, reconnect and toolbar fallback code |

The new context-menu tests cover capture before lookup, missing/restricted receivers, frame/URL targeting, one reconnect attempt, error fallback when a page disappears, and successful-save notification failure without duplicate writes. Browser APIs, network delays and toolbar calls are mocked; these are not installed-extension checks.

## Live network diagnostics

Only the disposable word `apple` was sent to the configured public endpoint, `https://api.dictionaryapi.dev/api/v2/entries/en/apple`:

- `curl` failed during TLS connection (`SSL_ERROR_SYSCALL`), before any HTTP response.
- Node fetch with a 10-second deadline timed out without returning a response.
- A direct Chrome navigation initially exceeded the browser tool's 10-second navigation wait. Reading that same tab afterward showed the complete JSON response for `apple`, including phonetics and definitions. The temporary diagnostic tab was then closed. This confirms the endpoint could be displayed in Chrome at that time, but does not measure the service-worker request latency or prove an installed-extension lookup passed.

The command-line failures and Chrome result differ. They do not establish a global service outage, a permanent Chrome connectivity failure or the exact route used by the user's Chrome/proxy. No provider switch, proxy change, certificate bypass or real vocabulary transmission was performed. Extending the timeout cannot make an unreachable endpoint available.

## Not verified

Actual native menu visibility, toolbar badge rendering, script reinjection and successful live dictionary lookup in the user's installed extension were not verified. Build/reload log messages are not proof that Chrome received the update. The remaining user check is to retry on an ordinary webpage and, if lookup still times out, check the same dictionary URL in that Chrome network environment. The extension error viewer can retain historical errors after code changes.
