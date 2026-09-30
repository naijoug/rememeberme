# Automatic local updates in your everyday Chrome

The local feedback build watches this checkout and updates the unpacked extension whenever source changes are successfully rebuilt. It uses WXT's development server and a dedicated output directory, `.output/chrome-mv3-feedback/`. Normal release builds keep their existing paths.

## Start the service

From `frontend/browser-extension/`, using the Node version in `.nvmrc` and installed dependencies:

```sh
npm run local:start    # macOS: start/recover in the background and at login
npm run local:status   # process + development-asset health, output directory and log path
npm run local:stop     # stop and remove login startup; retain browser vocabulary
```

The macOS helper creates a checkout-specific LaunchAgent in `~/Library/LaunchAgents/`, using the absolute Node and checkout paths. Logs live in this package's ignored `.local-feedback/service.log`. If Node or the checkout moves, run stop/start again. Stop the service before removing the checkout.

`local:start` repairs a registered-but-stopped job, updates older startup settings, and waits for both development scripts used by the popup to respond. It reuses a running service with matching settings instead of starting a second watcher. The job restarts after any process exit, including a clean exit; use `local:stop` to intentionally stop it and remove login startup. `local:status` returns a nonzero status for stopped/unhealthy services and does not confuse registration with a running process. A healthy server still does not prove the extension is enabled in Chrome.

For a foreground session (including other operating systems), use `npm run dev:local` and keep the terminal running. Do not run it alongside the background service: both use `127.0.0.1:3937`. The listener is loopback-only.

## Load once in Chrome

1. Open `chrome://extensions/` yourself and enable Developer mode.
2. Choose **Load unpacked**, then this checkout's `frontend/browser-extension/.output/chrome-mv3-feedback/` directory. On macOS, use **Cmd+Shift+G** in the folder picker to paste its absolute path, since `.output` is hidden.
3. Confirm **Remember Me · Local** appears and pin it if desired. Keep the same directory loaded for subsequent updates.

This directory gives Chrome a separate extension identity from the release build. If the old extension has vocabulary, export it first and import it into the local build once. Imports add counts/history, so do not repeatedly import the same backup. Retain the old extension until the transfer is verified, and keep only one Remember Me variant enabled to avoid duplicate selection UI. Do not delete or overwrite browser profile files to transfer data.

Browser automation may block `chrome://extensions/`; the initial loading step is then manual. The local service cannot confirm installation by itself.

## Quick check in Chrome

With the service running, open [the local selection test page](http://127.0.0.1:3937/test-selection.html) and double-click a highlighted English word. A working extension shows the definition card. **Remember** closes the card without saving; **Forget** and the context-menu shortcut save into the vocabulary of the currently loaded extension, so use Remember for a check that does not change your vocabulary.

If no card appears, check Chrome's puzzle-piece extension menu for **Remember Me · Local**. If it is absent, use the extension manager yourself to enable the existing entry or load the fixed directory above if it has never been loaded. Do not reinstall or create a second copy just to refresh an already-enabled extension. If the popup is blank, first run `npm run local:status` and `npm run local:start`; the local build needs its server even when the generated folder exists.

Chrome's **Errors** view retains historical warnings and exceptions. After enabling/reloading an existing entry, refresh the affected test page to replace scripts left behind by a disabled or reloaded extension, then reproduce the action and check for new errors. Older `Extraneous non-props attributes (context, theme)` warnings came from passing popup state to the fragment-root icon provider; the content entrypoint now passes only declared popup props and applies theme to its wrapper. An older `Extension context invalidated` stack at the storage listener's removal came from teardown after an extension reload; theme cleanup now tolerates an already-invalid browser context. Neither historical entry alone proves that the current build is still failing.

To distinguish retained records from a new failure: refresh the specific affected webpage, then open the extension's Errors view yourself and use **Clear all** after retaining any diagnostic details you need. Select a word again and look for newly added records. Clearing this diagnostic list does not erase vocabulary. Source fixes and hot updates do not automatically clear Chrome's historical error list. A definition timeout is a separate issue from the Vue attribute warning; check the lookup's source/coverage as described in [dictionary.md](dictionary.md).

## What updates automatically

- Popup Vue changes use WXT/Vite updates. Background changes reload the extension.
- Content changes register the new scripts and reinject them into eligible open tabs. The local mode replaces WXT's default whole-tab refresh, preserving page input and scroll position. Old content contexts remove their listeners, popup, notifications and pending timers to avoid duplicate saves.
- New eligible pages use the latest registered script. Browser-internal/restricted pages remain unsupported; pages that close or reject injection during an update can be refreshed manually.
- After the development server restarts, the local update client reconnects, waits for a build-complete signal, then reloads the extension to restore its WXT connection. This avoids reloading while the manifest is temporarily absent during a build.
- The current WXT 0.20 leading-only debounce can skip the last rapid save; feedback mode disables that debounce and retains WXT's serialized build queue.

Keep the service running while using this build: its popup loads development assets from localhost. Source errors must be fixed before a new build can succeed. This workflow does not mean automated tests run or pass on each save. Run the checks in [testing.md](testing.md) before declaring a change complete.

The feedback build adds WXT's development-only `tabs` and `scripting` permissions and localhost access for updates. Release builds omit the local update connection and use the permissions documented in [architecture.md](architecture.md). It does not publish anything or sync vocabulary to a server.

WXT references: [browser startup/manual profiles](https://wxt.dev/guide/essentials/config/browser-startup), [content-script lifecycle](https://wxt.dev/guide/essentials/content-scripts).

## Design preview

The [Paper & Sage component preview](http://127.0.0.1:3937/preview/paper-sage.html) uses disposable in-memory sample vocabulary and simulated lookup states. It renders the same UI components as the extension without accessing browser vocabulary. Use it to compare light/dark, empty/loading/error and reading/list states. It is not an installed-extension or live dictionary check. The preview files are outside extension entrypoints and are not shipped in production output.
