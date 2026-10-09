# Unified API

`backend/` contains a local Hono/Workers/D1 implementation for the Apple clients' API dependency. The service is not deployed and no Cloudflare database or GitHub OAuth app has been registered. Native Settings has explicit account/ownership/sync paths; real Swift/HTTP-to-local-Worker integration passes with separate synthetic device processes, while hosted/signed-device acceptance remains unfinished. The extension has no cloud sender.

Implemented: account-scoped operation receipts and conditional D1 batches, creation/migration baselines, distinct encounter recording/import, explicit legacy-merge count deltas, editing/reset/deletion tombstones, snapshot restoration and review-v1 admission/state rules, fixed-boundary snapshots/deltas, history paging, context/URL consent, OAuth browser state plus provider/client PKCE, single-use native codes, hashed device credentials, refresh rotation/revocation, account erasure, bounded request bodies, rate limits and JSON API errors. Atomic writes now recheck the resolved user epoch at commit. The latest 25 local API tests and shared native merge fixture are summarized in [sync core evidence](../frontend/apple/docs/verification/2026-10-09-sync-core.md).

This API work keeps the browser-extension Node package and lockfile independent, as permitted by the Apple plan. Root npm workspaces, the full website and extension storage/sync migration from the broader Cloudflare plan are deferred; they are not claimed as completed prerequisites. Language-neutral wire schemas/fixtures live in `contracts/`; local native operations are a different model.

## Local setup and checks

Use Node 22.22.3 from `.nvmrc`. Commands run in this package:

```sh
cd backend
nvm use
npx --yes --package=npm@11.21.0 npm ci
npm rebuild esbuild workerd
npm run types
npm run typecheck
npm run test
npm run build
```

A reproducible npm 10.9.8 peer-resolver crash was observed while bootstrapping; npm 11 was used in an isolated process, without replacing global npm or changing extension dependencies. Packages and lockfile are pinned. The patched Wrangler/Vitest plugin versions resolved the bootstrap's four dev-tool advisories; the final audit reported zero. `build` is an explicit root-environment **dry run**, not a deployment command.

Tests execute in local workerd/D1 bindings. GitHub calls are intercepted using current Cloudflare-compatible MSW handlers; all other outbound test calls are rejected. Accounts/tokens/vocabulary are synthetic and the test database resets between cases. Required-secret warnings during config loading are expected because no real secret is supplied; tests override it with a synthetic binding. Remote CI is configured but has not run.

For a local server with a disposable database:

```sh
npm run db:migrate:local -- --persist-to /tmp/rememberme-api-local-smoke
npm run dev -- --persist-to /tmp/rememberme-api-local-smoke
```

This binds only `127.0.0.1:8787`. A local loopback smoke check observed health 200 JSON, unauthenticated API 401 JSON, missing auth route 404 JSON and homepage 200 HTML. The temporary server was stopped after checks. Local development has no public test-token/login bypass; authenticated integration fixtures are injected only by tests.

## Configuration and credentials

`wrangler.jsonc` specifies separate local/staging/production bindings. Local D1 uses a zero-ID placeholder solely for local simulation. Remote D1 names/IDs and rate-limit namespace choices must be configured for the intended account before deployment. Staging/production origins intentionally use an invalid placeholder. No environment should be deployed from these defaults.

Set the public `GITHUB_CLIENT_ID`, exact `PUBLIC_ORIGIN` and `NATIVE_CALLBACKS` allowlist for an authorized OAuth app. Provide `GITHUB_CLIENT_SECRET` via an ignored `.dev.vars` for an explicitly requested live diagnostic or Cloudflare secret storage when deployment is authorized; the required-secret name is typed from configuration, not a source secret value. The GitHub callback is `${PUBLIC_ORIGIN}/auth/github/callback`. `rememberme://auth/callback` is the provisional native callback; server and app must agree before real login.

Long-term access/refresh credentials are returned only by the authenticated HTTPS exchange, never in callback URLs. Database sessions store hashes. Short browser/provider verifiers have bounded lifetimes; provider tokens are used only to revalidate identity and are not persisted. Logging records request IDs/status, without request bodies, authorization headers, contexts or complete URLs.

## Protocol boundaries

See [wire contract](../contracts/api-v1.md) and [verification](docs/verification/2026-10-09-api-foundation.md). An operation request is capped at 256 KiB of actual streamed bytes, one logical operation per request, with at most 25 events. Incremental/snapshot pages are capped at 50 states; history pages at 25 events. New version/cursor tokens are safe integers; old count/time values preserve finite nonnegative binary64 semantics. Definitions/notes/text remain untrusted data.

The backend uses real D1 transaction rollback plus conditional CHECK guards: receipts, business state, events and increment records commit together. A rejected conflict is retained for the original operation ID; resolution uses a new ID. History imports never increment count or replay review intervals. Snapshot restore takes current server versions, not backup versions, and cannot resurrect tombstones. Account deletion erases its active stored data and credentials; a later provider login receives a new opaque account ID, avoiding old cache ownership reuse.

Rate-limit bindings provide configured request limiting; they are not the globally atomic review quota. Review admissions use D1 guards. Migrations 0002–0004 allow explicitly requested duplicate lifecycles (normal creation remains atomically source-guarded), retained history positions and entry-version-bound event reads. ID paging remains stable while positions reconstruct retained/timestamp order. `/me` advertises these capabilities; native Settings requires them. The current local tests cover these paths, but hosted CPU/row budgets, rate behavior across regions, remote backup/epoch recovery, real OAuth/device sessions, end-to-end native sync, source consent/enrichment and complete release acceptance remain unfinished.

The website is only a small static connection page. Website cookie sessions, full vocabulary UI, old-site migration and extension sync remain unfinished. The entire Apple implementation goal is still active.

The current account/ordering checkpoint passed 29 local API tests, including a populated original-schema migration, plus native ownership/presentation and simulator checks. See [account ownership evidence](../frontend/apple/docs/verification/2026-10-09-account-ownership.md) for exact scope and remaining end-to-end acceptance.

The [native HTTP integration](../frontend/apple/docs/verification/2026-10-09-native-http.md) now runs real Swift/URLSession requests against the Worker in local workerd/D1. After `npm run build` and building `RememberMeProbe`, run `npm run test:native -- /absolute/path/to/RememberMeProbe`. The harness uses random loopback ports, disposable synthetic D1 accounts/credentials and separate native processes; it tests shared-source deduplication, real refresh, committed response loss/restart, history order, merge/null/review/conflicts/tombstones, account isolation and read-only changed-epoch snapshots. It never adds a production seed/login route or deploys. Hosted/signed-device epoch-reconciliation acceptance remains unfinished.

The latest [epoch recovery checkpoint](../frontend/apple/docs/verification/2026-10-09-epoch-recovery.md) passed 30 local API tests and actual Swift/HTTP recovery staging/exit/resume/recheck/publication. `/me` now includes the current account-day admission IDs for native quota reconciliation. Confirmed recovery leaves sending paused; re-enabling sends only newly chosen requests. Remote D1 backup/restore tooling and hosted/signed-device acceptance remain unfinished.

The native harness now additionally exercises [online account-backup merge](../frontend/apple/docs/verification/2026-10-09-account-backup.md): old count is restored through a fresh current-version snapshot, later history remains, and historical review answers/admissions are not replayed. Candidate staging exits, a new Swift process rechecks current cloud versions before publishing, and another explicit enable sends the restore/history requests. These changes use existing API operation kinds; no production fixture endpoint or deployment was added.

Primary references checked for implementation: [D1 batches](https://developers.cloudflare.com/d1/worker-api/d1-database/), [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/), [current Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/), [outbound mocks](https://developers.cloudflare.com/workers/testing/vitest-integration/mock-outbound-requests/), [GitHub OAuth/PKCE](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps).
