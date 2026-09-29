# Local Chrome feedback recovery — 2026-09-29

Scope: investigate inability to test the local build in everyday Chrome. The working tree already contained separate release-preparation edits based on `0dfb606`; those edits were preserved. This change only repairs local service lifecycle/health handling and updates its documentation.

Environment: macOS, Node 22.22.3, existing WXT 0.20.11 installation, package working-tree version 0.1.0. No dependency reinstall, second watcher or browser vocabulary mutation was performed.

## Reproduced failure

- `local:status` showed a registered LaunchAgent with **state = not running** and **last exit code = 0**. Its prior output also listed nested `state = active` lines, which did not establish process health.
- Fetching `http://127.0.0.1:3937/@vite/client` failed with `ECONNREFUSED`. The generated local popup references this server, so an existing build directory was insufficient.
- The old `local:start` path treated registration as success and did not restart a stopped job. The old KeepAlive policy restarted unsuccessful exits only, allowing a clean exit to leave the job stopped.

## Repair and verification

- `local:start` now chooses bootstrap, configuration replacement, kickstart, or reuse from actual job state. Existing matching running jobs are reused. Startup waits for both popup development scripts to be served as JavaScript.
- The installed LaunchAgent now uses unconditional KeepAlive. The explicit stop command still unloads the job and removes login startup. A full logout/login or clean-exit fault-injection test was not performed.
- `local:status` distinguishes not registered, registered/stopped, running but unhealthy, and healthy; it returns nonzero when unhealthy. Launchctl permission failures are reported rather than interpreted as absent services.
- `npm test -- scripts/local-feedback-health.test.mjs`: **7 passed**. Tests use synthetic launchctl output and mocked HTTP responses.
- `npm run compile`: **passed**. The initial TypeScript test file could not import the Node `.mjs` helper without declarations; moving this JavaScript-only test to `.test.mjs` resolved the mismatch without changing project type-check settings.
- `node --check scripts/local-feedback-service.mjs`: **passed** before startup; generated LaunchAgent XML is validated by the start command with `plutil -lint`.
- `npm run local:start`: **passed**, migrated the stopped job and restored reachable development assets. Repeated `local:start` reused the service; subsequent `local:status` reported healthy.
- `git diff --check` and current Markdown link checks: **passed**.

## Actual everyday-Chrome observations

- Opened `http://127.0.0.1:3937/test-selection.html` in the user's existing Chrome and successfully rendered the test article.
- Double-clicked `serendipity`; DOM inspection confirmed the selection, but no extension card appeared and no content-script startup log was observed.
- Inspected the native puzzle-piece extension menu for that page. Neither **Remember Me** nor **Remember Me · Local** appeared among the available entries. This does not distinguish a disabled extension from one that has not been loaded in this profile.
- Closed the menu and retained the test tab for the user. No Forget, import, deletion, or storage inspection was performed on the real browser profile.

The earlier browser URL-policy restriction on the extension manager was respected; no attempt was made to work around it through native UI, shell, or CDP. The remaining step is for the user to enable the existing extension in Chrome, or load the fixed local directory if no entry exists, then refresh the retained test page. Service health is verified; a successful installed-extension lookup is still **not verified** for this run.
