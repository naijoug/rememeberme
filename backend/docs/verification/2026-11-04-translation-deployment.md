# Translation optimization deployment — 2026-11-04

Date/time is America/Los_Angeles. Activation completed at 20:15:22 on November 4
(2026-11-05T04:15:22Z). The user authorized separate feature commits, a combined
push, and production deployment of the translation optimization.

## Commits and push

The translation fix `41e16c5` was retained. Remaining changes were committed in
dependency order without discarding the working tree:

| Commit | Scope |
| --- | --- |
| d430e95 | Backend sentence explanation, contracts and bounded gateway/bridge routes |
| 455e044 | Shared cancellable lookup Ports |
| 381a28a | Per-site extension controls |
| b76d629 | Selection-card viewport positioning |
| 48a469d | Extension sentence explanation and consent |
| 96e0e70 | Apple original-sentence review cards and accessibility |
| 7e4de91 | Personal lookup ingress configuration and client endpoint |
| a07edee | Adoption and typing-practice plans; typing practice remains unimplemented |
| db61a6e | 0.1.5 release evidence and current documentation |

Both GitHub API and SSH authenticated as `naijoug`; the destination repository
was `naijoug/rememeberme` with admin permission. `origin/main` had no missing
upstream commits. The non-force push advanced main from `3b090f5` to `db61a6e`,
including the already-local Mac fix and translation commit. The deployment below
uses exact source `db61a6ee7de835196cd35a3da23d6e1ca858e35b`.

## Verification

- Intermediate API, Port, website-control, positioning and explanation snapshots
  passed their relevant isolated tests and TypeScript checks before committing.
- Complete committed extension: 339 tests passed; backend: 91 tests passed.
- Both TypeScript checks passed; backend build/package succeeded.
- Apple UI Swift package: 39 tests passed, using redirected temporary caches.
  This is not physical-device, VoiceOver or fresh iOS simulator acceptance.
- JSON Schema checks and all fixtures passed with the repository-pinned
  `jsonschema==4.25.1` in a disposable environment. The first invocation lacked
  this optional dependency; installing it in that environment resolved the check.
- The exact extracted archive passed startup/health/auth boundaries, absence of
  credentials/database files, live WAL backup, new-path restore and fresh epochs.
- New-file credential-pattern scanning found no private-key, GitHub-token or AWS
  access-key patterns. This is not a general secret-scanning guarantee.

## Staging and activation

SSH verified `ubuntu` on `VM-0-9-ubuntu`, using the dedicated strict host-key
configuration. Existing ports matched the shared port register. No port, proxy,
firewall, DNS or Cloudflare resource was changed.

- Archive SHA-256: `0fc8736662665232bb20916eef839e73a2d96b076c83238cfd388d751449d733`.
- Active runtime: `/opt/rememberme/releases/20261104-translation-db61a6e-0fc87366/runtime`.
- Previous runtime retained: `/opt/rememberme/releases/20261027-context-fac9579f94d8/runtime`.
- Verified SQLite backup: `/var/lib/rememberme/backups/pre-translation-20261104-db61a6e.sqlite`.
- Private configuration backup: `/etc/rememberme/translation-backup-20261104-db61a6e/api.env`.

The archive's checksum and member paths were checked before extraction.
Candidate files are root-owned and readable by the existing service user. All
seven migration files were byte-identical to the active release. No schema or
database replacement was needed.

The candidate was first imported directly with an in-memory database and the
existing server configuration. Health/protected-route/capability checks passed;
packaged WordNet completed in 7 ms and real `group/translator` output in 1,514 ms.
Two isolated injected stalls each stopped at 3,003 ms. The next synthetic primary
call immediately returned `TRANSLATION_CIRCUIT_OPEN`. These fault probes did not
run against the production translator instance. Temporary users, sessions and
vocabulary tables remained empty.

Before activation, the consistent SQLite backup passed integrity and foreign-key
checks. The configuration backup retained mode 0600 under a 0700 directory.
The release pointer was replaced atomically and only `rememberme-api` restarted.
The activation script would restore the previous pointer on failed acceptance;
no rollback was needed and the production database was never restored.

Post-activation local health returned 200, `/api/v1/me` returned 401, and sentence
explanation remained enabled. Configuration SHA-256 was unchanged. The states and
PIDs of Magpie, lookup bridge, personal tunnel, Caddy, lesson-ledger, foundit and
study-buddy were unchanged. The model remains `group/translator`; no group
membership or upstream-provider settings were edited.

[Deployment receipt](assets/2026-11-04-translation-deployment/deployment.json).

## Public HTTPS acceptance

The same three fixture words were requested through the actual HTTP client
bundles, using the original client before activation and the optimized client
after activation. These are public HTTPS checks, not installed-browser UI timing.

| Fixture | Before ms / attempts | After ms / attempts | Result |
| --- | ---: | ---: | --- |
| granite | 2,521 / 2 | 3,335 / 1 | Magpie, valid Chinese |
| saffron | 2,503 / 1 | 2,785 / 1 | Magpie, valid Chinese |
| tundra | 2,484 / 1 | 1,987 / 1 | Magpie, valid Chinese |

All three after requests returned HTTP 200 with one attempt. The before granite
request retried before receiving an HTTP response; its total was below the old
five-second timeout, so it is not evidence of the provider-timeout race.

Healthy-path median was 2,503 ms before and 2,785 ms after. No healthy-path speedup
or p95 claim follows from these small samples; before requests may hit existing
server caches. No production cache was cleared. The earlier isolated
[fault comparison](2026-11-04-translation-resilience.md) measured the intended
benefit: a stalled-primary median of 8.889 s versus 3.274 s, and 0.615 s after
the circuit opened.

Public health and explanation capabilities returned 200; explanation stayed
enabled. The public gateway rejected the account route with 404 and extra
sentence data on the word-only translation route with 400. Existing account,
database, consent and gateway boundaries remain intact.

[Raw public measurements](assets/2026-11-04-translation-deployment/public-translation.json).

## Documentation discrepancy handled

`frontend/apple/docs/testing.md`, opening Magpie compatibility paragraph, still
described an eight-second primary. `contracts/translation-policy.ts` and
`backend/src/magpie.ts` now use three seconds. Updated that paragraph in the Apple
commit; the native client's twenty-second budget remains unchanged. No other new
documentation/code inconsistency was established by this deployment check.

## Rollback and limits

For runtime rollback, atomically point `/opt/rememberme/current` to the previous
runtime above and restart only `rememberme-api`, then verify local/public health.
Keep the current production database: no migration changed, and restoring the
backup would discard newer user data. Configuration was not changed and does not
need restoration for this runtime rollback.

The backend optimization is live. Cloudflare and Apple distributions were not
redeployed. The existing local extension watcher previously rebuilt the client
changes; this task does not establish that the user's installed Chrome loaded
that update. Store/packaged installations need an updated client build for the
new nine-second first attempt and `retryable: false` handling.
