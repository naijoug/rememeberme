# Automatic local updates in your everyday Chrome

The local feedback build watches this checkout and updates the unpacked extension whenever source changes are successfully rebuilt. It uses WXT's development server and a dedicated output directory, `.output/chrome-mv3-feedback/`. Normal release builds keep their existing paths.

## Start the service

From `frontend/browser-extension/`, using the Node version in `.nvmrc` and installed dependencies:

```sh
npm run local:start    # macOS: start in the background and at login
npm run local:status   # registration, process state, output directory and log path
npm run local:stop     # stop and remove login startup; retain browser vocabulary
```

The macOS helper creates a checkout-specific LaunchAgent in `~/Library/LaunchAgents/`, using the absolute Node and checkout paths. Logs live in this package's ignored `.local-feedback/service.log`. If Node or the checkout moves, run stop/start again. Stop the service before removing the checkout. A registered service is not proof of a healthy build: inspect the printed log for the latest successful output.

For a foreground session (including other operating systems), use `npm run dev:local` and keep the terminal running. Do not run it alongside the background service: both use `127.0.0.1:3937`. The listener is loopback-only.

## Load once in Chrome

1. Open `chrome://extensions/` yourself and enable Developer mode.
2. Choose **Load unpacked**, then this checkout's `frontend/browser-extension/.output/chrome-mv3-feedback/` directory. On macOS, use **Cmd+Shift+G** in the folder picker to paste its absolute path, since `.output` is hidden.
3. Confirm **Remember Me · Local** appears and pin it if desired. Keep the same directory loaded for subsequent updates.

This directory gives Chrome a separate extension identity from the release build. If the old extension has vocabulary, export it first and import it into the local build once. Imports add counts/history, so do not repeatedly import the same backup. Retain the old extension until the transfer is verified, and keep only one Remember Me variant enabled to avoid duplicate selection UI. Do not delete or overwrite browser profile files to transfer data.

Browser automation may block `chrome://extensions/`; the initial loading step is then manual. The local service cannot confirm installation by itself.

## What updates automatically

- Popup Vue changes use WXT/Vite updates. Background changes reload the extension.
- Content changes register the new scripts and reinject them into eligible open tabs. The local mode replaces WXT's default whole-tab refresh, preserving page input and scroll position. Old content contexts remove their listeners, popup, notifications and pending timers to avoid duplicate saves.
- New eligible pages use the latest registered script. Browser-internal/restricted pages remain unsupported; pages that close or reject injection during an update can be refreshed manually.
- After the development server restarts, the local update client reconnects and reloads the extension to restore its WXT connection.
- The current WXT 0.20 leading-only debounce can skip the last rapid save; feedback mode disables that debounce and retains WXT's serialized build queue.

Keep the service running while using this build: its popup loads development assets from localhost. Source errors must be fixed before a new build can succeed. This workflow does not mean automated tests run or pass on each save. Run the checks in [testing.md](testing.md) before declaring a change complete.

The feedback build adds WXT's development-only `tabs` and `scripting` permissions and localhost access for updates. Release builds omit the local update connection and retain their original permissions. It does not publish anything or sync vocabulary to a server.

WXT references: [browser startup/manual profiles](https://wxt.dev/guide/essentials/config/browser-startup), [content-script lifecycle](https://wxt.dev/guide/essentials/content-scripts).
