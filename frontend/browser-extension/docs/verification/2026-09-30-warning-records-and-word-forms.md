# Warning records and regular word forms — 2026-09-30

Scope: investigate the repeated `Extraneous non-props attributes (context, theme)` warning shown by the user for Having on `https://github.com/withastro/astro`. Preserve existing UI, dictionary and release-preparation work. No commit or push was performed.

Environment: macOS, Node 22.22.3, WXT 0.20.11, existing local feedback watcher and user's installed Chrome extension. Chrome version was not recorded.

## Findings and actual Chrome evidence

- Current `entrypoints/content.ts` and the feedback bundle explicitly pass declared popup props; neither forwards context/theme to the fragment-root icon provider. The existing regression checks passed. No console-warning suppression was added.
- The affected GitHub tab's captured log initially included six copies of the reported Vue warning, message-channel failures and an old invalidated-context stack. These were existing records when the tab was inspected; their displayed capture timestamps alone were not treated as proof of new occurrences.
- Selecting Having on the previously open tab did not produce a current card. Refreshed only that affected page. The newly captured content-script startup confirmed activation from the same installed extension ID.
- After refresh, the same Having selection had no leaked context/theme attributes or new Vue warning. It did expose a distinct dictionary timeout: having was not an exact WordNet headword and fell back online.
- Added regular WordNet suffix matching. After the existing watcher rebuilt, selected Having again on the same GitHub page. The actual extension displayed **Having**, **Base form: have**, real verb definitions and examples, and **Offline dictionary · WordNet**. DOM inspection found one popup host, no context/theme attributes; the page's captured warning/error list was empty. A browser screenshot was inspected in the task.
- The extension-manager historical error list was not cleared or asserted empty. No browser-manager restrictions were bypassed. The remaining user step is Clear all in that diagnostic view if they want to remove retained records, then check whether new ones appear.
- No real vocabulary was read, imported, saved, reset or deleted. Saved-word preservation was checked using a disposable mocked storage client.

## Implementation and checks

Exact dictionary entries retain priority. On a miss, regular noun/verb/adjective suffix candidates are checked against real packaged entries with matching parts of speech. Candidate reads are concurrent and the entire local lookup remains bounded by 1.5 seconds, inside the existing overall lookup budget. Irregular exceptions and full morphological disambiguation are not claimed.

The selected spelling remains the popup heading and vocabulary key; the base form is displayed and stored as `definition.word`. Legacy backups need no migration.

- Initial current-code warning/theme/update regression run: **20 tests passed** across three files.
- After word-form changes: **50 tests passed** across offline dictionary, dictionary fallback, content, selection popup and toolbar popup tests.
- One initial test incorrectly assumed larger was absent from WordNet; the real data contains it. Replaced that suffix-test fixture with bravest and retained a separate exact-headword priority check. Affected tests passed after correction.
- `npm run compile`: **passed**.
- `npm run build`: **Chrome production build passed**, about 14.09 MB.
- Existing local feedback service: healthy before inspection; later build log and successful actual-page lookup establish that the new source reached the installed extension.
- `git diff --check`: **passed**.

Firefox runtime, all other open tabs, and native context-menu saving were not rerun. These checks establish recovery on the reported page and no new warnings during that reproduction, not a blanket claim about all historical Chrome diagnostics.
