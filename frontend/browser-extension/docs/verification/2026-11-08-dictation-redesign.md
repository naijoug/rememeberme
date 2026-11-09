# Word dictation redesign — 2026-11-08

Implemented in the working tree based on `e88d1da`, preserving existing unrelated
dictionary/category work. Date is America/Los_Angeles. Runtime: Node 22.22.3,
macOS 26.5.2, isolated Chrome for Testing 153.0.8010.12 via agent-browser.

## Implemented behavior

- Popup entry: 单词听写. Two modes retain durable IDs `copy` / `recall`.
- Follow-along highlights the typed characters directly on the reference word.
- Dictation blurs only the underlying untyped letters and IPA/meaning hints;
  entered glyphs and the speaker remain sharp. Hidden reference hints have no
  tooltip or accessible target description. Explicit reveal remains recorded.
- Both modes automatically advance after a correct word. Typos reset the same
  word and retain aggregate mistakes. Words without a meaning can use dictation.
- Local US speech plays on start/resume; replay, stop, error/timeout and delayed
  voice discovery remain supported. Pause disables the blurred speaker as well
  as the input. No remote voice is substituted.
- Shared Paper & Sage light/dark tokens and appearance storage replace the old
  independent navy/lavender theme. The theme toggle preserves input/focus.
- Compact progress replaces the active WPM/time dashboard. Aggregate results,
  recovery, confirmation, owner isolation and existing session IDs are retained.

## Automated checks

- `npm test -- components/practice services/practice-engine.test.ts services/practice-store.test.ts services/practice-client.test.ts entrypoints/popup/App.test.ts`: **75 passed, 9 files**.
- `npm run compile`: passed.
- `npm run build`: Chrome production build passed.
- `node --check scripts/verify-typing-practice.cjs`: passed. The existing ZIP/Playwright
  harness was updated for the new labels and dictation contract, but was not run;
  the browser checks below used agent-browser against the production build.
- `git diff --check`: passed.

These tests cover literal glyph overlays, absence of hidden answer descriptions,
hints, theme persistence, automatic advance, corrected mistakes, IME composition,
late reads/callbacks, save-time pauses, restart/owner/revision boundaries and
unchanged vocabulary exports. An added test initially expected five wrong glyphs
for `<img>` against `humble`; its third character `m` actually matches. The expected
count was corrected to four; the full affected suite then passed.

## Actual extension browser checks

Loaded `.output/chrome-mv3` into an isolated Chrome for Testing profile. Confirmed
its vocabulary was empty before importing synthetic fixtures. No everyday browser
profile or real account was used. The normal Chrome binary did not load the
unpacked extension; the available Chrome for Testing binary did.

- The popup exposed the renamed entry and opened a practice tab. The task tab was
  explicitly activated; the app correctly refused to run while it was hidden.
- `humble`: first typed `h` green and sharp; untyped follow-along letters sharp.
- Native speech observation recorded a local-US request followed by `start` and
  `end` events. This observes speech lifecycle, not subjective audio quality.
- Theme toggle persisted `appearance` and kept input. Computed backgrounds were
  `rgb(250, 251, 248)` and `rgb(30, 30, 30)`.
- Both modes captured in both themes at 1586 × 990; light/dark dictation also
  captured at 390 × 844, with no horizontal overflow.
- Dictation: untyped references blurred; entered `h` and speaker had no blur;
  IPA/meaning were aria-hidden and had no title attribute.
- Escape paused the round, retained `h`, disabled input/speaker and blurred the
  whole prompt. Resume restored typing.
- Wrong `hz` reset the word; correcting it automatically started a retry with one
  mistake and no first-pass credit.
- A subsequent three-word round (`humble`, `companion`, `crane`) advanced and
  completed automatically. `companion` had no saved meaning and remained eligible.
  Export bytes before/after that round were identical.
- Cancellation of a mode-change confirmation retained the current round. Confirmed
  switching entered dictation. Reload retained the round and required resume.
- No page errors were reported during these checks.

Captures and combined reference comparisons are local-only under
`.qa/dictation-redesign/`. The approved design images are intentional references
under `frontend/designs/rememberme-extension/dictation/`.

## Documentation updates and limits

The prior behavior contract described meaning-based Spelling with Enter/Continue,
copy-only cached meanings, and an active WPM dashboard. These were intentional
product changes, not evidence that the old implementation had violated its docs.
`docs/behavior.md` now matches `PracticeApp.vue`, `TypingInput.vue`,
`PracticeMeaning.vue` and `practice-engine.ts`; `docs/architecture.md` documents the
word/meaning projection in `practice-store.ts` and shared theme in the practice
entrypoint. README has a current section above historical versioned descriptions.

The everyday installed extension loading the update, hosted account sync, physical
IME input and screen-reader speech were not verified. No release ZIP, publication,
push or commit was performed for this redesign.
