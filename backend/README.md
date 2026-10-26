# Remember Me API

## Magpie translation (2026-10-24)

The deployed runtime uses `TRANSLATION_PROVIDER=magpie`, calling the same-host
`http://127.0.0.1:3425/v1/chat/completions` gateway and
`MAGPIE_MODEL=zhipu/glm-5.3-flash`. Set `MAGPIE_API_KEY=magpie-rememberme` for
the verified loopback app label, or a private gateway key for a remote gateway.
The web administration key is not an API credential. No provider secret is sent
to clients. See [Magpie's integration contract](https://github.com/yetone/magpie/blob/main/docs/integrating.md).

`MagpieTranslator` makes word-only inference requests, rejects tools/truncated
or malformed output, caps output at 64 KiB, limits concurrency to two and aborts
after twelve seconds. `ServerTranslator` retains coalescing, bounded successful
caches and the four-second MyMemory fallback. `MYMEMORY_ENABLED=false` disables
fallback. `TRANSLATION_PROVIDER=hermes` retains the isolated legacy provider;
`none` permits MyMemory-only operation. Unknown provider names fail startup.

Responses carry the actual source (`magpie`, `hermes` or `mymemory`). Install
extension 0.1.2 or the updated Apple build to consume Magpie snapshots; older
validators reject the new source. Existing histories are not migrated. New
client cache namespaces avoid reusing old backend results after upgrading.
The historical deployment descriptions below predate this migration; the
[dated Magpie deployment record](docs/verification/2026-10-24-magpie.md) records actual cutover and verification.

The default runtime is Node/Hono with SQLite, deployed privately on Tencent
Lighthouse with an isolated live Hermes translator. Server-local HTTPS passes,
but Tencent's domain-filing block prevents canonical public access. A temporary Cloudflare HTTPS tunnel now serves word-only lookup and passed actual Chrome selection acceptance. GitHub credentials are
configured and native login-start checks pass; the exact installed-extension callback/CORS checks pass, while completed public client authentication remains blocked by filing. See
[deployment and host inspection](docs/tencent-deployment.md).

Implemented: GitHub OAuth with browser/client PKCE, hashed device credentials,
refresh rotation/revocation, account ownership, atomic operation receipts,
count/history-independent mutations, tombstones, fixed-boundary snapshots/deltas,
version-bound history, review admission, source consent/removal, and authenticated
Hermes Chinese translation. macOS and the browser extension use the same API.
The homepage is a small connection page; a full website vocabulary UI is deferred.

## Cloudflare account correction

Cloudflare ingress migration to `naijoug@outlook.com` is prepared with a verified shared workspace token; service cutover is still pending. The October 14–15 deployments used the wrong company account.
Old deployment records are source inventory only. Deploy through `npm run
cf:deploy -- <target>` after `npm run cf:check`; never use global Wrangler login.
The personal account ID is verified and pinned. Zero VPC IDs prevent Worker
deployment until replacement services are provisioned. See [account migration and credential setup](docs/cloudflare-account-migration.md).

## Local commands

Use Node 22.22.3 from `.nvmrc`, and run commands inside `backend/`:

```sh
nvm use
npm ci
npm run typecheck
npm test
npm run build
DATABASE_PATH=/tmp/rememberme-api-disposable.sqlite npm run dev
```

The server binds only `127.0.0.1:8787`. It has no development login/seed route.
Node 22's built-in SQLite API emits an experimental warning. The tested runtime
is pinned; the deployment host must use a compatible executable.

`npm test` runs the existing API/auth/migration tests against real SQLite and
mocked GitHub providers, plus Hermes adapter tests. Provider network is blocked;
all accounts, credentials and vocabulary are disposable synthetic fixtures.
The database resets between cases.
The Vitest entry discovers `tests/**/*.test.{ts,mjs}`; the lookup bridge tests
need loopback-listener access. Run `npm run test:cloudflare` separately for the
Node test runner's account/deployment guard tests, which use synthetic credentials.

After building `RememberMeProbe` with SwiftPM and this backend:

```sh
npm run test:native -- /absolute/path/to/RememberMeProbe
npm run test:browser
npm run package:deploy
```

The native harness runs separate Swift processes with URLSession over real
loopback HTTP. The browser harness bundles the actual extension repository/client
with disposable WXT storage and fake IndexedDB, then talks over real HTTP to
Node/SQLite. Install extension dependencies first. It covers refresh, frozen
response-loss retries, cross-device history, source exclusion, conflicts and epoch
fencing. Hermes protocol tests use a synthetic provider; these checks do not prove
installed-extension OAuth, live Hermes or hosted macOS sync.

## Runtime and data

`src/runtime.ts` defines the database/provider boundary. `sqlite.ts` uses WAL,
foreign keys, FULL synchronous commits and synchronous `BEGIN IMMEDIATE` batches.
The D1 SQL migrations are reused verbatim, with applied migration digests checked
on startup. Receipt, state, history and change records commit together; rejected
conflict IDs are retained. Finite nonnegative legacy binary64 counts/times,
including fractions and very large values, remain compatible. New versions and
cursors are safe integers. Reset retains history; imports never replay review.

Persist `DATABASE_PATH` outside the release directory. The service unit supplies
`/var/lib/rememberme/rememberme.sqlite` under a dedicated user. Release archives
contain bundled code, migrations, static assets, operations scripts and config
templates, never databases or credentials. Existing browser `local:words` and
native stores are retained. Account copy and sync enablement are explicit choices.

`npm run backup -- DATABASE NEW_BACKUP_PATH` uses `VACUUM INTO` and verifies
integrity/foreign keys. `npm run restore -- BACKUP NEW_DATABASE_PATH` creates a
new verified copy and fresh account epochs; stop API writes before selecting it.
Preserve the prior database/WAL and release.
Existing D1 production data, if discovered, requires a verified export and
migration; do not replace it with an empty database. No deployed D1 was established
in the current inspection.

## Auth, translation and configuration

Production uses exact `PUBLIC_ORIGIN`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`,
`NATIVE_CALLBACKS` and extension `CLIENT_ORIGINS`. Register
`${PUBLIC_ORIGIN}/auth/github/callback` with GitHub, and allowlist each actual
extension identity callback. Credentials never appear in callback URLs or logs;
long-lived tokens are returned by the HTTPS exchange and stored hashed server-side.
Node rate limiting is bounded, per-process memory suitable for this single-instance
release; it is not a distributed quota. Globally atomic review admission remains
in SQLite guards.

`POST /api/v1/lookup/translation` accepts only an authenticated single English
word and `zh-CN`. The backend owns Hermes's private URL, bearer key and model.
Use a dedicated loopback translation profile with tools/MCP/memory disabled.
The adapter checks `/v1/toolsets`, limits inference concurrency to two, shares
identical requests, bounds JSON bodies and has a twelve-second provider deadline.
The Node runtime routes Hermes provider failures to server-side MyMemory within an additional four seconds. Isolation failures remain explicit; `MYMEMORY_ENABLED=false` disables fallback. Responses preserve the actual `hermes` or `mymemory` source. Fallback successes cache for one hour; Hermes successes for seven days. Shared router concurrency is capped at eight.

Authenticated `POST /api/v1/lookup/dictionary` accepts only `{ word }`, calls Free Dictionary API with a six-second deadline, validates/size-bounds the result and returns the existing Definition shape. Server caches are bounded at 1,000 successful entries per service. Equivalent `/api/v1/public/lookup/dictionary` and `/api/v1/public/lookup/translation` routes support normal plugin lookup without login, with exact CORS, 30 requests/minute/IP and no vocabulary/auth data. The original authenticated routes remain for native clients. The server reads licensed WordNet shards before the Free Dictionary fallback. These routes/assets/fallback are activated in the October 14 automatic-lookup release; server-local HTTPS passed, while public access remains blocked by filing.
See [API contract](../contracts/api-v1.md) and
[Hermes official API documentation](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server/).

`GET /api/v1/health` is public liveness; `capabilities` advertises supported
translation/sync contracts, not upstream readiness. Vocabulary endpoints require
bearer authentication. Logs contain request IDs/status only. Definitions, imports,
contexts and URLs remain untrusted text.

## Retained Worker path

The old Worker configuration is retained for migration/reference:
`dev:worker`, `build:worker`, `test:worker`, `typecheck:worker` and
`db:migrate:local`. The default build/test/dev commands target Node/SQLite.
Do not use historical Worker verification records as evidence of a Tencent
production deployment. Live isolated Hermes and server-side HTTPS are now checked;
public access, hosted OAuth, production restore and installed Mac/browser
acceptance remain pending.

Current local and host evidence: [2026-10-14 Tencent/Hermes checkpoint](docs/verification/2026-10-14-tencent-hermes.md).


## Temporary lookup bridge

While filing is pending, `scripts/lookup-bridge.mjs` and the two `deploy/rememberme-lookup-*.service` units provide a separate lookup-only HTTPS transport. The bridge listens on loopback 8788 and forwards only health and public lookup to the existing API. The connector is the checksum-verified official cloudflared binary; neither service has account/provider credentials. Account/auth/vocabulary paths are 404, auth/cookies are stripped, and incoming sizes/concurrency/IP forwarding are bounded. Tests use disposable loopback HTTP.

The bridge/connector are installed separately under `/opt/rememberme/temporary`; the active API release remains unchanged. Quick Tunnel hostnames change when the process is recreated, so record the current address and update only the plugin's internal lookup config after a restart. The canonical account/OAuth origin remains unchanged. See [temporary deployment evidence](docs/tencent-deployment.md#temporary-https-lookup-on-2026-10-14).

## Canonical account ingress

`account-gateway/` and `account-entry/` prepare the canonical `rememberme.couplelabs.cn` account service through Cloudflare Pages and the existing private VPC/tunnel to API port 8787. The lookup gateway remains independent. The old company account's `rememberme` Pages project was allocated `rememberme-6hc.pages.dev`; account API requests require the canonical hostname so the existing OAuth callback and account partition remain stable. The entry serves the existing homepage and privacy policy, and never caches account responses. See the [October 15 checkpoint](docs/verification/2026-10-15-account-domain.md) for deployment IDs, completed checks and pending DNS/login/sync acceptance.

## Account reminder selection

Migration `0006_reminder_device.sql` and `reminder-device-v1` add one selected reminder device per account. `PUT /api/v1/reminder-device` uses an authenticated-device, expected-revision update; it never changes vocabulary or source consent. Apply migration 0006 through the normal backend release procedure before advertising the capability. This change is verified with disposable SQLite and native loopback HTTP; it has not been deployed by the October 16 implementation task. Offline native clients can still deliver previously scheduled notifications until they refresh the selection.
