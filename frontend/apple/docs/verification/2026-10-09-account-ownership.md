# Account ownership and application integration — 2026-10-09

This checkpoint connects native account selection/ownership and the existing sync core to Settings. It remains development implementation, not complete Apple stage-four or release acceptance. The API is still local/undeployed; no real vocabulary, Chrome profile, hosted OAuth or existing user Keychain item was used in these checks.

## Implemented behavior

- Sign-in alone keeps anonymous vocabulary local. Open account vocabulary performs read-only snapshot/history pulls and pauses sending. The service must advertise history-order, history-version and explicit-lifecycle capabilities before native sync can be enabled.
- Ownership preview has per-entry choices: keep anonymous, migrate a shared original baseline and its later intents, copy an unrelated current snapshot, associate history while retaining cloud count/fields, explicitly replace cloud fields, or explicitly create a separate lifecycle. Different-source/cloud-tombstone cases default to keep anonymous. Count is not inferred from history or automatically added during association.
- Shared migration retains the original seed/request IDs and payload, not the later accumulated count. Offline conditional actions retain their observed causal base; a newer cloud version is not adopted merely because the user binds the source. Unrelated local words create one selected current snapshot and do not replay the anonymous operation queue.
- Ownership is a frozen `bindAnonymous` candidate plan. Candidate copies/staging remain invisible and resumable. Publication checks both owner generations/revisions, account/device/epoch and paused configuration, then saves mapping receipts and the active account pointer in the same SQLite transaction. A real save failure or changed anonymous source leaves the active account vocabulary unchanged. The anonymous vocabulary is retained, with a receipt making repeated preview default to keep anonymous.
- Account selection/controller and repository actors are shared by URL/owner across windows. Selection clears details, editor scope, import tasks, export buffers and queries; stale view actions carry their original owner and cannot write into another account. Reminders are rebuilt for the selected vocabulary, and obsolete delivered review notices are removed during switching. Actual notification delivery remains unverified.
- Settings exposes explicit enable/pause, Synchronize now and basic confirmed conflict actions. Foreground/pending-mutation signals request finite sync flights. Disconnect cancels active work, pauses the old account queue and selects anonymous vocabulary; local account data/unsent intents remain partitioned. A previously selected account can be restored offline without being reassigned to a different signed-in user.
- A conflict can accept current cloud values or create a separate lifecycle from the local snapshot. A separate copy uses new encounter/review IDs and retains origin provenance; the original cloud lifecycle stays intact. Account-backup recovery and explicit epoch reconciliation remain unfinished, so a changed epoch keeps sending paused.
- Backend migrations 0002–0004 add explicit duplicate-lifecycle support, retained encounter positions and entry-version bounds. Normal create/rename source checks still run inside the atomic D1 guard after removing the old unique-spelling index. History paging uses immutable ID cursors, returns position/entryVersion, and excludes events newer than the base count snapshot. After complete scans, the native client restores retained order; explicit legacy merge uses stable timestamp/position order. Count/history remain independent.

## Observed verification

| Check | Result | Evidence scope |
| --- | --- | --- |
| Core `swift test --disable-sandbox`, redirected temporary caches/build | 93 tests passed | Existing suites plus ownership copying/seed identity, source/account revision failure, frozen recovery, association/tombstones, explicit IDs/conflict copy, history order and native history-version validation |
| UI package `swift test --disable-sandbox` | 14 tests passed | Synthetic browser/session/SyncAPI, read-only opening, confirmation before queue/send, repeated-copy default, two window models, stale-owner editor rejection, logout cancellation and capability rejection |
| Backend `npm test` | 29 tests / 5 files passed | Local workerd/D1 synthetic accounts; concurrent source collision versus explicit duplicates, retained positions, old-snapshot history bounds and populated 0001-to-current database migration |
| Backend `npm run typecheck` / `npm run build` | Passed | Types and explicit Worker `--dry-run`; no deployment |
| Schema verifier and `contracts/reference.ts` on Node 22.22.3 | Passed | Shared validation/normalization/identity/backup/review fixtures and updated request/response schemas |
| Separate-process recovery script | Passed | Existing import/share `_exit` recovery plus exact frozen request/backoff recovery; no network request |
| Mac unsigned `xcodebuild … build` | Passed | Native/shared compilation, not Mac UI/system authentication |
| iPhone 17 Pro / iOS 26.5 Simulator local regression | Three existing UI tests passed | Actual local add/edit/review/reset/delete/import-relaunch assertions; synthetic per-run app stores |
| Account Settings simulator test in a fresh DerivedData directory | One new test passed | Opens Settings, confirms anonymous vocabulary and absence of account/sync controls without signing in or accessing production credentials |
| `git diff --check` | Passed | Tracked whitespace errors |

The UI model tests originally reached UserNotifications from a SwiftPM helper without an app bundle and terminated before assertions completed. Repository-switch reminder handling is now injected; model tests use a no-op while normal app switching uses the actual platform scheduler. The 14-test rerun passed without touching system notifications.

The existing Xcode DerivedData run discovered only the three older tests despite compiling the updated test bundle. Inspection of its xcresult confirmed that limitation. The added account Settings case was then explicitly selected with a fresh temporary build directory; its independent xcresult recorded one pass, zero failures/skips. We do not claim that the cached run exercised that new case.

All authenticated coordinator/presentation tests in this checkpoint use synthetic injected transports or SyncAPI implementations. The backend tests separately exercise Worker/D1. Those results do not prove a Swift-to-Worker exchange or two signed devices synchronizing through hosted OAuth.

## Remaining work

Continue actual Swift-to-local-Worker integration/two-client migration and response-loss tests, explicit server-epoch reconciliation, online account-backup restore, source consent/enrichment controls and broader conflict field selection. Actual OAuth/HTTPS environment, signed Mac/iPhone sessions, Share Extension hosts, notification delivery/tap behavior, large-account sync/restore performance, accessibility and full device/release acceptance remain unfinished. The complete Apple goal is active; this checkpoint does not declare stage four or the first release complete.
