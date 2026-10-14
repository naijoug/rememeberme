# Verification and browser checklist

Run commands from `frontend/browser-extension/` after the setup in [README](../README.md). Automated tests use happy-dom and disposable browser/storage mocks. They have no production access and do not call the live dictionary API.

## Choose checks for the change

| Change | Verification |
| --- | --- |
| Prose or links only | Review changed facts and resolve local links; no application test suite required |
| Service logic | Run the affected test files and `npm run compile`; add cases for changed behavior or reproduced bugs |
| Vue behavior or rendering | Mount the affected component, exercise its interactions and run `npm run compile` |
| Content/background entrypoints, messaging, runtime or build configuration | Relevant tests, `npm run compile`, a Chrome build, and browser checks for affected flows when available |
| Release or cross-browser behavior | Complete suite, Chrome and Firefox builds, then record actual browser checks for each claimed target |

For example: `npm test -- components/HistoryItem.test.ts`. Run `npm test` for shared changes spanning several flows. Repeat or broaden verification when changes or failures justify it; passing checks do not need repeated runs without a reason.

## What the automated tests establish

- `services/storage.test.ts`: import/export, merging and invalid-data rejection using mocked WXT storage.
- `services/storage-concurrency.test.ts`: overlapping saves, mixed mutations/reads and recovery after write/import failures. Storage reads/writes clone values to model independent browser storage snapshots.
- `services/storage-client.test.ts`: real client, background handler and storage service over a mocked message transport; simultaneous page requests and context-menu writes, completed-write acknowledgements and failures without local fallback.
- `services/word-utils.test.ts` and `services/context-extractor.test.ts`: validation, ordinals and sentence extraction.
- `services/context-menu-handler.test.ts`: handler behavior using fake dictionary, storage and tab-message dependencies. This does not exercise a browser's native context menu.
- Record regressions cover single-word reads, one queued write per counter click, sentence/time/URL round-tripping, reset retaining history, delayed/out-of-order replies and write failure without automatic retry. Context extraction uses real DOM ranges, including inline links/emphasis, repeated words, split text nodes and code URLs.
- Context-menu regression tests cover connection checks before dictionary requests, frame/URL targeting, one local reconnect attempt, restricted-page rejection, and toolbar fallback without duplicate saves. `services/context-menu-status.test.ts` checks action/browserAction badge/title calls using mocks.
- `services/dictionary.test.ts`: local-hit network avoidance, online fallback after local failure, mocked slow responses, deadlines covering stalled JSON bodies, coalesced requests, network-error recovery and non-retried 404/429 responses. Live service access is a separate diagnostic, not part of automated tests.
- `services/phonetics.test.ts`: real packaged US/UK IPA for reported words and inflections, exact spelling, coalesced local reads, misses, invalid data, bounded stalled-body recovery, all 64 shard/source mappings, source hashes and shipped notices. No external network is used. Background tests validate and dispatch `GET_PHONETICS` separately without definition requests or vocabulary writes.
- `services/translation.test.ts`: keyless request parameters, persistent cache/coalescing, quota/error handling, unchanged or malformed results, storage failure and header/body deadlines, with mocked provider and storage.
- `services/pinyin-format.test.ts` / `components/TranslationText.test.ts`: the reported numbered-pinyin regression, four tones and neutral tones, vowel priority, `ü` / `v` / `u:`, punctuation/spacing, unknown/non-pinyin numbers, idempotence, reactive display of old snapshots without changing raw text, literal markup and malformed legacy translations.
- `services/bilingual-lookup.test.ts`: context-menu lookup combines successes and rejects only total failure, using disposable providers.
- `services/offline-dictionary.test.ts`: real packaged data for the reported word and other fixtures, verified regular word forms, exact-match priority, part-of-speech checks, index/shard completeness, sense ordering/examples, bounded full local lookup and failed-read recovery; fetch reads disposable local fixtures with no external network access.
- `services/background-handler.test.ts`: lookup success/failure, vocabulary request validation and legacy imported-word compatibility.
- `components/HistoryItem.test.ts`: real Vue rendering of untrusted text, literal matching and source-link protocols.
- `entrypoints/popup/App.test.ts`: mounted popup and child components, including sorting, search, reading-view navigation, theme persistence, delete/cancel, reset and import, using the real background handler with mocked transport and storage.
- `components/WordList.test.ts`: bounded virtual rows, scrolling to the final word, selection into a separate reading view and list replacement. Details no longer expand within virtual rows.
- `components/SelectionPopup.test.ts`: actions in the persistent header, viewport clamping/flipping, stable control position after interaction, recording during lookup and retry affordances using mocked geometry.
- `components/WordPronunciation.test.ts`: distinct exact US/UK voices, local preference, asynchronous voice discovery, selected spelling, stop/switch/word-change/unmount, stale callbacks, retryable failures/timeouts, unsupported browsers, literal/malformed phonetics, loaded US/UK IPA beside icon-only controls, stale IPA replies and separate retry. Speech and message data are mocked; these checks do not establish audible output or accent quality.
- `services/theme.test.ts`: system preference changes, cross-surface storage notifications, stale initial-read protection, separate preference storage and cleanup after extension invalidation.
- `components/HighlightedText.test.ts`: literal untrusted examples and malformed legacy optional example values.
- `tests/content.test.ts`: content entrypoint with real DOM selection and popup components, but a mocked browser runtime; ShadowRoot isolation, reopening, saving, out-of-order responses, UI deadline/retry, Escape, one write per intentional click and theme updates. Keep entrypoint tests outside the top level of `entrypoints/` so WXT does not discover them as extension entrypoints.
- Content tests also exercise the real WXT context's invalidation and reinjection cleanup (with deterministic postMessage delivery). `services/local-feedback.test.ts` covers script registration/replacement without tab reloads, restricted-tab failures and server reconnection with mocked browser/WebSocket APIs.
- Content interaction regressions cover page/body scrolling, drags beginning inside and ending outside, deliberate outside clicks, captured selection snapshots, new selection clicks and cancellation of delayed opening on Escape/close.
- The page card now uses a closed shadow root to encapsulate encounter history. Content tests capture it through a test-owned `attachShadow` spy; production code does not expose a debug root. Browser validation must not assume `host.shadowRoot` or ordinary page selectors can read the card.
- `scripts/local-feedback-health.test.mjs`: a registered job with `state = not running` / exit code 0 is recovered, healthy jobs are reused, permission failures are not mistaken for absent jobs, and both popup development assets must be reachable as JavaScript. These tests do not start real LaunchAgents or enable browser extensions.

These are not installed-extension E2E tests. A successful build also does not prove runtime browser compatibility, native menu behavior, live API availability or real storage quotas. The optional [release smoke script](release/README.md#optional-installed-browser-smoke-check) uses an externally available Playwright installation and a disposable Chrome for Testing profile; it is separate from `npm test`, uses packaged definitions and blocks online dictionary access. Playwright and MSW are not project dependencies.

## Manual browser checklist

Use a disposable browser profile and fixture vocabulary. Build the target and load the path documented in [README](../README.md). Serve this package locally with `python3 -m http.server 8000 --bind 127.0.0.1`, then open `http://127.0.0.1:8000/test-selection.html`. Packaged definitions need no external network; live online-fallback checks need internet access. Stop the local server when finished.

Mark each case **Not run**, **Pass**, **Fail**, or **Blocked**, with evidence. The checklist itself does not mean any case passed.

| Case | Expected result |
| --- | --- |
| Select a valid word, close with X or Escape, then select another | Correct card, position and definition on each selection; closing does not save |
| Select words in quick succession | Late results and errors do not replace the latest word's definition |
| Select `trick` or `having` with online providers blocked, then open a saved word in the reading view | Packaged US/UK IPA appears for the exact selected spelling even though WordNet lacks it; small speaker icons remain available during lookup failure; playback adds no encounter |
| Use a word missing one or both IPA entries, or force a local shard/message failure | Available IPA stays literal; missing IPA is explicit; a load error offers retry without changing definition/history or blocking speech; base-form IPA is not substituted |
| Switch accents, click the active button, change words, or close during speech | Previous playback stops; controls return to idle; late speech callbacks cannot change a newer playback |
| Use a browser/device without one accent voice or force a speech failure | Missing accent is disabled with system-voice guidance; no substituted accent; error/timeout remains retryable without affecting definitions |
| Click the bookmark counter twice, including while the first write is pending | Count increases twice after persistence; two sentence/time/URL records are retained and the card stays open |
| Open Records and expand one numbered entry | The sentence, local date/time including seconds and complete source URL match that record; only HTTP(S) URLs are links |
| Reset a fixture word, record it again, then export/import | Count restarts while old history survives; record numbers need not equal count; all contexts, timestamps and URLs round-trip |
| Save fixture words concurrently from two pages and the context menu | Every save survives; same-word counts/history include every successful operation |
| Interleave a fixture import, reset, delete and save | Final state follows the background's queue order; unrelated entries survive |
| Select text and open its right-click menu | Remember Me appears; a valid word saves and reports the new count |
| Select multiple words or non-English text, then use the menu | Validation error; no lookup or save |
| Open the context menu without selected text | Remember Me selection item is absent |
| Select `serendipity` when external services are unavailable | Real packaged English definition remains usable with WordNet attribution; Chinese failure is separate |
| Select Having, then close and select it again | Offline `have` verb definition, Having title and Base form: have caption; no Vue attribute warning; saving retains the selected word |
| Open technical, scroll its long reading body to the end and continue scrolling | The bookmark counter stays beside the word; internal edge scrolling does not move the page or dismiss the card |
| Scroll the page, or drag text from inside the card and release outside | Card remains open; a subsequent deliberate outside click still dismisses it |
| Start selecting another word, then press Escape before the debounce finishes | Card stays closed; no delayed reopening or lookup |
| Select curated while the English dictionary is unavailable | Chinese translation appears independently and can be saved; English failure does not replace it with an error screen |
| Fail Chinese translation while a local English result succeeds | English remains usable; a quota/network-specific Chinese note offers retry |
| Fail both sources for a word absent from the local index, then click the counter | Lookup error stays retryable; the explicit click records the word and context with an empty definition |
| Right-click on a page without a receiving script, or navigate away during lookup | Connection checked before lookup; feedback mode retries page connection once; toolbar fallback preserves the original failure or completed-save result |
| Open the toolbar popup, sort, open a word, reset, cancel deletion, confirm deletion | Display and stored data agree; reset preserves history and cancel preserves the word |
| Load over 100 fixture words, open a long history, go back and scroll to the final word | Detail scroll does not affect virtual rows; list position restores on back and the last word is reachable |
| Switch Light / Dark using the toolbar header sun/moon button | Toolbar and open page card update consistently; the choice persists without changing vocabulary; no footer theme selector appears |
| Stop both online responses for a word absent from the local index | Within the source-specific deadline (10 seconds English, 17 seconds Chinese) the loading UI becomes a retryable error; the counter can still record the selected word/context |
| Delete a word after scrolling deep into a large vocabulary list | Confirmation covers the viewport; cancel preserves the entry and confirm deletes it |
| Export fixtures, import into an empty disposable profile | Counts and history survive the round trip |
| Import a malformed file | Clear error and existing vocabulary remains intact |
| Import context containing HTML and a non-HTTP(S) URL | Markup displays literally; the URL does not become a link |
| Try a browser-internal or otherwise restricted page | Record the limitation; do not claim all-page support |
| Load the local feedback build, keep text in a page input and edit a content source | New behavior appears without a page reload or duplicate selection/save listeners; input and scroll position survive |
| Stop/restart the local feedback server | The extension reconnects; the popup and subsequent content updates work again |

## Record an actual run

Create a dated record under `docs/verification/` only after executing checks. Include:

- Date, commit or working-tree description, Node version, OS and browser versions.
- Commands actually run and their results.
- Manual case outcomes and evidence, including blocked or unexecuted cases.
- Failures caused by the change, their fixes, and the affected checks rerun.

The [archived test template](archive/context-menu-test-template.md) has an unfilled date and result boxes. It is historical planning material and provides no verified browser results.

Recorded runs: [2026-09-20 documentation and safety changes](verification/2026-09-20-documentation-and-safety.md), [2026-09-22 concurrency and large lists](verification/2026-09-22-concurrency-and-large-lists.md), [2026-09-22 local feedback](verification/2026-09-22-local-feedback.md).

Latest error-handling run: [2026-09-29 dictionary and page-connection errors](verification/2026-09-29-dictionary-and-page-errors.md).

Local service recovery: [2026-09-29 local Chrome service recovery](verification/2026-09-29-local-service-recovery.md), including real everyday-Chrome observations and the remaining extension-enable step.

Release preparation: [2026-09-29 release preparation](verification/2026-09-29-release-preparation.md), including the optional installed-extension smoke run and its remaining browser limitations.

Paper & Sage redesign: [2026-09-29 UI, themes and lookup states](verification/2026-09-29-paper-sage.md), including actual light/dark visual comparisons, automated checks and remaining installed-extension browser gaps.

Local-first dictionary: [2026-09-29 packaged WordNet and online fallback](verification/2026-09-29-offline-dictionary.md), including real installed-Chrome lookups for serendipity/meticulous, packaged-data checks and legacy backup compatibility.

Repeated warning inspection: [2026-09-30 GitHub warning records and Having lookup](verification/2026-09-30-warning-records-and-word-forms.md).

Chinese translation: [2026-09-30 curated and independent bilingual results](verification/2026-09-30-curated-translation.md).

Popup interaction: [2026-09-30 persistent header and accidental dismissal fixes](verification/2026-09-30-popup-interactions.md).

Encounter counter: [2026-09-30 counter and individual record inspection](verification/2026-09-30-encounter-counter.md).

## Tencent backend and durable browser sync

`services/cloud-vocabulary.test.ts` uses fake IndexedDB to test old-store retention,
legacy export/reset/import, atomic rejection, exact response-loss retry after
reopening, captured conditional versions, additive acknowledgment conflicts,
paged history/restart, account isolation and epoch recovery archives.
Regressions also gate the actual context-menu handler while switching to local,
another account or away-and-back; the late save must report an error and leave
both partitions/outboxes unchanged. Large copy/import fixtures use multibyte
definitions to check the UTF-8 request ceiling, retained event order, subsequent
writes, exact history-chunk retry after restart and causal reset versions.
Single-record overflow checks require atomic account rejection and an unchanged
anonymous backup.
See [2026-10-14 account scope and upload-size regressions](verification/2026-10-14-account-scope-upload.md) for the executed checks and remaining installed-client limits.
`services/backend-client.test.ts` checks PKCE/callback, exact request bodies,
refresh coalescing, credential-save retry and late refresh after offline disconnect.

From `backend/`, after installing both package dependencies and building the API,
run `npm run test:browser`. It bundles actual extension source with synthetic WXT
storage/fake IndexedDB and connects to random loopback HTTP/real SQLite; it never
accesses an installed extension or actual vocabulary. Provider inference is
synthetic. The harness additionally sends both large copy/import histories through
the real HTTP body reader, verifies every event in SQLite and syncs later resets.
Installed upgrade, OAuth callback IDs, real Hermes, cross-client hosted
sync and storage-quota/large-vocabulary performance still require browser checks.
