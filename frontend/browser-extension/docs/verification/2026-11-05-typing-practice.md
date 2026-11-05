# Local typing practice 0.1.6 verification

This records the initial candidate. The same-version review rebuild supersedes it;
see [review fixes and the new artifact hash](2026-11-05-typing-practice-review.md).
The counts, screenshots and hash below remain historical evidence for the initial run.

Date: 2026-11-05 (America/Los_Angeles). Starting HEAD: `2354b4b`.
The initial checkout was clean. Concurrent translation-cache/Port edits appeared
during implementation; they were retained, not reverted, and the final consistent
snapshot included them. This change adds the local practice first release, not
formal review scheduling, native typing, a hosted deployment or a store submission.

## Implemented scope

- Full extension practice tab, Copy and Spelling modes, up to ten words and two
  spaced retries per word, explicit hints, keyboard/IME handling and pause/resume.
- Local owner/epoch-scoped session with conditional transactions, bounded digest
  receipts, explicit unknown-result recovery, source invalidation and pinned clearing.
- Vocabulary commit paths reconcile practice atomically, including remote tombstones
  masked by pending local operations. Practice never enqueues cloud operations or
  changes encounter counts/history/review/timestamps.
- No provider requests: saved meanings only. No explanation capability probe even
  with consent enabled. Completed sessions discard meaning snapshots; exports omit
  practice. Unknown submissions retain one request in the submitting tab.
- Popup entry and Settings clearing, 0.1.6 package/lockfile version and explicit
  practice.html release-integrity traversal. No new runtime dependency or permission.

## Checks performed

Node 22.22.3 was obtained and used for a fresh locked `npm ci` in the disposable
copy `/private/tmp/rememberme-typing-20261105`. Relative contracts were retained.
The source checkout's dependency directory was not replaced.

| Check | Result |
| --- | --- |
| Full extension Vitest suite on consistent combined source | 44 files / 375 tests passed |
| Final practice UI recheck after mode restoration/focus adjustment | 3 files / 6 tests passed |
| Final Vue/TypeScript check | Passed |
| Production ZIP and extracted integrity verification | Passed: 349 files, 15 linked resources |
| Same-identity 0.1.5 → 0.1.6 upgrade in a disposable profile | Passed via Chromium's unpacked-extension installer |
| Offline Copy/Spelling, wrong answers, hints and bounded retries | Passed |
| Reload and Chrome process restart | Passed; session retained, unfinished turn marked interrupted |
| Two-tab coordination, local delete and Settings clear/cancel | Passed |
| Dark mode, 360px viewport and horizontal overflow check | Passed; screenshots visually inspected |
| Provider/account/explanation requests during browser scenario | Zero recorded HTTP(S) requests |
| Browser page errors | None |
| Existing local watcher | Refreshed in place with the pinned runtime; health passed |
| Documentation links and diff whitespace | Passed |

The full-suite and final-subset counts overlap and must not be added. The final
subset includes the new mode-selector regression. Account/sync tests use injected
backends and disposable IndexedDB; they are not hosted-account acceptance.

## Final artifact and browser evidence

Artifact: `.output/remember-me-0.1.6-chrome.zip`.

SHA-256: `cf242664273e50210bab7155e14305e49094249b328576c043b856047d445642`.

Browser: Chrome for Testing `151.0.7922.34`. The final receipt includes the ZIP hash.
The script blocks lookup/account host resolution and imports only synthetic words
(`apple`, `can't`, `well-known`) into a disposable profile. It sets explanation
consent in that profile to verify practice still sends no requests.

- [Acceptance receipt](assets/2026-11-05-typing-practice/acceptance.json).
- [Spelling screen](assets/2026-11-05-typing-practice/spelling.png).
- [Copy screen](assets/2026-11-05-typing-practice/copy.png).
- [Narrow dark screen](assets/2026-11-05-typing-practice/narrow-dark.png).
- [Results](assets/2026-11-05-typing-practice/results.png).

Reproduce from the extension package with an available Playwright runtime:

```sh
REMEMBERME_PLAYWRIGHT_PATH=/absolute/path/to/playwright \
REMEMBERME_TYPING_ZIP=/absolute/path/to/remember-me-0.1.6-chrome.zip \
REMEMBERME_PREVIOUS_ZIP=/absolute/path/to/remember-me-0.1.5-chrome.zip \
REMEMBERME_ACCEPTANCE_DIR=/temporary/evidence \
node scripts/verify-typing-practice.cjs
```

The upgrade harness uses the experimental Chromium installer only in this temporary
browser (`--enable-unsafe-extension-debugging`). It verifies the same extension ID,
profile and retained export. It does not model Chrome Web Store signing or delivery.
The temporary browser and profile are closed/removed in the script's finally block.

## Issues found and resolved during verification

- Completed-round cleanup initially mutated shared candidate objects. The engine now
  clones candidates; source fixtures remain intact across sessions.
- A delayed change-notification read could overwrite a newer UI answer. Read generations
  now reject stale replies, with a mounted regression.
- Clear confirmations now retain their original owner/scope/revision; changed page
  state dismisses a practice-page confirmation instead of redirecting it.
- A restored Copy session initially left the selector displaying Spelling. Restoring
  the session now restores the selector; a regression covers reopening.
- Raw unpacked-folder replacement initially reused Chromium's old background worker.
  A runtime.reload experiment left that test installation unavailable. The final
  harness uses Chromium's installer and passes. These were harness transitions;
  the fresh-install flows already passed and app behavior was not bypassed.
- A test snapshot briefly mixed in-progress concurrent translation code and old tests.
  The subsequent consistent snapshot passed the complete suite. No unrelated
  translation implementation was reverted to make practice pass.

## Documentation/code reconciliation and limits

The implementation plan §5 and project architecture index still described practice
as pending. They now reference the implemented page/engine/store and this evidence.
The implementation uses `PRACTICE_COMMAND` action variants and a `PracticeRecord`
envelope instead of the plan's preliminary separate write-message names; behavior
and compatibility are retained and the plan documents the final organization.
These are new-feature status updates, not claims that the former plan was a bug.

No real vocabulary/account was accessed for tests. Physical IME operation, screen-reader
speech, the user's actual toolbar/update loading, real multi-device hosted sync,
Firefox and native typing were not verified. The watcher health check is not proof
that the everyday Chrome instance loaded the new page. Public privacy-policy source
was updated locally; publication and Web Store submission remain separate actions.
