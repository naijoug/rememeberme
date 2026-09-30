# Browser extension behavior

Reviewed against the source on 2026-09-29. This describes the current product contract and explicitly tracks differences from the original specification. Historical plans are in [archive/](archive/README.md).

## Selection and saving

- On pages where the browser permits content scripts, selecting a single English word opens the definition card after a 300 ms debounce. The shared [word validator](../services/word-utils.ts) accepts ASCII letters with internal apostrophes or hyphens; it rejects whitespace, numbers and non-English selections.
- A successful lookup shows the definition. Remember closes the card without changing vocabulary. Forget saves the definition, sentence context, full page URL and timestamp, increments the count and reports the new count.
- Packaged lookup prefers the exact spelling, then tries verified regular word forms. For example, selecting Having can show Base form: have. Saving retains the selected spelling as the vocabulary key; it does not merge counts with the base word.
- Repeated selections reuse one Vue application inside a ShadowRoot. Only the latest lookup may update its definition or error; late results from earlier selections are ignored. Escape, outside clicks and page scrolling close the card. The card flips above the selection or clamps within the viewport when needed.
- Lookup checks the packaged English WordNet index first; a local hit needs no external dictionary request and is marked Offline dictionary · WordNet. Missing words or unavailable local assets use the online fallback. [Coverage and sources](dictionary.md) explain the 82,810-word index and pronunciation/inflection limits. Lookup has a 10-second total budget, including the local read and at most one online retry. The card also enforces its own 10-second response deadline, retains the selected word while loading, and offers Try again / Close on failure. Forget is disabled until a definition is available and while saving. A word without a retrieved definition is not saved.
- Context extraction uses sentence boundaries and a bounded window around the selected word for long sentences. See [the extractor and its tests](../services/context-extractor.ts) for exact truncation behavior.

## Right-click shortcut

- Remember Me is registered for text-selection context menus on HTTP(S) and file pages (file access still requires browser permission). It is excluded from browser-internal and extension-management pages. With no selection it is not offered. With an invalid selection it may be visible, but clicking it reports an error without a dictionary request or storage write.
- With a valid word, the handler first captures context from the clicked frame, then retrieves a definition and saves the word. A missing page connection prevents lookup/save work. Local feedback builds attempt one targeted script reinjection before reporting the limitation; release builds ask the user to refresh the page.
- Messages target the clicked frame, and history uses its URL when available. If an error cannot be shown inside the page, the toolbar icon shows `!`; hovering it reveals the error and next step. A completed save whose page notification fails instead shows `OK` and the saved count. Notification failure never retries a save. The status clears on the next context-menu action in that tab.
- Restricted pages and pages without a content script cannot be assumed to support context extraction or notifications. Opening the Chrome extension error page displays past errors; it is not a supported page for testing word selection.

## Vocabulary and backups

- The Paper & Sage toolbar popup lists saved words with a brief definition and count, initially sorted by count. Search filters by word; the sort control can switch to last-updated time. Opening a word shows a dedicated reading view with definition and history, and a Vocabulary back button. Import/export are in More options. Empty and error states remain actionable.
- Above 100 words the list uses fixed-height virtual rows. Details and long histories are outside that virtual list, so scrolling inside a definition cannot remove it. Returning to the list restores its position; replacing/sorting/filtering the list starts at the top. Delete confirmation stays outside translated rows, initially focuses Cancel and supports Escape.
- Saves from pages and the context menu, imports, deletes and resets share the background's operation queue. Reads and exports wait for earlier queued operations. A failed operation reports an error and does not block later requests.
- Deletion requires confirmation; cancelling preserves the word. Reset sets count to zero and retains history. Count therefore need not equal history length.
- Export downloads a JSON array of all entries, including contexts and full source URLs. Treat exports as potentially sensitive browsing data.
- Import validates the entire input before writing and merges by normalized word. Existing counts are added and histories concatenated and sorted. Reimporting the same file adds it again; import is not idempotent.
- History text, including imported markup, is rendered as text. Matches are highlighted with `mark` elements. Only HTTP(S) source URLs become links; other URL strings remain visible as text.

## Appearance

Both the toolbar and page card use the selected Paper & Sage layout: paper-white/sage in light mode, with a Codex-inspired neutral charcoal palette in dark mode at the user's request. Dark surfaces use `#1e1e1e` / `#29292a`, gray-white text and `#303030` selections; buttons, highlights and overlays share the neutral palette. Errors retain a distinct red tone. The header sun/moon button switches Light / Dark and persists the choice separately from vocabulary, syncing to open extension surfaces. The footer theme selector has been removed. New installations and an existing saved System preference follow the OS/browser media preference until manually switched; the webpage's own theme is not inferred. Word headings use a local serif font; UI controls use the system sans-serif stack. Imported text and examples remain literal text, including highlighted matches.

## Original specification differences requiring a product decision

These are documented gaps, not claims that the original requirements have passed. Preserve current behavior until a task explicitly resolves the relevant gap.

| Original expectation | Current implementation | Decision needed |
| --- | --- | --- |
| Requirement 1.1 allowed one or more words | Selection and context-menu lookup support one word | Add phrase lookup or formally narrow the requirement |
| Requirement 8.5 showed the menu only for valid English words | Menu is offered for selected text; validation happens on click | Retain click-time validation or design and verify browser-specific visibility behavior |
| Design allowed saving after a dictionary 404 | Both save flows require a definition | Decide how a word with no definition should be stored and displayed |
| Design described IndexedDB, localStorage and WXT storage together | One array is stored under WXT `local:words` | Any migration needs compatibility and recovery planning; none is currently required |
| Design promised optional URL recording and exports without sensitive data | Full URLs and contexts are saved and exported | A privacy control would require new UI and behavior; it does not exist today |

Cloud synchronization, a backend, mobile/desktop clients and learning algorithms are future ideas, not implemented features. Static designs under `frontend/designs/` are references, not proof of product functionality.
