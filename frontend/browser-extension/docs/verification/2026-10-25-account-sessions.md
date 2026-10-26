# Account sessions and local migration preview (2026-10-25)

Scope: repair lost-refresh-response recovery and expired-access logout; show the
GitHub username; preview local migration; enable optional account controls after
local checks. All tests use synthetic credentials/vocabulary. No real vocabulary
was copied, uploaded or used as a fixture. No production deployment occurred.

## Implemented behavior

- Backend migration 0007 adds hashed request/successor metadata and a 24-hour
  recovery deadline to existing sessions. A persisted random request ID allows
  exact refresh retries after network loss or failed credential persistence.
  Successor credentials are derived with domain-separated HMAC-SHA256; SQLite
  stores only hashes. Replay rejects expired windows, changed IDs and revoked or
  rotated successors. Legacy requests without an ID retain single-use behavior.
- Browser storage and native Keychain save the refresh intent before sending.
  Failed intent persistence does not spend the token. Restart retries the same
  intent, while late responses cannot reconnect a logged-out client.
- JSON refresh-authenticated logout revokes the device and its sessions without
  needing a valid access token. It can also revoke a just-rotated session whose
  reply was lost. Unknown/expired credentials have an idempotent response without
  mutating unrelated devices. Exact-origin checks and rate limits still apply.
  Offline clients clear local credentials and report unconfirmed remote revocation.
- Browser account controls show `/me.displayName`. Preview pauses sending,
  downloads account state and lists new/skipped words with counts/history sizes.
  Confirmation names the GitHub target. Duplicate normalized words/lifecycle IDs
  are skipped without adding counts. Copy atomically stages new entries/outbox,
  retains the anonymous original, and leaves sync disabled.
- Preview fingerprints cover the account, generation, epoch and both local
  snapshots. Changes, account switches, repeated confirmation or background
  restart invalidate the preview. Context/URLs never enter upload operations.
- `ACCOUNT_SYNC_ENABLED` is true after the initial checks. More options → Account
  & sync and identity/alarms permissions are included. Browser sign-in checks
  `refresh-retry-v1` and `refresh-logout-v1` before launching OAuth, so an older
  backend requires an update instead of silently using the old protocol.

## Executed checks

Node commands used the project-pinned 22.22.3 executable.

| Check | Result |
| --- | --- |
| Extension full Vitest suite after feature enablement | 277 tests / 30 files passed |
| Release integrity regression after permission update | 1 test passed; unexpected extra permission rejected |
| Backend Vitest suite | 76 tests across the full suite and affected reruns passed |
| Backend TypeScript and extension Vue/TypeScript | Passed |
| Native session/callback/origin tests | 12 passed |
| Native account UI / logout ownership tests | 3 passed |
| Backend Node bundle | Passed |
| Browser → real loopback HTTP → SQLite | Passed; actual refresh reply dropped after commit, client recreated, identical refresh retried; migration preview/copy, expired-access logout, history, conflicts, epoch and size limits checked |
| Swift/URLSession → real loopback HTTP → SQLite | Passed with separate synthetic device processes |
| Chrome production build | Passed |
| Chrome ZIP extraction/integrity | Passed; 345 files / 11 linked resources, version 0.1.3 |
| Existing local feedback watcher | Running and development assets reachable; no second watcher started |
| Browser component preview | GitHub username and new/skipped rows checked in light and dark at 420 px content width |

The original backend suite run passed 72 tests; two loopback bridge tests could
not bind 127.0.0.1 inside the sandbox. Those two passed with loopback execution
allowed. Two additional auth boundary/race tests subsequently passed with the
affected auth/sync files. Swift tests used disposable compiler/cache directories.
The populated pre-upgrade database test also verifies refresh after all migrations.

Package SHA-256:
`b8a989124255ab6aa7776173ae49504d1c0c497d400cee56c1fcc002bdec4fa0`.

The browser preview is `preview/account.html` on the existing local watcher. It
mounts the actual Vue component with synthetic in-memory messages and no backend
or extension-storage access. It does not establish an installed-extension login.

## Deployment and acceptance still separate

Deploy the backend with migration 0007 before distributing the updated clients.
No DNS, GitHub registration, Cloudflare account, production database or server
configuration was changed. Public routing, real GitHub OAuth, installed Chrome
permission/upgrade behavior and signed Apple cross-device acceptance were not
performed in this task. A healthy watcher and passing build do not prove the
user's installed extension loaded the update. Historical Chrome 0.1.1 store
materials are explicitly marked unsuitable for this account-enabled candidate
without updated disclosures and acceptance.
