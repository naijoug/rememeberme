# Automatic account sync and settings navigation — 2026-10-26

## Behavior

- The gear replaces the brand header with a back button and `Setting`. Back/Escape restores the previous view and focus.
- Sign-in activates account vocabulary, enables synchronization and downloads account words. Reopening preserves an explicit pause or recovery pause.
- The popup reloads words after account actions and periodically while visible. Unchanged data retains list scroll position.
- `View account words` shows the available account word count and opens the whole list, clearing an old search/reading selection. Pending uploads are not counted as confirmed remote uploads.
- `Use local vocabulary` is removed from the settings flow. `Add device words to account` previews new/skipped words, retains the original device vocabulary and requires confirmation. Preview preserves the sync preference; confirmed additions upload automatically when enabled.

## Executed checks

Using Node 22.22.3 and the existing package dependencies:

- Extension `npm test`: 30 files, 293 tests passed, including account activation/download, paused restart, recovery fencing, migration confirmation, popup refresh and the new view-words navigation regression.
- Extension `npm run compile`: passed.
- Extension `npm run build`: Chrome MV3 production build passed.
- Backend `npm run build` and `npm run test:browser`: passed. The integration script uses disposable SQLite/accounts over loopback HTTP, including automatic activation, downloaded words, confirmed copying with sync enabled, retry, conflict/recovery and source privacy checks.
- Existing `npm run local:status`: development assets reachable; reused the running watcher.
- Browser UI: actual Vue components in `preview/account.html`, using synthetic in-memory messages. Inspected light/dark settings, header replacement, sign-in enabling the switch, paused status retaining words, and View account words returning to the list. Preview does not access the installed extension's storage or a live account.

The implementation checks above did not perform production OAuth, real-account uploads, installed-toolbar acceptance or deployment; see the release follow-up below for later checks. Build success is not proof that the installed Chrome extension loaded it. The privacy-policy source was updated; its hosted publication is outside this local change.

## Documentation/code discrepancies reconciled

1. `README.md` (intro/backend connection), `docs/architecture.md` (account controls), root `docs/architecture.md` (account copying/sending), and `docs/release/privacy-policy.md` (storage/account sections) described separately enabling sync after account selection/copy. `services/cloud-vocabulary.ts` (`connect`, `activateAccount`, `restoreAccountView`) now activates sync at sign-in, while anonymous copying still requires confirmation. Updated these documents to distinguish account synchronization from importing pre-sign-in words.
2. `docs/architecture.md` (persistence overview) described popup reads only on mount/actions. `entrypoints/popup/App.vue` also restores account state and polls the vocabulary while visible. Updated the refresh description and its limits.
3. `docs/behavior.md` (cloud account behavior) and `docs/architecture.md` (`CLOUD_PREVIEW_LOCAL`) said preview/copy pauses sync. `services/cloud-vocabulary.ts` (`previewLocalMigration`, `confirmLocalMigration`) preserves the preference and synchronizes confirmed additions when enabled. Updated both descriptions; explicit pauses remain respected.
4. `docs/behavior.md` (account settings presentation) described vocabulary-location rows, switching vocabularies and disabling the switch for a local selection. `components/CloudConnection.vue` now shows account-word navigation and a retry for incomplete sign-in; `components/VocabularyPanel.vue` supplies the top-level back/header navigation. Updated the settings description. Earlier dated verification records remain historical evidence.


## 0.1.4 release follow-up

- Bumped package and lockfile versions together to 0.1.4.
- `npm run zip` passed: extracted archive contains 345 files and 11 linked code/resources. Archive SHA-256: `392522809712b35903d504de7cb21165a004c4d2ac7ecd5dad68db3cfae93738`.
- Type checking, release-smoke script syntax and the Chrome production build passed. The full release-smoke browser script was not rerun; the previous 293-test result remains the automated functional evidence.
- Restarted the existing local feedback service with its updated package fingerprint; development assets were reachable. The production output was also rebuilt at its existing path.
- Read-only inspection of the actual installed Chrome toolbar popup confirmed the new `Setting` header, back button, account-word navigation, paused status and device-word import entry. The pre-existing pause was preserved. No vocabulary was copied or changed for this check.
- Chrome's internal extension management page was blocked by the browser tool's URL policy, so a manual reload and verification of the installed manifest version were not performed. No workaround or reinstall was attempted.
- Updated release-smoke expectations: its heading assertion still expected `Settings` while `VocabularyPanel.vue` renders `Setting`; its generated limitation incorrectly said sync was disabled while `config/backend.ts` enables it. The assertion and evidence wording now match the source, without claiming authenticated browser acceptance.
