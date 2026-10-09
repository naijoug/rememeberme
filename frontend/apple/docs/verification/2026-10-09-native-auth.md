# 2026-10-09 native authentication and API transport

Implemented origin-scoped Keychain credentials, native PKCE/state/callback validation, a shared refresh coordinator and authenticated API transport with account-generation checks. Settings includes an explicitly configured HTTPS origin and system-browser Sign in with GitHub/Cancel/Disconnect. Connecting alone neither binds anonymous ownership nor uploads vocabulary; persisted wire projections/checkpoints, remote-base overlay and sync enablement remain unfinished.

## Verified evidence

- 62 core tests passed at this checkpoint. New cases cover the RFC S256 vector, callback scheme/host/path/duplicate-query rejection, origin validation, 12 concurrent expired-access requests sharing one refresh/vault write, concurrent 401 retries, logout during refresh, Keychain-write retry after server rotation, temporary failure versus confirmed revocation, superseded login, HTML/redirect replies and oversized request guards. Tokens/providers/vaults in these tests are synthetic; no real OAuth request occurs.
- 9 presentation-model tests passed. Account tests inject a mock browser, isolated preference suite and synthetic vault/transport; only the non-secret origin appears in preferences, cancelled login never exchanges credentials, and disconnect removes the synthetic saved pair.
- Mac compilation passed and three existing iOS Simulator UI cases passed after adding authentication/session code and explicit app metadata. These regressions exercise local vocabulary/review/import recovery, not real browser login or Keychain on a signed device.
- A CLI probe used a fresh `com.rememberme.tests.<UUID>` Keychain service with only synthetic credentials. It verified write, reopen, another-origin isolation and removal. Both test namespaces were cleared; existing user Keychain items were not inspected or modified. This is actual development-host Keychain evidence, not physical iPhone or packaged-app signing evidence.
- Actual Mac/iOS build products were read to verify `CFBundleURLTypes` declares the `rememberme` callback scheme. Generated build-setting metadata initially omitted the array in the app Info.plist; explicit source `Mac-Info.plist`/`iOS-Info.plist` fixed that observed defect. Source plist files parsed successfully.

## Design boundaries

Native credentials use WhenUnlockedThisDeviceOnly Keychain accessibility and no synchronization/access group. Synchronous Security framework writes occur within the session actor turn; checking account generation and saving/removing the item cannot interleave with a new connection. A completed successful refresh remains available if vault persistence fails, so retry does not spend the already-rotated old refresh token again. Confirmed expiry/revocation clears credentials; temporary storage/server errors do not erase them.

The API origin validator rejects remote plaintext HTTP, embedded credentials, queries/fragments and non-root paths. Explicit loopback HTTP is limited to test helpers; production Settings uses HTTPS. URLSession is ephemeral, has no cookie/credential cache, blocks redirects, bounds response bytes and deadlines, and cancels incomplete response tasks. The authenticated client retries an expired access token once through the common refresh path and rejects results from a superseded account lease. No token appears in preferences, vocabulary exports, log messages or callback URLs.

`ASWebAuthenticationSession` starts only from explicit Settings action, requests an ephemeral browser session and has cancellation/presentation-anchor handling. Disposable UI test-store sessions block persistent credential/network access; injected test models explicitly opt into synthetic flows. Login attempt cancellation/state checks protect against late exchange results. No live system-browser login is claimed from mock tests.

## Remaining acceptance and implementation

Actual hosted OAuth configuration, browser/callback presentation on Mac and iPhone, signed app/device Keychain accessibility and device revocation UI remain unverified. Account ownership/merge preview, account-scoped repository selection, server-base overlays, frozen bounded wire items, checkpoints/epoch recovery, durable conflicts and native sync UI are still required before enabling vocabulary transmission. The unified API remains local and undeployed. The overall implementation goal is active.
