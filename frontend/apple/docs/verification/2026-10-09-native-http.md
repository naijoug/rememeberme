# Native HTTP / Worker / D1 integration — 2026-10-09

The native sync path now has an integration harness that runs the real Swift repository/session/coordinator and URLSession transport against the bundled Hono Worker in local workerd with D1. These checks go beyond separately mocked native transports and Worker unit tests. They do not establish hosted OAuth, signed devices or production deployment.

## Harness boundaries

`backend/scripts/verify-native-sync.mjs` creates a fresh temporary `rememberme-native-sync-*` directory, a dedicated local Miniflare/workerd instance, two devices for one synthetic account and a third isolated account. It applies the checked-in migrations and injects synthetic credentials directly into that disposable D1 binding. There is no test login/seed endpoint in the Worker. Node listens only on a random `127.0.0.1` port and forwards actual HTTP requests to the Worker; outbound Worker provider requests are rejected, CF data fetching/telemetry are disabled, and runtime/store/credential files are cleaned after the run.

`RememberMeProbe native-sync FIXTURE_CONFIG ACTION` is executable-only test code. It requires the dedicated directory marker, synthetic user/device prefixes and an IPv4 loopback HTTP origin. Its temporary file vault is separate from production Keychain; credentials are written with mode 0600 and never included in reports. Normal apps retain HTTPS Settings, Keychain and explicit ownership/sync behavior. Each probe invocation is a separate process opening the same device's temporary SQLite store and fixture vault.

Miniflare is pinned as a direct development dependency at the same version already resolved by Wrangler. The installed Miniflare 5 exposes `convertV4MiniflareOptions`; the harness uses that exported converter rather than passing the older constructor shape directly. The npm package/lockfile remain in sync, with the install audit reporting zero vulnerabilities. No global npm/runtime was replaced.

## Observed scenarios

- Two Swift device processes independently import the identical raw legacy file, each with count 0.5 and 26 historical events, then each records one separate offline click. Their ownership previews are read-only and queue original baseline/intents only after local confirmation; no word request is sent during preparation.
- Device A begins with an expired access token. The real `/api/v1/auth/refresh` endpoint rotates its credentials once; reopened processes use the persisted rotated fixture credentials rather than refreshing the old token again.
- The HTTP proxy closes the connection only **after** the Worker has committed the seed. The Swift process records a retry, freezes request identity/body and calls `_exit` without repository/session teardown. A fresh process reopens the same store and resends the identical request. Device B's same baseline has the same request identity/content. D1 retains one receipt and one baseline count.
- After both queues and history pulls finish, each device has count **2.5**, exactly **28** events and the original 26 source-derived IDs in retained source order. Each retains its own private history locally; default wire events omit context and URL, and D1 has no nonempty private source fields.
- A separately confirmed legacy merge adds count 0.5 once and another 26 distinct events: count **3**, history **54**. Manual unknown count crosses the actual wire/D1 boundary as null. A real review submission reaches step 0 on both clients while count remains 3.
- Device A prepares an offline reset before device B's later click. Pulling the new state does not silently rebase that reset: the real server returns VERSION_CONFLICT, the local reset/input remains visible for resolution, and confirmed cloud-value selection returns count **4**.
- A deletes the lifecycle. B records over its earlier offline live base and then reconnects; the Worker returns ENTRY_DELETED and the lifecycle remains a tombstone. The third account's full pull returns no entries from the shared account.
- The fixture changes the D1 user's epoch and adds a pending local word on A. Sync observes the new epoch, suspends the old queue and sends no operation. This is an epoch-change simulation, not a database backup restoration exercise.
- The new read-only `ServerSnapshotLoader` then downloads the new epoch through actual HTTP, including tombstones, null count and 55 shared-history events. It binds a fixed snapshot boundary and each history scan's entry version. The old active store remains in epochConflict with its pending word; no checkpoint or old queue is reset/replayed. This is the read side of recovery, not a completed reconciliation/publication UI.

## Commands and evidence

From the corresponding packages, with disposable build/cache paths:

```sh
# Build the standalone native fixture executable.
cd frontend/apple/Packages/RememberMeCore
env CLANG_MODULE_CACHE_PATH=/tmp/rememberme-swift-modules \
  SWIFTPM_MODULECACHE_OVERRIDE=/tmp/rememberme-swift-modules \
  swift build --disable-sandbox --scratch-path /tmp/rememberme-swift-build \
  --cache-path /tmp/rememberme-swift-cache

```

Then from `backend/` (the build is explicitly a dry run):

```sh
npm run build
npm run test:native -- /tmp/rememberme-swift-build/arm64-apple-macosx/debug/RememberMeProbe
```

The backend commands run in `backend/`, using its Node 22.22.3/.nvmrc and lockfile. Use the actual `swift build --show-bin-path` result when the architecture/path differs. The test does not deploy, sign/install an app or change user vocabularies.

| Check | Observed result |
| --- | --- |
| Swift/HTTP/workerd/D1 harness | Passed all scenarios above, including explicit refresh-call count and frozen-body/receipt checks |
| Core Swift tests | 96 tests passed; new snapshot cases cover fixed boundaries/versioned retained order/tombstones, mid-download epoch/boundary/position changes and cancellation |
| Existing separate-process recovery script | Passed import/share/frozen-wire `_exit` cases with the rebuilt probe |
| Backend typecheck and harness syntax | Passed |
| Mac/iOS Simulator unsigned builds | Passed with the new snapshot module |
| `git diff --check` | Passed |

The Apple CI workflow now builds the local Worker bundle and runs this native HTTP integration on its Mac runner. Remote CI has not been observed. The standalone probe entry file was renamed from main.swift to Probe.swift so SwiftPM can build the multi-file `@main` executable; application entry targets are unchanged.

## Remaining acceptance

Full epoch reconciliation choices and atomic publication, online account-backup restoration, source consent/enrichment UI, broader conflict field selection and large-account sync/restore budgets remain unfinished. The harness uses two independent Mac CLI processes/stores, not a Mac and iPhone app signed into hosted OAuth. Actual OAuth/environment configuration, deployment, physical-device sharing/notifications, accessibility and complete release acceptance remain outstanding. The overall Apple goal remains active.
