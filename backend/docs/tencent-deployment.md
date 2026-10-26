# Tencent Lighthouse deployment

The Node/Hono server listens on loopback and uses SQLite with WAL, foreign keys,
full synchronous commits and atomic conditional batches. The checked-in D1
migrations are reused verbatim. Existing migrations are checked by digest; an
edited applied migration stops startup.

## Current recorded status (2026-10-25)

First-lookup recovery is deployed at
`/opt/rememberme/releases/20261025-first-lookup-8cfccea264ce/runtime`.
Magpie now uses low reasoning, a 512-token cap and an eight-second primary
deadline, retaining MyMemory fallback. Installed extension 0.1.3 has one bounded
automatic network retry. Three actual installed-Chrome first lookups passed.
See [investigation, validation and rollback](verification/2026-10-25-first-lookup.md).

## Previous recorded status (2026-10-24)

The API now runs `/opt/rememberme/releases/20261024-magpie-84793192d5c7/runtime`
with direct same-host Magpie translation, model `zhipu/glm-5.3-flash` and
MyMemory fallback. Migration 0006 is applied. Verified database/config backups
and the old Hermes runtime remain for rollback. Both live provider checks and
the exact extension 0.1.2 ZIP's disposable Chrome acceptance passed; installed
user clients still require updating. See [Magpie deployment evidence](verification/2026-10-24-magpie.md).

## Previous recorded status (2026-10-15)

The Tencent API and isolated Hermes remain active under `/opt/rememberme/releases/20261014-4c2222236a8a/runtime`, on loopback 8787/8643. Word lookup now has a fixed trusted HTTPS entry independent of the filing-blocked canonical account domain. Its named private connector and loopback lookup bridge are enabled; connector restart and subsequent formal/native Chrome lookup have been verified. The former random Quick Tunnel has been disabled.

The Chrome candidate disables account login/sync and identity/alarms permissions. Real fixed-gateway Hermes Chinese translation, Free Dictionary data, packaged WordNet/IPA, no-login selected-word requests and public privacy hosting have been accepted. Browser account OAuth and cross-client hosted sync remain separate unaccepted features, pending canonical-domain access. Filing was submitted to the communications authority; SMS verification was delayed and the user had not received the SMS.

The canonical DNS-01 certificate has manual renewal and expires 2027-01-12 at 09:40:43 Asia/Shanghai. Off-host backup/production restore drills are not claimed by lookup-only acceptance. See [2026-10-15 fixed entry and Chrome candidate](../../frontend/browser-extension/docs/verification/2026-10-15-release-candidate.md). The historical sections below preserve earlier inspection/deployment states.

## Prepare and deploy

Use the version in `backend/.nvmrc`, run `npm ci`, `npm run typecheck`,
`npm test`, `npm run build` and `node scripts/package-deploy.mjs`.
The archive includes the bundled runtime, migrations, static connection page
and deployment templates. It excludes credentials, local stores and vocabulary.

Inspect the host with `sh scripts/check-server.sh`. Confirm the existing proxy,
ports, service users and domains before changing configuration. Do not replace
another application's proxy or systemd service.

Unpack `runtime/` under a new `/opt/rememberme/releases/RELEASE/runtime`
directory. The server's adjacent `migrations/` and `public/` directories are
required. Point `/opt/rememberme/current` at that runtime only after configuration
and isolated smoke checks pass. Retain the previous release for rollback.

Provision a dedicated `rememberme` service account, `/etc/rememberme/api.env`
(mode 0600) and the supplied service unit. Confirm the installed Node executable
matches `ExecStart` and supports the pinned Node runtime. Use the existing
reverse proxy for a new HTTPS site; the nginx example is a template only.
The API/database ports remain private.

For a new host with no existing deployment, `deploy/install-private.sh ARCHIVE
SHA256 PUBLIC_ORIGIN` verifies the archive and SQLite runtime, refuses existing
service/state/configuration paths, and installs only the private API. It does
not configure DNS, OAuth, translation credentials or a public proxy. Inspect an
existing deployment and back up its data before using a migration procedure.
The release packager omits macOS extended attributes and AppleDouble files.

Configure an exact production `PUBLIC_ORIGIN`, a registered GitHub OAuth app
and its callback `${PUBLIC_ORIGIN}/auth/github/callback`. `NATIVE_CALLBACKS`
is an exact allowlist containing the native callback and each installed
extension's `browser.identity.getRedirectURL('auth/callback')`.
`CLIENT_ORIGINS` is an exact comma-separated allowlist of extension origins.
Do not accept arbitrary `chromiumapp.org` callbacks or wildcard extension IDs.
Extension login, normal native login and refresh issue separate device sessions.

## Hermes translation

The existing dashboard is an administration surface, not the translation
endpoint. Use a dedicated translation profile/service with no enabled tools,
MCP tools, user memory or shared conversation. Keep its API listener on loopback,
with a separate server-side bearer key and the already-authorized model provider.
Verify the installed Hermes version's profile/config commands before setup;
do not silently upgrade or restart the user's existing gateway.

Set `HERMES_BASE_URL` to the profile's OpenAI-compatible `/v1` URL,
`HERMES_API_KEY` to its bearer key and `HERMES_MODEL` to its advertised model.
The adapter calls `/v1/toolsets` before inference and rejects any enabled tools.
It accepts the legacy array and the installed gateway's exact
`{"object":"list","platform":"api_server","data":[...]}` envelope; a
mismatched platform, missing enabled flag or any enabled toolset fails closed.
Missing discovery support fails closed until the profile is verified.
Only the selected English word is sent, with a fixed translation instruction;
clients cannot select an upstream URL, model, tools or conversation.

The client-facing endpoint is authenticated
`POST /api/v1/lookup/translation` with `{"word":"synthetic","target":"zh-CN"}`.
The response is `{"translation":{"text":"...","target":"zh-CN","source":"hermes"}}`.
Successful results are cached in bounded server memory. Concurrent identical
lookups share one request, inference concurrency is limited to two and the
provider deadline is twelve seconds. Failures are not cached.

## Acceptance and recovery

Check public health/capabilities, 401 for protected routes, valid HTTPS,
real OAuth callbacks in both clients and a synthetic translation.
Verify the actual client's words remain local until explicit account copy/import
and sync enablement. Test committed-response loss, device revocation and
cross-account isolation with separate disposable accounts.

Use `node scripts/backup.mjs DATABASE NEW_BACKUP_PATH` for a consistent live
backup and integrity/foreign-key verification. Keep an encrypted off-host copy.
For a restore, stop API writes and retain the current database and its WAL files.
`node scripts/restore.mjs BACKUP NEW_DATABASE_PATH` creates a new verified database
and rotates every account's `sync_epoch` in a transaction. It refuses an existing
destination. Configure `DATABASE_PATH` to that new file and inspect it before
resuming. Old queues must enter explicit recovery, never replay silently.
Code rollback must not reverse already-applied schema migrations.

Normal browser word lookup uses the fixed product service's public word-only routes, without login or user-entered API URLs. Exact origin checking and 30 lookups/minute/IP apply; vocabulary/account APIs remain authenticated. Server English lookup reads packaged WordNet then Free Dictionary API for uncovered words. Chinese uses Hermes with server-side MyMemory fallback, preserving source attribution. Hermes tools/profile isolation failures remain explicit. The active release includes licensed dictionary assets and the real-provider acceptance script. See [automatic lookup deployment verification](../../frontend/browser-extension/docs/verification/2026-10-14-auto-lookup-deployment.md).

Account sync and legacy data copy are separate explicit
choices. A copied unchanged browser baseline uses its retained snapshot digest;
an anonymously modified vocabulary copies its current fields as a new create
intent, rather than relabeling changed counts as an old migration baseline.

## Host inspection on 2026-10-13

Historical pre-deployment checkpoint; later October 14 sections supersede its
terminal, domain and disabled-API status.

The authenticated Hermes dashboard reports Linux x86_64, two cores,
approximately 1.9 GiB memory and 49.1 GiB disk. Hermes is v0.21.0 with
`glmcode / glm-5.3-flash`; the existing gateway is running.
The Channels screen reports API server disabled.

A fresh OrcaTerm connection reports TAT passwordless login unavailable and no
managed SSH password. The local SSH key is not accepted by the server.
No server files, keys, gateway settings, firewall or DNS were changed.
Deployment requires an authenticated SSH/server-terminal session and a selected
business HTTPS domain/OAuth app; these are not inferred from dashboard access.

## Private deployment on 2026-10-14

Initial private-install checkpoint; Hermes/HTTPS activation and GitHub credential
configuration in later sections supersede the pending steps recorded here.

The user authenticated the OrcaTerm shell as `ubuntu`. Host inspection confirmed
`/usr/bin/node` v22.23.2 and SQLite 3.51.3, about 1.9 GiB RAM, 35 GiB free disk,
Caddy on 80/443 and the existing dashboard on loopback 9119. The pre-existing
`lesson-ledger` service uses loopback 3010. No Remember Me deployment paths were
present before installation.

The reviewed archive with SHA256
`a35df442cd05b5370194b5b370f5a803071b6ff55330d7b25184c8ed52ddfea5`
was uploaded and checked on the host. It is installed under
`/opt/rememberme/releases/20261014-a35df442cd05/runtime`; `current` points there.
`rememberme-api.service` is enabled and active as the dedicated `rememberme`
user, listening only on `127.0.0.1:8787`. The database is
`/var/lib/rememberme/rememberme.sqlite`, with root-only environment configuration
at `/etc/rememberme/api.env`. Health returned `ok`, capabilities reported
translation disabled, protected `/api/v1/me` returned 401, integrity/FK checks
passed, and the database contained zero users. A consistent verified initial
backup is at `/var/lib/rememberme/backups/bootstrap-20261014.sqlite`.

The planned origin is `https://rememberme.couplelabs.cn`. It did not resolve
during inspection. The existing HTTPS site is `lesson-ledger.couplelabs.cn`;
its configuration was retained. The additive site draft is saved as
`/etc/rememberme/rememberme.caddy.pending` and passed Caddy validation, but is
not imported or serving traffic.

A separate `rememberme-hermes` user and `/var/lib/rememberme-hermes/config.yaml`
were prepared without provider credentials or an API key. The configuration
retains only the existing model/provider/base URL/API mode and disables tools,
MCP, personal memory and profile multiplexing. A transient systemd process under
the dedicated user successfully loaded the installed Hermes configuration and
resolved an empty toolset, both memory flags false, multiplexing false, and
the API address `127.0.0.1:8643` with advertised model `rememberme-translation`.

`rememberme-hermes.service` is installed but disabled. Its private environment
file is deliberately absent until credential creation is confirmed. The service
uses `ProtectHome=tmpfs`, exposing only the pre-existing Hermes code and Python
runtime through read-only binds. The Python runtime directory must include its
version alias symlinks; mounting only the resolved interpreter version fails.
See the host-specific [service template](../deploy/rememberme-hermes.service) and
[profile template](../deploy/hermes-translation.config.yaml.example).

The logged-in GitHub account's OAuth Apps list was empty. A new Remember Me app
form was prepared with an exact callback
`https://rememberme.couplelabs.cn/auth/github/callback` and no wildcard matching,
but was not submitted. DNS, credential creation, provider-secret configuration,
real API inference and hosted client acceptance remain pending. Browser security
policy blocked access to `chrome://extensions/`; the installed extension's exact
ID/permission state was not read or changed. Existing vocabulary was not used
as deployment or acceptance data.

## Hermes and HTTPS activation on 2026-10-14

The user confirmed the hostname, private Hermes credential creation, GitHub OAuth
application creation and server-side use of the existing GLM credential. The
isolated Hermes service is now enabled and active on `127.0.0.1:8643`, with a
separate API key and the selected GLM key in root-only
`/etc/rememberme/hermes.env`. The API environment was backed up before adding its
private Hermes URL/key/model. No credentials were printed or included in a release.

The installed gateway returns a list envelope, rather than the earlier documented
array, and resolves the `glmcode` provider through the top-level `providers` map.
Only the selected provider registration and its environment-key reference were
copied into the isolated configuration. Discovery showed every toolset disabled.
An actual GLM request translated the synthetic word in about 8.35 seconds.

The runtime was updated to validate that exact discovery envelope and require an
explicit `enabled: false` for each toolset. Backend typecheck, 39 tests in eight
files, build and extracted-release checks passed. The new release archive digest is
`80bfe7fb0c9db7f8dadd0592c956b2778c723d8ab11c4b6ce8352bc8578cd09f`.
It is active under `/opt/rememberme/releases/20261014-80bfe7fb0c9d/runtime`.
The original release remains available. The live production database was backed
up to `/var/lib/rememberme/backups/pre-hermes-release-20261014.sqlite` before the
atomic release-pointer change; no database/schema replacement occurred.

The release now includes its runtime library and
`scripts/verify-live-hermes.mjs`. This manually invoked acceptance check creates
an independent temporary SQLite database and synthetic session, starts a random
loopback HTTP listener, verifies unauthenticated translation returns 401, and
calls the actual private Hermes API through the authenticated backend route.
It ignores production DATABASE_PATH and OAuth settings, deletes its fixtures,
and prints no credentials. The host execution passed with real Chinese text,
`source: hermes` and an observed deadline usage of about 11.5 seconds. This is
server HTTP/provider acceptance, not installed-client OAuth or sync acceptance.

DNSPod now contains the `rememberme` A record to the inspected host. A new
`/etc/caddy/acli.d/sites/rememberme.caddy` site was added using the existing import;
other sites and the main Caddyfile were retained. The shared configuration has
`admin off`, so hot reload was unavailable; validated changes were loaded by short
Caddy restarts. All inspected existing application services remained active, and
the existing lesson-ledger server-side HTTPS check returned 200 afterward.

Automatic HTTP-01 and TLS-ALPN certificate challenges failed. A separate certificate
tool environment at `/opt/rememberme/cert-tools` uses acme 5.8.0 and josepy 2.2.0
from PyPI, without changing the Hermes environment. The scoped
[manual DNS procedure](../deploy/manual-dns-certificate.py) reused the existing
production Caddy ACME account (lookup only, no new account or terms acceptance).
It issued a DNS-01 certificate after authoritative TXT validation. Private order
state is under `/etc/rememberme/tls-request-20261014`; the serving chain/key are
under `/etc/caddy/certs/rememberme`, with the key root/caddy-readable only.
The certificate expires January 12, 2027 at 09:40:43 Asia/Shanghai. Renewal remains
manual; the certificate was explicitly loaded by this site, so Caddy does not
automatically renew it. Complete renewal setup before relying on long-term service.

The server's normal, certificate-validated HTTPS health request returned 200 and
capabilities reported translation enabled. However, public access from the Mac
and Chrome was reset. Public DNS returned the correct A record. The Lighthouse
firewall already allowed TCP 80/443 for all IPv4 addresses, and was not changed.
The public HTTP request was redirected to the DNSPod
[filing-block page](https://dnspod.qcloud.com/static/webblock.html?d=rememberme.couplelabs.cn),
which explicitly reports the site has not completed filing. Server-local 200
responses do not establish public accessibility. Tencent filing must be completed
before hosted macOS/extension login and real cross-client sync can be accepted.
The authenticated filing console has an existing first-filing order created on
October 13. Tencent review is marked passed; submission to the communications
authority is waiting because a domain's real-name verification is less than
three days old. The console says Tencent will retry submission after that delay,
followed by SMS/authority review. No duplicate filing or identity-data edits were
made during deployment. The server OS firewall was reported inactive.

GitHub OAuth application `3930524` was created in the signed-in account with the
confirmed exact callback and no wildcard matching. At this activation checkpoint,
client-secret generation was waiting on Passkey reauthentication; the final
GitHub configuration checkpoint below records its successful installation.
The extension's actual ID/callback is still needed
for the exact allowlist, because browser policy blocks its management-page access.
These are missing identity/configuration steps, not a request to repeat deployment
authorization. Existing client vocabulary was not loaded, uploaded or modified.

## GitHub login configuration after identity verification

After the user completed GitHub reauthentication, the app displayed its newly
generated client secret. The confirmed client ID/secret were transferred directly
to a root configuration process with terminal echo disabled, without including
them in shell commands, shell history, release files or diagnostic output. The
one-time GitHub plaintext display was then closed by reloading the settings page.

The checked-in [installer](../deploy/configure-github.py) preserves the old
environment as a root-only `api.env.pre-github-*` file, validates the exact origin,
refuses conflicting credentials, and atomically updates only the two GitHub fields
in `/etc/rememberme/api.env`. The file remains root-owned mode 0600. Callback
allowlists, Hermes settings, service release and vocabulary/database files were
retained. Only `rememberme-api` was restarted; the Hermes service remained active.

The [login configuration check](../scripts/verify-github-login.mjs) passed locally
with synthetic configuration and on the host with the actual configuration. It
uses an in-memory database to verify the native GitHub redirect, exact callback,
provider PKCE, empty scopes, secure cookie, invalid callback rejection and protected
401 response. It never creates production accounts or sessions. The latest local
release includes both tools and passed extracted-release checks again; no actual
credentials are packaged.

A separate live check against the running service through normal, certificate-
validated server-side HTTPS returned native login start 302, unregistered extension
callback 400, protected API 401 and health 200. It created only an expiring synthetic
login attempt and confirmed users, sessions, vocabulary and encounter counts were
unchanged. GitHub's documented application token-check endpoint was also called
with application Basic authentication and a randomly generated invalid token; it
returned the expected 404, consistent with application credential authentication.
No real user token was supplied, refreshed or revoked. See
[GitHub's check-token documentation](https://docs.github.com/en/rest/apps/oauth-applications#check-a-token).
These checks do not establish completed OAuth code exchange or a hosted client
session; public access is still blocked by filing and the extension ID is pending.

The old task terminal had closed, and a direct replacement initially reported that
the account could not find the instance. Reopening the login from the authenticated
Lighthouse instance details restored the existing TAT connection without adding
SSH credentials or changing instance permissions. Host runtime remains
`/opt/rememberme/releases/20261014-80bfe7fb0c9d/runtime`; this turn installed the
operating/check scripts under root-only `/etc/rememberme` without replacing it.

## Automatic lookup release activation on 2026-10-14

Archive SHA-256 `4c2222236a8ab67f9ab0d92f584706f4fc2d1f436540fd5637fa26975f0a6780` was uploaded through the existing authenticated OrcaTerm connection and checked on the host. It is active under `/opt/rememberme/releases/20261014-4c2222236a8a/runtime`. The previous `20261014-80bfe7fb0c9d` runtime is retained for rollback. The earlier staged `44b2b737a600` candidate was not activated because real Free Dictionary lookup timed out.

The final release adds server WordNet from the extension's identical licensed source assets, public read-only lookup routes and a four-second MyMemory deadline. Preflight with a disposable database passed real Hermes (about 5.96 seconds), server WordNet and forced server-side fallback to actual MyMemory. `scripts/verify-live-lookups.mjs` never uses production vocabulary or OAuth accounts.

Before activation, a verified consistent production backup was created at `/var/lib/rememberme/backups/pre-auto-lookup-20261014-2112.sqlite`, and `/etc/rememberme/api.env.pre-auto-lookup-20261014-2112` retained the prior private configuration. Only the actual observed installed Chrome identity was appended: origin `chrome-extension://blmbjchnpodecheenfmajdjfpmgimdcj` and callback `https://blmbjchnpodecheenfmajdjfpmgimdcj.chromiumapp.org/auth/callback`. Other fields/allowlist entries were retained; the file remains root-owned mode 0600. No credential rotation occurred.

The release symlink was switched atomically and only `rememberme-api` restarted. Server-local certificate-validated HTTPS passed anonymous dictionary (`wordnet`), anonymous translation (`hermes`), account API 401, exact CORS preflight 204, different-origin rejection 403, and installed extension callback GitHub redirect 302. Production users/sessions/vocabulary/encounter counts were unchanged by anonymous acceptance. API, Hermes, Caddy and lesson-ledger were active afterward. Caddy, firewall, DNS and other services were not reconfigured.

Tencent-to-Free-Dictionary egress timed out for both published IPv4 addresses under certificate validation. MyMemory responded HTTP 200 in about 2.47 seconds, which exceeded the initial 1.8-second deadline; the deadline is now four seconds. Server WordNet restores covered words without that egress dependency. Uncovered English words still require the external provider, and that observed egress limitation remains unresolved. Native clients retain their existing fifteen-second deadline; slow Hermes-plus-fallback can exceed it, so full native timing changes remain separate work.

No public extension OAuth exchange or real public translation was completed: the domain is still blocked pending filing/SMS/authority review. The user should complete the 12381 SMS verification after it arrives; the console requires verification within 24 hours of receipt. No duplicate application or identity data change was made.


## Temporary HTTPS lookup on 2026-10-14

The user requested a temporary internal service address until filing completes. The existing business HTTPS hostname also failed from the Mac, so a Cloudflare Quick Tunnel was created without changing canonical DNS/Caddy/OAuth settings. Its public origin is recorded in `/etc/rememberme/temporary-lookup-origin` and the plugin's internal `LOOKUP_SERVICE_ORIGIN`; the UI never displays it. The canonical account `SERVICE_ORIGIN` remains separate.

Official cloudflared 2026.10.0 was downloaded from Cloudflare's package CDN after the direct GitHub asset transfer was too slow. Debian package SHA-256 `9721287c28f78cb623e77c7b95a63feea87e909054d75666a0ec9eff20e5d548` matched the official package index; its extracted binary SHA-256 `d33ff2d14475178d2012c2c56beba87389ac5ded27649519f198a7d3134a99db` also matched the official GitHub release digest. It is scoped to `/opt/rememberme/temporary/cloudflared`; no system package repository or credential was added.

`rememberme-lookup-bridge.service` listens on `127.0.0.1:8788`, permitting only public dictionary/translation POST and OPTIONS plus health GET. Its body/concurrency limits are 2 KiB/eight, and it strips client credentials/cookies/XFF while preserving the Cloudflare edge IP for backend limits. `rememberme-lookup-tunnel.service` uses HTTP/2 and targets only that bridge. Both are enabled/active as the existing dedicated rememberme user with restricted filesystem/systemd settings. Existing API/Hermes release, database, OAuth, proxy/firewall and application services were retained.

Mac certificate-validated public HTTPS passed health 200, dictionary 200/WordNet, translation 200/real Hermes, excluded account/auth routes 404, and extra-context lookup rejection 400. Requests with the installed extension origin received the expected CORS header. Actual installed Chrome selection of ephemeral on the local static test page then showed Chinese Hermes translation, WordNet English meanings and packaged IPA. No login/URL input appeared and no bookmark/save operation was performed. This is actual browser lookup acceptance, not OAuth/sync acceptance.

The Quick Tunnel hostname changes when its process is recreated and has no uptime guarantee. Normal network reconnections keep the running process, but a process restart/reboot requires maintainers to read the new journal address, update `/etc/rememberme/temporary-lookup-origin` and `LOOKUP_SERVICE_ORIGIN`, rebuild/verify the plugin. Do not publish credentials or infer a new address. After canonical health/public lookup passes, set the lookup origin back to the canonical service, verify installed Chrome and disable the two temporary units. Account login/sync remain blocked by filing, and uncovered English words retain the separate Free Dictionary egress limitation.

See [temporary lookup verification](../../frontend/browser-extension/docs/verification/2026-10-14-temporary-lookup.md) and [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) for the hostname lifecycle.

## Fixed lookup entry activated on 2026-10-15

DNSPod's dedicated `lookup` CNAME points to `rememberme-lookup.pages.dev`; existing `rememberme` and other application's records were retained. Cloudflare verified the custom domain `lookup.couplelabs.cn` and activated its trusted certificate. A Pages advanced-mode `_worker.js` forwards through the `LOOKUP_GATEWAY` service binding to Worker `rememberme-lookup` in the company account (incorrect ownership; see [personal-account migration](cloudflare-account-migration.md)), avoiding dependency on direct workers.dev/pages.dev access from the client network.

Worker source/configuration is `backend/lookup-gateway/`; Pages forwarding source is `backend/lookup-entry/`. Deployment must run in the correct subdirectory/config so legacy root Worker/D1 configuration is never selected. The Worker currently active version is `2920d7a7-ea23-4ea7-a840-d6f44b762d0c`. It serves a static `/privacy`, validates single-word JSON, enforces an edge IP quota and exact Chrome-origin syntax, and strips client credentials/cookies. Private account and OAuth routes return 404. The private backend keeps its own exact origin/callback allowlist for authenticated clients; the anonymous gateway admits syntactically valid store/test Chrome identities without opening account access.

VPC Service `01a13b1f-f04b-7892-ada7-d9092b7ff0f4` restricts access to HTTP `127.0.0.1:8788` through named tunnel `d8b5791c-9173-4a12-9c0d-e58d3da01d5f`. Remote ingress defaults to 404 and no database/account ports are exposed. `rememberme-lookup-stable-tunnel.service` uses QUIC (required by Workers VPC), restart-always and systemd `LoadCredential`. The source token is root:root 0600 under the existing 0700 private configuration directory. Token material was never packaged or printed; the local transfer file was removed.

Cloudflare fetch does not support the initially used redirect-error mode. The final gateway uses manual mode and rejects redirect responses instead of following them. Temporary diagnostic responses/logging have been removed; normal diagnostics emit only whitelisted static VPC error codes, never input words or credentials. The public dictionary gateway calls the fixed Free Dictionary endpoint through Cloudflare egress because Tencent's direct provider connection timed out, then recovers through the existing server-local WordNet/provider chain. Unsupported inflections can still fail independently of Chinese translation.

Recovery: inspect `systemctl status rememberme-lookup-bridge rememberme-lookup-stable-tunnel` and the named connector connections, verify loopback health, then the same public HTTPS health and synthetic word lookup. Restart only those dedicated services when needed; their identity/hostname remains fixed. Do not weaken certificate verification, change unrelated DNS/proxies, reopen private database ports or rotate credentials as a connectivity workaround. The disabled old Quick Tunnel is historical rollback context, not an automatic client fallback.

Workers VPC remains a beta product. A persistent custom domain is not a guaranteed availability SLA. Some local terminal requests timed out or were rejected while browser HTTPS and the accepted Chrome lookup succeeded; default workers.dev/pages.dev were not accepted as client endpoints. Continuous network/uptime and load coverage remain outside this single-session acceptance.
