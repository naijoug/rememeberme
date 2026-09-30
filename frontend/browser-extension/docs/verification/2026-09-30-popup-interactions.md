# Popup actions and accidental dismissal — 2026-09-30

Scope: move Remember / Forget beside the selected word and prevent accidental dismissal while reading long definitions. Existing bilingual-lookup and release/documentation changes were preserved. No commit or push was performed.

Environment: macOS, Node 22.22.3, WXT 0.20.11, existing local feedback watcher and everyday Chrome extension. Browser version was not recorded.

## Causes identified

- The old content entrypoint closed the card on every window scroll. A tall card used nearly the entire viewport, and scrolling beyond its content could reach the underlying page and trigger that close path.
- Mouseup started a 300ms timer that reread the live selection, closing the card if it had become empty or invalid. Text-copy, scrollbar and drag interactions could change that selection before the timer fired. An outside release was not distinguished from an outside click.
- Closing did not cancel the pending selection timer, allowing a card to reopen after Escape or close.
- Card position was recomputed as asynchronous content grew, potentially moving controls while the reader was interacting.

## Changes

- The word, Remember / Forget (or error-state actions), and close control share the persistent header. The reading body scrolls independently; the card is up to 420px wide and 480px high, clamped to the viewport.
- Reading-body overscroll is contained. Page scrolling no longer dismisses the card. Pointer entry or keyboard focus locks the control position while subsequent content growth uses the available body space.
- Pointer origin is captured before events reach the ShadowRoot UI. Drags that start inside and end outside are not treated as dismissals. A deliberate outside click still closes the card.
- Selection text, context, range and anchor geometry are captured on mouseup. Empty selection alone does not dismiss an open card. New valid selections replace its content; close/Escape cancels delayed opening and lookup waits.

## Verification

- `npm test -- tests/content.test.ts components/SelectionPopup.test.ts`: **24 passed** (20 content, 4 component tests).
- Regressions cover page/body scrolling, dragging outside from the card, deliberate outside click, selection snapshots, clicks completing a new selection, pending-timer cancellation, header actions and stable geometry after pointer entry.
- Type checking identified an overly narrowed interaction flag in the template; using a Vue ref resolved it. A subsequent cleanup edit initially reset pointer origin in the wrong callback; the new drag regression caught it. Moved cleanup to invalidation and reran affected tests successfully.
- `npm run compile`: **passed** after final corrections.
- `npm run build`: **Chrome production build passed**. The already-running feedback watcher rebuilt edits; no generated file was edited and no second watcher was started.
- `git diff --check`: **passed**.

## Actual installed Chrome observations

Selected technical on the local test article through the installed extension. The real card showed Remember / Forget on the word's right and a separate scrolling body. It measured 420px wide, about 384px high at this anchor; body content was about 594px high with a 323px viewport.

- Scrolled the reading body to its end and continued scrolling. Body scrollTop reached about 271.5px; underlying page scrollY remained 223.5px and header top remained about 607.65px. The card stayed open.
- Scrolled the underlying page upward to scrollY 0. The card remained visible at the same screen position.
- Dragged from the reading body beyond the card's right edge and released. The card stayed open.
- Clicked outside deliberately. The card closed and technical could be selected again.

Screenshots and accessibility/DOM observations were inspected in the task. No Forget action or real vocabulary mutation was performed. The provider still returned no Chinese translation for technical during this run; this interaction fix does not claim to repair that separate dictionary-coverage issue. Narrow-viewport positioning and delayed resize stabilization use mocked geometry tests; Firefox runtime and all host-page event combinations were not tested.
