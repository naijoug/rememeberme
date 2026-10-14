# Account scope and upload-size regressions

Executed 2026-10-14 (Asia/Shanghai) against the working tree based on `2c66ec0`,
using Node 22.22.3 on macOS 26.5.2 arm64. The checkout also contained concurrent
lookup-related work; the full-suite result below describes the tested working
tree, not only this patch. All fixtures used disposable mocked WXT storage,
IndexedDB or SQLite, without installed profiles, real vocabulary or credentials.

## Changes and regressions

Right-click operations capture the selected owner/generation before page/provider
I/O. The queued write rejects a changed scope, including switching away and back,
and displays a failure rather than recording in the new partition. Regressions
gate the actual context-menu handler while switching to anonymous or another
account, or returning to the original account. Neither account entries/outboxes
nor the anonymous backup change. Separate checks prove a sync pause keeps the
writer usable and confirmed cloud recovery invalidates the old writer.

Both account copy and intentional import split history by the shared 25-event
limit and the 256 KiB UTF-8 JSON body limit, including request metadata. Multibyte
fixtures verify event order/completeness and later writes. A committed history
response-loss case reopens the repository and retries the identical ID/body,
retains all 25 events once, and applies a later reset with its causal version.
Single-event overflow rejects the complete account copy/import before any
entries/outbox are published; the anonymous export remains unchanged. The mock
server now validates operations/byte sizes and supplies real history positions.

The real HTTP harness sends 25 histories with 12,000-character Chinese definitions
through both planners, the actual backend body reader and SQLite. It verifies
bounded request sizes, complete event timestamps/counts, source exclusion and
later reset/sync without a paused queue.

## Commands actually run

From `frontend/browser-extension/`, using the pinned Node executable in `PATH`:

```sh
npm test -- services/cloud-vocabulary.test.ts services/context-menu-handler.test.ts
npm test
npm run compile
npm run build
npm run local:status
```

The first focused run exposed the regressions before the fix. After the fix,
the focused run passed 29 tests; two further pause/recovery cases were included
in the full run. The final full suite passed **246 tests in 28 files**, including
21 cloud-vocabulary tests and 10 context-menu tests. Type checking and the Chrome
production build passed. The existing feedback watcher stayed running and its
latest build completed; `local:status` confirmed reachable development assets.
No second watcher was started or extension reinstalled.

From `backend/`:

```sh
npm run build
npm run test:browser
```

Both passed. The HTTP test needed authorized random loopback listeners outside
the filesystem/network sandbox; it used only a disposable database and synthetic
providers. No server deployment or upstream inference was performed.

`git diff --check` and local-link checks of the changed guides passed.

## Documentation and limits

Project, browser and Apple architecture now agree with the latest recorded
Tencent deployment. The deployment guide has a current-status summary, while
earlier disabled-Hermes/pre-deployment/pending-secret notes are marked historical.
The recorded private API/Hermes, server-side HTTPS and GitHub credentials are
configured; public filing, exact installed-extension callbacks and full hosted
OAuth/cross-client acceptance remain outstanding. Host/filing state was not
reinspected during this source-fix turn, and the patch was not deployed.

Already-frozen oversize requests retain their original ID/body and recovery copy.
They require explicit archive/cloud recovery and a new copy/import; this update
does not silently rewrite a previously submitted operation. Installed-browser
switching, upgrade/quota/large-store behavior and hosted/device acceptance remain
unverified. Build success and synthetic HTTP checks do not prove Chrome loaded
an update or a real client completed OAuth.

## Isolated commit verification

Before committing, `git archive HEAD` plus only this change's 12 prepared files
was extracted into a disposable directory. Installed package dependencies were
reused, but the other uncommitted lookup-routing code/docs were excluded.
In that snapshot, `npm test` passed **243 tests in 28 files**; extension
`npm run compile`, backend `npm run build` and `npm run test:browser` also passed.
The difference from the earlier 246-test working-tree run is the excluded
concurrent lookup work. The HTTP run still verified large copy/import histories
and later resets through the original Node/SQLite runtime.
