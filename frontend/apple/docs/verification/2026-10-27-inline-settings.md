# Inline macOS settings — 2026-10-27

## Change

Removed the standalone SwiftUI Settings scene. The sidebar action, Options → Settings and the app menu’s Command-comma command now select the settings page in the active vocabulary window. Account, General, Privacy and Updates share the existing window model; the page resizes with the window. Back to vocabulary preserves the previous word, and selecting a word leaves settings. iOS retains its settings sheet.

Updated README and behavior documentation that previously described a separate Settings window/scene. Those descriptions matched the previous implementation; this is an intentional behavior change, not a pre-existing documentation discrepancy.

## Executed checks

- macOS application build passed (arm64, Xcode, disposable DerivedData).
- iOS Simulator compatibility build passed; no iOS UI test was run for this change.
- `RememberMeMacUITests/VocabularyUITests/testMacSettingsStaysInVocabularyWindow` passed using a UUID-guarded disposable store and synthetic `bank` entry. The test verifies all four sections, unchanged window count, absence of a settings sheet, return to the selected word, Command-comma, and selecting the same word to leave settings.
- `git diff --check` passed.

Initial UI-test attempts used incorrect accessibility queries for the Mac word row and group headings. Corrected the queries to the native button/checkbox and actual section text, then reran successfully.

The passing Xcode result is `/tmp/rememberme-inline-settings-ui-final.xcresult`. Mac build and final iOS build logs are `/tmp/rememberme-inline-settings-mac.log` and `/tmp/rememberme-inline-settings-ios-final.log`.

## Visual evidence and limits

Settings within the vocabulary window: `../../.qa/verification/2026-10-27-inline-settings/settings-window.png` (local-only)

The screenshot is the actual test app window. Updater controls are intentionally disabled for disposable UI tests. The test did not authenticate, synchronize production vocabulary, change notification permission, or install an update. The installed application was not replaced during the initial settings change; the authorized follow-up installation is recorded below.

Xcode also reported a SwiftUI “Publishing changes from within view updates” warning during the initial vocabulary-row selection, before opening Settings. Assertions passed; at that checkpoint the warning’s baseline/source had not been established. The follow-up below resolves the warning. A separate Google Chrome crash was attached by Xcode; it was not a RememberMe crash. Neither is treated as a failed settings-navigation assertion or silently presented as a warning-free run.

## Follow-up: selection warning fixed and local app replaced

The navigation list previously wrote directly to `VocabularyModel.selection` (`@Published`) from its selection binding. Clicking a NavigationLink could invoke that setter during a SwiftUI view update. `RememberMeRootView` now binds the list to view-owned `@State` and synchronizes it to the model in `onChange`. Model-driven selection changes still update the list; opening Settings clears only the visible selection and preserves the return word.

- Mac `testMacSettingsStaysInVocabularyWindow` passed in `/tmp/rememberme-selection-state-ui.xcresult`. Its test details contain no runtime warnings; the exported application log contains neither the publishing warning nor other `[SwiftUI]` warning entries.
- iPad Simulator `testLocalWordSurvivesRelaunchAndResetRetainsHistory` passed in `/tmp/rememberme-selection-state-ios.xcresult`, covering model-driven selection after saving, relaunch, reset retaining history, and confirmed deletion with disposable data. The simulator reported a separate existing-configuration warning that support for all orientations will soon be required; this macOS task does not change iOS orientation policy.
- Universal Release build passed in `/tmp/rememberme-inline-settings-release`; all 260 packaged WordNet files and notices verified. Nested Sparkle code and the app were ad-hoc signed following the existing local packaging policy; deep/strict signature verification passed. The existing unsandboxed data location, bundle identity, feed trust settings and disabled installer launcher service were preserved.

The user authorized replacement of `/Users/guojian/Applications/Remember Me.app`. The previous app was moved to `/Users/guojian/Library/Application Support/RememberMe-UpdateBackups/2026-10-27-inline-settings-6n53cj76/Remember Me.app` before the prepared app was installed. The replacement executable SHA-256 is `33aa133da1015269b2333e8875a7ca58ef72e8f261702ed2302451d6ec8eed06`. This is a local rebuild of 0.2.0 (2); no release/feed was published or version number reserved.

The installed executable was verified running at the destination path. Actual installed-app inspection confirmed Command-comma opens Settings in the existing main window, the existing GitHub session and two account words remain available, and synchronization reports Up to date. No vocabulary edits or account-setting changes were made as part of installation acceptance.

## Scoped commit verification

Before committing, the Mac settings test was moved to the existing interrupted-import fixture (`original`, count 3), removing its dependency on the separately uncommitted original-sentence review fixture. The staged source was exported into a temporary directory without other working-tree changes. Its Mac build and `testMacSettingsStaysInVocabularyWindow` passed in `/tmp/rememberme-settings-commit-ui.xcresult`; the test result reports no runtime warnings. The screenshots and earlier `bank` runs above remain historical verification evidence.
