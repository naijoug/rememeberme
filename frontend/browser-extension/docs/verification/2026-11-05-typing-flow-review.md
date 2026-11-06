# Continuous typing implementation review — 2026-11-05

Scope: review the rebuilt 0.1.7 typing flow and fix issues before the user-authorized commit. Base commit `0674fac`; only typing-related changes belong in this commit. Separate everyday-query evidence is left untouched.

## Findings fixed

| Priority | Requirement / documentation | Code | Reproduction and resolution |
| --- | --- | --- | --- |
| P1 | [Plan §2 pause](../../../../docs/typing-practice-implementation-plan.md) requires explicit continuation after pause; [behavior](../behavior.md) describes focus-loss pause | [PracticeApp.vue](../../components/practice/PracticeApp.vue), `run`, `pause`, `focus` | Delay a start/save response, press Escape, blur, or open Settings, then deliver the response. It previously activated input despite the pause. A pause generation now prevents late automatic activation; open panels retain focus. Three regression cases failed before the fix and pass afterward. |
| P1 | [Plan §2 Spelling](../../../../docs/typing-practice-implementation-plan.md) requires whole-word judgment; [behavior](../behavior.md) says target appears after hint/answer | [PracticeApp.vue](../../components/practice/PracticeApp.vue), `submit`, result template | A wrong Spelling answer previously advanced without showing either the judgment or saved spelling. Spelling now submits with `advance:false`, displays Correct/Incorrect/Skipped and the saved spelling, and waits for Continue/Enter. The next target stays hidden. Copy remains automatic. |
| P2 | [Plan §2 results](../../../../docs/typing-practice-implementation-plan.md) calls for separate result counts and words needing work | [PracticeApp.vue](../../components/practice/PracticeApp.vue), completion template | The rebuilt completion page omitted the difficult-word list and detailed retry/hint/assistance/interruption/skip totals. These are restored as literal text. A three-wrong-attempt regression verifies feedback, bounded retries and the final list/breakdown. |

Visual follow-up: added spacing between the completed-round actions and the progress bar after inspecting the rendered result. The browser harness asserts at least 16px separation and waits for the final progress transition before capture. This is a layout correction, not another product-rule discrepancy.

The current plan, behavior and test guide were updated individually for the above differences. Other documentation is not claimed to have been audited exhaustively.

## Validation

- All four new regression cases failed on the pre-fix snapshot, then passed.
- Full Vitest: **46 files / 402 tests passed** after the behavioral fixes. Final result-breakdown component check: **13 tests passed** (overlapping with the full suite).
- TypeScript check passed. Final CSS/class spacing adjustment was checked by the production build and rendered browser acceptance.
- Node **22.22.3**, locked dependencies in the existing disposable `npm ci` source copy. Relevant runtime and test files match that copy.
- Production ZIP extraction/integrity: **349 files / 15 linked resources**, version **0.1.7**.
- Existing local feedback service reports reachable assets outside the sandbox's loopback restriction. No second watcher, extension reinstall or real vocabulary mutation.

Final ZIP SHA-256: `ece241da2c789b88d7809097052f01af00214f7a8d30e5bff4ff5a7a4a396c29`.

## Browser receipt

Disposable Chrome **151.0.7922.34**, synthetic vocabulary only; 0.1.6→0.1.7 same-identity upgrade. Verified direct Copy input, typos/automatic next, pause/resume, restart, mode confirmation/cancel, correct and incorrect Spelling feedback before continuing, source deletion and tab takeover. Dark/light/390px and completed-round spacing were inspected. Captured external requests **0**, page errors **0**.

[Machine receipt](assets/2026-11-05-typing-flow-review/acceptance.json), [correct spelling feedback](assets/2026-11-05-typing-flow-review/spelling-feedback.png), [incorrect feedback](assets/2026-11-05-typing-flow-review/spelling-incorrect.png), [results](assets/2026-11-05-typing-flow-review/results.png), [mobile results](assets/2026-11-05-typing-flow-review/results-mobile.png).

Actual audible speech, physical IME, screen-reader operation, hosted-account sync and everyday Chrome update activation remain unverified by these fixture checks. No push, deployment or store submission is part of this review.
