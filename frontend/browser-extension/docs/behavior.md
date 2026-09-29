# Browser extension behavior

Reviewed against the source on 2026-09-29. This describes the current product contract and explicitly tracks differences from the original specification. Historical plans are in [archive/](archive/README.md).

## Selection and saving

- On pages where the browser permits content scripts, selecting a single English word opens the definition card after a 300 ms debounce. The shared [word validator](../services/word-utils.ts) accepts ASCII letters with internal apostrophes or hyphens; it rejects whitespace, numbers and non-English selections.
- A successful lookup shows the definition. Remember closes the card without changing vocabulary. Forget saves the definition, sentence context, full page URL and timestamp, increments the count and reports the new count.
- Repeated selections reuse the popup container. Only the latest lookup may update its definition or error; late results from earlier selections are ignored.
- Lookup errors are shown in the card. A word without a retrieved definition is not saved by the current implementation.
- Context extraction uses sentence boundaries and a bounded window around the selected word for long sentences. See [the extractor and its tests](../services/context-extractor.ts) for exact truncation behavior.

## Right-click shortcut

- Remember Me is registered for text-selection context menus on HTTP(S) and file pages (file access still requires browser permission). It is excluded from browser-internal and extension-management pages. With no selection it is not offered. With an invalid selection it may be visible, but clicking it reports an error without a dictionary request or storage write.
- With a valid word, the handler first captures context from the clicked frame, then retrieves a definition and saves the word. A missing page connection prevents lookup/save work. Local feedback builds attempt one targeted script reinjection before reporting the limitation; release builds ask the user to refresh the page.
- Messages target the clicked frame, and history uses its URL when available. If an error cannot be shown inside the page, the toolbar icon shows `!`; hovering it reveals the error and next step. A completed save whose page notification fails instead shows `OK` and the saved count. Notification failure never retries a save. The status clears on the next context-menu action in that tab.
- Restricted pages and pages without a content script cannot be assumed to support context extraction or notifications. Opening the Chrome extension error page displays past errors; it is not a supported page for testing word selection.

## Vocabulary and backups

- The toolbar popup lists saved words with counts and dates, initially sorted by count. The sort control can switch to last-updated time. Expanding a word shows its definition and history.
- Above 100 words the list uses virtual scrolling. Collapsed rows have a fixed height; the open row is measured as its content changes, so scrolling inside long history keeps it visible. Replacing/sorting the list starts at the top. Delete confirmation stays outside the translated rows.
- Saves from pages and the context menu, imports, deletes and resets share the background's operation queue. Reads and exports wait for earlier queued operations. A failed operation reports an error and does not block later requests.
- Deletion requires confirmation; cancelling preserves the word. Reset sets count to zero and retains history. Count therefore need not equal history length.
- Export downloads a JSON array of all entries, including contexts and full source URLs. Treat exports as potentially sensitive browsing data.
- Import validates the entire input before writing and merges by normalized word. Existing counts are added and histories concatenated and sorted. Reimporting the same file adds it again; import is not idempotent.
- History text, including imported markup, is rendered as text. Matches are highlighted with `mark` elements. Only HTTP(S) source URLs become links; other URL strings remain visible as text.

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
