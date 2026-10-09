# Epoch recovery preview and publication — 2026-10-09

The changed-server-epoch path now has native recovery choices, a durable candidate plan, online publication recheck and atomic activation. This completes another development portion of stage four; online account-backup restore, hosted restore tooling/device acceptance and the complete Apple release remain unfinished.

## Implemented boundary

- A changed epoch pauses the account queue and keeps its current vocabulary/old requests intact. Settings offers Review restored cloud vocabulary, using the independent fixed-boundary/versioned snapshot loader.
- Each lifecycle can use restored cloud fields, keep local changes as explicit conflicts, restore local fields through new conditional requests, or create a separate lifecycle with new history IDs. Missing cloud words default to retained local conflicts. A restored live cloud state cannot implicitly undo a local tombstone; a cloud tombstone cannot be revived by field restore.
- Field restoration takes count/review as snapshots, imports history without increments and does not replay historical answers. Immutable same-ID event differences block field restoration; the user can retain the conflict or choose a separate lifecycle. Local private source text is preserved where immutable events agree. Old-only history may remain locally even when the chosen cloud count differs; count and history remain independent.
- Confirmation creates a `reconcileEpoch` candidate from selected entries/new logical requests plus new server bases/checkpoint. It does not copy old wire items, receipts or operations into the new active generation. The previous generation remains the private recovery point with its original requests. Streamed plan records carry their matching remote base; header count/digest and entry/base identities are verified after reopening.
- Staging stays invisible. Publication rechecks local generation/revision, identity/device, old epoch and a recent online validation of the proposed new epoch/preferences. UI confirmation and Interrupted imports resume both obtain a fresh account reply before publication; the repository requires a scoped validation no older than 60 seconds. Another restore, account switch, local edit, corrupt plan or save failure blocks activation. Later ordinary server mutations remain subject to server CAS/epoch checks.
- Active generation, new configuration, checkpoint, conflict records and known review quota switch in one SQLite save. Publication is idempotent, and successful recovery leaves sync **paused** until explicit re-enablement. A separate chosen lifecycle queues only a new snapshot/request; earlier-epoch operations are not resent.
- `/api/v1/me` now returns the account's current IANA local review day and at most 20 stable admission IDs. Native queues count the union of known server IDs and local IDs for that day. Recovery replaces old local admission records with the freshly rechecked server quota, retaining historical review events for display without replaying them. This prevents stale old-epoch quota records from blocking new-word review or duplicating a known admission.

## Observed verification

| Check | Result | Scope |
| --- | --- | --- |
| Core Swift tests | 105 passed | Existing suites plus candidate visibility/real save rollback, retained private old queue, fresh CAS/request IDs, missing lifecycle conflicts, local/cloud tombstones, separate history IDs, frozen restart, online recheck rejection, changed local revision and quota replacement |
| Native presentation-model tests | 16 passed | Recovery choice/confirmation workflow remains paused, and a second server restore before publication leaves the old active state unchanged; synthetic API/browser/vault only |
| Local Worker/D1 tests | 30 tests / 5 files passed | Existing API suites plus account-day admission ID reporting/isolation without count mutation |
| Real Swift/HTTP/workerd/D1 harness | Passed | Existing shared baseline/refresh/response-loss/order/conflict checks plus `_exit` after recovery staging, separate-process resume/recheck/publication and subsequent explicit re-enable |
| Separate-process recovery script | Passed | Existing import/share/frozen-wire recovery unaffected |
| Backend typecheck / Worker dry-run bundle | Passed | Updated profile response; no deployment |
| Mac/iOS Simulator unsigned builds | Passed | Recovery view/core compilation; not physical-device or real web-auth acceptance |
| Shared schemas/reference runner and whitespace check | Passed | Local epochOrphan kind, existing shared JSON/identity/review compatibility |

The HTTP harness changes a synthetic user's epoch, preserves a tombstone and creates a local unsent word. Recovery staging exits without teardown; inspection in a new process still sees epochConflict and the original pending word. Resume loads the frozen plan, rechecks the real Worker account and publishes. Before re-enabling there are no new operation requests. After re-enabling, exactly one fresh selected lifecycle is created; the old pending ID is not reused and the tombstone stays deleted.

This simulates an epoch change; it does **not** restore a remote D1 backup. The native recovery interaction is covered by presentation-model tests and target builds in this checkpoint. No claim is made of new epoch-specific XCUITest, VoiceOver, physical-device, hosted OAuth or notification acceptance. The UI SwiftPM scratch build initially retained an obsolete source list for the new core file; cleaning its disposable scratch output and rebuilding passed.

## Remaining work

Continue online account-backup recovery and source consent/enrichment controls, then broaden large-account/recovery performance, conflict UI and device/accessibility acceptance. Remote D1 backup/restore procedures must pause writers and rotate epochs, and require an actual isolated hosted rehearsal before release. Production/staging configuration, signing/App Groups, real OAuth and signed Mac/iPhone synchronization remain unset/unverified. The overall Apple goal remains active.
