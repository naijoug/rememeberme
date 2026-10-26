# Account backend deployment and hosted acceptance

Date: 2026-10-25 (America/Los_Angeles). User explicitly authorized backend
rollout, migration 0007, real GitHub login and browser/Mac sync verification,
with existing vocabulary retained.

## Deployment completed

- Host verified through the dedicated strict-host-key SSH configuration:
  `ubuntu@VM-0-9-ubuntu`, personal Tencent Lighthouse `lhins-g5atn8ei`.
- Host Node: 22.23.2; local build/package checks used 22.22.3.
- New runtime: `/opt/rememberme/releases/20261025-sessions-a5fe92f8a903/runtime`.
- Archive SHA-256:
  `a5fe92f8a9034828867b9ab75398688fb4349e099c24d4ef11d75edee44b317a`.
- Previous runtime retained:
  `/opt/rememberme/releases/20261025-first-lookup-8cfccea264ce/runtime`.
- Database backup:
  `/var/lib/rememberme/backups/pre-sessions-20261025-a5fe92f8a903.sqlite`.
- Configuration backup:
  `/etc/rememberme/api.env.pre-sessions-20261025-a5fe92f8a903`.
- Host receipt:
  `/opt/rememberme/releases/20261025-sessions-a5fe92f8a903/deployment.json`.

The exact archive passed local extracted startup/auth/WAL-backup/restore checks.
Host staging checked its checksum, safe member paths, service-user readability,
byte-identical previous migrations and in-memory OAuth configuration. Only
`0007_session_rotation.sql` was added. Activation stopped only rememberme-api,
verified the SQLite backup, retained the config, switched the runtime symlink,
and restarted the API. It included automatic previous-runtime rollback on failure;
rollback was not needed.

All pre-existing table rows were compared by canonical digest of their original
columns before and after activation. They were unchanged. Integrity and foreign
key checks passed. Production migration history now contains 0001–0007. Before
real login there were zero users/devices/sessions/vocabulary/encounters and two
old auth-flow records. No diagnostic fixtures replaced the database.

Public `https://rememberme.couplelabs.cn/api/v1/capabilities` now advertises
`refresh-retry-v1` and `refresh-logout-v1`; unauthenticated `/me` returns 401.
The exact installed Chrome origin's preflight returns 204. No DNS, GitHub
registration, Cloudflare resource, provider secret, proxy or API-origin change
was required. Existing transport is reused; this is not completion of the
separate Cloudflare personal-account migration.

## Mac application and actual OAuth callback fix

Updated the existing `/Users/guojian/Applications/Remember Me.app` in place.
The prior app and a stopped-app local-data copy are retained under
`~/Library/Application Support/RememberMe-UpdateBackups/2026-10-25-sessions-a5fe92f8a903/`.
The live `~/Library/Application Support/RememberMe` directory was not replaced,
and Keychain was not copied, cleared or edited outside normal client login.
The installed app was already ad-hoc signed; the updated native build preserves
its bundle ID and uses ad-hoc signing. This does not establish notarization or
App Store/physical-device signing acceptance.

First real OAuth returned a valid GitHub identity but crashed before code
exchange. The crash report identified `_dispatch_assert_queue_fail` in
`AppleWebAuthenticator.authenticate` on SafariLaunchAgent's XPC queue. Swift 6
had inferred a MainActor-isolated Objective-C completion closure; the assertion
occurred before its inner Task could hop executors. A nonisolated Sendable bridge
now schedules only the actual state mutation on MainActor. Its regression invokes
the bridge from a detached task. Callback, account and cancellation tests passed,
and the Xcode app was rebuilt and reinstalled with the previous build retained.

Fixed installed binary SHA-256:
`65b9b22905b0cc27daee5e8927c8c94a37a50c3e1c8834ae5846674b24eae341`.

The updated app subsequently completed real GitHub login as `naijoug`, displayed
account vocabulary and completed synchronization. Anonymous Mac vocabulary was
empty and remains separate. Source-context and URL sharing stayed disabled.
Quitting and relaunching the actual Mac app retained its Keychain login and account word, and synchronization completed again.
A new synthetic word `synchronization`, with a clearly marked acceptance-test
meaning and note, was created through the actual Mac UI and synchronized. It is
not an existing vocabulary item used as a fixture. [Mac evidence](assets/2026-10-25-account/mac-synthetic-sync.png).

## Browser checkpoint before manual sign-in

The actual installed Chrome extension ID is
`blmbjchnpodecheenfmajdjfpmgimdcj`. Its popup showed four existing anonymous words,
all retained. No anonymous copy/upload or clear/import was performed.

Toolbar popup automation repeatedly lost the popup while the desktop was being
used. Attempting a dedicated tab for the observed extension URL was then rejected
by the browser URL policy (only HTTP/HTTPS allowed). The rejection explicitly
forbade alternate surfaces or indirect execution to bypass it. The user was asked
to manually sign in in the existing extension, open account vocabulary and enable
sync, without copying the anonymous vocabulary. At that point, browser OAuth and the complete browser↔Mac round trip were pending
the user step. The final verification below supersedes this checkpoint.

The synthetic account test word was retained at that checkpoint for the round
trip and later cleaned up through normal confirmed product deletion.

## Rollback

Stop rememberme-api, point `/opt/rememberme/current` to the recorded previous
runtime, restart, then verify health and auth. Keep the current database and
backups; migration 0007 is additive, so an older runtime need not remove its
columns. Do not restore the pre-login database over newly created user/session
or vocabulary records. For the Mac app, quit it before restoring the retained
previous app bundle; preserve the current data directory and Keychain.

## Follow-up checkpoint (2026-10-26, America/Los_Angeles)

The user reported logging in and seeing the test word in Chrome. A subsequent
read-only server check still showed only the `Remember Me Mac` device for
`naijoug`, with no browser device/session. Native Chrome observation showed an
ordinary website rather than an open extension account page. Consequently the
reported browser result was not yet corroborated at that checkpoint. The final
verification below records the later successful browser session.

The actual Mac UI recorded the synthetic `synchronization` word once. SQLite
confirmed count 1, version 2 and exactly one encounter. All source context/URL
fields remained empty. The original browser vocabulary was not touched. The
user was asked to keep the actual installed extension's Account & sync page open
so its username or error can be inspected without repeating the blocked
extension-URL navigation. Browser-to-Mac updates and cleanup were still pending
at that point.

## Completed browser ↔ Mac acceptance (2026-10-26)

This section supersedes the pending browser checkpoints above. The user manually
opened the installed extension's Account & sync page. Its UI showed
`Signed in as @naijoug`, an anonymous local vocabulary with **6 words**, and no
pending changes/conflicts. The existing page was used to open account vocabulary
and enable sync. No blocked extension URL was reopened, no browser profile files
or credentials were extracted, and no anonymous vocabulary was copied/imported.
The backend then confirmed two unrevoked devices under the same user:
`Remember Me Mac` and `Remember Me Browser`.

The remaining write/read checks used the installed extension's normal selection
card on the ordinary HTTP development page `preview/sync-acceptance.html`. This
page contains only synthetic test text and no application/storage scripts.

| Action | Actual observed result |
| --- | --- |
| Mac creates the synthetic word and records it once | Browser selection card shows count 1 and one record |
| Browser clicks its record control exactly once | Browser shows count 2 / Records 2 |
| Mac performs Synchronize now | Mac shows Forgotten: 2 / Records (2), including the new browser timestamp |
| Mac resets the count | Mac and then browser show count 0 while retaining both records; server version 4 |
| Mac confirms Delete word for the synthetic entry | Mac account list becomes empty; server version 5 has deleted=1 |
| Browser's periodic sync runs, then a fresh selection card opens | Count 0 with no saved Records section; the synthetic entry is no longer active |

Evidence:
- [Browser record 1 → 2](assets/2026-10-25-account/browser-recorded-two.png)
- [Mac receives both records](assets/2026-10-25-account/mac-received-two.png)
- [Browser reset retains history](assets/2026-10-25-account/browser-reset-retains-history.png)
- [Browser after test cleanup](assets/2026-10-25-account/browser-test-cleaned.png)

SQLite confirmed zero active account words after cleanup, a tombstone for the
test word and the retained two history records. Integrity returned `ok` and
foreign-key checks returned zero errors. No encounter context or URL was
uploaded. Session metadata also confirmed one real Mac refresh rotation after
its initial access expiry, without exposing raw credentials.

Both clients remain signed in with account sync enabled. The six original
browser words remain in the anonymous local partition, separate from the now
empty account vocabulary; migration still requires the user's preview/copy
choice. No bulk migration was performed as an acceptance test. Earlier database,
configuration and Mac application/data backups remain available.

This verifies the existing installed Chrome identity and this Mac build against
the deployed backend. It does not establish other extension IDs, notarization,
iOS device acceptance or prolonged network-outage behavior. The desktop Chrome
OAuth step was completed manually by the user; its account identity/device
session and subsequent real synchronization were independently observed.
