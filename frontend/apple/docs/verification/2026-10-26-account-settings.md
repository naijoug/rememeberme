# macOS account settings — 2026-10-26

## Implemented behavior

- Native Settings opens on Account, with separate General and Privacy tabs. Account shows GitHub identity, available word count, sync status, pending changes and a reviewed device-word import action. Source privacy is a collapsed advanced disclosure; conflict/recovery confirmations remain available when needed.
- Fresh GitHub login uses the canonical service without an API-address field. Saved origins remain respected. Successful login selects account vocabulary, downloads its words, checks capabilities/recovery state and enables synchronization. Anonymous device words are not copied by login.
- Existing selected accounts preserve explicit pause/recovery state on restart. Cached account words stay selected after download failure; incomplete downloads expose retry.
- Device-word import pauses synchronization for the existing core ownership boundary. Cancel restores the previous sync preference. Confirmation publishes selected changes, enables sync and runs bounded synchronization; remaining work uses the existing foreground retry scheduler. Original device words are retained.
- Added an aggregate entry count scoped to the active owner/generation and excluding deleted entries.

## Executed validation

- RememberMeCore: 132 tests passed using temporary stores and synthetic providers.
- RememberMeUI: 35 tests passed, including automatic sign-in activation, account-word selection, anonymous isolation, paused restart, offline retry, recovery fencing, preview cancellation and immediate post-confirmation sync.
- macOS arm64 Xcode build: passed using `/tmp/rememberme-settings-mac-build`.
- iOS Simulator Xcode build: passed using `/tmp/rememberme-settings-ios-build`. The shared settings UI test assertions were updated, but the simulator UI suite was not executed in this task.
- Final macOS bundle: ad-hoc signed and passed `codesign --verify --deep --strict`.
- `git diff --check`: passed.

## Local application update and limits

Updated `/Users/guojian/Applications/Remember Me.app`, preserving bundle ID `com.rememberme.app.mac` and the prior ad-hoc signing approach. The original app was quit through its native menu before the initial update. The original bundle and a stopped-app data copy are retained under `/Users/guojian/Library/Application Support/RememberMe-UpdateBackups/2026-10-26-account-settings-1fb0567d/`. Live vocabulary and Keychain were not replaced.

The updated application launched and its main window was observed. Opening Settings then failed because the native UI inspection connection closed. Re-querying and resetting the tool did not restore it. Process inspection confirmed the app was still running, with no new RememberMe crash report. Therefore this task does not claim final Settings screenshots, actual GitHub sign-in, live cross-device sync or completed visual acceptance.

The final foreground-continuation adjustment was rebuilt and installed atomically for the next app launch. Its non-executable resources were verified identical to the already-running candidate, the running process and live data were left intact, and the intermediate bundle was retained alongside the original backup. Quit and reopen the app to load this final binary.

Final installed SHA-256:

- `Contents/MacOS/RememberMe`: `d335034cda89b9fcf1b0a92b4420e807a5ae9d8bfaa17b7c860ce055eda7b279`
- `Contents/MacOS/RememberMe.debug.dylib`: `13efb713fea607d4551cf163dc91767cb11186d9c95e6f440cd97bf0358e362d`

## Documentation/code reconciliation

1. `README.md` Native account connection and `docs/behavior.md` Account connection described a user-entered HTTPS origin. `AccountConnection.swift` now defaults to the canonical service and removes that field. Both documents were updated; existing saved origins are still supported internally.
2. Those sections described login, account selection and enabling sync as separate steps. `AccountVocabulary.swift` now activates the account on successful login and restores the selected account on startup while preserving explicit pauses. Both documents now describe the implemented automatic flow.
3. Ownership descriptions covered enabling a queue after confirmation, without immediate sending or restoration after cancellation. `AccountVocabulary.swift` now runs sync after confirmation and restores the previous preference on cancel; README, behavior and testing guidance were updated. The core still requires a paused ownership preview/publication boundary.
