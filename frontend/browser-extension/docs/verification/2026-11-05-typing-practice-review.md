# Typing practice review and fixes

Date: 2026-11-05 (America/Los_Angeles). Review baseline: local HEAD `18c5775`
plus the uncommitted first-release implementation. Existing changes were preserved.
This reviews the planned P0–P4 scope; it does not implement later native typing,
formal review scheduling, dictation or sentence-cloze phases.

## Confirmed findings and plan/code discrepancies

All five findings were reproduced. The initial added regressions produced nine
failing cases before fixes (including several malformed nested-data variants).

| Requirement/document location | Corresponding implementation | Before | Fix |
| --- | --- | --- | --- |
| Implementation plan §2 IME handling; behavior.md Typing practice | `components/practice/TypingInput.vue`, `PracticeApp.vue` | Enter was prevented even during composition; the mouse submit button remained enabled | Preserve native composition Enter; block answer/hint/skip actions while composing |
| Implementation plan §4 only affected questions invalidated; behavior.md session lifecycle | `components/practice/PracticeApp.vue:take`, `practice-store.ts:resume` | Every record revision cleared the current input, flags and timer, even when another word changed | Preserve an identical active turn; rotate an optional activation ID on resume to still detect repeated takeover by another tab |
| Implementation plan §4 fault isolation/recovery; architecture.md atomic vocabulary reconciliation | `practice-store.ts:readPractice`, `cloud-vocabulary.ts:persistMany/practice` | Shallow validation accepted null nested records that could throw during vocabulary deletion; corrupt progress had no usable clear flow | Validate bounded nested fields/references; discard damaged optional progress without blocking vocabulary writes; expose read-only repair state with confirmed clear |
| Implementation plan §4 frozen ID/body recovery; architecture.md tab recovery | `services/practice-client.ts:command` | The pending command shared the caller's action object, so later mutation changed its recovery body | Clone the action before storing/sending it; recover the original operation |
| Implementation plan §2 ASCII case rule | `practice-engine.ts:answerPractice`, `TypingInput.vue` feedback | Unicode lowercasing accepted the Kelvin sign K as ASCII k | Share explicit ASCII-only folding for grading and copy feedback |

Current behavior/architecture/testing docs and the plan now state these details.
This table covers only verified differences; unchecked documentation is not claimed
consistent. The nested validator accepts early 0.1.6 turns without activation IDs.
Practice projections also normalize unknown optional legacy source labels to `saved`,
while retaining the original fields in vocabulary exports. This compatibility check
prevents stronger practice validation from invalidating otherwise accepted imports.

## Verification

Node 22.22.3 and the existing locked `npm ci` installation in the disposable
`/private/tmp/rememberme-typing-20261105` source copy were used. No dependency changed.

| Check | Result |
| --- | --- |
| Initial reproduction suite | Nine added cases failed before fixes |
| Practice plus vocabulary regression subset after core fixes | 7 files / 67 tests passed |
| Full extension suite after core fixes and confirmed repair | 44 files / 386 tests passed |
| Final store/legacy-source compatibility subset | 19 tests passed, including three additional compatibility cases |
| Final TypeScript/Vue compilation | Passed |
| Final ZIP integrity | 349 files / 15 linked resources passed |
| Final packaged Chrome for Testing run | Passed, browser 151.0.7922.34 |
| HTTP(S) requests / browser page errors during acceptance | 0 / 0 |

Suite/subset counts overlap and must not be added. The final compatibility change
was checked with the store subset, final type check and packaged browser run.

The browser run covers same-identity 0.1.5 → 0.1.6 installation, synthetic composition
events, offline spelling, hidden answers, hints, limited retries, restart recovery,
copy mode, repeated tab coordination, unrelated-word deletion preserving current
input, current-word deletion, dark/narrow layout and damaged-progress clear/cancel.
The repair test corrupts only its own synthetic practice row in a disposable profile.
It never touches real vocabulary. Account/remote-sync cases remain injected tests.

The new repair scenario initially advanced before the Settings clear notification
had updated the practice page. The harness now waits for that rendered state before
starting the next scenario; the final rerun passed.

## Artifact and evidence

The reviewed candidate keeps version **0.1.6**; no deployment or store submission
occurred. It supersedes the earlier same-version local ZIP.

- Artifact: `.output/remember-me-0.1.6-chrome.zip`.
- SHA-256: `55b936221f86fe307d727eae8ca0912865f5130ec212077abaab8d564e8a349c`.
- [Acceptance receipt](assets/2026-11-05-typing-practice-review/acceptance.json).
- Spelling: `../../.qa/verification/2026-11-05-typing-practice-review/spelling.png` (local-only).
- Copy: `../../.qa/verification/2026-11-05-typing-practice-review/copy.png` (local-only).
- Narrow dark layout: `../../.qa/verification/2026-11-05-typing-practice-review/narrow-dark.png` (local-only).
- Results: `../../.qa/verification/2026-11-05-typing-practice-review/results.png` (local-only).

Reproduce with `scripts/verify-typing-practice.cjs` and the same environment variables
listed in the [initial verification](2026-11-05-typing-practice.md). Use a separate
acceptance directory to retain historical evidence.

Physical OS IME operation, screen-reader speech, hosted multi-device synchronization,
Firefox and everyday installed-Chrome loading remain unverified. Synthetic composition
events do not establish physical IME acceptance. No new permissions, external requests
or modifications to vocabulary export/review contracts were introduced.

## Subsequent user-requested opening

After the review, the installed Remember Me toolbar entry opened `practice.html`
in the user's existing Chrome profile. The page displayed its mode selector and
enabled Start a new round button. No round was started and no vocabulary was
modified. This confirms installed entry/page loading only; physical IME,
screen-reader speech and hosted multi-device behavior retain the limits above.
