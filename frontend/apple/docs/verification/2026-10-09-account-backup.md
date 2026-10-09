# Online account backup restore — 2026-10-09

Account backup merge is now a native application path. It uses current online lifecycle/tombstone/history state, explicit field/source choices, durable staging and a fresh publication check. This is development acceptance with synthetic stores and local HTTP, not complete hosted/device/release acceptance.

## Behavior and transaction boundary

- Restore complete backup (merge) works from the selected account vocabulary; Replace remains anonymous-only. Backup parsing preserves the existing schema/legacy value rules and rejects unsupported versions or unknown request/checkpoint fields. Files remain untouched.
- Account restore pauses the sender and downloads a fixed snapshot. If account access fails, cached local data can produce a preview, but confirmation is disabled until current cloud versions are successfully reloaded. A changed epoch directs the user to epoch recovery first.
- Current fields are kept by default. Valid missing history/review audit records can be merged without changing count or recalculating review intervals. Explicit backup selection can restore count, current definition, notes, review schedule, spelling/type and locally retained shared origin independently. New words necessarily retain their spelling/type. Backup CAS versions never become server authority.
- Different-source entries can explicitly associate history to a current live cloud word while retaining its count, or create a separate lifecycle with new history/review IDs and origin aliases. Additional same-spelling lifecycles require an explicit choice. Tombstones are retained; a backup deletion creates a current-version delete only after explicit confirmation.
- Immutable encounter/review differences block the item. Explicit Keep current can reject that backup item; a separate lifecycle preserves its different history under new IDs. Same-epoch local/cloud immutable differences are rejected rather than silently overwritten. Source positions are refreshed from the current server; stale backup positions do not define server identity.
- Pending/conflicted local fields cannot be overwritten by a backup snapshot. Unrelated current operations and frozen requests are copied unchanged with the active generation. Missing words in the backup stay present. Incoming backup envelopes never supply queues, sessions or checkpoints.
- The confirmed `restoreAccount` plan freezes the selected results, fresh logical IDs, current remote bases, expected lifecycle versions and relevant live spelling/ID sets. Per-item wire validation catches unsupported IDs, unsafe API review ranges, excessive text/nesting/body size before queueing; the user can exclude unsupported fields or skip/copy the item. No values are silently truncated.
- Candidate copy/staging is invisible and resumable. Before publication the application downloads another current snapshot, checks account/device/origin/epoch/preferences, relevant versions and source identities, then saves a validation valid for at most 60 seconds. A server change, local revision change, disconnect, damaged plan or actual store-save failure prevents activation.
- Publication switches the candidate pointer and batch state in one SQLite save, with its existing/new operations and base records already staged. Sync remains paused; later explicit enablement sends fresh conditional restores and independent history imports. Restored history does not increment count; restored historical answers do not consume admissions or advance review. Shared origins stay local.

## Observed verification

| Check | Result | Scope |
| --- | --- | --- |
| Core Swift tests | 115 passed | Existing suites plus default keep/history-only, selected fields/current server CAS, offline blocking, envelope rejection, immutable history, source association, tombstones, unrelated/pending outbox, frozen restart/version recheck/save rollback, API-range exclusions and cancellation |
| UI presentation-model tests | 19 passed | Explicit field confirmation stays paused, unavailable cloud gives non-confirmable preview, and changed cloud state blocks publication; synthetic browser/API/vault only |
| Real Swift/HTTP/workerd/D1 harness | Passed | Account backup stage `_exit`, separate-process reopening/online recheck/publication, explicit re-enable and real restore/history request behavior |
| Existing separate-process recovery script | Passed | Earlier import/share/frozen request boundaries remain intact |
| Mac and iOS Simulator unsigned builds | Passed | Core/view compilation; no new account-backup XCUITest or physical-device claim |
| Shared schema/reference checks, harness syntax, whitespace | Passed | Existing JSON/identity/review compatibility and source hygiene |

In the HTTP fixture, the account backup captures count 3, 54 history events and a step-0 review. A later click yields count 4/history 55. Selecting only backup count stages and exits without changing the active value 4 or sending any request. A fresh process reads the frozen plan, rechecks the Worker and publishes count 3 while sending remains paused. Explicit re-enable sends one restore and three bounded history imports; D1 retains 55 events, count 3, the same review step and one historical review event/admission. The old backup does not delete later history or replay its answer. The complete harness's prior baseline/refresh/loss/conflict/tombstone/epoch scenarios also pass.

During full verification, the earlier lookup cancellation test exposed a timing assumption: an 80 ms provider delay could elapse before the test called cancel under parallel load. The test now gates the provider until both subscriptions are registered. The coalescer/service also check cancellation after continuation delivery and before returning/caching a reply, including cached lookups. The gated shared-request case and a self-cancelled cached lookup pass in the 115-test suite; another subscriber still receives its result without cancelling the shared provider.

The fixture probe had a path-type compile error while adding file permissions; it was corrected and the new binary was verified before the final integration run. No production vocabulary, Chrome data, existing Keychain items or provider network was used. Remote CI has not been observed.

## Remaining acceptance

Continue source consent/enrichment controls, large-account/restore performance, broader interface/accessibility acceptance and actual Mac/iPhone OAuth/signing/App Groups/notification behavior. Remote D1 backup/restore rehearsals and deployment remain unfinished. Local HTTP uses independent CLI device processes and cannot prove the signed app's real login/file-dialog/system flows. The overall Apple goal remains active.
