# First-lookup timeout investigation and fix

Date: 2026-10-25 (America/Los_Angeles). Source base: `e3f7ac3` plus this fix.

## Evidence and limits

The installed extension previously showed `signal timed out` on its first
translation and succeeded after the user-facing Retry action. There was no
request trace captured at that exact initial failure, so it cannot be assigned
to a single layer with certainty. The investigation reproduced two contributors:

- From this Mac, three consecutive HTTPS translation probes produced one TLS
  handshake failure, one successful Magpie response (8.627 s total, 0.657 s TLS,
  7.584 s to first byte), and one TLS connection timeout. These failures happened
  before an application response and are independent of dictionary storage.
- Magpie usage showed ordinary requests taking roughly 3.6–5.7 s with
  117–186 reasoning tokens and one cancelled request at 12,003 ms. Three
  uncached server-local API samples took 7.555, 5.429 and 4.042 s. The model
  advertises low/high/max reasoning; low was not specified by the old adapter.

The old browser request timeout and translation-service timeout were both 20 s,
leaving no opportunity for automatic recovery. The primary/fallback budgets
were 12+4 s, leaving little room for cold TLS and proxy transport. The 256-token
output cap also competed with reasoning for the final JSON; truncation is a
possible failure mode, not a confirmed cause of the original first timeout.

## Implementation

- Magpie stays on `zhipu/glm-5.3-flash`, with `reasoning_effort: low`, a 512-token
  output cap and an eight-second primary deadline. Output still requires a
  finished, bounded, Chinese JSON result; tool calls and truncated output are
  rejected. MyMemory retains its four-second deadline and actual source label.
- Only the public word-only translation request retries automatically, at most
  once, for network failures, timeout or 502/503/504. A stalled first attempt is
  aborted after five seconds, and the second uses the remaining part of one
  nineteen-second budget. Existing service/UI deadlines remain 20/22 s.
- 4xx/quota responses, malformed JSON and oversized bodies do not retry.
  Dictionary requests are bounded at eight seconds without adding retries.
  Vocabulary writes do not use this retry path. Both attempts send the exact
  same body; the server's existing same-word coalescing/cache remains in place.
- Deadlines cover headers and bodies even if an injected transport ignores
  AbortSignal. Late first replies are discarded/cancelled. Errors shown to the
  user are readable rather than raw `signal timed out` exceptions.
- Existing API request-ID/status logs now include `durationMs`, without words,
  prompts, page URLs or credentials. No DNS, proxy, TLS verification, shared
  Magpie routing or Cloudflare account settings were changed.

The primary's configured reasoning support came from the running gateway's
`/v1/models` metadata and [Magpie's integration documentation](https://github.com/yetone/magpie/blob/main/docs/integrating.md).
Three fixed-word direct low-effort trials returned complete JSON in 2.034,
1.377 and 1.615 s. These are small samples with different words, not a controlled
latency benchmark or an availability guarantee.

## Validation

Node 22.22.3; fresh `npm ci` for both packages in an isolated source copy.
Backend typecheck and all 69 tests passed. Extension compile and the 267-test
suite passed, followed by the final affected 31-test run including one added
dictionary timeout regression. Backend release startup/auth/backup/restore
checks and actual browser services → loopback HTTP → SQLite integration passed.
Extension 0.1.3 ZIP verified 345 files and 11 linked resources.

Regression cases include first-connect failure, stalled headers/body, exhausted
total budget, response-body cancellation, late first replies, 4xx/quota exclusion,
one retry for transient 5xx, malformed/oversized rejection, same-word coalescing,
no vocabulary writes, and MyMemory starting at the eight-second primary limit.

## Deployment and installed acceptance

- Runtime: `/opt/rememberme/releases/20261025-first-lookup-8cfccea264ce/runtime`.
- Archive SHA-256: `8cfccea264cefd8a0f5aee1a6e687a65298f26ac5b8700e2fbc6fd370c1b5acd`.
- Previous runtime: `/opt/rememberme/releases/20261024-magpie-84793192d5c7/runtime`.
- Database backup: `/var/lib/rememberme/backups/pre-first-lookup-20261025-8cfccea264ce.sqlite`.
- Config backup: `/etc/rememberme/api.env.pre-first-lookup-20261025-8cfccea264ce`.
- Receipt: `/opt/rememberme/releases/20261025-first-lookup-8cfccea264ce/deployment.json`.

Before activation, the new archive passed checksum/path checks, unchanged
migration comparison, real Magpie translation (1,440 ms) and real MyMemory after
a forced synthetic primary failure, all with a disposable database. The
production database backup passed integrity checks. Activation changed only
the release symlink; health passed. Configuration and migrations were unchanged.
Rollback retains the previous runtime/config/database backup.

The existing local feedback service was restarted in place for 0.1.3, keeping
extension ID `blmbjchnpodecheenfmajdjfpmgimdcj` and all vocabulary storage. In
the actual installed Chrome profile, a local page presented three fresh words:
`luminous`, `steadfast` and `ingenious`. Each first selection displayed Chinese
and **Online translation · Magpie**, without a manual Retry click. The recent
model-side successful durations were 1,745, 1,506 and 1,482 ms; these are not
browser end-to-end timings. No test word was saved, no vocabulary was cleared,
and no network outage was imposed on the user's machine. Mac code/install was
unchanged; its connected lookup benefits from the backend improvement.

Evidence: [first luminous lookup](../../../frontend/browser-extension/docs/verification/assets/2026-10-25-first-lookup/first-lookup-luminous.png),
[first ingenious lookup](../../../frontend/browser-extension/docs/verification/assets/2026-10-25-first-lookup/first-lookup-ingenious.png).
The temporary verification tab was closed. The 0.1.3 ZIP is in the extension's
`.output/` directory; SHA-256
`56f28ce284acdd3ad4071cfd146c137f05c75cb48f45e981e985d0a059c7ec39`.

Sustained disconnection or simultaneous provider failure can still produce a
bounded retryable error. The three successful first lookups establish this
run's result, not long-term reliability. Updated privacy-policy source assets
were generated; separate Cloudflare static policy publication remains pending
the personal-account ingress migration documented previously.
