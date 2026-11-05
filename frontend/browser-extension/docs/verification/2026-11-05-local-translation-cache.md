# Local translation cache and selection latency — 2026-11-05

## Scope

Implemented the requested local-cache and selection-delay changes. Magpie
`group/translator` remains the backend primary; its existing MyMemory fallback
is unchanged. No backend/Cloudflare deployment, bulk word generation or local
dictionary replacement was performed. Concurrent typing-practice work was
excluded from the isolated build and commit.

## Implementation

- `translation-cache.ts` owns a separate IndexedDB database,
  `rememberme-translation-cache-v1`, with per-entry writes, timestamp/LRU indexes,
  a 10,000-entry disk limit and a 256-entry memory LRU. Vocabulary, account and
  sync databases are never opened by this cache.
- Keys include the lookup origin, `public:v3`, `zh-CN` and normalized word.
  Entry format, translation shape, timestamps and key/word consistency are
  checked before reuse. Future timestamps and incompatible entries are ignored.
- Freshness remains seven days for Magpie/Hermes/legacy anonymous entries and
  one hour for public MyMemory results. Valid stale results can be reused for up
  to 30 days; older results are never served, and expired disk rows are pruned on
  cache writes. A failed refresh retains usable data and backs off for 60 seconds.
- Existing current-public-v3 and plain anonymous WXT entries migrate once.
  Private/account and old public namespaces are excluded. The old WXT object
  remains untouched for rollback, so the new cache's cleanup does not erase that
  retained migration source.
- Reads have a 150 ms budget; open/transaction/legacy-storage waits are bounded.
  Storage failures cannot disable online lookup. Successful network results are
  immediately available in memory; persistence is best-effort and does not delay
  rendering. Disk completion uses IndexedDB transaction completion, not merely
  a successful put request.
- Translation Port replies may send a `cached` preview before the final result.
  The Port stays open during refresh, retaining site-policy, disconnect and user
  cancellation. No detached refresh is started by legacy/context-menu callers
  without a preview subscriber. Same-word subscribers share cache reads and
  network work; cancellation of one caller does not cancel another.
- `content.ts` starts the selected-word lookup at 120 ms instead of 300 ms.
  Cached results appear before refresh completes. Refresh only updates the open
  card: previously saved encounter snapshots remain unchanged.

## Verification

Node 22.22.3 and the committed dependency versions were used. The before and
isolated after exports each ran `npm ci --offline`; no dependency was added.

- Working-tree suite, including concurrent practice work at that point:
  375 tests in 44 files passed; TypeScript passed.
- The final isolated cache-only full suite passed **347 tests in 38 files**.
  The affected 37-test subset, including storage recovery and saved-snapshot
  preservation, also passed; TypeScript passed.
- Isolated Chrome production build passed. The existing local-feedback watcher
  rebuilt successfully and `local:status` passed; no second watcher was started.
- Regressions cover more than 500 cached words, LRU eviction, disk restart,
  migration/version boundaries, stale previews, refresh coalescing/backoff,
  cancellation and late replies, failed storage, the exact 120 ms boundary,
  preserved saved snapshots, and unchanged vocabulary isolation.

The first test iteration detected duplicated requests while concurrent callers
awaited separate IndexedDB reads. Subscribing before cache I/O fixed the race;
the original shared-lookup cancellation regression and the new concurrent
cache-miss test both pass.

## Actual browser timings

Runner: `scripts/benchmark-translation-cache.cjs`, using the existing desktop
Playwright package and Chrome for Testing in disposable profiles. The script
loads the real built extension, selects fixture words through mouse events,
reads the closed-shadow-root card via CDP, counts translation HTTP requests, and
asserts no vocabulary-save messages. It measures from mouseup to rendered Chinese
with approximately 20 ms DOM-polling resolution.

The before build came from `2354b4b`. The after build is that baseline plus this
cache/selection change, excluding unrelated practice files. Each starts with an
empty client profile. First lookups use the live public translation API; repeats
and restart checks must make zero translation HTTP requests.

| Fixture | Before first / repeat ms | After first / repeat ms | Repeat HTTP requests |
| --- | ---: | ---: | ---: |
| harbor | 4,129 / 333 | 2,836 / 140 | 0 / 0 |
| orchard | 2,557 / 308 | 886 / 139 | 0 / 0 |
| copper | 2,599 / 313 | 780 / 145 | 0 / 0 |
| Median | **2,599 / 313** | **886 / 140** | **0 / 0** |

Repeated-lookup median fell from **313 ms to 140 ms (55.3%)**, consistent with the
180 ms debounce reduction. Both versions already avoided HTTP for these repeats;
the larger cache improves retention/coverage, not the model's speed.

All three optimized first lookups returned Magpie results. **First means a client
cache miss, not a cold backend/model.** Before requests can warm the server for
after requests. The first-query difference therefore cannot be attributed wholly
to this frontend change. This is a small diagnostic sample, not p95/load coverage.

Restarting Chrome with the same disposable profile retained the cached copper
result: before 1,155 ms, after 843 ms, both with zero HTTP. First-card startup costs
were larger and variable (about 0.8–1.5 seconds); no guarantee of 140 ms immediately
after browser startup is made.

For an additional synthetic stale-result acceptance check, the after profile's
harbor entry was aged eight days and its refresh response deliberately held.
The saved Chinese appeared in **136 ms**, before releasing that response. This
sample checks the actual preview/Port/UI path but is not a live-provider speed
measurement. Unit tests separately verify refresh completion and cancellation.

- [Before browser measurements](assets/2026-11-05-local-translation-cache/before.json)
- [After browser measurements](assets/2026-11-05-local-translation-cache/after.json)
- [Build SHA-256 identities](assets/2026-11-05-local-translation-cache/bundle-sha256.json)

## Documentation reconciled

- `docs/architecture.md` persistence/cache sections versus `translation-cache.ts`:
  replaced the former 500-entry WXT-only description with separate IndexedDB,
  indexed eviction, origin/version keys and retained migration data.
- `docs/dictionary.md` cache section versus `translation-cache.ts` and
  `translation.ts`: distinguished seven-day/one-hour freshness from the new
  30-day reuse window, refresh backoff and read-only legacy retention.
- `docs/architecture.md` Port lifecycle versus `lookup-port-handler.ts` and
  `lookup-port-client.ts`: documented nonterminal cached previews and preserved
  cancellation through the final result.
- `docs/behavior.md`, README and testing guide versus `content.ts`/tests:
  documented 120 ms selection, stale rendering and saved-snapshot preservation.
- `docs/release/privacy-policy.md` local-cache paragraph versus the new store:
  clarified capacity, stale refresh, expiry cleanup and rollback retention.
  This is a source-policy update; no hosted policy publication was performed.

## Limits

This verifies disposable Chrome, not the user's everyday installed profile.
No real vocabulary was substituted for fixtures, and no account sign-in, source
upload, database migration or server configuration change was needed. Source
attribution remains the provider of the translation even when displayed locally.
