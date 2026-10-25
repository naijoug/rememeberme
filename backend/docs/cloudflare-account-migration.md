# Personal Cloudflare account migration

Status on 2026-10-16 (America/Los_Angeles): shared token created and identity verified; **no service
resources migrated and no DNS/domain cutover performed by this correction**.
The user requested migration from `guojian@hoxigames.com` to
`naijoug@outlook.com`. The workspace policy is
`/Users/guojian/Workspace/naijoug/AGENTS.md`, explicitly referenced by this
repository's `AGENTS.md` for temporary checkouts as well.

## Identity and credentials

The original workspace Keychain token could not read user identity, memberships
or Pages (403). It is no longer used by the workspace launcher.

The user authorized one shared, non-expiring user API token named
`naijoug-workspace` for current/future projects under this workspace. It was
created in the signed-in `naijoug@outlook.com` dashboard with access limited to
CoupleLabs, account `5c11819c6fdb08421e6d58084e37f028`. Live API checks verified
both the user's email and accepted membership in that account.

The private source is
`/Users/guojian/Workspace/naijoug/.cloudflare/credentials.env` (0600, inside a
0700 directory, ignored by its local `.gitignore`). Project configuration stores
only that path; no token copies are needed in repositories. The earlier empty
`backend/.env.cloudflare` is unused. Do not copy, print or commit token values.

Use `/Users/guojian/Workspace/naijoug/.cloudflare/bin/cloudflare-local check`, or
`cloudflare-local run <command>` for other workspace projects. Remember Me's
`cf:check` / `cf:deploy` explicitly read the same file. Both verify identity and
membership. The shared launcher sanitizes inherited Cloudflare/Wrangler variables
and pins the personal account. No global OAuth login was changed; old Keychain
credentials are not a fallback. CI and remote credentials are not automatically
replaced by this local shared source.

Required permissions for identity checks are User Details Read and Memberships
Read (dashboard labels may say User Details / Read and Memberships / Read).
Account Settings Read permits account discovery. For the migration, scope Workers
Scripts Edit, Cloudflare Pages Edit and Cloudflare Tunnel Edit to the personal
account. The signed-in dashboard was subsequently inspected: the user-token
editor exposes Account > Connectivity Directory (`连接目录`) with Read, Admin
(`管理员`) and Bind levels. Choose Admin for creating the replacement VPC
services. Workers VPC documentation also requires the user's appropriate account
role; verify actual VPC API access after token setup.
DNS is currently managed in DNSPod; Cloudflare DNS Edit is not needed for those
records. This ingress migration does not require D1/R2 or billing permissions.

References: [User Details](https://developers.cloudflare.com/api/resources/user/methods/get/),
[Memberships](https://developers.cloudflare.com/api/resources/memberships/methods/list/),
[token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/),
[VPC roles](https://developers.cloudflare.com/workers-vpc/configuration/vpc-services/),
[Workers VPC service API](https://developers.cloudflare.com/api/resources/connectivity/subresources/directory/subresources/services/methods/create/).

Run with the Node version in `.nvmrc`, inside `backend/`:

```sh
npm run cf:check
npm run test:cloudflare
```

`cf:check` is read-only. It verifies the exact email and accepted membership in
the candidate/approved account. The verified account ID is now recorded in `deploy/cloudflare-account.json`
as `accountId` and in all four gateway/Pages Wrangler configs. A successful check does not itself
write configuration or grant permission to any other account.

The root `wrangler.jsonc` is the retained local D1/Worker path, not the live
Tencent backend. It also has a zero account ID to prevent accidental cloud use;
do not provision that old backend as part of this ingress migration.

## Source inventory

These are recorded October 14–15 resources in the **incorrect company account**
`83d5b273d7ceb2b02a9f454f67ac495b`. Re-inventory the live source before cutover;
the historical records are not a current backup.

| Resource | Recorded source | Required target work |
| --- | --- | --- |
| Account Worker | `rememberme-account` | Deploy `account-gateway/` with personal VPC binding |
| Lookup Worker | `rememberme-lookup` | Deploy `lookup-gateway/` with personal VPC binding |
| Account Pages | `rememberme`, allocated `rememberme-6hc.pages.dev` | Create target project, deploy `account-entry/public` |
| Lookup Pages | `rememberme-lookup`, `rememberme-lookup.pages.dev` | Create target project, deploy `lookup-entry/public` |
| Tunnel | `d8b5791c-9173-4a12-9c0d-e58d3da01d5f` | Create personal tunnel and install a separate connector credential |
| Lookup VPC | `01a13b1f-f04b-7892-ada7-d9092b7ff0f4` | Recreate HTTP `127.0.0.1:8788` through personal tunnel |
| Account VPC | `01a13e1f-3d24-7082-95bd-1d336c070b2a` | Recreate HTTP `127.0.0.1:8787` through personal tunnel |
| Domains | `lookup.couplelabs.cn`, `rememberme.couplelabs.cn` | Release/rebind exact domains and update their DNSPod CNAMEs to actual new targets |

The account custom domain was previously pending validation; lookup was recorded
active. Keep the canonical account origin and GitHub callback
`https://rememberme.couplelabs.cn/auth/github/callback`. Do not assume old
`pages.dev` allocations will be available in the new account.

Vocabulary and account data remain in Tencent SQLite at
`/var/lib/rememberme/rememberme.sqlite`; this is not a D1 data migration.
Existing application/provider credentials stay on that host. Do not copy company
Cloudflare credentials into the target account or use real vocabulary as fixtures.

## Cutover procedure after identity verification

1. Read the existing Pages settings/domains, Worker versions/bindings, tunnel
   configuration and exact DNSPod records. Save private backups outside source
   control. Verify the SQLite backup before the ingress change.
2. Create the personal tunnel with default 404 ingress. Run a separate systemd
   connector using a new private token file and `LoadCredential`, retaining the
   old connector for rollback. Use QUIC for the VPC path. The existing installer
   refuses overwriting its old token file; do not overwrite or reuse it.
3. Create the two personal VPC services restricted to loopback HTTP ports 8788
   and 8787. Verify their account ownership and connector health. Replace the
   zero VPC IDs in the two gateway configs with returned IDs; never use source IDs.
4. Deploy the Workers, then create/deploy the two personal Pages projects with
   their same-account Worker service bindings. Use the guarded commands below.
   Record actual target `pages.dev` hostnames. Check static assets, health and
   lookup isolation. The account gateway intentionally rejects account requests
   on a noncanonical host, so that rejection is expected before domain cutover.
5. At cutover, release only the two Remember Me domain associations from the
   source, bind them to target Pages, and update only their DNSPod CNAME records.
   Keep the existing TTL/line and unrelated DNS intact. Record old associations
   and DNS values for rollback; cross-account reattachment may require certificate
   validation and is not guaranteed to be instantaneous.
6. Check canonical HTTPS, health/capabilities, anonymous lookup with synthetic
   words, unauthenticated account rejection, CORS and OAuth redirect behavior.
   Verify the real browser/native login only with the user's normal flow; do not
   silently upload local vocabulary. On failure, restore the recorded domain/DNS
   association and old connector routing. Do not delete source resources while
   validation or rollback remains pending.
7. Record target IDs, deployed versions, DNS and acceptance results. Retiring old
   service resources must be explicitly scoped after successful cutover; never
   delete databases or backups as an incidental migration step.

```sh
npm run cf:deploy -- lookup-gateway
npm run cf:deploy -- account-gateway
npm run cf:deploy -- lookup-entry
npm run cf:deploy -- account-entry
```

Every deployment rechecks the email/membership/account, rejects old or zero VPC
IDs, and checks that the service is readable in the target account. The wrapper
accepts only these four targets and no arbitrary CLI overrides. It is a guard for
this entrypoint, not a system-wide interception of all Cloudflare tools; future
provisioning/API operations must follow the same workspace identity rule.

## Verification scope

Executed on Node 22.22.3 after `npm ci`: `npm run test:cloudflare` passed 10
tests; the targeted account/lookup gateway suite passed 9 tests in 2 files.
`npm run cf:check` with the empty project token stopped before any API request,
as intended. `git diff --check` passed, and the private token file is Git-ignored
with mode 0600. No dependency/runtime changes were made; package and lockfile
dependency/engine declarations still match.

The guard tests use disposable credentials, mocked HTTP and temporary files.
They cover company email/account rejection, membership/403 failures, credential
isolation, private-file permissions and missing/old VPC IDs. They do not prove
that target deployment, browser login, DNS cutover or data synchronization works.


## Shared-token completion and migration blocker

The dashboard confirmed `naijoug-workspace` is Active with seven permissions,
scoped to one account, with no expiry. Live reads of Workers, Pages, Tunnel and
Connectivity Directory succeeded in the verified personal account. They found
no Remember Me resources there. The shared launcher also passed an execution
check with deliberately incorrect inherited account/key values: those values
were removed and the verified account was pinned. The 10 guard tests still pass.

Service cutover remains pending. Automatic approval review rejected the attempted
source inventory using the old global Wrangler OAuth credential: it considered
that credential source and access to the company account unauthorized. The
rejected command did not execute, and there has been no company-account read,
resource mutation, domain release or DNS cutover in this continuation. Obtain
explicitly scoped source-account access/approval before inventory and backup;
do not work around the rejection via another credential extraction method.

The target Worker VPC bindings are still zero placeholders pending provisioning.
The root legacy Worker config remains locked to a zero account ID.
