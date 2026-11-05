# Word translation resilience — 2026-11-04

This record describes the pre-deployment implementation and comparison.
Production activation subsequently completed; see the separate
[deployment record](2026-11-04-translation-deployment.md).

## Scope and activation

Implemented in the existing working tree, preserving its prior uncommitted work.
Word translation still calls Magpie `group/translator`; no group membership,
provider order, credentials, production service or vocabulary was changed.
The optimized adapter was executed in isolated memory on the personal Tencent
server using its existing credentials and real providers. **This is not a
production deployment or installed-user-browser acceptance.** The local extension
watcher rebuilt the source; its development assets passed `local:status`.

## Changes

- `contracts/translation-policy.ts` shares the budgets: 3,000 ms Magpie,
  4,000 ms MyMemory, 9,000 ms first HTTP attempt, 19,000 ms total HTTP,
  20,000 ms extension service and 22,000 ms UI. The normal provider chain fits
  before the first HTTP timeout with 2,000 ms reserved for the network.
- `backend/src/translation-circuit.ts` is per Magpie word-translator instance.
  Two consecutive upstream failures open it for 30 seconds. Open/half-open
  rejections immediately enter the existing MyMemory fallback. After cooldown,
  one probe is admitted; success closes, failure reopens. Local capacity
  rejection and invalid input do not trip it. Generations fence stale concurrent
  completions; the existing pending map coalesces identical probe words.
- Sentence explanation retains its separate deadline and no word circuit.
  Successful caches, provenance, vocabulary/import/export and privacy boundaries
  remain unchanged. Fallback-disabled configurations report the circuit error.
- `public-lookup.ts` reads at most 8 KiB of structured error JSON inside the same
  attempt deadline. Explicit `error.retryable: false` stops retry even for
  502/503/504. No upstream error message is displayed. Plain proxy failures
  retain status-based recovery; malformed/oversized JSON, HTTP 4xx and caller
  cancellation do not retry. At most one eligible retry remains.

## Automated verification

Used existing Node 22.22.3 and the dependencies installed with `npm ci --offline`
during the preceding review. No dependency/package changes were required.

- Extension `npm test`: **339 tests, 37 files passed**.
- Backend `npm test`: **91 tests, 16 files passed**.
- Extension `npm run compile` and backend `npm run typecheck`: passed.
- Chrome production build and backend build: passed.
- `git diff --check`, comparison-script syntax and changed local documentation
  links: passed.
- The initial sandboxed loopback test failed with `listen EPERM`; it passed
  outside the network sandbox, as did the subsequent complete backend suite.

New regressions cover timed fallback, circuit opening, local capacity exclusion,
one half-open probe, failed-probe reopening, recovery, stale completions,
fallback-disabled behavior, cache retention, non-retryable 502/503/504, malformed
and oversized error bodies, stalled error-body cancellation, HTTP 429 protection,
and a seven-second response completing without a speculative HTTP retry.

## Live before/after comparison

The baseline was bundled from the working tree **before this change**, not from
an older Git commit. Separate before/after server objects had fresh in-memory
caches. The same fixture words were queried once per variant, alternating order.
Both used the same host, credentials, prompt and `group/translator`. No database,
public HTTP listener, browser vocabulary or production cache was accessed.
The bundles were passed over verified SSH and imported from data URLs in memory.

Runner: `backend/scripts/compare-word-translation.mjs`. It accepts two standalone
bundles exporting `MagpieTranslator`, `MyMemoryTranslator` and `ServerTranslator`,
plus a private environment-file path. Never copy the environment file into a
report. The script validates the expected loopback origin/group and prints only
fixture results and timing metadata.

| Real-provider sample | Before ms | After ms | Source, both |
| --- | ---: | ---: | --- |
| test | 2,005 | 1,913 | magpie |
| latency | 1,163 | 1,669 | magpie |
| benchmark | 1,652 | 2,077 | magpie |
| quartz | 1,282 | 1,433 | magpie |
| sapphire | 2,431 | 1,733 | magpie |
| Median | **1,652** | **1,733** | 5/5 successes per variant |

The group was healthy during this run. There is **no demonstrated healthy-path
speedup**; the small median difference is not evidence of a persistent regression.
These five samples do not estimate p95 or include public gateway/browser latency.

The second phase deliberately stalled the primary fetch while retaining **real
MyMemory calls** and real wall-clock deadlines. It measures fault tolerance, not
a naturally occurring upstream outage. New independent server objects prevent
the first phase's caches from affecting these rows.

| Injected stalled primary + live fallback | Before ms | After ms | After primary calls |
| --- | ---: | ---: | ---: |
| latency, first failure | 8,889 | 3,274 | 1 |
| quartz, second failure | 8,603 | 3,344 | 1 |
| benchmark, circuit open | 8,906 | **615** | **0** |
| Median | **8,889** | **3,274** | 3/3 successes per variant |

Fault-phase median latency fell **63.2%**. The open circuit avoided another
primary wait. All fallback results retained `source: mymemory`. MyMemory can
still return unusable translations, including unchanged words; validation stays
strict, so this change cannot guarantee translation availability during outages.
Cancelling HTTP work does not guarantee that upstream inference or billing stops.

Raw measurements: [live-comparison.json](assets/2026-11-04-translation-resilience/live-comparison.json).
Bundle identities: [bundle-sha256.json](assets/2026-11-04-translation-resilience/bundle-sha256.json).

## Documentation/code discrepancies handled

Locations refer to sections rather than old line numbers, which changed during
this update. No unchecked consistency is claimed. Historical release records
remain historical; current source behavior is stated separately.

| Documentation | Corresponding code | Difference and handling |
| --- | --- | --- |
| Extension README product summary; dictionary service section; architecture runtime table/paragraph; backend README runtime paragraph | `backend/src/node-runtime.ts`, `backend/deploy/api.env.example` | Active Hermes descriptions contradicted configured Magpie. Updated to Magpie and identified Hermes as legacy/rollback. |
| Extension README English routing summary | `backend/lookup-gateway/index.ts` | Described server WordNet first. Updated to public edge Free Dictionary first, then server fallback. |
| Extension README lookup endpoint; architecture temporary transport section | `frontend/browser-extension/config/backend.ts` | Temporary/changing origin versus stable Worker. Updated active text; labeled Quick Tunnel section historical. |
| Architecture dictionary/privacy ingress; dictionary deployment section | `frontend/browser-extension/config/backend.ts`, `backend/lookup-gateway/index.ts` | Custom-domain/Pages hop versus direct `workers.dev` origin. Updated configured route. |
| Dictionary cache section | `frontend/browser-extension/services/translation.ts` | v1 versus v3 namespace. Corrected to v3. |
| Dictionary provider/HTTP budgets; backend README Magpie section; architecture query section; API contract Magpie/explanation sections | `contracts/translation-policy.ts`, `backend/src/magpie.ts`, `frontend/browser-extension/services/public-lookup.ts` | Legacy 12/8-second primary and five-second first attempt versus new 3/9-second budgets. Updated current descriptions; retained explicitly historical 0.1.3 values. |
| Architecture persistence table and import/export paragraph | `frontend/browser-extension/services/translation.ts` | Seven-day-only wording omitted the one-hour public MyMemory TTL. Corrected. |
| Extension README setup; architecture package section | `frontend/browser-extension/package.json` | Node 22.12 minimum versus ^22.22.3. Corrected; used 22.22.3. |
| Architecture sentence-explanation build gate | `frontend/browser-extension/config/backend.ts` | Explicit opt-in versus enabled unless false. Corrected; user consent remains required. |
| Dictionary translation object | `frontend/browser-extension/types/index.ts` | Source union omitted magpie. Corrected. |
| Dictionary deployment route list | `backend/lookup-gateway/index.ts` | Word-only ingress omitted explanation/capability. Corrected. |
| Dictionary login/sync status | `frontend/browser-extension/config/backend.ts` | Disabled wording versus current enabled flag. Corrected source description without claiming new login acceptance. |
| Backend README Cloudflare migration section | `backend/lookup-gateway/wrangler.jsonc`, `backend/deploy/personal-lookup-resources.json` | Pending/zero-resource wording versus populated personal configuration. Updated references; did not change resources. |
| Extension testing guide quota/retry statement | `frontend/browser-extension/services/public-lookup.ts`, `backend/src/lookup.ts` | Broad no-quota-retry claim versus HTTP 503 quota errors. Clarified status/structured policy; regression verifies explicit false stops retry. |
| Backend README authenticated lookup description | `backend/src/node-runtime.ts`, `backend/src/index.ts` | Unqualified Hermes adapter description on the shared endpoint. Marked legacy-only and linked shared current translator behavior. |

## Isolated commit verification

The translation-only commit was additionally tested in a temporary export of
HEAD plus its selected changes, excluding the pending sentence-explanation,
lookup-Port/site-policy, Apple UI and personal-ingress features. That snapshot
passed 301 extension tests and 80 backend tests, plus both TypeScript checks.
It retains HEAD's existing concurrency/message implementations while adding the
same word circuit and retry policy. The source default and example configuration
use `group/translator` independently of the pending explanation work.

The earlier 430-test result and the documentation-discrepancy table describe the
complete working tree. Feature-specific documentation cleanups remain with their
uncommitted features; they are not all part of the isolated translation commit.

## Remaining acceptance

Production deployment and installed-user Chrome acceptance were not performed.
The source update is built and tested; the live comparison is isolated adapter
execution, not a public endpoint running the new backend. Production activation
must use a scoped release that preserves the existing unrelated working-tree
changes, followed by public/installed-client checks. No service restart, routing
group edit, database migration or cache reset occurred in this task.
