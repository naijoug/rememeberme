# Hosted and device acceptance

Updated 2026-10-16. The current API is Node/Hono/SQLite on Tencent; Cloudflare is an independent HTTPS/account gateway. Historical Worker/D1 tests do not establish the currently hosted service. No external deployment or signed-device acceptance was performed by the October 16 gap-closure work.

## Configuration inputs

| Input | Current source / remaining observation |
| --- | --- |
| Canonical HTTPS origin and GitHub callback | Backend deployment configuration and `docs/verification/2026-10-15-account-domain.md`; recheck DNS/TLS/health rather than treating that historical pending state as live |
| Account gateway identity | Follow `../../../../AGENTS.md` / workspace account routing and `../../../backend/docs/cloudflare-account-migration.md`; historical company resources are not deployment targets |
| API runtime/database | Existing Node/Hono/SQLite service; a new D1 database is not required |
| API capabilities | Current `/api/v1/health` and authenticated `/api/v1/me`; reminder device selection additionally needs `reminder-device-v1` |
| Native callback | Exact `rememberme://auth/callback` allowlist and both app Info.plists |
| Apple Team / Bundle IDs / App Group | `project.yml` and `Configuration/Signing.local.xcconfig.example`; provisional IDs are not registration evidence |
| Target hardware | Record Mac and physical iPhone model, OS, build and provisioning; use iPad for additional layout checks |

## Hosted preparation

Follow [backend deployment](../../../backend/docs/tencent-deployment.md) and the current personal-account gateway instructions. Use synthetic isolated accounts for acceptance. Confirm canonical HTTPS, health/capabilities, unauthenticated errors, exact callback and allowed client origins before starting native login.

The reminder feature adds SQLite migration `0006_reminder_device.sql`, the optional `/me.reminderDevice` response and `PUT /api/v1/reminder-device`. Apply migrations through the existing reviewed backend deployment procedure. This task prepared source and tested local migration, but did not deploy it. Older services without the capability keep account reminder selection unavailable; anonymous local reminders remain available. Existing clients ignore the additive response fields.

Account reminder selection is explicit and separate from local notification permission. Verify version conflicts and unknown write outcomes: another device's newer selection must not be overwritten by a stale retry. Device changes cancel previously scheduled account notifications once learned; offline devices may still deliver their earlier schedule.

## Real acceptance run

Record device/OS, app build, API version, actual outcome and evidence per row. Pending rows remain pending until observed.

| Flow | Required observation | Status |
| --- | --- | --- |
| GitHub login on Mac and iPad | System-browser login/cancel, exact callback/state/PKCE, origin-scoped Keychain restart and token refresh; login alone never uploads anonymous data | Pending |
| Signed sharing | With main app closed, share selected text and URL-only content from Safari and another actual host; confirm draft durability/acknowledgment and explicit word confirmation; duplicate/failure fallback | Pending |
| Two devices | Same old JSON yields one baseline; independent offline encounters each increment once; reset/history independence, current-version conflict, tombstone, logout/switch and network loss/relaunch | Pending |
| Privacy across devices | Both switches default off per device; enabling A cannot grant B local upload consent; backfill is confirmed; clearing disables account consent; re-enable then retry old requests remains blocked; new explicit backfill works | Pending |
| Removal failure | Disconnect after server commit, close app, relaunch: sending remains paused; Retry removal completes same receipt without clearing later newly consented uploads | Pending |
| Notifications | Account device claim/transfer/release, offline stale schedule, permission grant/deny, selected vocabulary reminder rebuild, due delivery with app closed, launch to review, timezone/day change and cancellation | Pending |
| Large store on target hardware | Synthetic 10k words/100k events: backup restore and interruption, full cloud pull/history/upload, scroll/search p95, peak memory and OS termination/relaunch | Pending |
| Native files | Actual import picker/export sheet, malformed input, complete-backup merge/replacement, cancel and current cloud-version recheck | Pending |
| Accessibility | VoiceOver labels/order/modal isolation; Mac keyboard-only traversal, iPad external keyboard, Dynamic Type/accessibility sizes, portrait/landscape and Split View, light/dark contrast | Pending |

Local benchmarks measure storage/outbox work on Mac; they do not measure hosted full synchronization or physical-device memory. Current screenshot/UI evidence is in [privacy and acceptance checkpoint](verification/2026-10-09-source-privacy.md).

Configuration references: [GitHub OAuth flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps), [Apple App Groups](https://developer.apple.com/documentation/xcode/configuring-app-groups), [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/).
