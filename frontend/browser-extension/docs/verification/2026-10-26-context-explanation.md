# Second-round lookup cancellation and explanation verification

Date: 2026-10-26 (America/Los_Angeles). Base: `3b090f5` plus the retained first-round working tree. Other architecture/typing-plan edits were preserved. This implements plan PR 4–6 locally; it does not activate or deploy the new service.

## Implemented scope

New dictionary/translation/IPA clients use one bounded Port per lookup. Shared dictionary/translation flights track independent subscriptions, abort only after the last caller leaves, prevent cancelled results from entering cache, and retain the existing one-retry word-translation policy. Context-menu and old message callers remain finite background subscribers. Site rules, disconnects, request deadlines and consent revocation clean up the appropriate Port; arbitrary request IDs cannot cancel a different connection.

The opt-in explanation has separate typed contracts, a fixed public capability GET, a context POST and a temporary display. Build flag, compatible enabled service and explicit per-device consent are all required. The default build is off. User cancellation and later setting changes stop that subscription without changing saved vocabulary. Results are literal text, never Definition/history/export data. The backend's default is also off.

## Executed checks

| Check | Result |
| --- | --- |
| Full extension suite | 37 files / 328 tests passed |
| Final affected cancellation/site/consent/UI recheck | 6 files / 44 tests passed, including two added race regressions and cache-expiry/eviction coverage |
| Vue/TypeScript compilation | Passed |
| Default Chrome build | Passed |
| Explicit opt-in build in disposable checkout | Passed |
| Default-build first-round Chrome regression | Passed in Chrome for Testing 151.0.7922.34 |
| Opt-in Chrome explanation/Port acceptance | Passed in the same browser version, separate clean profile |
| Existing local feedback status | Running; development assets reachable; no second watcher or reinstallation |

Node 22.22.3 with locked `npm ci` in `/private/tmp/rememberme-round2-workspace/frontend/browser-extension`. The fresh test checkout retains the repository's relative contracts directory. Existing source-checkout dependencies were not replaced. The full-suite count and final-regression count overlap and must not be added.

Expanded regressions include cancelling before a retry timeout, cancelling between attempts and during the second attempt; cancellation isolation and A→B→A late-flight cleanup; default-off/consent/capability checks; cache separation by sentence; cancellation during consent reads; invalid model output; literal HTML-like text; settings revocation; Port expiry/disconnect and policy cleanup; refusal of vocabulary writes over lookup Ports.

## Actual browser evidence

`verify-reading-controls.cjs` passed on the normal default-disabled build, preserving first-round website rules/geometry/restart checks.

`verify-context-explanation.cjs` uses real extension UI, background services and runtime Ports in a disposable profile. Only lookup responses are supplied by a synthetic worker fixture; actual lookup/account domain resolution is blocked. It checks:

- No original sentence sent before confirmation; cancelling the disclosure sends none.
- Exactly word/context/target/schemaVersion sent after the explicit action; no page URL, title or vocabulary.
- Literal model markup remains text; the card creates no injected image.
- Two actual Ports share one logical translation; cancelling the first preserves the second, and last-Port disconnection aborts transport.
- Consent revocation cancels an active explanation and clears presentation; server capability false hides the entry on the next card.
- Vocabulary and legacy export stay empty throughout.

[Opt-in acceptance receipt](assets/2026-10-26-context-explanation/acceptance.json), [default-build receipt](assets/2026-10-26-context-explanation/default-build-acceptance.json), [literal-result screenshot](assets/2026-10-26-context-explanation/explanation.png). The screenshot was visually inspected; its HTML-like text is a deliberate synthetic security fixture.

The initial browser run caught site-policy checks rejecting a trusted extension page opened in a tab. Policy checks now exempt the verified extension URL while retaining page-host checks; unit and browser reruns passed. Review also caught first-round site watchers transiently closing enabled pages when another hostname changed; a policy recheck now keeps the existing enabled page open until its own result, with a regression. Existing tests used authenticated-client mock types for public queries; they now model the actual public transport's optional AbortSignal and preserve payload/retry assertions.

## Reproduction and release limits

After a default build, run the existing first-round script. In a disposable copy only, opt in and run:

```sh
VITE_CONTEXT_EXPLANATION_ENABLED=true npm run build
REMEMBERME_PLAYWRIGHT_PATH=/absolute/path/to/playwright \
REMEMBERME_ACCEPTANCE_DIR=/temporary/evidence \
node scripts/verify-context-explanation.cjs
```

The production build flag was not enabled, no real model was called, no vocabulary/account was used, and no source/contract changes require a storage migration. Native app code was not changed in this round. Live model accuracy/latency/retention, actual provider cancellation/billing, public ingress deployment and published policy remain unverified. Source policy HTML was regenerated locally, not deployed. The watcher status alone is not evidence that the user's installed browser loaded an update.

## Verified documentation/code discrepancy

Before this round, `docs/release/privacy-policy.md` under Permissions said the sentence/URL was captured only when recording. Existing `entrypoints/content.ts` captures them at mouseup in the selection snapshot, before a save. The policy now distinguishes selection-time local capture, recording-time persistence and the separately consented explanation transfer. The regenerated gateway/account policy HTML carries the same correction. The broader new route/Port/explanation documentation changes describe newly implemented behavior, not pre-existing discrepancies. Unchecked areas are not claimed consistent.
