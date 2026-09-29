# Paper & Sage redesign — 2026-09-29

Scope: implement the user's selected second design in the existing toolbar popup and webpage lookup card, add system/light/dark appearance, bound loading with retry, and preserve vocabulary/import/export contracts. Existing release-preparation and local-service-recovery edits were retained. No commit or push was performed for this change.

Environment: macOS, Node 22.22.3 (matching `.nvmrc`), WXT 0.20.11, working-tree package version 0.1.0. Visual checks used the user's native Google Chrome; its version was not recorded. Iconoir Vue was added with matching package/lock entries. An initial dependency install encountered a registry connection reset; the cache-assisted retry succeeded.

## Automated verification

- `npm test`: **113 tests passed across 18 files** after the UI, lookup and updater changes.
- A subsequent invalidated-extension cleanup guard in `services/theme.ts` added one regression test. After that final change, `npm test -- services/theme.test.ts tests/content.test.ts services/local-feedback.test.ts`: **19 passed** (4 theme, 10 content, 5 local feedback). The entire suite was not rerun after this small cleanup change.
- `npm run compile`: **passed** after the final change.
- `npm run build`: **passed**, Chrome MV3 production output.
- `npm run build:firefox`: **passed**, Firefox MV2 production output. This is not a Firefox browser run.
- `git diff --check`: **passed**.
- Production manifests retain storage/context-menu permissions, and the disposable preview is absent from packaged output. Appearance uses its own storage key; backup shape and vocabulary keys are unchanged.

New coverage includes isolated ShadowRoot rendering, stale responses, a 10-second UI lookup deadline with retry, duplicate-save prevention, theme changes and cleanup, safe example rendering, popup reading-view interactions and virtual-list selection. All storage/runtime/API fixtures are disposable mocks.

## Visual and interaction checks

The [design QA report](../../design-qa.md) records an initial comparison, three corrections and post-fix source/implementation captures of both light and dark themes. Actual extension components were rendered in the [sample preview](http://127.0.0.1:3937/preview/paper-sage.html); this harness has no access to real vocabulary storage.

| Check | Outcome |
| --- | --- |
| Light detail and lookup compared with the selected design | Pass after spacing, heading and duplicate-definition fixes |
| Dark detail and lookup compared with the selected design | Pass with accepted minor icon/flat-surface differences |
| Delete confirmation and Cancel on sample data | Pass in native Chrome; word and count preserved |
| Light-theme control changes active state | Observed in native Chrome; persisted preference and cross-surface notification tested with mocks |
| Loading deadline, retry, stale response, duplicate-save guard | Pass in mocked content tests; no live-network browser claim |
| Search, reading-view navigation, reset, import, virtual-list bounds | Pass in component tests; complete native browser flow not rerun |
| Installed extension lookup/save and update activation | Not fully verified in this run |
| Firefox installed-extension interaction | Not run |

Browser-tab automation returned policy/availability failures, and later native automation reported no available windows. Existing browser-manager restrictions were respected. Chrome console inspection identified no Vue/application error; unrelated extension output and an unattributed runtime warning prevent a claim of a completely clean browser console.

## Local feedback

An observed Chrome missing-manifest alert led to a reconnect race fix: the client now waits for the server's build-available event before reloading. WXT may remove output during a full rebuild; socket availability alone did not establish manifest availability. Mocked reconnect tests verify the new handshake and single reload. A full native browser reconnect fault-injection run remains unverified.

The existing watcher rebuilt the latest theme source successfully. Final `npm run local:status` confirmed a running service with reachable Chrome development assets. The initial sandboxed status call could not fetch localhost; the authorized host-network check succeeded. No second watcher was started and generated output was not edited. Service health and successful build output do not establish that Chrome activated the newest extension code.

Existing release marketing screenshots predate this redesign and need refresh before publication; the optional release smoke harness has updated selectors but was not rerun here.
