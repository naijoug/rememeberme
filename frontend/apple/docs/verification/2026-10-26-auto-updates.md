# macOS automatic updates — 2026-10-26

## Implementation and trust

The Mac app pins Sparkle 2.10.1 at revision `ab7d71291238df6e0492143b120c9b696a35f603`.
Official distribution archive SHA-256 `1a856d2a9edb8e628de88121d7be04cf0e2167f8641650b78fca00b14244cf27`
matched the GitHub release asset digest. SwiftPM independently verifies its binary
artifact checksum. Sparkle's license notices are included in the app resources.

The app menu and Updates settings tab expose manual checking and optional automatic
download/install. Automatic checks default on. Both the appcast and archive are
Ed25519 signed, with archive validation before extraction and signed-feed failures
configured to fail closed. The dedicated private key remains in the login Keychain
under `naijoug.rememberme`; only its public key is committed.

## Executed checks

- Universal Release build: macOS arm64 and x86_64 passed.
- iOS Simulator compatibility build: passed; Sparkle is not linked by iOS or shared Swift packages.
- RememberMeUI: all 35 presentation tests passed. The unchanged core suite's 132-test result is recorded in the preceding account-settings task; it was not rerun just for the updater.
- Six release-policy tests passed: correct identity/channel, fail-closed signing policy, public-key format, numeric build identifiers and literal XML metadata.
- Packaging: nested ad-hoc code signatures verified, ZIP extracted successfully with framework symlinks preserved, extracted bundle metadata matched, archive/feed Ed25519 signatures verified.
- Actual Sparkle end-to-end fixture: signed update discovery; tampered feed rejection; tampered archive rejection without app replacement; unavailable-feed failure preserving the installed version; signed download/install from build 1 to build 2; current-version handling without reinstall. A separate SQLite fixture remained byte-identical. Tests use unique app identities and never target the real application.
- The official `sparkle-cli` was built from the pinned source and used for these noninteractive integration checks. Its own UI is not substituted for the app's menu/settings UI.

Swift 6.3.3 crashed during optimized compilation when passing a MainActor method
reference directly as a SwiftUI Binding setter. Explicit setter closures compiled
successfully on both architectures; no compiler flags or isolation checks were disabled.

## Documentation/code discrepancy

The existing Xcode target enables sandboxing, while the installed personal app's
ad-hoc signature has no sandbox entitlements and uses user Application Support.
The old README described storage through the app sandbox without this distinction.
The README and automatic-updates guide now distinguish the two. The new Mac
entitlement file supports Sparkle in sandbox-signed builds; the personal packaging
script preserves the existing unsandboxed distribution and disables the unneeded
installer XPC switch. No company signing certificate is used, and this release is
not notarized. Data-location or Developer-ID migration is separate work.

## Release and installed acceptance

Publication and installed-app observations are appended after execution. The
fixture results above alone do not establish GitHub availability, a completed
installed-app relaunch, preservation of a real Keychain prompt state, or notarization.


Installed bootstrap acceptance before publication:

- Installed and launched 0.2.0 (build 2) at `/Users/guojian/Applications/Remember Me.app`.
- Previous app and stopped-app data backup: `/Users/guojian/Library/Application Support/RememberMe-UpdateBackups/2026-10-26-updater-1bbd23df/`.
- Native menu inspection confirmed an enabled `Check for Updates…` item.
- Opening Settings again closed the native UI inspection connection. The app remained running and no new RememberMe crash report appeared; final Updates-tab screenshot/interaction acceptance is not claimed.
- Installed executable SHA-256: `3ec5eafb064ab3dd367349317cef9b03bb968cdb9dbbc2da746de4b30267da15`.
- Final ZIP SHA-256: `106ade1b49986933238a9c17e81d5d59c2805c6ad783c2c12a98cfb86bdcbb35`.
- Final signed appcast SHA-256: `f752df86fba03cff2d3f057d1e8a2c162bfbba902423a196d5ec6f259465033f`.


Public publication after explicit user approval (2026-10-26, America/Los_Angeles):

- Published `macos-v0.2.0` as a public, non-draft, non-prerelease application release: https://github.com/naijoug/rememeberme/releases/tag/macos-v0.2.0
- Published `macos-stable/appcast.xml` as the signed production feed. The feed-hosting release is marked prerelease only to keep it out of GitHub's latest-app selection; the feed item itself is stable.
- Public archive (9,859,928 bytes) and feed SHA-256 matched the final signed local artifacts recorded above. The publisher completed successfully after verifying both downloads.
- A read-only probe with the official Sparkle CLI against `/Users/guojian/Applications/Remember Me.app`, using the feed embedded in that installed app and no URL override, returned `No new update available!` with exit code 4. This is the expected current-version result for installed 0.2.0 (build 2), and confirms the public signed channel is readable by Sparkle.
- No real vocabulary was uploaded, account session changed, or app reinstall triggered by this production probe. Real download/install and rejection behavior remain covered by the disposable fixture checks above.
