# Canonical account gateway checkpoint (2026-10-15, America/Los_Angeles)

The user explicitly authorized registering `rememberme.couplelabs.cn` with
Cloudflare and changing only its DNS, while retaining vocabulary, the existing
Tencent SQLite database and the original GitHub OAuth callback. The user also
confirmed an extension JSON backup. This supersedes the earlier lookup-domain
proposal in [the preparation record](2026-10-14-temporary-account-sync.md).

## Completed Cloudflare work

- Refreshed the existing Cloudflare OAuth session through Wrangler without
  requesting additional scopes or changing application/provider credentials.
- Created the `rememberme` Pages project in account
  `83d5b273d7ceb2b02a9f454f67ac495b`. Cloudflare allocated
  `rememberme-6hc.pages.dev`; it did not allocate the exact `rememberme.pages.dev`.
- Registered `rememberme.couplelabs.cn` on that project. Domain ID:
  `d3c788a5-bcf5-4b28-925c-92c9785a6016`. Its last observed state is pending HTTP
  validation; DNS has not yet been changed by this task.
- Deployed account Worker version `769a85c5-3e03-48fd-b47f-b7a7147c8d39` with
  `PUBLIC_ORIGIN=https://rememberme.couplelabs.cn`, workers.dev/preview disabled,
  exact extension CORS and no invocation logs. Its VPC target remains only the
  original API at HTTP `127.0.0.1:8787`, through the existing private tunnel.
- Deployed Pages production build `d682db31-8501-49b5-b181-5070d25eaa77` with the
  `ACCOUNT_GATEWAY` service binding to `rememberme-account`. The compiled entry
  routes authenticated API/OAuth and health to that gateway and serves the
  existing application homepage and prepared privacy policy as static assets.
- A normal certificate-validated HTTPS GET to
  `https://rememberme-6hc.pages.dev/` returned HTTP 200 with the application
  homepage. This proves default-host reachability, not authenticated sync.
- GET `/api/v1/me` on the default Pages hostname returned the gateway's JSON
  HTTP 404 with `Cache-Control: no-store`, confirming that it cannot silently
  become a second account origin. The canonical HTTPS health request still
  failed its TLS connection on the latest check, so sync remains disabled.

Anonymous lookup remains in its independent Pages/Worker gateway. The account
entry is separate under `backend/account-entry`; lookup-entry source retains its
lookup-only delegation. The backend database, credentials, PUBLIC_ORIGIN and
registered GitHub callback have not been changed.

## Verification and local preparation

The nine account/lookup gateway tests passed after adding the separate account
entry and health route. They verify fixed-target forwarding, frozen request and
cursor preservation, cookie/header restrictions, strict redirect/CORS handling,
conflict preservation, size bounds and lookup isolation. The gateway TypeScript
check passed. Earlier isolated account-enabled client checks passed 38 targeted
tests, compile and Chrome build; the canonical-origin build and three connection
UI tests subsequently passed again. These all use synthetic fixtures.

The active installed extension's account flag remains disabled until public
account health/OAuth checks pass. Its existing local-feedback service is reused;
no reinstall, replacement identity, second watcher or vocabulary import occurred.
The installed Mac app was opened in normal mode; its existing empty anonymous
store is retained. Settings was filled with the canonical HTTPS origin but sign-in
was not started while the service remained pending DNS.

## Current external blocker

Browser control repeatedly failed to load its request-header policy due to a
network error. No alternate browser API/native Chrome control was used to bypass
that control. The Cloudflare CLI/API work was independently authorized and
completed; the DNSPod browser save could not run.

The user was asked to change only the `rememberme` DNS record from A
`49.233.208.103` to CNAME `rememberme-6hc.pages.dev`, default line, TTL 600, then
confirm completion. Any old unsaved `rememberme-lookup.pages.dev` draft must use
the new assigned target. Other DNS entries and the ACME TXT record stay intact.
The previous routing approval rejection is resolved by the user's explicit
current authorization; no further approval is required for this same change.

Pending: DNS save/propagation, custom-host certificate validation, canonical
health/capabilities/unauthenticated/CORS/OAuth preflight checks, enable the existing
extension's account UI, same-account browser/native login, confirmed local-copy
publication and sync, native pull and real-word learning. No completed hosted
login or real-vocabulary synchronization is claimed.
