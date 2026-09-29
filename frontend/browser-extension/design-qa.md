# Paper & Sage design QA

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

final result: passed
