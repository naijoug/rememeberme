# Account settings list and switch (2026-10-26)

Replaced the account page's scattered outlined buttons and status paragraphs
with grouped app-style settings lists. Identity, vocabulary location and
pending/conflict counts are static rows. Cloud sync uses a keyboard-accessible
`role=switch` control with its confirmed `aria-checked` state. Actions remain
explicit full-width rows, with only the applicable vocabulary-switch action shown.

Sync cannot be enabled on anonymous vocabulary or before required recovery.
Requests disable controls until completion; failures refresh the authoritative
state. Sync now is disabled when paused. Migration preview receives focus;
confirmation, privacy boundaries and original local vocabulary retention are
unchanged. The 600 px popup now scrolls its account content rather than clipping
long previews, recovery choices or disconnect controls.

## Verification

- Node 22.22.3; CloudConnection and mounted popup tests: **18 passed**.
- Vue/TypeScript compilation passed.
- Chrome ZIP build and extracted integrity validation passed: 345 files / 11 linked resources.
  SHA-256: `f83d44c8fddeb3cb7d74c7ef897c667ecbb601c09e09b86b8c31b7c971093f47`.
- Existing local feedback watcher remained healthy; no second watcher started.
- Browser preview uses the actual VocabularyPanel and CloudConnection components
  with only synthetic in-memory messages. No real account settings or vocabulary
  were changed during UI checks.
- Light/dark appearance, local versus account mode, keyboard Space toggle,
  read-only status, long GitHub username and recovery state were inspected.
- At 400 px outer width, the long-name/recovery account viewport had matching
  clientWidth and scrollWidth (385 px), with vertical access to longer content.
- Existing copy confirmation, cancellation, literal imported text, recovery
  confirmation and fixed-origin sign-in tests continue to pass.

Screenshots: [dark](assets/2026-10-26-account-settings/dark.png),
[light](assets/2026-10-26-account-settings/light.png).

Source and development assets are updated. These component previews and watcher
checks do not establish that the installed Chrome extension loaded the new UI.
