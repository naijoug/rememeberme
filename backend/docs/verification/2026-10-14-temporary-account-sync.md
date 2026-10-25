# Temporary account sync preparation (2026-10-14, America/Los_Angeles)

Requested scope: use a temporary HTTPS domain for GitHub account sync, retain the
installed extension’s local vocabulary and open the same account in macOS for
word learning. Real vocabulary is user data, never a test fixture.

## Prepared and checked

- Existing Tencent API and persistent lookup tunnel are active. The production
  database remains `/var/lib/rememberme/rememberme.sqlite`; the current API origin
  is still `https://rememberme.couplelabs.cn`.
- Existing exact allowlists include the installed extension identity
  `blmbjchnpodecheenfmajdjfpmgimdcj` and `rememberme://auth/callback`.
- Provisioned `rememberme-account` VPC service
  `01a13e1f-3d24-7082-95bd-1d336c070b2a` through the existing named tunnel. It is
  restricted to HTTP `127.0.0.1:8787`; no database port is exposed.
- Deployed the private `rememberme-account` Worker, version
  `5d74f275-a3cc-488b-a287-e2116cab23ba`, with workers.dev/preview URLs disabled.
  It requires the exact public host and installed extension origin, forwards
  original request bytes and query cursors, preserves bearer/epoch metadata,
  bounds payloads/time, disables invocation logging and validates OAuth redirect
  targets. OAuth cookies are restricted to `rm_auth_flow`; unrelated cookies and
  proxy headers are excluded. The forwarded IP is supplied by the trusted edge.
- Prepared Pages routing to separate account and anonymous lookup gateways.
  This routing has **not been activated** on the public domain.
- Prepared privacy-policy changes documenting optional sync, login identity,
  local-copy retention, excluded browser contexts/URLs and identity/alarms usage.
- Added an activation script with read-only preflight, consistent SQLite backup,
  environment backup, an origin-only update and API-health rollback. Uploaded
  it to the existing authenticated server terminal and ran `--check`: passed.
- Added the exact additional callback
  `https://lookup.couplelabs.cn/auth/github/callback` to the GitHub settings form,
  preserving the canonical callback and leaving wildcard matching off. The form
  remains **unsaved**, pending action-time confirmation.

## Executed verification

`npm test -- tests/account-gateway.test.ts tests/lookup-gateway.test.ts` passed
9 tests / 2 files using synthetic requests and mocked service bindings. New
coverage verifies account/lookup route isolation, exact frozen-body/query
preservation, OAuth cookies/redirects, origin/body rejection, conflict metadata,
preflight, upstream failure isolation and credential/header exclusions.

`tsc -p account-gateway/tsconfig.json` passed with generated Wrangler bindings.
A separate temporary typecheck against official workers-types 5.20261015.1 also
passed. Wrangler-generated binding declarations are checked in without the full
runtime type bundle. The pinned package runtime used Node 22.22.3.

An isolated source copy at `/tmp/rememberme-account-preview/frontend/browser-extension`
was configured with the proposed temporary origin and account sync enabled.
Its Vue/TypeScript check, Chrome build and 38 targeted tests across backend-client,
cloud-vocabulary, CloudConnection and the popup passed. The active checkout's
account feature flag remains disabled until the required confirmation and backup.
The existing installed extension's local-feedback service passed its health check;
no replacement extension identity or second watcher was created.

## Remaining gates

Browser tooling explicitly rejected navigation to the installed extension’s
`chrome-extension://` page. No alternate browser surface, profile-file access or
raw browser execution was used to bypass that restriction. The user was asked to
export a backup manually before updating/enabling the installed extension.

The browser’s action-time confirmation rule applies to adding an OAuth trusted
redirect and changing the publicly used authentication origin. An exact combined
confirmation was requested after preparing code, tests and the unsaved form.
Do not save/activate those settings without the response. Existing credentials,
canonical redirect, database and anonymous vocabulary are retained.

Still pending: confirmation, server-origin activation, Pages activation, public
health/auth/CORS/OAuth acceptance, account-enabled extension configuration and
live-update validation, same-account browser/native login, explicit local-copy
publication, sync enablement, Mac pull and learning of the actual saved words.
No completed hosted OAuth or real-vocabulary sync is claimed by this record.

## Revised canonical-domain plan (2026-10-15, America/Los_Angeles)

The user confirmed the extension JSON backup and requested that account sync use
`rememberme.couplelabs.cn`, rather than `lookup.couplelabs.cn`. This supersedes
all proposed origin/callback changes above. The GitHub lookup callback was never
saved, and the server origin was never changed. No new OAuth callback or API
origin migration is needed. The unused origin-change installer was removed from
source; its uploaded temporary copy was never run with `--apply`.

The account gateway source and isolated client now target the existing canonical
origin. The nine gateway/lookup tests passed again with that hostname. The live
private account Worker still has its prior prepared configuration; it is not yet
connected to a public account route.

Read-only DNSPod inspection confirmed one canonical record: `rememberme`, A,
`49.233.208.103`, default line, TTL 600. The existing independent `lookup` CNAME
points to `rememberme-lookup.pages.dev`. Only `lookup.couplelabs.cn` is currently
registered and active on that Pages project. Other applications' DNS entries
remain out of scope.

Proposed change: register the canonical hostname on the existing Pages project,
then replace only its A record with CNAME `rememberme-lookup.pages.dev`, retaining
the default line and TTL 600. The backend stays on its original private port,
database and credentials; HTTPS is terminated at the edge and the existing
private tunnel carries authenticated account requests. The original GitHub
callback and server PUBLIC_ORIGIN remain canonical. The DNS form is prepared but
unsaved; a screenshot is at `/tmp/rememberme-canonical-dns-proposed.png`.

Automatic approval review rejected the Pages-domain registration before the
command ran: it considered the exact mutation insufficiently authorized and
potentially conflicting with the existing A record/API. Do not retry that
registration or save the DNS change until the user explicitly approves this
specific canonical-domain routing change. No DNS/domain mutation occurred.
