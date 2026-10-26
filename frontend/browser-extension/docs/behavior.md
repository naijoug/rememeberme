# Browser extension behavior

## Magpie update (2026-10-24)

Current source supports backend Magpie translation with `zhipu/glm-5.3-flash`
and server-side MyMemory fallback. The new `magpie` source is accepted alongside
legacy `hermes` and `mymemory` snapshots without rewriting saved history.
Extension 0.1.2 uses `public:v3:` translation caches and displays the actual
source. Older installed clients must be updated before consuming Magpie results.
The descriptions and dated acceptance links below retain pre-Magpie context;
use the new deployment record for current host acceptance.

Selection saving updated against the working-tree source on 2026-10-15; pronunciation and lookup layout on 2026-10-10; other behavior was reviewed on 2026-09-29. This describes the current product contract and explicitly tracks differences from the original specification. Historical plans are in [archive/](archive/README.md).

## Selection and saving

- On pages where the browser permits content scripts, selecting a single English word opens the definition card after a 300 ms debounce. The shared [word validator](../services/word-utils.ts) accepts ASCII letters with internal apostrophes or hyphens; it rejects whitespace, numbers and non-English selections.
- Chinese translation and English definitions load independently and appear as each succeeds. A single bookmark-and-number button replaces Remember / Forget. Each opening of a word card allows one successful encounter save and count increment; the card stays open. Recording also works while lookup is pending or unavailable, using an empty definition when necessary. The saved snapshot contains the selected sentence, selection-time source URL, click-time timestamp and whichever dictionary results are available. Successful Chinese translations may be cached independently of vocabulary.
- The button loads the saved count for this word, then displays confirmed write results. While saving, a spinner replaces the bookmark in the same icon slot and further clicks are blocked. Success shows a solid bookmark and keeps the button disabled until a new selection opens a card, including after closing and reselecting the same word. Retrying definitions does not reset this lock or cancel a pending save. Failed writes keep the count unchanged, restore the outline bookmark and allow a manual retry; they never retry automatically. Stale reads and replies from an earlier card cannot overwrite the active card's confirmed count or save state.
- Packaged lookup prefers the exact spelling, then tries verified regular word forms. For example, selecting Having can show Base form: have. Saving retains the selected spelling as the vocabulary key; it does not merge counts with the base word.
- Repeated selections reuse one Vue application inside a closed ShadowRoot, preventing ordinary host-page DOM traversal of saved encounter text and URLs. Only the latest lookup may update its definition or error. Escape, the close button and deliberate outside clicks dismiss the card. Page scrolling, internal scrolling and drags starting inside the card do not dismiss it. A new selection replaces the lookup. Selection text/context/URL/position are captured on mouseup; closing cancels delayed opening.
- The bookmark counter sits beside the word in a persistent header, with pronunciation beneath the word. Expand the Records row after the definitions, then a numbered entry to view its sentence, timestamp (including seconds) and source URL. These record numbers reflect retained history order, not the resettable count. Up to ten entries are shown at a time, with Show more records for older entries. The card is up to 420px wide and 480px high, constrained by the viewport; its reading body scrolls independently. After pointer entry or keyboard focus, result growth keeps controls in place.
- The page card and vocabulary reading view label US/UK IPA with United States / United Kingdom SVG flags (including country names for screen readers and accent tooltips), with a small, borderless speaker icon immediately beside each available transcription. Exact selected spellings are read from separate packaged IPA data, independently of definition/translation availability; WordNet itself still has no phonetics. Source variants are preserved, some words have only one accent, and missing transcriptions are not invented. General saved/provider IPA is a fallback only for the matching spelling. Failed IPA loads offer retry and late results cannot replace a newer word's data; no history or backups are rewritten. Each icon uses an exact `en-US` / `en-GB` speech-synthesis voice, preferring a device voice. Missing voices are disabled with system guidance; a different accent is never substituted. Nothing plays automatically. Clicking the active icon stops playback; switching accents, changing words, closing and unmounting stop the prior playback. Speech failure/timeout is retryable (eight-second limit). Playback speaks the selected word without recording an encounter; the system voice may choose a different variant from the IPA list. See [sources and coverage](dictionary.md#pronunciation).
- English lookup checks packaged WordNet first, then the built-in server dictionary route, without login or user-entered URLs. Chinese lookup uses the same built-in service with Hermes-first/MyMemory fallback. English has an 8.5-second service/ten-second UI budget; Chinese has a twenty-second service/twenty-two-second UI budget. Existing cached translations remain usable. The plugin never contacts third-party dictionary/translation providers directly. Sources retain actual attribution, and total lookup failure still permits recording a word/context. [Coverage and sources](dictionary.md) document external data flow.
- Context extraction uses the surrounding block rather than an inline link/emphasis/span and calculates the actual selected occurrence with DOM ranges. Ordinary sentences up to 1,000 characters are retained whole; longer text is bounded around the occurrence. Preformatted code preserves the complete selected line up to that bound. See [the extractor and tests](../services/context-extractor.ts).

Chinese translation text in the page card and vocabulary reading view displays bracketed numbered pinyin with tone marks (`hong3 pian4` → `hǒng piàn`). The formatter supports neutral tones and explicit `ü` spellings, preserves ordinary numeric text and traditional/simplified variants, and never interprets provider/imported markup. Raw translations, caches, historical snapshots and exports are retained unchanged; existing data receives the formatting when displayed.

## Right-click shortcut

- Remember Me is registered for text-selection context menus on HTTP(S) and file pages (file access still requires browser permission). It is excluded from browser-internal and extension-management pages. With no selection it is not offered. With an invalid selection it may be visible, but clicking it reports an error without a dictionary request or storage write.
- With a valid word, the handler first captures context from the clicked frame, then retrieves a definition and saves the word. A missing page connection prevents lookup/save work. Local feedback builds attempt one targeted script reinjection before reporting the limitation; release builds ask the user to refresh the page.
- Messages target the clicked frame, and history uses its URL when available. If an error cannot be shown inside the page, the toolbar icon shows `!`; hovering it reveals the error and next step. A completed save whose page notification fails instead shows `OK` and the saved count. Notification failure never retries a save. The status clears on the next context-menu action in that tab.
- Restricted pages and pages without a content script cannot be assumed to support context extraction or notifications. Opening the Chrome extension error page displays past errors; it is not a supported page for testing word selection.

## Vocabulary and backups

- The Paper & Sage toolbar popup lists saved words with a brief definition and count, initially sorted by count. Search filters by word; the sort control can switch to last-updated time. Opening a word shows a dedicated reading view with definition and history, and a Vocabulary back button. The header gear opens the unified Settings page, including import/export. Empty and error states remain actionable.
- Above 100 words the list uses fixed-height virtual rows. Details and long histories are outside that virtual list, so scrolling inside a definition cannot remove it. Returning to the list restores its position; replacing/sorting/filtering the list starts at the top. Delete confirmation stays outside translated rows, initially focuses Cancel and supports Escape.
- Saves from pages and the context menu, imports, deletes and resets share the background's operation queue. Reads and exports wait for earlier queued operations. A failed operation reports an error and does not block later requests.
- Deletion requires confirmation; cancelling preserves the word. Reset sets count to zero and retains history. Count therefore need not equal history length.
- Export downloads a JSON array of all entries, including contexts and full source URLs. Treat exports as potentially sensitive browsing data.
- Import validates the entire input before writing and merges by normalized word. Existing counts are added and histories concatenated and sorted. Reimporting the same file adds it again; import is not idempotent.
- History text, including imported markup, is rendered as text. Matches are highlighted with `mark` elements. Only HTTP(S) source URLs become links; other URL strings remain visible as text.

## Appearance

Both the toolbar and page card use the selected Paper & Sage layout: paper-white/sage in light mode, with a Codex-inspired neutral charcoal palette in dark mode at the user's request. Dark surfaces use `#1e1e1e` / `#29292a`, gray-white text and `#303030` selections; buttons, highlights and overlays share the neutral palette. Errors retain a distinct red tone. Settings → Appearance selects System / Light / Dark and persists the choice separately from vocabulary, syncing to open extension surfaces. The vocabulary header has a single Settings gear; inside settings it becomes a back button and Setting title. There is no separate theme shortcut or footer selector. New installations and an existing saved System preference follow the OS/browser media preference until manually switched; the webpage's own theme is not inferred. Word headings use a local serif font; UI controls use the system sans-serif stack. Imported text and examples remain literal text, including highlighted matches.

## Original specification differences requiring a product decision

These are documented gaps, not claims that the original requirements have passed. Preserve current behavior until a task explicitly resolves the relevant gap.

| Original expectation | Current implementation | Decision needed |
| --- | --- | --- |
| Requirement 1.1 allowed one or more words | Selection and context-menu lookup support one word | Add phrase lookup or formally narrow the requirement |
| Requirement 8.5 showed the menu only for valid English words | Menu is offered for selected text; validation happens on click | Retain click-time validation or design and verify browser-specific visibility behavior |
| Design allowed saving after a dictionary 404 | The page's bookmark counter records the word/context regardless of lookup; the context-menu shortcut still requires one source to succeed | Decide whether the context-menu fallback should also record without a lookup result |
| Legacy storage vs account storage | Account/local partitions now use IndexedDB; original `local:words` is retained | Compatibility is covered by disk/mock/HTTP fixtures; real browser upgrade acceptance remains required |
| Design promised optional URL recording and exports without sensitive data | Full URLs and contexts are saved and exported | A privacy control would require new UI and behavior; it does not exist today |

The shared Node/SQLite API, explicit browser account synchronization and native Apple clients are implemented. Hosted/installed-client acceptance and the full website remain unfinished; review features are implemented in native clients, not in this extension. Static designs under `frontend/designs/` are references, not proof of product functionality.

## Cloud account behavior

Right-click lookup saves belong to the vocabulary selected when the operation
starts. Switching vocabularies, including switching back before lookup finishes,
rejects the old save with retry guidance instead of adding to another partition.
Pausing sync alone does not cancel the save.

New account copy/import histories are split by both event count and UTF-8 request
size. If an individual entry or history cannot fit, the complete account mutation
is rejected before persistence. The user can keep/export it in local vocabulary
or reduce its definition before a new account copy/import. Previously frozen
oversize requests are retained; use explicit archive/cloud recovery rather than
expecting the update to change an already-submitted request.

The current source enables `ACCOUNT_SYNC_ENABLED=true` after local session and migration tests. The gear opens Settings with embedded GitHub sign-in and synchronization controls; the initial vocabulary view still has no connection banner or API address input. GitHub sign-in checks backend support for recoverable refresh and refresh-authenticated logout. Existing published packages may still have account controls disabled.

Signing in verifies the GitHub username, selects the account vocabulary, enables synchronization and downloads account words into the main list. Reopening the popup refreshes the connected account; an explicit pause or recovery pause is preserved. Pausing sync keeps downloaded account words visible. Sign-out returns to the separate device vocabulary.

Add device words to account downloads the account state and previews each device word, count and history size as Copy or Skip existing, preserving the current sync setting. Existing normalized words or lifecycle IDs are skipped without adding counts. Confirm copy names the target GitHub account and retains the anonymous original. Confirmed new words sync automatically when sync is enabled; an existing pause remains paused. Account/vocabulary changes or a background restart invalidate the preview; retrying a confirmed preview cannot duplicate its copy. Very large downloads may require Preview again until paging completes. Browser exports remain legacy arrays with local context/URLs.

Refresh intents survive response loss, failed credential persistence and restart. The server permits the exact retry for up to 24 hours while the successor remains active; after that, sign in again. Disconnect clears local credentials and uses the refresh credential to revoke the device even if access expired. Offline disconnection reports that server revocation was not confirmed.

Lookup uses an internal fixed HTTPS gateway and persistent private connector. Connector restarts retain the hostname. English packaged hits remain local; Chinese and English misses call the service without login. Source attribution identifies Hermes, MyMemory, WordNet or Free Dictionary. Hosted OAuth and public account routing still require separate deployment and installed-client acceptance; local feature enablement does not establish those results.

### Account settings presentation

The gear opens one settings page directly. Its fixed header replaces the brand
and gear with a back button and “Setting”; Escape/back restores the previous
list or reading view and keyboard focus. Appearance, account, synchronization,
device-word import, backups and privacy/support remain on the same scrollable page.

The account section shows the verified GitHub username and a “View account words”
row with the available word count. This opens the complete vocabulary list,
clearing any old search or reading selection. The count includes saved account
words whose uploads may still be pending; it is not an upload completion count.
The list refreshes after account actions and every five seconds while the popup
is visible, without resetting scroll when data is unchanged.

Cloud sync is an accessible switch reflecting the confirmed setting. It is
disabled during a request and when recovery is required before enabling. Failed
requests restore the confirmed status. Sync now is unavailable while paused;
uncompleted sign-in offers Retry sync. Status distinguishes downloading, pending
uploads, paused, up to date and attention required.

There is no “Use local vocabulary” switch. Device words saved before sign-in
are offered through “Add device words to account” with a preview and confirmation.
Opening that preview focuses it inside the scrollable popup. Recovery and sign-out
remain explicit actions; copy/recovery confirmation and original-data retention
are preserved.
