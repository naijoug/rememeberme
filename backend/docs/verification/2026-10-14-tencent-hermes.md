# Tencent/Hermes verification checkpoint

Executed October 13-14, 2026 (Asia/Shanghai), against the working-tree refactor.
Node v22.22.3 on macOS arm64; both Node packages use their independent lockfiles.
No production vocabulary or server credentials were used as test fixtures.
Local checks were followed by the private host deployment recorded below.
This record does not establish a public service or installed-client acceptance.

This record contains chronological checkpoints. Earlier disabled-Hermes,
pre-deployment and pending-GitHub-secret statements describe those phases only.
The final checkpoint confirms the deployed private API/Hermes, server-side HTTPS
and configured GitHub credentials; public filing, exact extension callbacks and
completed hosted-client OAuth/sync remain unaccepted. See the
[current status summary](../tencent-deployment.md#current-recorded-status-2026-10-14).

## Implementation

The default backend now bundles Node/Hono with real SQLite WAL and the existing
SQL migrations/conditional transaction guards. Deployment templates provide a
dedicated systemd user, persistent database path and an additive HTTPS proxy site.
Hermes translation uses a private bearer-authenticated OpenAI-compatible profile,
toolset discovery, bounded JSON, request coalescing, a twelve-second deadline,
two concurrent lookups and bounded successful cache. It is not the dashboard API.
Both clients accept `hermes` alongside historical `mymemory` definitions.

The extension retains the original `local:words` snapshot, migrates anonymous data
into IndexedDB and partitions cloud accounts by origin/user. Local intent and
outbox commit together. Account copy and sync enablement require explicit choices.
Exact request bytes survive restart; count reset retains history. Conditional
versions cannot advance over unseen remote edits, including an additive
acknowledgment; no-op version adjustments propagate through later causal intents.
History scans persist across flights/reopening and restore positions. Outgoing
context/URL fields are always omitted. Conflicts/changed epochs pause sending.
Confirmed recovery archives the entire previous account partition/frozen queue
atomically before loading cloud state and stays paused; archives export as legacy
vocabulary JSON. Richer field merge remains in macOS.

macOS injects the authenticated backend Chinese provider into the lookup actor,
with origin/account cache namespaces, generation/cancellation fencing and explicit
connected errors. English lookup and disconnected MyMemory remain independent.
Existing native local stores, histories, ownership, backup/recovery and deletion
confirmation are retained.

## Executed checks

| Check | Observed result |
| --- | --- |
| Backend `npm ci`, `npm run typecheck`, `npm test` | Passed; 38 tests / 8 files |
| Extension `npm ci`, `npm run compile`, `npm test` | Passed; final full suite 233 tests / 28 files |
| Extension Chrome `npm run build` | Passed; generated output only |
| Swift Core `swift test` with isolated `/private/tmp` caches | Passed; 122 tests |
| Swift UI package `swift test` | Passed; 20 tests, followed by the two affected AccountConnection tests after the final guard change |
| Unsigned `RememberMeMac` Xcode build | Passed, including the final account/provider change |
| Shared Node reference fixtures | Passed |
| JSON Schema meta-schemas and shared legacy/backup/wire fixtures | Passed with jsonschema 4.25.1 in a disposable venv |
| Real native HTTP integration | Passed, including authenticated Swift translation through the Node/Hermes adapter with synthetic inference |
| Real extension client/repository HTTP integration | Passed with synthetic WXT storage/fake IndexedDB and real Node/SQLite |
| Extracted release smoke | Passed: loopback startup, liveness, protected 401, static page, secret-free archive, live WAL backup and new-path restore with fresh epochs |
| Existing local feedback service | Running; development assets reachable using `local:status` outside the filesystem/network sandbox |
| `git diff --check` and changed guide link checks | Passed |

Core/UI commands use `--disable-sandbox --scratch-path --cache-path` with separate
isolated paths as described in Apple testing docs. The initial Mac build failed
because the enclosing sandbox denied normal SwiftPM/cache writes; rerunning with
authorized Xcode cache access succeeded. Initial loopback HTTP tests were likewise
blocked by sandbox listener restrictions, then passed with authorized local-port
access. These permissions did not add a production test route.

HTTP commands run from `backend/` after building the API and standalone probe:

```sh
npm run test:native -- /private/tmp/rememberme-tencent-core-build/arm64-apple-macosx/debug/RememberMeProbe
npm run test:browser
npm run package:deploy
npm run test:release
```

Native HTTP covers refresh, shared baseline deduplication, committed response
loss/reopening, retained history, account backup field restore, source consent/
backfill/clear loss and stale-source fencing, conflicts/null/review/tombstones,
account isolation and online-rechecked epoch recovery. The new translation command
uses URLSession and the real authenticated client, while provider inference is
synthetic and external fetch is blocked.

The extension harness bundles the actual repository/backend client, starts a
random loopback HTTP server and uses disposable real SQLite. It verifies two
synthetic devices, exact committed-loss retry, refresh, cross-device count/history,
source omission, Hermes protocol, stale reset rejection, private recovery export
and restored-epoch pause. It does not run in an installed browser or touch Chrome
profile vocabulary. The archive includes no database, actual env file or secrets.

## Server evidence and remaining work

Authenticated dashboard inspection on October 13 and recheck on October 14:
Hermes v0.21.0 gateway running; API server disabled. The inspected instance is
Linux x86_64 with two cores, approximately 1.9 GiB RAM and 49.1 GiB disk. The model
shown was `glmcode / glm-5.3-flash`.

Initial TAT/SSH inspection failed and changed no server configuration. The user
subsequently authenticated the OrcaTerm shell as `ubuntu` on October 14.
Read-only host inspection found no existing Remember Me deployment and confirmed
Node v22.23.2, SQLite 3.51.3, Caddy, the existing dashboard and lesson-ledger service.

The uploaded release digest matched
`a35df442cd05b5370194b5b370f5a803071b6ff55330d7b25184c8ed52ddfea5`.
The API was installed additively under
`/opt/rememberme/releases/20261014-a35df442cd05/runtime`, with a dedicated system
user, root-only environment file and a new persistent SQLite database.
`rememberme-api.service` is enabled and active, bound only to `127.0.0.1:8787`.
Health returned `ok`, protected `/api/v1/me` returned 401, integrity and foreign-key
checks passed, and the database had zero user accounts. The initial live backup
at `/var/lib/rememberme/backups/bootstrap-20261014.sqlite` passed verification.
Caddy, lesson-ledger and hermes-dashboard remained active.

The planned `rememberme.couplelabs.cn` hostname did not resolve. An additive Caddy
site draft passed validation but was not imported. A separate Hermes service user
and private profile were prepared without keys or provider secrets. A transient
process using the installed Hermes under that user and read-only runtime mounts
successfully resolved empty tools, disabled memory/user profile, disabled profile
multiplexing and loopback port 8643. The service definition passed systemd
validation and remains disabled pending its private environment file.

The GitHub account's OAuth Apps list contained no app. An exact-callback form for
Remember Me was prepared without wildcard matching but not submitted. Creating
API/OAuth credentials through computer use requires action-time confirmation.
Chrome extension-manager navigation was blocked by browser policy; no workaround
or installation/reload was attempted, and the installed ID/permission state
remains unverified.

DNS, certificate provisioning, OAuth credentials, exact extension callback/origin
allowlists, Hermes provider credentials/private API key, live inference and hosted
macOS/browser sync remain pending. Existing local vocabulary and old JSON exports
were neither uploaded nor used as fixtures. See
[deployment instructions](../tencent-deployment.md) for the exact host paths.

The macOS archive extended-attribute warnings seen during initial extraction
prompted a packager change to omit extended attributes/AppleDouble metadata.
The updated local package passed extracted-release checks again, including
startup, authentication boundary, consistent backup, restore and epoch rotation.
It has not replaced the already-running host release.

No hosted OAuth, live Hermes, installed-extension IndexedDB upgrade/permission
flow, signed Mac/browser cross-client sync, public backup restore or hosted
large-vocabulary performance was verified. Chrome build/watcher health is not
proof that the browser loaded the update. CI workflows were updated but not
executed remotely. The aggregate extension partition still needs large-store
memory/quota/latency validation. Legacy export cannot express unknown cloud count:
the UI marks it as unknown, while legacy JSON projects it as numeric zero; use
native complete backup when that distinction must be preserved.

## After credential/domain confirmation on October 14

The isolated Hermes service was enabled with a separate API key, the existing GLM
credential and only the selected `providers.glmcode` registration. The private
configuration remains server-side. No personal gateway state or client vocabulary
was copied. The installed `/v1/toolsets` response uses an OpenAI-style list envelope
with `platform: api_server`; the adapter now validates this shape alongside the
legacy array and requires every toolset to be explicitly disabled. Missing flags,
wrong platforms and enabled toolsets are rejected before inference.

Backend typecheck and all 39 tests in eight files passed after the compatibility
fix. The release build and extracted release checks also passed. Archive digest
`80bfe7fb0c9db7f8dadd0592c956b2778c723d8ab11c4b6ce8352bc8578cd09f`
was checked on the host. A real authenticated loopback HTTP request through the
new runtime and actual isolated Hermes returned valid Chinese JSON with
`source: hermes` in about 11.5 seconds; a prior direct provider call took about
8.35 seconds. The HTTP check used an independent disposable SQLite account/session
and refused unauthenticated requests. It did not read the production database.
The runtime was activated only after this acceptance check and a consistent live
database backup. The old release and backup were retained.

The A record and scoped DNS-01 TXT record were added, and a trusted certificate was
issued through the existing production ACME account. A separate acme 5.8.0/josepy
2.2.0 environment was used without modifying Hermes dependencies. The serving key
is root/caddy-readable only, and the certificate expires January 12, 2027 at
09:40:43 Asia/Shanghai. It is manually loaded; automatic renewal is not configured.
The existing Caddy configuration disables its admin API, so two validated site
changes required short proxy restarts. Other site configurations were retained.
All inspected services were active afterward; server-local HTTPS health returned
200 for Remember Me and the existing lesson-ledger site, and translation capability
was enabled.

Mac curl/Node and Chrome public HTTPS requests failed with connection resets.
Public DNS showed the correct A record; Lighthouse already allowed TCP 80/443.
The public HTTP response redirected to the official DNSPod filing-block page.
The page explicitly reported that the site had not completed filing. These results
establish server readiness and actual provider integration, not external client
reachability. Filing is the current public-access blocker.
The signed-in console showed an existing first-filing order: Tencent review passed,
waiting to submit to the authority because real-name verification is less than
three days old. No filing/account identity information was changed.

GitHub app `3930524` was created with the confirmed exact callback. Secret creation
is waiting on required Passkey reauthentication, and the installed extension ID is
still required for its exact callback/origin allowlist. No hosted OAuth, installed
extension or signed Mac/browser cross-client sync was accepted. Those checks remain
pending filing and the user's authentication/configuration inputs. Existing
vocabulary and legacy import/export formats remain preserved. See the current
[host deployment record](../tencent-deployment.md) for exact paths and recovery.

## GitHub configuration after user reauthentication

The user completed GitHub identity verification. The generated app credential was
installed in the server's root-only environment using a non-echoing stdin process
and an atomic, backup-preserving field update. No credential values were printed,
packaged or saved in shell command history. The old callback allowlist remains
exact and has no extension entry pending the actual installed ID.

Synthetic local and actual host-configuration checks passed using an in-memory
database. The running API, checked through server-side trusted HTTPS after reload,
returned native login start 302, unknown extension callback 400, unauthenticated
API 401 and health 200. Provider PKCE and secure cookies were verified without
following a user authorization flow. User/session/vocabulary/encounter counts were
unchanged; the live check created only an expiring synthetic login attempt.

The GitHub application token-check endpoint returned its documented 404 for a
random invalid token when authenticated with the configured application credential.
No real user tokens were used or changed. This checks application configuration,
not completed user OAuth/code exchange. The latest package, containing the new
configuration and preflight scripts without secrets, passed extracted-release
startup/authentication/backup/restore checks. The host runtime release was retained.

Public filing blockage and installed extension ID remain outstanding. Full hosted
macOS/browser authentication, lookup and cross-client vocabulary synchronization
have not been accepted. The user's existing client vocabulary was not read or
uploaded, and production vocabulary/history records were not changed.
