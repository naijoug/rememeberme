# Apple clients

Native macOS and iOS targets now share `RememberMeCore` and `RememberMeUI`. This is the implementation foundation, not the completed first release. The browser extension remains independently installed and stores its own vocabulary.

Implemented: local SQLite/Core Data repository and durable logical outbox; legacy migration/explicit merge and cancellable staged publication; complete backup export and anonymous merge/replacement restore with conflict preview; shared native adding/editing, literal history and pagination, reset and confirmed deletion; bundled WordNet and independent English/Chinese providers; review-v1 queues/events with durable daily admission limits; appearance and opt-in local reminder settings. No production vocabulary is seeded or read from Chrome.

Word learning is available directly from the **Learn words** toolbar button (Command-Shift-R on Mac), as well as Options → Today’s review. Flashcards hide saved meanings/examples and notes until revealed; Space reveals and 1/2/3 answer Forgot/Fuzzy/Remembered. The view shows due reviews, the remaining daily new-word allowance, committed answer totals for this session and the last answered word’s next review time. Review schedules persist; the session summary resets when the view closes. To bring in extension words without a working account connection, export JSON from the extension and use Import extension snapshot; this is an explicit import, not continuous sync.

The iOS Share Extension and main-app draft confirmation path are implemented and buildable; App Groups signing and real host/device sharing are not yet validated. Interrupted imports have a durable plan and Resume/Discard/Cleanup UI; existing-store copies and inactive-generation cleanup run in bounded chunks. Account ownership, vocabulary selection, sync/conflicts, epoch recovery and online account-backup merge are connected. Real Swift/URLSession-to-local-Node/SQLite integration passes with separate synthetic stores, including interrupted epoch/backup recovery. Source consent/backfill and explicit uploaded-source removal are implemented with persistent retry fencing. Hosted/signed-device sessions and complete large-store/device acceptance remain unfinished. Connected Chinese lookup uses the authenticated backend Hermes provider with a separate persistent cache; disconnected lookup retains MyMemory. Live isolated Hermes has passed backend HTTP acceptance on Tencent, while public access is blocked pending domain filing. Native hosted lookup/sync and system notification delivery/launch routing remain unverified; remote CI execution has not been observed.

## Build

Open `RememberMe.xcodeproj`, select `RememberMeMac` or `RememberMeiOS`, and build. Minimum deployment targets are macOS 14 and iOS 17. Shared schemes and the project are checked in; local packages have no external Swift dependencies.

The macOS app is named **RememberMe** in the menu bar and window title, and builds as `RememberMe.app`. Its Xcode target and scheme remain `RememberMeMac`.

The authoritative project configuration is `project.yml`. If target configuration changes, regenerate the checked-in project with XcodeGen 2.44 or later:

```sh
cd frontend/apple
xcodegen generate
```

Command-line builds use disposable output:

```sh
xcodebuild -quiet -project RememberMe.xcodeproj -scheme RememberMeMac -destination 'platform=macOS,arch=arm64' -derivedDataPath /tmp/rememberme-mac-build CODE_SIGNING_ALLOWED=NO build
xcodebuild -quiet -project RememberMe.xcodeproj -scheme RememberMeiOS -destination 'generic/platform=iOS Simulator' -derivedDataPath /tmp/rememberme-ios-build CODE_SIGNING_ALLOWED=NO build
```

Unsigned builds verify compilation and simulator development only. Select your own signing team in Xcode before physical-device installation; no team or account identity is hardcoded in this repository.

## Storage and safety

The default app creates `RememberMe/vocabulary.sqlite` under its own Application Support directory. The app's sandbox container determines the physical location. Each platform starts with an empty anonymous vocabulary. Explicitly select a user-exported JSON to import; development tests use synthetic temporary stores.

The programmatic `StoreModelV1` through `StoreModelV4` are versioned in source. V2 adds indexed review-query fields and admission records; V3 adds durable captures; V4 adds operation sequence columns and generation-scoped sync records. Known old models migrate into a separate store, preserve a coherent `pre-upgrade-recovery.sqlite` copy, then replace the active store. Unknown models fail without discarding the database. Domain code returns value types; one actor/private context owns writes and is shared across app windows. Entry changes, events, quota admission and logical operations commit in the same store save. Import candidates remain invisible until the active pointer and published batch state commit together. Successful imports prune older scratch generations while keeping the current state, latest pre-publication recovery point and any in-flight sources/candidates.

Private recovery plans live beside the store under `vocabulary.sqlite-import-plans/<owner hash>/`. They may contain sensitive vocabulary/history and logical operations; they are neither user backups nor synchronized data. New plans use streamed JSON records plus a SHA-256 receipt; older complete-JSON plans remain readable. Startup only lists interrupted jobs; it never automatically publishes them. Resume uses the original plan and operation IDs, while a changed vocabulary requires a fresh preview. Original input files are never modified by discard/cleanup.

Backups retain potentially sensitive contexts/URLs, but omit credentials, sessions, pending requests and sync checkpoints. Count reset retains history. Text is rendered literally; only HTTP(S) history links are navigable. Deletion asks for confirmation.

WordNet resources are packaged from the same checked-in source directory as the extension, with metadata and licenses. English local misses use Free Dictionary API and uncached Chinese lookup uses MyMemory; only the lookup word is sent. Opening saved words does not make requests or change definitions; lookup/refresh results stay in the editor until explicit Save. See [behavior](docs/behavior.md) for the exact boundaries.

See [source privacy and local acceptance](docs/verification/2026-10-09-source-privacy.md), [staging/device setup](docs/staging-device-acceptance.md), [testing](docs/testing.md), [shared contracts](../../contracts/README.md) and the [implementation plan](../../docs/apple-clients-implementation-plan.md).

## iOS sharing setup

`RememberMeShare` is embedded in `RememberMeiOS`. Both use `Configuration/SharedCapture.entitlements` and the `REMEMBERME_APP_GROUP` build setting. The default `group.com.rememberme.app` and bundle IDs are provisional development identifiers, not evidence of registration. Before signing/installing, choose an authorized team and configure an App Group available to that team, keeping both targets on the same value. No group or provisioning has been registered automatically.

The extension accepts only host-provided text or URL, explicitly saves an immutable draft file, and finishes without network access or launching the app. On startup/foreground, the main app commits the draft to Core Data before acknowledging the shared file. Shared drafts remain pending until the user chooses a word and confirms; counts/history do not change merely from sharing. Capability failure reports a Paste/JSON-import fallback instead of falsely reporting a saved draft. Pending captures are not part of vocabulary backups; confirmed capture origins are retained in complete backups and lost in legacy export.

## Native account connection

Settings includes an explicit HTTPS API origin and system-browser GitHub sign-in. PKCE verifier/state and callback validation run through `NativeSession`; access/refresh credentials live in a per-origin Keychain item with WhenUnlockedThisDeviceOnly accessibility. Non-secret origin and selected vocabulary owner are saved in preferences. Login does not bind or upload anonymous vocabulary. Open account vocabulary performs a read-only pull and keeps sending paused. Review anonymous vocabulary offers migrate, keep anonymous, associate history, replace chosen fields or explicitly create a separate lifecycle. Confirmation publishes the selected account copy atomically and enables its queue; the anonymous copy remains available. Reopening the preview defaults previously copied entries to keep anonymous.

The account coordinator runs finite foreground batches on foreground entry, pending local mutations and explicit Synchronize now. Account selection is shared across windows; switching clears open details/drafts/export buffers and rebuilds reminders, while queues remain in their original account partitions. Disconnect pauses the account queue and selects anonymous vocabulary. A saved account vocabulary can be reopened offline on application restart without claiming a new account owns it. Basic conflicts offer confirmed cloud values or a separate lifecycle preserving the local snapshot. The service must advertise history-order/version and explicit-lifecycle capabilities before this development sync path is enabled. See [ownership integration evidence](docs/verification/2026-10-09-account-ownership.md).

The origin validator rejects credentials/query/fragment/path and insecure remote HTTP. Core test helpers can explicitly allow loopback HTTP; production Settings accepts HTTPS. API requests use an ephemeral session without cookies/credential caches, block redirects, bound body/response sizes and preserve structured error/conflict metadata. A shared refresh flight avoids spending the same rotated token twice; account/logout generations reject late replies.

Mac/iOS source Info.plists explicitly declare the `rememberme` callback scheme, verified in built packages. Presentation/session tests mock the system browser and use synthetic vaults/providers. A separate opt-in probe used a unique `com.rememberme.tests.<UUID>` Keychain namespace with synthetic credentials, verified write/reopen/origin isolation/remove, and removed the fixture. Actual hosted OAuth, signed device Keychain behavior and web-auth presentation remain platform acceptance work. See [native authentication evidence](docs/verification/2026-10-09-native-auth.md).

The standalone `RememberMeProbe` supports a guarded synthetic HTTP harness. [Native HTTP evidence](docs/verification/2026-10-09-native-http.md) records real URLSession/workerd/D1 refresh, shared baseline/history, response-loss/restart and conflict checks. `ServerSnapshotLoader` independently reads fixed, versioned recovery snapshots. Settings now lets users confirm cloud/local/separate-lifecycle choices into a durable candidate, rechecks the new epoch online and publishes atomically while retaining old requests in the recovery generation. Sync remains paused after publication. Current server admission IDs replace obsolete local epoch quota without replaying review events. See [epoch recovery evidence](docs/verification/2026-10-09-epoch-recovery.md).

Restore complete backup (merge) now supports account vocabulary. It pauses sending, reads current cloud versions/tombstones/history, defaults to current fields and offers selected backup fields, history association or a separate lifecycle. An unavailable account gives a cached preview without confirmation. Candidate publication rechecks relevant cloud versions/source IDs and local revision; affected pending fields cannot be overwritten. Existing queues stay separate from backup input, imported history does not increment count and historical review answers are not replayed. Sync remains paused afterward. See [account backup evidence](docs/verification/2026-10-09-account-backup.md).

## October 16 feature completion

Anonymous snapshot conflicts now support explicit skip, history association, selected count/definition replacement and separate entries. Anonymous complete-backup restore supports field selection. Both retain the preview/confirmation and durable import recovery boundary. macOS has a native Settings window and accepts a single local JSON drop into an import preview.

Foreground synchronization retries transient failures with a bounded schedule and restarts on network recovery. Original frozen requests remain unchanged. Account reminder selection is versioned on the backend and requires migration `0006_reminder_device.sql` plus `reminder-device-v1`; this is prepared and locally tested, not deployed by this change. Permission, actual notification delivery, signed sharing and hosted two-device OAuth/sync remain acceptance items. See [October 16 verification](docs/verification/2026-10-16-gap-closure.md).
