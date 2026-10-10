# Bookmark counter and encounter records — 2026-09-30

Scope: replace Remember / Forget with a single icon-and-number action; each click records an encounter, increases count and keeps the card open. Make individual records inspectable with sentence, click time and source URL. Existing release-preparation and separate project-documentation work was preserved. No commit or push was performed.

## Implementation

- Added `GET_WORD` so the card obtains the selected word's existing count/history. `SAVE_WORD` accepts an optional validated click timestamp; older callers can omit it. Existing vocabulary/backups keep the same record fields and need no migration.
- Each intentional counter click sends one distinct write to the existing background queue. The UI uses confirmed responses, permits additional clicks while writes are pending, guards stale reads/older replies, reports failure and never retries a write automatically. Recording is available even if lookup has not succeeded; the definition snapshot may be empty.
- Selection captures the surrounding sentence and source URL before focus changes or later SPA navigation. The new extractor traverses inline elements to the containing block and calculates the actual occurrence with a DOM Range. Ordinary sentences up to 1,000 characters are retained whole, longer text is bounded, and preformatted URLs keep their full line.
- Records are numbered independently of the resettable count. Expand Records in the page card, or open a word in the toolbar, then expand a numbered entry for the highlighted sentence, local timestamp including seconds, and full source link. Only HTTP(S) links are navigable. Older entries load ten at a time.
- Previous encounter sentences/URLs render inside a closed shadow root so the ordinary host-page DOM cannot traverse them. No production debug reference was exposed. Browser developer tools/privileged extensions are outside that encapsulation claim.

## Executed checks

Environment: macOS, Node 22.22.3, WXT 0.20.11; existing local watcher reused. No dependencies, second watcher or generated-output edits.

- `npm test`: **177 tests passed in 21 files** after the final functional changes.
- `npm run compile`: **passed**.
- Chrome and Firefox production builds: **passed**. A build is not Firefox runtime verification.
- Coverage includes repeated clicks before prior writes finish, out-of-order responses, stale reads, record-on-lookup-failure, write failure without optimistic increment/retry, original URL capture, closed-root encapsulation, timestamp validation and exact sentence/time/URL export/import round trips.
- DOM extraction regressions exercise nested links and emphasis, repeated words after inline siblings, a word split across inline elements, longer sentences and preformatted code URLs.
- History rendering tests exercise native details expansion, precise timestamps, full URLs, literal untrusted text and unsafe protocol rejection.
- Existing tests for the removed Remember/Forget behavior were updated to the new user-requested recording contract. The new single-word request was added to disposable background mocks. A Boolean prop's absent-value default hid the toolbar Records heading during visual checking; an explicit true default corrected it.
- Whitespace and current documentation links: **passed**.

## Chrome visual/interaction evidence

Used the same real UI components in `http://127.0.0.1:3937/preview/paper-sage.html?compare=codex`, with disposable in-memory example data. This preview does not access the user's vocabulary.

- Clicked the counter twice: count advanced from 2 to 4, and the page card remained open.
- Expanded Records and entry #4: observed the example sentence, a date/time including seconds, and `https://example.com/article`. A screenshot and accessibility state were inspected in the task.
- In a fresh preview state, reset count to 0 while its two history entries remained. Another click produced count 1 and three retained records.
- The card header contains the bookmark/count button plus close; the two old text actions are absent. Both the page card and vocabulary detail show the numbered record list.

Persistence, queue behavior and backup compatibility were exercised through the real client/handler/storage logic with mocked transport and disposable storage. No test records were written into the user's real vocabulary. This is not a claim of an installed-extension save/delete E2E run. The optional older standalone release smoke script requires closed-shadow/counter adaptation; it was not run.
