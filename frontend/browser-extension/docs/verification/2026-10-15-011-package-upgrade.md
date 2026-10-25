# 0.1.1 production package and file-not-found regression acceptance

Executed 2026-10-15 Asia/Shanghai, Node 22.22.3, macOS arm64, Chrome for Testing 151.0.7922.34. The user requested the popup recovery be included in a newly packaged release and an upgrade regression check. Source/lockfile version is **0.1.1**. No Git commit/store submission is implied; pre-existing API/native changes remain retained.

## Fixes in the deliverable and packaging workflow

The production storage client now bounds GET_WORDS, GET_WORD and export reads at ten seconds, so a stalled background produces a retryable error instead of leaving “Opening your vocabulary…” indefinitely. This deadline does not affect writes: save/delete/import/reset are not automatically retried or timed out, because a late reply can follow an already committed mutation.

`npm run zip` now calls `scripts/package-release.mjs` and builds with `wxt.release.config.ts` into `.output/release-staging/chrome-mv3`. The new build never clears `.output/chrome-mv3` or the running `.output/chrome-mv3-feedback`. A file-by-file comparison proved all old production output members still matched the accepted 0.1.0 ZIP after packaging 0.1.1. Generated staging output must not be loaded as a permanent unpacked installation.

After archiving, the gate extracts that actual ZIP and requires the popup, background, content scripts, icons, HTML scripts/styles, transitive static/dynamic JS module imports and CSS assets to exist inside the package. Unsafe paths/symlinks, remote executable imports, feedback/temporary endpoints and private/development files fail the command. A SHA-256 inventory is emitted. Regression fixtures prove missing popup, imported module and CSS image fail before a complete package is accepted.

The prior launchd/file-health/toolchain-fingerprint fixes remain development tooling in source. They are not injected into the production extension. Formal popup code/resources are bundled, with no localhost dependency or exposed API address. The same local watcher was stopped before npm ci and restored afterward; no user profile or vocabulary was replaced.

## Executed checks

| Check | Result |
| --- | --- |
| `npm ci` | Passed; 0 vulnerabilities; package/lockfile agree |
| Full `npm test` | 30 files / 245 tests passed |
| `npm run compile` | Passed |
| `npm run zip` | Passed build, ZIP and extracted-resource gate |
| Resource inventory | 345 files, 11 linked resources including transitive assets |
| `scripts/release-smoke.cjs` | Exact 0.1.1 ZIP passed live translation, records/reset/deletion/import/export, restart and legacy migration |
| `scripts/release-upgrade.cjs` | Same-path/same-profile old ZIP -> new ZIP upgrade, offline loads/restart, stalled-read recovery and real action popup passed |
| `npm run local:start` | Original local feedback service restored and health passed |
| Script syntax / `git diff --check` | Passed |

The installed npm configuration printed unapproved-install-script notices for transitive esbuild/fsevents; npm ci and subsequent real builds passed. These are install-policy notices, not npm audit vulnerabilities; no global allowlist was weakened.

## Actual upgrade/browser evidence

The upgrade driver extracted the previously accepted 0.1.0 ZIP, loaded it in a fresh test-owned Chrome profile, imported a synthetic fixture, then closed Chrome. It installed the extracted 0.1.1 files at the same test install path and reopened the same profile. Version changed to 0.1.1 and extension ID remained unchanged. Fractional count 0.5, literal HTML context, history and complete fixture source URL matched the exported 0.1.0 data.

With all network offline, three new popup loads succeeded from the packaged files. A controlled test-only replacement of GET_WORDS with a stalled promise caused the real packaged Vue popup to show the bounded error and Try again control. Closing that fixture popup and opening a genuine popup recovered without changing vocabulary. A further process restart offline retained the same data.

The headed test called Chrome's own `action.openPopup()`, identified the newly created popup target, and inspected its DOM through a test-owned CDP session. Its real browser action popup rendered retained vocabulary offline; [screenshot](../release/assets/upgrade-toolbar.png). There were no observed failed extension-file requests or localhost dependencies. This is actual Chrome action rendering, distinct from opening popup.html as a normal tab.

The first action-popup verifier incorrectly waited for a Playwright page event, then assumed a specific CDP target type. Chrome exposed the action popup without that event and as a page-type target. The verifier now compares target IDs before/after action.openPopup instead. The final complete run passed. A separate attempted manual native-menu run was interrupted by desktop input changes and ended with 3 fixture records rather than its required 1; it wrote no pass result and is not claimed as a 0.1.1 single-save native regression. The prior 0.1.0 native record remains explicitly historical. The new package's native action rendering, upgrade and packaged operations are established by the passing drivers above.

Results: [upgrade-acceptance.json](../release/assets/upgrade-acceptance.json), [release-acceptance.json](../release/assets/release-acceptance.json). All data/profile directories used by these drivers were disposable; the user's real vocabulary was never test input.

## Deliverable

`remember-me-0.1.1-chrome.zip`, **8,799,127 bytes** (confirm the accompanying inventory/archive if redistributed).

SHA-256: `37c0326dc2a85c8d1f9a545a3a2c0aa00a525d88f485cb1372a59de20b50c269`.

The artifact includes a separate `.integrity.json` inventory and `.sha256` file. Only upload/install the verified ZIP, not the staging directory or development output. The existing data-processing policy remains applicable; no API URL/configuration appears in the UI, and account sync remains disabled.

## Scope of the conclusion

The reported missing-file failure is covered by package resource checks, isolated build output, real same-identity upgrade, offline popup reopening and process restart. This does not guarantee operation if an external process deletes/moves an installed directory. Manual unpacked updates must replace a completed package in the original stable directory while it is not running, then reload the same entry; do not remove/reinstall or import the same backup again. Signed Chrome Web Store update delivery/review was not performed. No continuous service SLA, Firefox acceptance or account-sync readiness is implied.
