# Apple verification

Use Xcode 16/Swift 6 or later. Node commands use the extension's `.nvmrc` (currently 22.22.3). Package tests use synthetic fixtures and disposable SQLite stores; no production accounts, real vocabulary or live dictionary requests are involved.

## Contracts and disk tests

From the repository root:

```sh
node --experimental-strip-types contracts/reference.ts
```

From `frontend/apple/Packages/RememberMeCore`:

```sh
swift test
```

For a restricted local filesystem, redirect compiler/SwiftPM caches and output:

```sh
env CLANG_MODULE_CACHE_PATH=/tmp/rememberme-swift-modules SWIFTPM_MODULECACHE_OVERRIDE=/tmp/rememberme-swift-modules swift test --disable-sandbox --scratch-path /tmp/rememberme-swift-build --cache-path /tmp/rememberme-swift-cache
```

`--disable-sandbox` disables SwiftPM's manifest subprocess sandbox only; it does not provide app access to production data. The packages have no external dependencies or plugins. Cache redirection avoids writing into user Library caches.

The tests verify permissive legacy data, ECMAScript normalization and UTF-8 identity, count/time precision, event identity, current/unknown count distinctions, reset retaining history, real Core Data save rollback, entry/outbox disk recovery, candidate visibility, failed publication, revision checks, partition isolation, restored history not advancing count/review, immutable event conflicts and tombstone protection. These are domain/disk tests, not simulator or device acceptance.

Additional core checks cover bundled/mocked lookup and cancellation, monotonic review versions through restore, review quota/date/DST rules, V1/V2/V3 SQLite migration into the current V4 model, incompatible-store preservation, and concurrent durable capture files with deduplicated main-app confirmation. Mocked providers do not contact external APIs.

Native authentication tests use injected in-memory vaults and mock API transports; account presentation tests also inject a mock system browser and isolated UserDefaults suites. They verify origin/callback/PKCE rules, concurrent refresh, revoked/superseded sessions and credential-storage failure recovery without opening real login or touching user Keychain items. The optional `RememberMeProbe keychain-smoke UNIQUE_UUID` diagnostic uses only a newly generated synthetic test service namespace and removes it; it is deliberately not part of automatic test suites or normal app startup. See [native auth evidence](verification/2026-10-09-native-auth.md).

Sync core tests additionally verify frozen request bytes and causal ordering, response-loss retry after reopening, multi-chunk/no-op acknowledgments, retained local edits/sources, atomic state/history cursor rollback, account identity mismatch, disabled sync, logout during submission, epoch suspension and rejected-review rollback. Coordinator tests use the real authenticated client with a synthetic `APITransport`; they do not contact the Worker or prove hosted/native end-to-end sync. See [sync core evidence](verification/2026-10-09-sync-core.md).

Import recovery checks additionally cover copying/staging/ready-state restart, same-ID plan/chunk changes, modified vocabulary, corrupt/missing source plans, interrupted cancellation cleanup, owner isolation, old full-JSON plan compatibility and operation order in streamed plans. Pruning tests inspect actual disk row generations as well as public vocabulary/outbox results.

From `frontend/apple/Packages/RememberMeUI`, `swift test` verifies presentation models with injected temporary repositories and mock providers: backup/restore preview, list/history paging, cancelled imports, late lookup results, and share confirmation without fake history. Redirect SwiftPM/compiler caches as above if required, using a separate scratch path for this package.

Account presentation tests inject a synthetic browser/session/SyncAPI and isolated preferences. They check read-only account opening, explicit ownership confirmation before queueing/sending, repeated-copy defaults, switching two window models, old-scope editor rejection, logout cancellation and required-service capability rejection. Injected repository-change callbacks avoid accessing UserNotifications from a SwiftPM process. Ownership disk tests cover frozen original baselines/intents, count-preserving association, explicit separate IDs, tombstones, publication save failure/stale source and interrupted candidate recovery. These cases are listed in [account ownership evidence](verification/2026-10-09-account-ownership.md).

For real native HTTP integration, first build the standalone probe and the backend's dry-run Worker bundle. From `backend/`, run `npm run test:native -- /absolute/path/to/RememberMeProbe`. It starts only random loopback listeners/local workerd, applies migrations to disposable D1, seeds synthetic fixture credentials directly through the local test binding and runs separate Swift processes with URLSession. The script cleans its files/runtime and blocks provider outbound requests; it has no production fixture endpoint. The explicit test command uses a filesystem fixture vault instead of user Keychain. See [native HTTP evidence](verification/2026-10-09-native-http.md) for refresh/dedup/committed-loss/history/conflict/epoch scope and exact commands. Snapshot-loader tests additionally reject changed boundaries/epochs/positions and verify cancellation. Local HTTP success does not establish hosted OAuth or physical-device acceptance.

Epoch recovery tests cover candidate visibility, old private queue retention, real publication save rollback, new request IDs/current server CAS, local/cloud tombstones, missing lifecycles, immutable event conflicts, frozen plan reopening, online recheck/local-revision failure and known-server review quota replacement without answer replay. The HTTP harness additionally `_exit`s after staging a recovery candidate and resumes it in a new process with an actual online account recheck; only an explicitly chosen new lifecycle is sent after separate re-enablement. Presentation-model tests verify confirmation stays paused and another server restore prevents publication. See [epoch recovery evidence](verification/2026-10-09-epoch-recovery.md). Interrupted epoch jobs require the connected account for online recheck before publication; no job auto-publishes at startup.

Account-backup tests now cover cached/offline confirmation blocking, selected fields using current server versions, history association without count increment, immutable conflicts, deletion rules, existing outbox preservation, frozen reopening, changed cloud versions/store-save rollback and API-range exclusions. Presentation models inject the cloud service; the real HTTP harness stages/exits/reopens/rechecks a backup and verifies later history remains while count alone is restored, with no review replay. Resumed account-backup jobs recheck cloud versions before publication. See [account backup evidence](verification/2026-10-09-account-backup.md). Lookup cancellation checks use a gated provider and exact subscriber registration rather than a short timing window; cancelled callers are rejected even when a cache/reply is ready.

After building the probe, verify exit-without-teardown recovery in independent processes:

```sh
python3 frontend/apple/scripts/verify-process-recovery.py /tmp/rememberme-swift-build/arm64-apple-macosx/debug/RememberMeProbe
```

The script creates temporary directories, forces a probe process to `_exit` immediately before/after publication, then opens the store in a fresh process. The before case must have zero active words/operations, and the after case exactly one of each. It also exits during copy, during staging and after staging but before publication, then resumes each job in a new process without the original in-memory preview; the original 1 word/1 operation becomes exactly 3/3. It also compares the Swift identity report with Node-generated fixtures.

It also writes a shared draft from one process, exits the main-app drain after committing but before acknowledgment, and drains again in a new process. The result must be one pending draft, zero vocabulary entries/operations and no leftover shared file. This tests disk protocol recovery, not actual signed App Group access.

The same script freezes a synthetic account request and saves a retry/backoff, then `_exit`s without teardown. A separate process must recover the exact ID/body and retry metadata with unchanged local count. This proves wire persistence across process boundaries, without sending any network request or reading Keychain.

To check a clean-source build without relying on this checkout's generated output:

```sh
python3 frontend/apple/scripts/verify-clean-build.py
```

The script copies Apple sources, contracts and pinned dictionary inputs into a temporary tree; builds both app targets with fresh DerivedData, checks both Bundle dictionaries, runs core tests, then the separate-process recovery checks. It does not register signing identities or groups, access app user data, or run Mac UI automation.

## Native UI

From `frontend/apple`, choose an available simulator ID from `xcrun simctl list devices available`, then run:

```sh
xcodebuild -quiet -project RememberMe.xcodeproj -scheme RememberMeiOS -destination 'platform=iOS Simulator,id=YOUR_SIMULATOR_ID,arch=arm64' -derivedDataPath /tmp/rememberme-ios-build CODE_SIGNING_ALLOWED=NO test
```

UI tests launch with a unique `ui-…` temporary store inside the app container, never the normal Application Support store. They exercise manual add, record, process relaunch, reset retaining history, delete/cancel, confirmed deletion, manual definition editing, review without changing forgotten count and opening account Settings while remaining anonymous. They never sign in, request system notifications or read the App Group inbox. They do not prove native file-dialog behavior, physical-device sharing, notification delivery, account sync or VoiceOver usability.

The Mac scheme includes the same UI test suite. It may need normal local test-runner automation access and ad-hoc signing; the latest local attempt failed before running assertions with an automation-mode initialization timeout. Keep that failure separate from passing Mac compilation/presentation tests. Do not change system security permissions automatically to make the test pass.

## Performance and remaining acceptance

`RememberMeProbe benchmark PATH` generates 10,000 synthetic entries with 100,000 encounter records and imports them into a fresh temporary disk store, then appends one additional word through a bounded copy of that existing store. It reports generation/import time, append/copy time/chunk count, 30 first-page queries with p95 latency, and process peak RSS. Do not point it at a real app store. The original baseline is in [2026-10-08 foundations](verification/2026-10-08-foundations.md); current recovery/streaming results are in [2026-10-09 import recovery](verification/2026-10-09-import-recovery.md).

The search budget is p95 <= 300 ms after debounce. The initial Mac debug fixture budget is <= 90 seconds generation/import and <= 512 MiB peak RSS. This budget includes fixture generation; it does not establish existing-store import or iPhone performance. Re-measure release builds, candidate copies over an existing large vocabulary, history paging, actual UI scrolling and target iPhone memory before release.

Follow the implementation plan's remaining physical-device, lookup, backup UI, Share Extension, sync, review/notification, upgrade migration and accessibility acceptance. Do not mark them complete from compilation or domain tests. Run browser-extension checks only when its affected source/contracts change.

Check packaged dictionary integrity before builds and on their Bundle paths:

```sh
python3 frontend/apple/scripts/verify-dictionary-assets.py
python3 frontend/apple/scripts/verify-dictionary-assets.py /tmp/rememberme-ios-build/Build/Products/Debug-iphonesimulator/RememberMeiOS.app/wordnet
```

Share Extension/device acceptance remains required: provision both app and extension with the same available `REMEMBERME_APP_GROUP`, then share text and URL-only payloads from real hosts with the main app closed; verify inbox acknowledgment, confirmation, duplicate delivery, disk failure and capability failure. No registry or signing team has been selected by the automation.

## Source privacy and current local acceptance

The [2026-10-09 source privacy checkpoint](verification/2026-10-09-source-privacy.md) records 119 core, 20 presentation and 32 API tests, real local native HTTP removal/backfill/restart checks, the four passing iPad simulator UI cases and manual Mac keyboard/AX evidence. Source removal freezes an idempotent request before I/O and blocks sending on unknown outcomes; test re-enable plus old frozen/unsubmitted source intents as well as explicit new backfill. Account/snapshot recovery rechecks the source revision.

`RememberMeProbe sync-benchmark /tmp/rememberme-sync-benchmark-NEW/store.sqlite` requires a new synthetic directory and measures 10k-word/100k-history outbox setup, status/first-wire/retry latency, exact request recovery after reopen and peak RSS without network. Paging/database-count optimization reduced retry p95 from 7183.5 to 32.7ms in the observed Mac debug run. Neither benchmark proves full hosted throughput or physical-device acceptance. Use [staging/device acceptance](staging-device-acceptance.md) for the unfinished signing/OAuth/share/notification/accessibility and large-store device checks.
