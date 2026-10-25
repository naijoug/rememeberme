# Uncommitted-work checkpoint review

Date: 2026-10-24 (America/Los_Angeles). Starting commit: `39302c7`.
Scope: preserve the accumulated backend, Apple, extension and planning changes
as separate local commits. No deployment, remote push, live account login or
production vocabulary access was performed.

## Review adjustments

- Restricted backend Vitest discovery to `tests/**/*.test.{ts,mjs}` so the
  separate `node:test` Cloudflare suite is not collected as an empty Vitest suite.
- Ignored Python bytecode/cache directories and excluded them from backend
  deployment archives. Release verification rejects these cache artifacts.
- Corrected the reminder capability documentation to name `/api/v1/capabilities`,
  matching the implementation, rather than the liveness endpoint.
- Corrected the Cloudflare environment example to reference the existing shared
  private workspace credential file instead of asking for a project-local copy.
- Checked changed text for private-key blocks and common credential patterns;
  no matches were found. Account/resource IDs and synthetic fixtures are retained.

## Verification performed

The current source was copied to a disposable directory, excluding ignored
runtime data and Python caches. Both Node packages were installed with `npm ci`
using Node 22.22.3, matching their `.nvmrc` files. The working checkout's installed
extension output and dependency directories were not replaced.

| Check | Result |
| --- | --- |
| Backend `npm run typecheck` | Passed |
| Backend `npm test` after discovery fix | 13 files, 62 tests passed |
| Backend `npm run test:cloudflare` | 10 tests passed |
| Account and lookup gateway TypeScript projects | Both passed |
| Backend `npm run package:deploy` and `npm run test:release` | Passed: extracted runtime, auth boundary, WAL backup, restore and fresh epochs |
| Backend `npm run test:browser` | Passed: real loopback HTTP, disposable SQLite/browser storage, synthetic providers |
| Backend `npm run test:native` with freshly built RememberMeProbe | Passed: Swift/HTTP sync, reminder selection/handoff, source privacy and recovery |
| Extension `npm run compile` | Passed |
| Extension `npm test` | 30 files, 249 tests passed, including release-integrity and local-feedback script tests |
| Extension `npm run zip` | Passed: Chrome 0.1.1, 345 archive files, 11 linked resources verified |
| RememberMeCore `swift test` | 127 tests passed |
| RememberMeUI `swift test` | 28 tests passed |
| Xcode RememberMeMac build, signing disabled | Passed with fresh DerivedData |
| Xcode RememberMeiOS generic Simulator build, signing disabled | Passed with fresh DerivedData |
| `contracts/verify-schemas.py` and `contracts/reference.ts` | Passed, including reminder fixtures |
| `git diff --check` | Passed |

SwiftPM used disposable scratch/module caches. Xcode only built the app targets;
it did not install or launch them. The schema verifier used a temporary Python
virtual environment with `jsonschema`.

Initial backend loopback tests were denied by the sandbox and passed with local
listener access. Initial Xcode runs were blocked by compiler-cache/simulator
service permissions and passed when run with normal local build access. An
extra attempt to run the extension's Vitest script files with `node --test`
failed because they require Vitest; they are already included in the passing
extension suite. These initial environment/runner failures are not application
test failures in the final verification results.

## Limits and preserved pending work

- The existing local feedback process is registered/running but its readiness
  check times out even with local network access. It was not restarted or
  replaced. The independent release build passed; this does not establish that
  the installed browser loaded the changes.
- No new installed-browser, native UI, physical-device, notification-delivery,
  live-provider or hosted OAuth acceptance was run. Earlier dated acceptance
  records remain historical evidence for their recorded builds.
- Cloudflare's personal account is pinned, but zero VPC service IDs deliberately
  block gateway deployment until replacement resources are verified. The
  reminder database migration and production cutover remain deployment work.
- The Read Frog adoption document is a future implementation plan; its features
  are not included in the implemented-code claim for this checkpoint.

Commit boundaries: backend/contracts and ingress safeguards; Apple client and
native HTTP harness; browser extension and browser HTTP harness; shared plans
and this verification record. The commits form one cumulative checkpoint.
