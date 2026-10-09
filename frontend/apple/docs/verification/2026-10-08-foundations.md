# 2026-10-08 Apple implementation foundations

This record covers implemented foundations, not the complete native release. All test vocabulary was synthetic and stored in disposable directories; no extension or real vocabulary was imported.

## Environment

- Development host: Apple Silicon Mac, macOS 26.5.2.
- Xcode 26.6 (17F113), Swift 6.3.3, Node 22.22.3, XcodeGen 2.44.1.
- iOS Simulator test device: iPhone 17 Pro, iOS 26.5, arm64. Other installed simulator runtimes were observed but not tested.
- Signing identity inspection found five valid certificates; no team was selected, no provisioning was created and App Groups was not validated. Registered iPhones were offline. No certificate/private key was exported; device IDs and signing identities are not copied into repository configuration.

## Executed checks

| Check | Result and scope |
| --- | --- |
| Node reference | Shared legacy acceptance/rejection, ECMAScript trimming/normalization, byte-based source/event IDs, backup downgrade/restore choices and review-v1 fixtures passed |
| JSON Schema | Three draft-2020-12 meta-schemas, legacy positive/negative corpus and new backup fixture passed with temporary jsonschema 4.25.1; schema whitespace corrected to match ECMAScript |
| Swift package | 17 Swift Testing tests passed using temporary disk stores; XCTest reports zero because these tests use Swift Testing |
| Separate process recovery | Probe `_exit` before publication reopened with 0 words/0 operations; after publication reopened with 1/1; independent Swift identity report matched Node golden fixtures |
| macOS target | Built for arm64/macOS deployment target 14 using local packages, unsigned, disposable DerivedData |
| iOS target | Built for Simulator deployment target 17 using local packages, unsigned |
| iOS UI test | One XCUITest passed: add, record, terminate/relaunch, reset retaining history, deletion cancellation and confirmed deletion. Stores used unique app-container temporary paths |

Commands are in [testing](../testing.md). Xcode result bundles and build output were left under `/tmp/rememberme-ios-build` and `/tmp/rememberme-mac-build`, not committed. Local Xcode emitted a debugger-version diagnostic, but the final UI result was successful. Early UI runs found missing explicit Cancel and an empty-list state; both were fixed and the same affected flow rerun successfully. No result from those failed runs is counted as a pass.

## Debug performance baseline

The final indexed probe generated and imported 10,000 synthetic entries with 100,000 encounters into a fresh SQLite store. This includes fixture generation, JSON decode/preview, 100-entry staging batches and publication; it is not an iPhone or release-build measurement.

| Metric | Observed |
| --- | --- |
| End-to-end generation/import | 71.07 seconds |
| Search first-page p95 (30 queries) | 9.14 milliseconds |
| Process peak RSS | 454,901,760 bytes (433.8 MiB) |

An earlier benchmark exposed a missing history fetch index and was deliberately stopped after the defect was identified. The final run used composite history/list indexes. Initial development-Mac debug budgets are 90 seconds generation/import, 512 MiB peak RSS and 300 ms search p95; all three passed. Existing-store candidate copies, release builds, UI scrolling and physical iPhone performance remain unverified.

## Remaining work

The implementation plan remains active. Lookup, complete editing/backup/restore and paging UI, review sessions/notifications, Share Extension, credential/account binding and unified backend sync are unfinished. Physical Mac/iPhone acceptance, App Groups, upgraded-model recovery, accessibility and actual provider/service diagnostics remain outstanding. CI configuration is checked in but remote CI has not run. No claim is made that the first release or stages requiring these checks are complete.
