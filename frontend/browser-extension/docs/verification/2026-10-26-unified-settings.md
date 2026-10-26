# Unified popup settings (2026-10-26)

The header now has one gear icon. It opens Settings directly, replacing the More
options dropdown and separate Account & sync page. The former sun/moon shortcut
moves into Appearance with System / Light / Dark choices.

One scrollable Settings page contains Appearance, account and synchronization,
local migration/recovery, Backups (import/export), and Privacy & support. Account
sections are embedded without a second page title or navigation step. Shared
settings-row styles keep general settings and account controls consistent.
Sync remains a switch; status remains read-only. Existing account/copy/recovery
confirmation and vocabulary storage behavior are retained.

Opening settings focuses its heading. Back or Escape returns to the previously
selected vocabulary/detail view and focuses the gear. Import/export do not
navigate away. The empty-vocabulary import shortcut remains available.

## Verification

- Node 22.22.3: **24 tests / 3 files passed** (mounted popup, CloudConnection,
  theme service).
- Tests cover the single page/heading, absence of the old dropdown/theme shortcut,
  safe privacy link, preserved reading context and original words, theme choices,
  actual synthetic import/export, focus restoration, and prior switch/migration
  behavior.
- Vue/TypeScript compilation and release-smoke script syntax checks passed.
- Chrome ZIP build and extracted integrity validation passed: 345 files / 11 linked resources.
  SHA-256: `558ee12726d7f2640c6ef90a07391bf2154aa941afd33e4f9ddf28fc64ed296e`.
- Actual 400 px component preview checked the gear, direct navigation, all settings
  in one scroll container, in-page theme changes and access to backup/support rows.
- Existing local feedback watcher is healthy; no second watcher started.
- Browser observations used synthetic in-memory messages; no real account or
  vocabulary was changed. They do not establish installed-extension activation.

Screenshots: [dark top](assets/2026-10-26-unified-settings/dark-top.png),
[light lower section](assets/2026-10-26-unified-settings/light-bottom.png).

The previous grouped account-settings report remains a historical UI checkpoint;
this unified page supersedes its More options navigation and separate heading.
