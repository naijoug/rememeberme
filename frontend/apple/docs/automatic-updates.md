# macOS automatic updates

The macOS application uses Sparkle **2.10.1**, pinned in `project.yml` and the
Xcode workspace's `Package.resolved`. Sparkle is linked only by the Mac app;
the shared Core/UI Swift packages and iOS app do not depend on it.

The RememberMe menu and Settings → Updates offer **Check for Updates…**.
Automatic checks default on (Sparkle's daily interval); automatic downloading
and installation default off and can be enabled in Settings. Sparkle presents
download progress, errors, installation and relaunch actions. Automatic installs
normally finish at application quit. Preferences are owned by Sparkle's defaults,
not duplicated in the vocabulary database. Disposable UI-test stores disable the
updater entirely.

## Trust and hosting

- Personal public repository: `naijoug/rememeberme`.
- Stable signed feed: `https://github.com/naijoug/rememeberme/releases/download/macos-stable/appcast.xml`.
- Immutable archives: `macos-vVERSION` GitHub releases.
- Ed25519 Keychain account: `naijoug.rememberme`. Only the public key is in
  `Configuration/Mac-Info.plist`. Never export the private key into source,
  command arguments, build logs, releases or chat.
- Both the feed and the archive require valid signatures. The archive is
  verified before extraction. Invalid-feed failures do not expire into an
  unsigned-feed fallback. Downloads use HTTPS and system profiling is disabled.
- Update requests go to GitHub/CDN endpoints and include normal connection and
  app-version metadata. Vocabulary, account credentials and source sentences
  are not sent by the updater.

The current personal channel retains the existing **ad-hoc, unsandboxed** local
distribution. It is not Developer ID signed or notarized; no company signing
identity is selected. This retains the existing Application Support location
and Keychain identity. The signing of update archives is independent of Apple
code signing.

The Xcode target remains sandbox-capable: `Mac.entitlements` declares the existing
network/file access plus Sparkle's two installer Mach services, and the source
Info.plist enables the installer XPC service. The local ad-hoc packaging step
explicitly disables that service and does not apply sandbox entitlements, matching
the currently installed app. A future move to sandboxed/Developer ID distribution
requires a separate data-location and signing migration; do not silently change
this release channel's sandbox policy.

## Build, sign, publish

Prerequisites: Xcode/XcodeGen, the pinned official Sparkle distribution tools,
the `naijoug.rememberme` signing key in the login Keychain and personal GitHub
access. Build tools never create or silently replace a signing key.

For each release, increase **both** the Mac target's `MARKETING_VERSION` and
numeric `CURRENT_PROJECT_VERSION` in `project.yml`, regenerate Xcode, and add
release notes. Build numbers must strictly increase even for a rollback release.

From `frontend/apple`:

```sh
xcodegen generate
xcodebuild -quiet -project RememberMe.xcodeproj -scheme RememberMeMac \
  -configuration Release -destination 'generic/platform=macOS' \
  -derivedDataPath /tmp/rememberme-updater-build \
  -clonedSourcePackagesDirPath /tmp/rememberme-updater-packages \
  'ARCHS=arm64 x86_64' ONLY_ACTIVE_ARCH=NO CODE_SIGNING_ALLOWED=NO build
```

From the repository root, substituting the new version and verified tools path:

```sh
python3 frontend/apple/scripts/package-macos-update.py \
  --app /tmp/rememberme-updater-build/Build/Products/Release/RememberMe.app \
  --sparkle-tools /absolute/path/to/Sparkle-2.10.1/bin \
  --output frontend/apple/.output/macos-VERSION \
  --notes frontend/apple/docs/releases/VERSION.md
```

The package step verifies identity, public-key match and universal architectures,
signs nested code explicitly, preserves framework symlinks with `ditto`, signs
and verifies the archive/feed, and writes checksums to `release.json`. Output
must be a new directory; do not replace already released archive bytes.

After verification and committing the exact application source, publish:

```sh
python3 frontend/apple/scripts/publish-macos-update.py \
  frontend/apple/.output/macos-VERSION \
  --sparkle-tools /absolute/path/to/Sparkle-2.10.1/bin
```

The first feed publication additionally requires `--initialize-channel`. The
publisher checks the personal GitHub identity/repository, signatures, checksums,
clean committed Apple source and increasing build number. It publishes the
immutable app release and verifies its public download before advancing the feed.
An app-upload/download failure leaves discovery on the previous release. If advancing an existing feed fails, the publisher attempts to restore the previous signed feed. An
existing version's archive is never overwritten. The mutable `macos-stable`
release is marked prerelease only to keep this infrastructure entry out of
GitHub's latest-app release selection; its appcast items are the stable channel.

Do not hand-edit an already signed appcast. Re-sign every metadata change.
Losing the only signing key prevents this ad-hoc channel from issuing trusted
updates; retain the login Keychain through the user's normal secure backup process.

## Verification

`scripts/verify-macos-updater.py` uses the official `sparkle-cli` built from the
pinned Sparkle source. It generates unique, disposable app identities and tests
real discovery, download, installation, no-update behavior, unavailable feeds,
tampered feed rejection and tampered archive rejection. A separate SQLite fixture
must remain byte-identical. It never targets or launches the user's app.

```sh
python3 frontend/apple/scripts/verify-macos-updater.py \
  --sparkle-cli /absolute/path/to/built/sparkle.app \
  --sparkle-tools /absolute/path/to/Sparkle-2.10.1/bin
```

The official tool can be built from the package checkout using the
`sparkle-cli` Xcode scheme and disposable DerivedData. See the
[executed verification](verification/2026-10-26-auto-updates.md) for actual results
and distinctions between fixture installation and installed-app UI acceptance.

Existing pre-0.2.0 apps have no updater and need one bootstrap replacement.
Subsequent releases use Sparkle to replace the app bundle; vocabulary, Keychain
credentials and other Application Support files are outside that bundle.

References: [Sparkle integration](https://sparkle-project.org/documentation/),
[SwiftUI setup](https://sparkle-project.org/documentation/programmatic-setup/),
[sandbox requirements](https://sparkle-project.org/documentation/sandboxing/),
[signed publication](https://sparkle-project.org/documentation/publishing/).
