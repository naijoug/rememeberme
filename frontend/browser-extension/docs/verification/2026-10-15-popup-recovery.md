# Local feedback popup recovery

2026-10-15, macOS, Node 22.22.3, working tree based on 39302c7. The user's screenshot showed a native toolbar `ERR_FILE_NOT_FOUND` page. This is local extension-resource failure, not evidence of an API/server failure.

Observed in the actual Chrome: the existing extension ID was `blmbjchnpodecheenfmajdjfpmgimdcj`, loaded from `.output/chrome-mv3-feedback`. On reopening, the file error was replaced by the real popup, which remained on “Opening your vocabulary…”. The manager showed the same enabled extension and inactive background; no user vocabulary was deleted, saved, imported, exported or migrated as a test. The exact origin of the captured missing-file interval is not conclusively established. WXT full rebuild code removes and recreates its output directory, so resource absence during rebuild is a known possibility.

The existing health probe checked only Vite scripts. It could report healthy without checking Chrome's actual local files or whether a running watcher matched the changed toolchain. The helper now requires manifest/popup/background and local HTML-linked scripts/styles, fingerprints package/lockfile/Node in the same LaunchAgent, reports stale toolchains and replaces the old watcher before starting the current one. Permission failures are not retried; transient launchd unload EIO has a bounded retry.

Recovery executed `npm run local:start` against the same registered service. The first bootstrap after bootout returned EIO; a subsequent start restored the same watcher and produced a complete feedback build. No second watcher or new extension identity was installed. Production source/package and vocabulary data were not changed by this helper fix.

Executed checks:

- `npm test -- scripts/local-feedback-health.test.mjs`: 10 tests passed, using disposable filesystem fixtures/mocks. Missing popup/background/chunks, dependency fingerprint changes, bounded EIO recovery and non-retried permission failures are covered.
- Existing service `local:status`: passed actual HTTP and disk-output checks after recovery.
- Actual feedback directory loaded in a fresh disposable Chrome for Testing profile: real popup reached “Your words start here”; background GET_WORDS returned an empty fixture vocabulary. This did not attach to the user profile.
- `node --check` for both helper sources and `git diff --check`: passed.

Desktop automation initially reported macOS locked, and the user subsequently confirmed unlock. After recovery the same installed extension was reloaded once through its existing Chrome details page. Its actual toolbar popup loaded the local vocabulary normally and displayed **62 words**, with neither ERR_FILE_NOT_FOUND nor the stuck loading state. The extension ID and loaded directory were unchanged; there was no reinstall or vocabulary mutation.

An ordinary local test tab in the user's current Chrome then selected `serendipity`. The actual installed card displayed Chinese text attributed to Hermes, packaged WordNet English, US/UK IPA, and counter **0**, without an API URL or login setup. No bookmark/context-menu save was clicked. Escape closed the test card. A viewport screenshot was saved as `popup-recovery-chrome.jpg` in this chat's artifact directory; it contains only synthetic test-page text, not saved vocabulary/history. This completes existing-browser verification independently of the earlier disposable-profile test.

A full WXT build still briefly replaces its generated output directory; file checks detect incomplete output rather than making the build atomic. If a popup was opened during that interval, close/reopen it after health passes. Do not remove/reinstall, delete a profile, or import real vocabulary to diagnose this error.
