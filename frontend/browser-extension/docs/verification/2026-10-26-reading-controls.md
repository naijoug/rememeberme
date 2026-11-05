# Read Frog first-round browser verification

Date: 2026-10-26 (America/Los_Angeles). Base: `ca60d0e` plus the first-round working-tree changes. Existing architecture/adoption/typing-plan edits were retained. No real vocabulary or account was used as a fixture.

## Implementation

Settings → Websites manages exact device-local hostname rules. The background validates the top-level tab and restricts rule changes to extension pages, rechecks page lookup/save requests, and prevents right-click saving when the site becomes disabled during lookup. Rules survive restart independently of vocabulary and sync; future/corrupt data remains untouched until explicit reset. Existing file-page behavior is retained without offering hostname rules for file URLs.

Popup geometry now uses visualViewport and fixed-coordinate calibration, nearest release-line selection, frame-coalesced updates, and explicit close/invalidation cleanup. The existing interaction lock and scroll-keeps-open behavior remain. No network cancellation protocol or context-explanation API was introduced.

## Executed checks

Node 22.22.3, using `npm ci` in `/private/tmp/rememberme-round1-workspace/frontend/browser-extension` with the repository's `frontend/` + `contracts/` layout. The running source checkout's dependencies/watcher were not replaced.

| Check | Result |
| --- | --- |
| Full extension `npm test` | 33 files / 309 tests passed |
| Final site settings/UI/content/context-menu recheck | 4 files / 49 tests passed |
| Final geometry/content recheck after close-listener cleanup | 2 files / 36 tests passed, including the additional lifecycle regression |
| `npm run compile` | Passed after final functional changes |
| `npm run build` | Chrome build passed after final functional changes |
| `scripts/verify-reading-controls.cjs` | Passed in disposable Chrome for Testing 151.0.7922.34 |
| Existing `npm run local:status` | Running, development assets reachable; watcher reused |

The first restricted `npm ci` could not resolve registry hosts; the same locked install passed with network access. The initial temporary copy lacked the relative `contracts/` directory: one suite and compilation could not resolve imports. Recreating the correct source layout fixed the harness without changing application contracts. The first browser run exposed extension-page-in-tab authorization being too narrow; validating the trusted extension URL fixed it, with a unit regression and a successful rerun. These failed setup/runs are not counted as passing checks.

## Browser evidence

The script loads the built extension into a new temporary profile, seeds only synthetic translation-cache values, blocks lookup/account host resolution, and keeps vocabulary empty. It checks 80%, 100%, 125%, 200% browser zoom; a 360px viewport; a translated/scaled body; nested scrolling; current-site disable; another hostname remaining enabled; page reload; process restart; and saved-host re-enable. Profile and fixture server are cleaned up.

- [Acceptance receipt](assets/2026-10-26-reading-controls/acceptance.json).
- [Narrow selection card](assets/2026-10-26-reading-controls/narrow-selection.png).
- [Website settings](assets/2026-10-26-reading-controls/website-settings.png).

Reproduction after building the extension:

```sh
REMEMBERME_PLAYWRIGHT_PATH=/absolute/path/to/playwright \
REMEMBERME_ACCEPTANCE_DIR=/temporary/evidence \
node scripts/verify-reading-controls.cjs
```

The script exercises the actual extension Settings page in a tab; native toolbar anchoring and the browser-native right-click menu remain manual checks. Sender/frame rules and context-menu interception are covered by injected tests. Physical pinch gestures, rotations/perspective, all-site compatibility, installed everyday-Chrome loading, dark-mode acceptance, hosted sync and live provider reliability were not verified in this run. The successful watcher health check alone does not prove the user's Chrome loaded an update.

## Verified documentation/code discrepancies

The following existing discrepancies were corrected while updating current docs. Planned first-round features becoming implemented are tracked separately, not treated as old bugs.

| Documentation | Corresponding code | Difference and handling |
| --- | --- | --- |
| `docs/read-frog-adoption-plan.md` §2 and release gates | `config/backend.ts`, `services/cloud-messages.ts` | Plan retained disabled account sync; current code enables account controls and sign-in sync. Preserved code behavior and corrected the plan. |
| `docs/behavior.md` Selection and saving | `backend/src/node-runtime.ts`, `backend/src/magpie.ts` | Current guide still said Hermes-first; current configured implementation supports Magpie primary. Updated current description to Magpie, keeping legacy provenance. |
| `docs/behavior.md` Cloud account behavior | `types/index.ts`, `components/TranslationText.vue` | Source attribution list omitted Magpie, although the type and UI accept it. Added Magpie. |
| `docs/architecture.md` Dictionary and privacy | `backend/src/magpie.ts`, `backend/src/lookup.ts` | Paragraph still specified preferred Hermes / 12-second primary. Updated to current Magpie / 8-second primary and retained 4-second MyMemory fallback. |
| `docs/architecture.md` Dictionary and privacy | `services/translation.ts` | Cache paragraph still said public:v1; code uses public:v3 and accepts Magpie. Corrected key and source lifetimes. |
| `frontend/apple/docs/testing.md` opening | `backend/src/magpie.ts` | Connected-client budget explanation still used 12-second primary. Corrected it to 8 seconds without changing the native 20-second timeout. |
| `docs/local-feedback.md` What updates automatically | `config/backend.ts`, `entrypoints/background.ts` | “Does not sync vocabulary” was too broad for the now-enabled account path. Clarified that the feedback connection itself does not sync, while extension account functionality remains active. |

Locations are repository-relative except extension-local `config/`, `services/`, `types/`, `components/`, `entrypoints/`, and `docs/` entries above. Unchecked areas are not claimed consistent. Historical deployment paragraphs retain their dated context; this task did not re-probe hosting or migrate accounts.
