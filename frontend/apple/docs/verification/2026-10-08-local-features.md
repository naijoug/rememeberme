# 2026-10-08 native local features

This extends [foundation verification](2026-10-08-foundations.md). The implementation goal remains active; no full-release claim is made. All automated vocabulary and capture data were synthetic, and stores/build output used disposable directories.

## Implemented since the foundation record

- Shared editor/paste/type/notes flows, independent bundled English and cached Chinese lookup, explicit refresh/save, literal definition/example rendering and immutable encounter snapshots.
- Complete backup export, legacy-loss confirmation, anonymous merge/replacement restore, conflict choices, progress and pre-publication cancellation.
- Bounded list/history loading, complete timestamp display with out-of-range preservation, native appearance settings and local review sessions.
- Durable review quota/admissions, version/event checks, separate forgotten counts, DST date handling, optional nonrepeating notification scheduling.
- Embedded iOS Share Extension, immutable durable App Group file protocol, main-app draft storage before acknowledgment and explicit confirmation. Shared origins stay separate from encounters and survive complete backups.
- Source-versioned V1/V2/V3 store models and known-model migration with `pre-upgrade-recovery.sqlite`, preservation on unknown model versions, and monotonic review CAS values through schedule clearing/restoration.

## Evidence

| Check | Observed result and limit |
| --- | --- |
| RememberMeCore Swift Testing | 40 tests passed, including real disk save failures, migrations, review quota/version invariants, concurrent capture writers, duplicate capture requests, unsafe backup version/key rejection and mocked providers |
| RememberMeUI Swift Testing | 5 presentation-model tests passed: backup/restore, paging, import cancellation, stale lookup prevention and source-preserving share confirmation |
| iOS XCUITest | 2 tests passed on iPhone 17 Pro Simulator / iOS 26.5 / arm64: add/record/relaunch/reset/delete and manual editing/review independence |
| Mac compilation | Current shared UI/store built for arm64/macOS deployment target 14; this is not Mac interactive acceptance |
| iOS compilation | iOS app and embedded Share Extension built with deployment target 17, unsigned, including both simulator architectures in the generic build |
| Dictionary integrity | Source and Mac/iOS Bundle copies verified against 260 pinned SHA-256 files, including metadata and licenses |
| Shared contracts | Node reference and three JSON Schema meta-schemas/legacy acceptance and backup fixture checks passed; schema-specific finite/UTF-16 conditions also have runtime validation |
| Clean source snapshot | Both targets and their Bundle resources built from source-only temporary copies with fresh DerivedData; core tests and separate-process import/share recovery checks passed without using checkout build output |
| Separate-process capture recovery | One process saved a draft; another exited after store commit but before shared-file acknowledgment; the retry retained exactly one pending draft, zero words/operations and removed the shared file |

The source/build/test commands are in [testing](../testing.md). Xcode results are under disposable `/tmp/rememberme-ios-build/Logs/Test`; no production fixtures or provider requests were used by these checks. UI-test launches explicitly skip notifications and App Group draining.

## Mac UI failure and unresolved platform acceptance

The unsigned Mac UI runner hung before establishing a test connection. An ad-hoc-signed attempt then found unwritable stale output; a fresh ad-hoc-signed output directory compiled but failed to initialize UI testing with “Timed out while enabling automation mode.” No Mac UI assertions ran, so none are counted as passed. A read-only computer-use inspection also timed out and provides no UI evidence. Original test processes were subsequently inspected and confirmed terminal; no overlapping watcher or second active test was started.

Real Mac keyboard/window interactions, iPhone/iPad layout/accessibility, signed App Groups and sharing from actual hosts, native import/export dialogs, live provider diagnostics, notification delivery/foreground/background routing and physical-device behavior remain unverified. The App Group/bundle IDs are provisional; no team, group registration or provisioning was created. The original foundation performance numbers apply to that earlier debug fixture run, not automatically to current-model copies over existing large data.

## Remaining implementation

Abandoned import recovery/pruning and large existing-store copy optimization, richer source-conflict resolution, authentication/Keychain, unified API/outbox transport/checkpoints/conflicts, account ownership binding and all associated service/device acceptance remain unfinished. Backend directories still contain no runtime. Remote CI is configured but has not been observed running. After the clean-snapshot run, backup version/key guards and stale-editor invalidation were tightened; their added tests passed in the final 40-test core run and 5-test presentation run. The earlier snapshot result is not claimed as a test of later edits.
