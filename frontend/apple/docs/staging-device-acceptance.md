# Staging and device acceptance

This is the execution checklist for a hosted/signed run. Local Worker tests, simulator tests and unsigned builds are separate evidence. No remote resources, OAuth registration, signing team or App Group have been created by this checkpoint.

## Configuration inputs

| Input | Where to configure | Current state |
| --- | --- | --- |
| Cloudflare account and separate staging D1 ID | `backend/wrangler.jsonc` → `env.staging.d1_databases` | Account not selected; ID absent |
| HTTPS API origin | `env.staging.vars.PUBLIC_ORIGIN` and native Settings | `.invalid` placeholder |
| GitHub OAuth App Client ID | `env.staging.vars.GITHUB_CLIENT_ID` | Empty |
| OAuth callback | OAuth App registration | `${PUBLIC_ORIGIN}/auth/github/callback` |
| OAuth Client Secret | Cloudflare `GITHUB_CLIENT_SECRET` secret | Not verified; never put it in source or chat |
| Native callback | Server allowlist and both app Info.plists | `rememberme://auth/callback` |
| Apple Team, all three Bundle IDs | Xcode / `project.yml` | Provisional IDs; no team selected |
| Registered App Group | iOS app and Share Extension `REMEMBERME_APP_GROUP` | Provisional `group.com.rememberme.app` |
| Target Mac and physical iPad/iPhone | Device model, OS, provisioning | Not supplied |

`Configuration/Signing.local.xcconfig.example` documents the non-secret local signing settings. Keep app and extension entitlements on the same registered group. If bundle IDs or project settings change, regenerate the checked-in project with XcodeGen; do not edit the generated project alone.

## Hosted preparation

After the public configuration is supplied, run from `backend` with `.nvmrc` Node and `npm ci`:

```sh
node scripts/staging-preflight.mjs
npx wrangler deploy --env staging --dry-run --outdir /tmp/rememberme-staging-review
```

The preflight checks public values only. It cannot establish secret availability, resource ownership or provisioned entitlements. Its current failure is expected for the placeholder configuration.

For an authorized staging deployment, configure the secret through the interactive secret prompt and apply migrations 0001–0005 to the selected staging database before deployment:

```sh
npx wrangler secret put GITHUB_CLIENT_SECRET --env staging
npx wrangler d1 migrations apply DB --env staging --remote
npx wrangler deploy --env staging
```

These commands change external state and have not been run. Use the exact reviewed environment and resource IDs. The source privacy feature requires migration 0005 and the `source-privacy-v1` capability. Keep test accounts and vocabulary separate from production. Inspect public `/api/v1/health` over HTTPS, and verify TLS, JSON API errors and callback matching before signing in. Logs should contain request IDs/status only, with no request bodies or bearer/callback credentials.

## Real acceptance run

Record device/OS, app build, API version, actual outcome and evidence per row. Pending rows remain pending until observed.

| Flow | Required observation | Status |
| --- | --- | --- |
| GitHub login on Mac and iPad | System-browser login/cancel, exact callback/state/PKCE, origin-scoped Keychain restart and token refresh; login alone never uploads anonymous data | Pending |
| Signed sharing | With main app closed, share selected text and URL-only content from Safari and another actual host; confirm draft durability/acknowledgment and explicit word confirmation; duplicate/failure fallback | Pending |
| Two devices | Same old JSON yields one baseline; independent offline encounters each increment once; reset/history independence, current-version conflict, tombstone, logout/switch and network loss/relaunch | Pending |
| Privacy across devices | Both switches default off per device; enabling A cannot grant B local upload consent; backfill is confirmed; clearing disables account consent; re-enable then retry old requests remains blocked; new explicit backfill works | Pending |
| Removal failure | Disconnect after server commit, close app, relaunch: sending remains paused; Retry removal completes same receipt without clearing later newly consented uploads | Pending |
| Notifications | Permission grant/deny, selected vocabulary reminder rebuild, due delivery with app closed, launch to review, timezone/day change and cancellation | Pending |
| Large store on target hardware | Synthetic 10k words/100k events: backup restore and interruption, full cloud pull/history/upload, scroll/search p95, peak memory and OS termination/relaunch | Pending |
| Native files | Actual import picker/export sheet, malformed input, complete-backup merge/replacement, cancel and current cloud-version recheck | Pending |
| Accessibility | VoiceOver labels/order/modal isolation; Mac keyboard-only traversal, iPad external keyboard, Dynamic Type/accessibility sizes, portrait/landscape and Split View, light/dark contrast | Pending |

Local benchmarks measure storage/outbox work on Mac; they do not measure hosted full synchronization or physical-device memory. Current screenshot/UI evidence is in [privacy and acceptance checkpoint](verification/2026-10-09-source-privacy.md).

Configuration references: [GitHub OAuth flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps), [Apple App Groups](https://developer.apple.com/documentation/xcode/configuring-app-groups), [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/).
