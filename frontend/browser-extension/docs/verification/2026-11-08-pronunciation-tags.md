# Pronunciation animation and category tags

Checked on 2026-11-08 (America/Los_Angeles), working tree based on `fb684cb`,
Node 22.22.3, macOS 26.5.2 and isolated Headless Chrome 157. Existing unrelated
dictionary and UI changes were retained.

## Changes

- Keep the speaker visible and animate its two waves only after speech starts.
  Stop/end/error/timeout clear the animation; stale start callbacks are ignored.
- Move category styling out of the Vue component into the shared stylesheet
  injected into the page card's closed shadow root. Tags have borders, backgrounds,
  six-pixel gaps and wrapping in both themes.
- Reduced motion preserves the active highlight without animating the waves.

## Executed checks

- `npm test -- components/WordPronunciation.test.ts components/SelectionPopup.test.ts services/dictionary-categories.test.ts tests/content.test.ts`: 49 tests passed.
- `npm run compile`: passed.
- Existing watcher's `npm run local:status`: healthy after final CSS changes;
  no second watcher or extension reinstall was needed.
- Browser fixture mounts the real `SelectionPopup` with the production inline
  stylesheet in closed shadow roots. Synthetic speech events and sample `storage`
  definitions are used; it never accesses browser vocabulary or account APIs.
- Light/dark: five individually bordered tags, six-pixel gaps, changing wave
  opacity during speech and no animation after completion.
- 240-pixel cards: tags wrap to two rows without horizontal overflow.
- Reduced motion: an initial check exposed insufficient CSS selector specificity.
  Matching the wave selectors fixed it; both themes then passed. Normal-motion
  animation was checked again after resetting media emulation and also passed.
- No browser page errors; `git diff --check` passed.

Local-only fixtures/screenshots: `.qa/pronunciation-tags/`.

## Limits and documentation discrepancy

This is component-browser acceptance with mocked speech, not proof of audible
output, accent quality or an update loaded by the everyday installed extension.
`docs/architecture.md` described category badges, but
`components/DictionaryCategoryBadges.vue` kept their styles scoped to the document;
`entrypoints/content.ts` injected only `assets/paper-sage.css` into the closed root.
The styling is now shared and the architecture/behavior/testing docs describe it.
