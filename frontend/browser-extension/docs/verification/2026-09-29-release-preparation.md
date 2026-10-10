# Release preparation — 2026-09-29

Scope: prepare a local 0.1.0 Chrome release candidate and submission materials. No store upload, account registration, public hosting, Git push or production vocabulary access was performed.

Environment: macOS 26.5.2 arm64, Node 22.22.3 (matches `.nvmrc`), npm 10.9.8, WXT 0.20.11, Vite 7.2.2, Vitest 4.0.8. Working tree based on `0dfb606`, with the release preparation edits. Browser smoke run: Chrome for Testing 151.0.7922.34, headless, fresh temporary profile, production Chrome MV3 output.

## Changes

- Set package/lockfile version to 0.1.0 and a descriptive extension summary.
- Replace WXT starter icons with the editable blue bookmark/R icon and remove the unused public WXT logo.
- Set popup document/action title and visible heading to Remember Me; describe supported webpages accurately in the empty state.
- Remove unused `activeTab`; keep `storage`, `contextMenus` and broad site access for selection. No storage schema/import/export changes.
- Prepare English/Chinese store copy, factual permission/privacy explanations, a policy draft, promotional tile and actual extension screenshot.
- Add an optional, externally provisioned Playwright release smoke script; no application dependency changes.

## Executed checks

| Check | Result / evidence |
| --- | --- |
| Dependency setup | `npm ci` completed with 422 packages and `wxt prepare`; lockfile versions retained. Initial restricted-network attempt failed to resolve npm registry, then succeeded with network access. |
| `npm test` | **Pass**: 14 files, 96 tests, disposable mocked APIs/storage |
| `npm run compile` | **Pass**: Vue/TypeScript |
| `npm run zip` | **Pass**: production Chrome MV3 build and ZIP |
| `npm run zip:firefox` | **Pass**: Firefox MV2 build, distribution ZIP and source ZIP; not an AMO readiness claim |
| Package inspection | Version 0.1.0, expected icon sizes and title, no `activeTab`, no feedback output, `.env`, `node_modules`, local logs, or Vite/feedback server markers in release ZIPs |
| Installed Chrome smoke | **Pass**, details below; dictionary responses are intercepted fixtures |
| Visual inspection | **Pass**: opened actual 1280 × 800 selection screenshot, 400 × 600 popup image, and 440 × 280 promotional tile; readable, no clipped lookup card |
| Existing local feedback service | Dependency reinstall interrupted the watcher. After installation, restarted the same registered LaunchAgent (no second watcher); status reports running and logs show a successful 640 ms build. This does not prove the user's Chrome loaded the update. |
| `git diff --check` | **Pass** |

One initial browser smoke attempt timed out because the test tried to click Delete after reset remounted/collapsed the word list. Corrected the harness to expand the row after reset; the full smoke check then passed. No product workaround or real browser data was used.

## Installed Chrome smoke evidence

Executed `scripts/release-smoke.cjs` with `REMEMBERME_PLAYWRIGHT_PATH` set to the desktop runtime's existing Playwright package. The script loaded `.output/chrome-mv3/`, served only an in-memory synthetic article on loopback, and routed dictionary requests to a synthetic definition. Browser runtime messaging, extension storage, Vue rendering, downloading and importing were real.

- **Pass:** service worker starts, manifest is 0.1.0 with `storage` and `contextMenus`, without `activeTab`.
- **Pass:** selecting `serendipity` opens the definition card; a dictionary request from the extension reaches the test route.
- **Pass:** Remember closes the card and leaves storage empty.
- **Pass:** Forget twice creates count 2, two history records, context text and the full loopback source URL.
- **Pass:** popup HTML loads as an extension page with heading Remember Me; reset sets count 0 and preserves two histories.
- **Pass:** cancel deletion retains the word; confirmed deletion removes it.
- **Pass:** downloaded JSON equals stored vocabulary; import into empty fixture storage restores count and history independently.
- **Pass:** malformed JSON import displays an error and preserves existing data.
- **Pass:** [store screenshot](../release/assets/screenshot-selection.png) and [popup evidence](../release/assets/popup-verification.png) captured from the real extension UI. Popup evidence opens `popup.html` as a page, not via the native toolbar.

The temporary browser profile was removed after the run. No ordinary user browser profile, vocabulary, cookies or real page contents were read or modified.

## Remaining checks and publication inputs

- **Not run:** live dictionary lookup, native right-click menu and toolbar popup anchoring, toolbar error fallback, browser updates/reinjection, file URL access, restricted-page behavior, real storage quotas, large-history browser layout, and Firefox/Edge installed runtime. Unit tests cover several of these contracts but do not replace installed-browser checks.
- **Pending owner information:** public developer name and support contact. The privacy policy deliberately retains visible placeholders and a draft status; it is not yet a public policy URL.
- **Pending external steps:** host the completed policy, review store certifications, register/configure publisher account, choose distribution visibility, upload and submit for review.
- **Firefox deferred:** select stable Gecko ID and correct data-consent/version settings, review source submission, and run Firefox before claiming AMO readiness. The word sent to Free Dictionary API prevents a truthful no-data-transmission declaration.

The complete [manual checklist](../testing.md) remains the release gate for any additional browser claims.
