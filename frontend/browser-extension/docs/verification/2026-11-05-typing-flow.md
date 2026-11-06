# Continuous typing interaction — 2026-11-05

Historical pre-review receipt. The [subsequent review](2026-11-05-typing-flow-review.md) records the corrected interaction and replacement 0.1.7 archive hash.

Candidate: **0.1.7**, based on commit `0674fac` plus the current local changes. No commit, push, deployment or store submission was performed in this revision. This supersedes the 0.1.6 interaction acceptance, while retaining its historical evidence.

## User-requested correction

The supplied first screenshot exposed a form-like spelling quiz, whereas the selected [Qwerty reference](https://qwerty.kaiyi.cool/) uses a centered target, phonetics and meaning with direct keyboard input. The live reference was inspected: partial correct letters turn green, completing a word advances without Enter, and a wrong letter resets the typed prefix.

Implemented default Copy for new sessions, large inline target, local IPA/device pronunciation, saved or locally cached meaning, correct/error letter feedback, automatic completion/advance, thin progress and compact statistics. Optional Spelling retains Enter, hides the target and requires confirmation before replacing an unfinished round. Existing sessions are preserved.

Corrected typos now prevent first-pass credit and schedule bounded practice. WPM uses non-assisted correct characters / 5 / active minutes. No per-keystroke persistence or vocabulary mutation was added. The answer transaction starts the next turn atomically; legacy records and messages keep defaults for optional fields.

## Verification

- Locked dependencies installed with `npm ci` in a disposable source copy; Node 22.22.3.
- Full Vitest: **46 files, 398 tests passed**. Final component/cache refinements: **6 files, 22 tests passed**; these overlap, so counts are not additive.
- TypeScript `npm run compile`, production ZIP and release integrity passed.
- Disposable Chrome **151.0.7922.34** installed 0.1.6 then loaded 0.1.7 with the same extension identity/profile; synthetic vocabulary was preserved.
- Direct input, partial coloring, typo reset/scoring, multiple consecutive words without Enter/Next, pause/resume, process restart, optional Spelling, mode-switch confirmation/cancel, unrelated deletion and tab takeover passed.
- Dark/light at 1280×800 and responsive 390px checked. Local Chinese cache display was exercised with synthetic entries.
- Captured external requests: **0**. Captured page errors: **0**. These are the bounded harness observations, not a claim about every network action in Chrome.
- Existing local feedback service reused in place; no second watcher or user-extension reinstall.
- Final local archive SHA-256 matched both acceptance and integrity receipts (15 checked resources); changed runtime source matched the tested disposable copy. `git diff --check` and new document links passed.
- Everyday Chrome handoff was blocked by the browser URL policy rejecting `chrome-extension:` navigation. No workaround or user-profile practice mutation was attempted; refreshed installed-page activation remains unverified.

## Artifact and evidence

ZIP: `.output/remember-me-0.1.7-chrome.zip` (local ignored build artifact).

SHA-256: `d796e32df1d706faa42d83b93948c5534dcbf619a16d48bf04a28539247103bc`.

[Machine receipt](assets/2026-11-05-typing-flow/acceptance.json), [dark partial input](assets/2026-11-05-typing-flow/copy-partial.png), [light](assets/2026-11-05-typing-flow/copy-light.png), [mobile](assets/2026-11-05-typing-flow/copy-mobile.png), [results](assets/2026-11-05-typing-flow/results.png), [full comparison](assets/2026-11-05-typing-flow/comparison-full.png), [focused comparison](assets/2026-11-05-typing-flow/comparison-focus.png).

Reproduction: run `scripts/verify-typing-practice.cjs` with `REMEMBERME_PLAYWRIGHT_PATH`, `REMEMBERME_PREVIOUS_ZIP` (0.1.6), `REMEMBERME_TYPING_ZIP` (0.1.7) and `REMEMBERME_ACCEPTANCE_DIR` pointing to disposable fixture/output paths. The harness never uses the everyday Chrome profile or real vocabulary.

## Limits

Actual speaker audio quality, physical IME, screen-reader experience and real-account sync were not claimed from these fixture checks. Pronunciation tests mock device voices and verify remote voices are rejected; the button is unavailable if no local en-US voice exists. Chinese display is opportunistic: no cached translation means the saved English meaning is shown. No online translation is started by practice.

See [plan §13](../../../../docs/typing-practice-implementation-plan.md#13-2026-11-05-用户反馈后的交互校正当前) for each revised product decision, and [design QA](../../design-qa.md) for visual comparison and intentional differences.
