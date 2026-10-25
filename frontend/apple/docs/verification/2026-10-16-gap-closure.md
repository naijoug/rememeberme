# Apple plan gap closure — 2026-10-16

## Scope

The implementation plan was updated first to separate implemented behavior, five functional gaps and unfinished device/hosted acceptance. Work used the existing checkout, including pre-existing uncommitted changes; no deployment, signing registration, account login or real vocabulary migration occurred.

Implemented in this checkpoint:

- **G1:** Anonymous cross-source snapshot preview offers explicit skip, history association, selected count/definition replacement and separate lifecycles. Association preserves the existing count and retains distinct event IDs/source aliases. Separate IDs are source-derived and stable across previews; published-source suppression and frozen-plan resume remain intact. Event ownership checks query incoming event IDs instead of loading all store history for every conflict. Account ownership remains a separate operation.
- **G2:** Anonymous complete-backup merge supports separate count, definition, notes, review schedule, spelling, type, capture source and deletion choices. Unselected values remain current; later history stays, review events are not replayed, and immutable-event/tombstone checks still apply.
- **G3:** A production `NWPathMonitor` and bounded foreground scheduler retry on network recovery and transient failures. Delays are 2/4/8/16/32/60 seconds; persisted wire backoff still gates submission. Disabling sync, account/vocabulary switching or backgrounding all vocabulary windows cancels the flight. Retry exhaustion retains the queue. Network recovery can refresh reminder preferences even while vocabulary sending is paused.
- **G4:** SQLite migration 0006, additive `/me.reminderDevice`, capability `reminder-device-v1` and a compare-and-set selection endpoint support one account reminder device. The target derives from the authenticated device. Late/stale reclaim and another device's release are rejected. Native Settings reconciles unknown outcomes without automatically reclaiming; restore publication checks prevent publishing a selection older than the preview. Local notification permission/toggle remains separate. Offline schedules can continue until a device learns the transfer.
- **G5:** macOS uses a native Settings scene and Command-comma. A single local JSON drop opens an extension-snapshot preview without importing; full backups retain their explicit restore entrypoints.

## Automated verification

| Check | Result and scope |
| --- | --- |
| Core Swift suite | 127 passed in final serial run; temporary disk stores and synthetic providers |
| Presentation Swift suite | 28 passed; includes source preview/drop, bounded retry scheduling/cancellation, reminder handoff and lost response |
| Backend typecheck | Passed with Node 22.22.3 |
| API/gateway Vitest | 60 passed / 12 files via `npm test -- tests/*.test.ts`; includes migration 0006, two-device selection, stale/revoked requests and account isolation |
| Backend build | Node bundle passed; not deployed |
| Shared contracts | TypeScript fixtures, all JSON schemas and new shared reminder fixture passed |
| Independent process recovery | Publication before/after exit, copy/stage/ready resume, shared inbox acknowledgment and frozen wire/identity/backoff passed |
| Real native HTTP | Swift/URLSession → local Node/SQLite passed, including new reminder claim/handoff/fresh-process read/release and existing auth/response-loss/privacy/restore/epoch cases |
| App builds | macOS arm64 and generic iOS Simulator builds passed with signing disabled |
| Packaged dictionary | Both built App Bundles verified, 260 files each |
| iPad Simulator UI | 4 passed / 0 failed / 0 skipped, iPad Pro 11-inch (M5), iOS 26.5 Simulator |
| Whitespace | `git diff --check` passed |

The core suite also passed repeatedly in parallel. One final parallel run overlapped Xcode compilation/simulator startup and failed only the pre-existing wall-clock assertion in `deadlineCoversFullTransportAndFailureIsNotCached`: 5.128 seconds against a 1-second bound. The unmodified test and all 127 tests passed with `--no-parallel`; this is recorded as timing sensitivity rather than a hidden passing run.

The broad backend `npm test` discovery also collected `scripts/cloudflare.test.mjs`, which uses `node:test` rather than Vitest, and the unrelated bridge tests could not listen on loopback in the sandbox. The scoped API/gateway command passed. This checkpoint does not claim that the unfiltered backend command passes. The native HTTP harness initially hit the same loopback sandbox restriction; its approved local-only rerun passed. Xcode initially could not write its caches/access CoreSimulator; normal local unsigned builds passed. JSON-schema validation used a disposable `/tmp` virtual environment with `jsonschema==4.25.1`; repository dependencies were unchanged.

## Actual Mac observation

Launched `/tmp/rememberme-gap-mac-build/Build/Products/Debug/RememberMe.app` with `-rememberme-test-store ui-40FC315D-D3A5-4E50-AC29-07B04A013A73`. The new store was empty. Command-comma opened **RememberMe Settings**, with accessibility window ID `com_apple_SwiftUI_Settings_window`; appearance, reminder, disconnected account and anonymous vocabulary controls were present. Closing Settings returned to the original empty vocabulary window. The isolated application was then quit. No sign-in or notification request occurred. This verifies native Settings presentation, not full VoiceOver, notification delivery or actual Finder drag/drop.

## Reproduction

From the repository root, Swift package tests used separate `/tmp/rememberme-progress-core-build` and `/tmp/rememberme-progress-ui-build` scratch paths, corresponding module/cache directories, `--disable-sandbox`, and the final core run used `--no-parallel`. The packages have no external dependencies.

```sh
/Users/guojian/.hermes/node/bin/node --experimental-strip-types contracts/reference.ts
/tmp/rememberme-gap-schema-venv/bin/python contracts/verify-schemas.py
python3 frontend/apple/scripts/verify-process-recovery.py /tmp/rememberme-progress-core-build/arm64-apple-macosx/debug/RememberMeProbe
```

From `backend/`, with `.nvmrc` Node and `npm ci`:

```sh
npm run typecheck
npm test -- tests/*.test.ts
npm run build
npm run test:native -- /tmp/rememberme-progress-core-build/arm64-apple-macosx/debug/RememberMeProbe
```

From `frontend/apple/`, unsigned App builds used `/tmp/rememberme-gap-mac-build` and `/tmp/rememberme-gap-ios-build`. UI tests use the existing disposable `ui-UUID` arguments and do not access user stores or accounts.

```sh
xcodebuild -quiet -project RememberMe.xcodeproj -scheme RememberMeiOS \
  -destination 'platform=iOS Simulator,id=52DE7123-D5D7-4DDE-B2F1-7E2E5D7D1B64,arch=arm64' \
  -derivedDataPath /tmp/rememberme-gap-ios-build \
  -resultBundlePath /tmp/rememberme-gap-ipad-ui.xcresult CODE_SIGNING_ALLOWED=NO test
xcrun xcresulttool get test-results summary --path /tmp/rememberme-gap-ipad-ui.xcresult
```

The result bundle confirms four passes with no skipped/expected-failure cases. They cover account settings remaining anonymous, interrupted-import resume, editing/learning without rewriting counts/history, and relaunch/reset/delete behavior. This is simulator regression evidence; it does not prove physical-device or hosted behavior. Xcode emitted debugger-version diagnostic warnings but completed the run successfully. Final incremental builds also include the last network-recovery preference-refresh change.

Local logs: `/tmp/rememberme-gap-core-serial.log`, `/tmp/rememberme-gap-ui.log`, `/tmp/rememberme-gap-backend-tests-scoped.log`, `/tmp/rememberme-gap-native-http.log`, `/tmp/rememberme-gap-process.log`, `/tmp/rememberme-gap-mac.log`, `/tmp/rememberme-gap-ios.log`; simulator summary: `/tmp/rememberme-gap-ipad-ui-summary.json`. Temporary paths are evidence from this local run, not permanent CI artifacts.

## Remaining gates

Migration 0006 and the new backend capability are **not deployed** by this task. Existing servers without the capability cannot enable account reminder selection. Hosted OAuth, signed iPhone/App Groups/real-host sharing, real notification permission/delivery/cold-start routing/device transfer, physical-device two-way sync, large complete-backup restoration, Release/iPhone memory and full accessibility acceptance remain open. Actual Finder drag/drop and the new conflict controls on physical devices also remain platform acceptance items. Local tests and simulator results do not close these gates.
