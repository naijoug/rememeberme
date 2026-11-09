# Paper & Sage design QA

The latest single counter action and numbered record viewer intentionally replace the original Remember/Forget design; see [encounter-counter verification](docs/verification/2026-09-30-encounter-counter.md) for the current browser evidence.

Subsequent user-requested popup action placement and scrolling changes are recorded in [the interaction verification](docs/verification/2026-09-30-popup-interactions.md); the original source comparisons below describe the earlier layout.

Latest update: the user replaced the original green dark palette with a neutral Codex-inspired palette. The earlier comparison below documents the selected layout; the final section records the superseding dark-color check.

Selected target: the second displayed concept, saved at `../designs/rememberme-extension/paper-sage-reference.png`. Implementation: existing extension components; disposable comparison harness at `http://127.0.0.1:3937/preview/paper-sage.html?compare=light` and `?compare=dark`.

## First visual comparison

Inspected the selected source and actual components side by side in the same native Chrome screenshot. Reference crops are displayed at the actual component width (400px popup and 340px lookup); browser chrome and the presentation board are excluded from fidelity judgments. Native screenshot is at Retina density; both comparison columns share the same browser scaling.

- P2: preview heading selectors also colored the product's word heading gray and added unwanted margins. Scope preview heading rules to direct children and explicitly apply the word token.
- P2: excessive header/footer spacing and a duplicate latest-definition disclosure made the reading panel taller than the reference. Tighten spacing and show historical-definition disclosure only on older records.
- P2: lookup phonetic/POS/example spacing was looser than the target. Tighten those gaps while retaining readable text and usable buttons.

## Post-fix comparison

Recaptured the revised light and dark comparison views in native Google Chrome after applying all three fixes. Each capture included the actual source crop and rendered components in the same screenshot, with the `multiple` detail and lookup definition visible together. The browser-rendered captures were displayed inline in the task; no standalone screenshot file was exported. Reproducible comparison URLs:

- Light: `http://127.0.0.1:3937/preview/paper-sage.html?compare=light`
- Dark: `http://127.0.0.1:3937/preview/paper-sage.html?compare=dark`

Source board: 1536 × 1024 pixels. Source popup crops: 447 × 556 pixels, normalized to approximately 400 × 498 CSS pixels; lookup crops: 420 × 250 pixels, normalized to approximately 340 × 202 CSS pixels. Implementation widths are 400 and 340 CSS pixels respectively. The comparison presentation scales both columns uniformly by 0.82 to fit the available native Chrome viewport with DevTools open. Captured full native surfaces were 3024 × 1898 physical pixels at Retina density; browser chrome and DevTools are excluded from comparison. A separate exact browser content-viewport measurement was not recorded. This is a same-scale comparison, not a claim of pixel-perfect equality.

The final screenshots visibly resolve the gray word title and unwanted heading margin, shorten the header and footer, remove the duplicate latest definition and tighten the lookup card. The full popup and smaller lookup region were both readable in the combined captures; an additional focused screenshot was unnecessary for this compact interface.

## Required fidelity surfaces

| Surface | Result |
| --- | --- |
| Fonts and typography | Serif word titles and italic examples, with system sans controls and definitions, preserve the selected hierarchy. Georgia is an intentional available-font interpretation of an unidentified generated face. Word and control text remain readable in both themes. |
| Spacing and layout rhythm | Header, breadcrumb, definition, history, actions and theme footer follow the target order and spacing. The rendered detail panel is visually about 4–5% taller; readable controls and actual text metrics account for the remaining difference. No persistent controls were clipped in the comparison. |
| Colors and tokens | Paper and sage in light mode; ink green and pale sage in dark mode. Shared tokens apply to the toolbar and page card. The revised word heading uses the correct foreground token. |
| Image quality and assets | The existing Remember Me raster logo remains sharp at the displayed size; standard controls use Iconoir Vue icons. No decorative image assets or drawn substitute illustrations are introduced. Flat surfaces intentionally omit the generated reference's subtle texture. |
| Copy and content | `multiple`, phonetic, definition, example, count and source context match the sample intent. The phonetic spelling is corrected rather than copying generated text errors. Remember/Forget behavior and reset/delete distinctions are retained. |

## Interaction evidence and limits

- In native Chrome, Delete opened the confirmation overlay; Cancel dismissed it and the accessibility tree still showed `multiple` with count 2.
- The light-theme control exposed its pressed state and the header action changed to offer dark mode. Persistence and cross-surface updates were exercised in mocked component/service tests, not a complete installed-extension browser session.
- Browser console output was inspected. No application/Vue error was identified; the everyday profile produced unrelated extension messages and an unattributed runtime warning. This is not a claim that the entire browser profile has a clean console.
- Loading/error/retry, search, navigation, save guards and viewport positioning have automated coverage. Additional native interactions became unreliable when browser automation reported unavailable windows; a full installed-extension lookup/save and all responsive placements remain unverified.
- The comparison page uses disposable in-memory vocabulary and never reads or writes the user's extension vocabulary.

## Findings and implementation checklist

No actionable P0/P1/P2 visual differences remain in the two recaptured detail/lookup themes.

- [x] Scope preview headings and restore the product word foreground.
- [x] Tighten panel spacing and remove the duplicate latest-definition disclosure.
- [x] Tighten lookup spacing without shrinking controls below the implementation's readable sizes.
- [x] Recapture both themes with source and implementation together.
- [x] Check typography, layout, colors, assets and copy.

P3 follow-up polish: the moon icon is outlined rather than filled, the panel is slightly taller and backgrounds are flat rather than textured. These are accepted implementation differences. New empty/loading/error states extend the mock and have no source artwork against which to claim visual equivalence.

## Codex dark palette revision

The user explicitly requested the colors of their Codex screenshot. Source: `../designs/rememberme-extension/codex-dark-reference.png` (946 × 644 pixels). Dominant sampled colors are `#1e1e1e` for the main background, approximately `#29292a` for a secondary surface, `#303030` for selection and `#e0e0e0` for text. These now replace the green dark tokens in both actual extension surfaces; muted text is `#aaaaaa`, borders `#3a3a3a`, and the deletion scrim is neutral black. Semantic errors remain red.

Comparison evidence: `http://127.0.0.1:3937/preview/paper-sage.html?compare=codex`, rendered and captured in Chrome at an observed 887 × 902 screenshot size. Source and implementation appear together in the same input. The source is scaled to 400 CSS pixels wide and both comparison columns share a 0.82 presentation scale. This is a palette-only target: the source depicts a sidebar, so its typography and layout are not treated as extension layout requirements. The screenshot was displayed inline in the task; no standalone screenshot file was exported.

The complete popup and lookup card visibly share the reference's neutral charcoal and gray-white colors. A second screenshot with More options expanded verifies the secondary menu surface and icon hover area. No actionable visual mismatches were found. Typography, spacing, assets and copy retain the previously accepted implementation; the requested palette change intentionally supersedes the original sage dark accents. Light-mode token values are unchanged. No new asset approximation or copy changes are introduced into the product. The supplied screenshot is a development-only reference and is not in production output.

Verification: Chrome production build and TypeScript check passed; the existing local watcher rebuilt successfully and `local:status` confirmed reachable development assets. Browser verification covers the sample components, not activation in the installed extension. No additional behavior tests were added for this token-only change.

## Header-only theme control refinement

At the user's request, removed the footer Theme / System / Light / Dark row and its unused component/styles. The header sun/moon button remains the manual control. The existing system default and saved preferences remain supported by the theme service.

Chrome's sample preview at `?compare=codex&state=empty` was captured after the change: the empty popup ends after Import a backup without a footer row or leftover gap. The detail-view accessibility tree likewise has no theme group. Clicking the header button in both directions changed its action label between Use dark theme and Use light theme. This intentional layout simplification supersedes the original reference footer. No new visual defects were observed. The eight existing popup tests, TypeScript check and whitespace check passed; the existing local watcher rebuilt successfully. These observations cover sample components, not installed-extension activation.

Historical result: passed


# Continuous typing — 2026-11-05 (current QA)

## Source, viewport and evidence

Source truth: the user's two screenshots and the live Qwerty desktop interaction at https://qwerty.kaiyi.cool/. Saved reference: reference-qwerty-partial.png: `.qa/verification/2026-11-05-typing-flow/reference-qwerty-partial.png` (local-only). Implementation: copy-partial.png: `.qa/verification/2026-11-05-typing-flow/copy-partial.png` (local-only), rendered from the actual extension ZIP in disposable Chrome.

Reference and implementation are both 1280×800 CSS pixels and 1280×800 screenshot pixels (1×). State: dark theme, `cancel`, correct prefix `ca`. No browser chrome or density rescaling. Timers, course/account chrome and progress differ because the reference has a course and the implementation has a synthetic personal-vocabulary round; these are not pixel-equivalence claims.

Full side-by-side: comparison-full.png: `.qa/verification/2026-11-05-typing-flow/comparison-full.png` (local-only), 2560×800. Focused side-by-side: comparison-focus.png: `.qa/verification/2026-11-05-typing-flow/comparison-focus.png` (local-only), 960×220, the same (400,270)–(880,490) content crop from each source. Both combined images were opened and inspected, not inferred from paths. Light and 390px captures were also opened.

## Findings and iteration history

1. P1, original supplied implementation: prominent quiz form, large input box and Check/Next workflow missed the selected direct-typing interaction. Replaced with a centered inline target, per-letter feedback, automatic advance and compact statistics. The original screenshot is the before evidence; the saved full comparison is the final evidence.
2. P2, first implementation comparison: an extra visible cache-provenance line cluttered the word/IPA/meaning group. Moved source/full text to the meaning tooltip. Before: full-before-polish: `.qa/verification/2026-11-05-typing-flow/comparison-full-before-polish.png` (local-only) and focus-before-polish: `.qa/verification/2026-11-05-typing-flow/comparison-focus-before-polish.png` (local-only). After: final full/focus comparisons above; both correct letters are green and the core group has three visual levels.
3. Captures were repeated after letter/theme transitions settled, avoiding misleading intermediate colors. This is capture normalization, not another design defect.

No actionable P0/P1/P2 visual mismatch remains in the inspected states.

## Fidelity surfaces

| Surface | Observed result |
| --- | --- |
| Typography | 48px maximum monospace target with .08em spacing; compact system-sans IPA/meaning/controls. Reference hierarchy is retained; system font rendering is an intentional available-font choice, not an exact font claim. |
| Layout and spacing | Word/IPA/meaning centered with generous empty space; slim 360px progress, compact bottom metrics. Mobile header wraps without horizontal clipping; the input is integrated into the word rather than a form card. |
| Colors | Dark navy `#111724`, panel `#192230`, pale text `#cbd0dc`, lavender accent `#bdc5fa`, green correct/red wrong. Light variant has settled dark text on a pale surface; both visibly readable. |
| Assets | Existing Remember Me logo and library Iconoir controls; no generated raster, custom-drawn substitute artwork or Qwerty logo reuse. Speech icon is a standard control beside the word. |
| Copy/content | Synthetic `cancel`, packaged IPA and cached Chinese meaning establish the selected focal hierarchy. Own-brand controls and personal-vocabulary semantics remain; no implementation/debug text in the central group. |
| Interaction/accessibility | Real focusable input, accessible spelling label, target description, keyboard controls, focus indicator, manual pause/resume, reduced-motion styling. Browser harness exercised direct input, error reset, progression and confirmation. Screen-reader experience is not asserted. |

Intentional differences: Remember Me branding and personal vocabulary instead of course chapters; four relevant metrics instead of the reference's five; round progress rather than course progress; local device pronunciation instead of remote audio. Light/mobile/results extend the desktop reference and were checked independently.

## Verification and limits

[Acceptance receipt](docs/verification/assets/2026-11-05-typing-flow/acceptance.json): direct Copy input, typo reset, automatic next, pause/resume, process restart, Spelling confirmation, unrelated updates and tab takeover passed. Zero captured external requests and page errors in the disposable fixture run. Actual audible speech and physical IME remain manual checks; local speech routing and composition safety have automated tests.

- [x] Replace quiz form with direct typing.
- [x] Compare source and implementation together, full view and focal crop.
- [x] Fix provenance clutter and recapture.
- [x] Inspect typography, spacing, palette, assets and content.
- [x] Check light/dark, mobile and core keyboard states.

final result: passed


## 0.1.7 implementation review follow-up

The [review record](docs/verification/2026-11-05-typing-flow-review.md) supersedes the earlier artifact receipt. New correct/incorrect Spelling feedback and end-of-round details were rendered and inspected in disposable Chrome. The first results capture placed actions too close to the progress bar; the final completion-only padding fixes that spacing, and the harness verifies at least 16px separation. Final desktop results: `.qa/verification/2026-11-05-typing-flow-review/results.png` (local-only) (1280×800, 1×) and mobile results: `.qa/verification/2026-11-05-typing-flow-review/results-mobile.png` (local-only) (390×844, 1×) show readable controls without horizontal clipping. Incorrect feedback: `.qa/verification/2026-11-05-typing-flow-review/spelling-incorrect.png` (local-only) shows the saved answer and focused Continue action. These additional states extend the source reference; the centered Copy design and its prior comparison remain unchanged. No actionable visual issue remains in these inspected states.

final result: passed

## Word dictation redesign — 2026-11-08

Selected targets: `../designs/rememberme-extension/dictation/light-follow.png`,
`dark-follow.png`, and `dark-dictation.png` (the corrected selected dark designs).
The discarded blurred follow-along draft was not used. Implementation is the
production extension's `practice.html`, loaded in an isolated Chrome for Testing
profile with synthetic words.

**final result: passed**

Reference images and implementation captures were compared together, side by side
in `.qa/dictation-redesign/compare-light.png`, `compare-dark-follow.png` and
`compare-dark-dictation.png`. Sources are 1586 × 990 or within two pixels of that
size; the browser viewport is 1586 × 990 at DPR 1. Full comparisons normalize each
side to 1000 × 624. A second, focused comparison (`compare-input-detail.png`) uses
the same 640 × 300 central crop from each image, scaled equally to 800 × 375.

The reference depicts three of ten words; the matched `humble` typing capture uses
one synthetic word, so the counter and number of progress segments intentionally
differ. The same first-character entry and selected mode/theme were compared.

### Findings and fixes

- P2, initial light comparison: the word, toolbar and supporting text were too small
  relative to the selected design. Increased desktop word size to 96px maximum,
  enlarged the brand/mode controls, aligned the header rule and moved the prompt
  to the target vertical band. Recaptured light/dark follow-along states.
- P2, initial dark dictation comparison: 7px blur left the large reference letters
  too recognizable. Increased desktop reference blur to 12px with lower opacity;
  retained 7px for mobile's smaller letters and the supporting hints. Recaptured
  dictation and inspected the word/IPA/meaning crop. Entered glyphs stay sharp.
- P2, paused keyboard state: the speaker remained focusable inside an aria-hidden
  blurred prompt. Disable it while inactive and guard the replay shortcut. The
  actual paused extension now disables both speaker and input.

### Fidelity and usability

| Surface | Result |
| --- | --- |
| Fonts/typography | System monospace word with direct green entered glyph, thin next-letter cursor, small inline library speaker, subordinate IPA/meaning. Readable desktop and mobile. |
| Spacing/layout | Quiet header, two modes, compact progress, centered word, lower skip and footer. No separate input/hint card or statistics dashboard. 390px layout wraps controls without horizontal overflow. |
| Colors/tokens | Imports popup Paper & Sage tokens: warm light `#fafbf8`, charcoal dark `#1e1e1e`, sage/green success, neutral controls. Shared theme changes retain input. |
| Assets | Existing blue product logo retained intentionally rather than replacing it with the generated green logo; Iconoir icons remain vector assets. No decorative rasters are needed in runtime. |
| Copy/content | Chinese mode/interaction labels match the selected concept; existing settings and explicit hint reveal remain available as small controls. Packaged IPA is the real local spelling variant, rather than generated mock text. |

P3 accepted differences: supporting copy and controls are slightly more compact
than the generated mock; the speaker is the existing outline icon, not the generated
shape; the original product logo and existing settings/reveal actions are retained.
These preserve product conventions without changing the selected interaction.

See `docs/verification/2026-11-08-dictation-redesign.md` for executed checks and limits.
