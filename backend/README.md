# Remember Me API

The default runtime is Node/Hono with SQLite, deployed privately on Tencent
Lighthouse with an isolated live Hermes translator. Server-local HTTPS passes,
but Tencent's domain-filing block prevents public access. GitHub credentials are
configured and native login-start checks pass; exact installed-extension callbacks
and completed client authentication remain pending. See
[deployment and host inspection](docs/tencent-deployment.md).

Implemented: GitHub OAuth with browser/client PKCE, hashed device credentials,
refresh rotation/revocation, account ownership, atomic operation receipts,
count/history-independent mutations, tombstones, fixed-boundary snapshots/deltas,
version-bound history, review admission, source consent/removal, and authenticated
Hermes Chinese translation. macOS and the browser extension use the same API.
The homepage is a small connection page; a full website vocabulary UI is deferred.

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
Successful results have source `hermes`; old `mymemory` snapshots remain valid.
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
