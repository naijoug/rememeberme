# Remember Me browser extension

Select an English word to see a Chinese translation and English definitions, and record when you forget it. The toolbar popup provides vocabulary history, sorting, deletion, count reset and JSON backup/import. The extension uses WXT, Vue 3 and TypeScript.

Vocabulary is stored in the browser's local extension storage. Chinese translations use MyMemory without an API key; uncached words are sent to that external service. English definitions first use packaged WordNet; missing words fall back to Free Dictionary API. The two results load independently, so a failed provider does not hide a successful result. Saved contexts and full source URLs are included in exports; there is no cloud vocabulary sync. See [sources, limits and privacy](docs/dictionary.md).

## Setup

Run these commands from the repository root:

```sh
cd frontend/browser-extension
nvm install
nvm use
npm ci
```

The package uses Node 22 (minimum 22.12.0); `.nvmrc` pins the tested development version, 22.22.3. If you use another Node manager, select that version before `npm ci`. Use npm and the committed `package-lock.json`. Installation runs `wxt prepare` to generate `.wxt/` types. The repository root has no Node package.

## Develop and verify

Run subsequent commands from this package directory:

```sh
npm run dev             # Chrome development, with reload support
npm run dev:firefox     # Firefox development
npm run local:start     # macOS background auto-updates for your everyday Chrome
npm run local:status    # Show local service state and paths
npm run local:stop      # Stop local updates and disable login startup
npm run dev:local       # Foreground alternative; don't run beside local:start
npm test               # Automated tests with mocked browser APIs
npm run test:watch      # Watch affected tests during development
npm run compile        # TypeScript and Vue checks
```

Choose the checks needed for a change using [testing.md](docs/testing.md). Unit/component test success does not establish installed-extension or native-menu compatibility.

For ongoing usage and feedback, follow [automatic local updates](docs/local-feedback.md): load `.output/chrome-mv3-feedback/` once as **Remember Me · Local**, then keep the local service running. Subsequent source edits update that build without reinstalling or refreshing all your tabs. This is a separate extension identity; the guide explains transferring existing vocabulary once.

## Build, load and package

```sh
npm run build          # Chrome/Edge MV3
npm run build:firefox  # Firefox MV2
npm run zip            # Chrome distribution archive
npm run zip:firefox    # Firefox distribution archive
```

For a production build:

- Chrome/Edge: open `chrome://extensions/` or `edge://extensions/`, enable Developer mode, select Load unpacked, and choose this package's `.output/chrome-mv3/`.
- Firefox: open `about:debugging#/runtime/this-firefox`, select Load Temporary Add-on, and choose this package's `.output/firefox-mv2/manifest.json`.

Development output paths can differ from production paths. Use the path printed by `npm run dev` or `npm run dev:firefox`; do not load stale output from the repository root. Zip commands print the actual artifact name under this package's `.output/`; names include package/version/browser information.

After updating/reloading the extension, reload existing webpages as well. Vocabulary operations now go through the background queue; old content scripts must be replaced to stop using the previous direct-write path.

Use [the browser checklist](docs/testing.md) before claiming a browser target has been verified. Selection and page notifications require pages where the browser permits content scripts. Firefox build support alone does not prove Firefox runtime behavior.

## Documentation and source map

| Task | Start here |
| --- | --- |
| Product behavior and original-specification gaps | [Behavior](docs/behavior.md) |
| Messaging, storage, import compatibility or privacy | [Architecture](docs/architecture.md) |
| Tests and browser verification | [Testing](docs/testing.md) |
| Historical implementation context | [Archive](docs/archive/README.md) |
| Content selection / page card | [content.ts](entrypoints/content.ts), [SelectionPopup.vue](components/SelectionPopup.vue) |
| Dictionary messages / context menu | [background.ts](entrypoints/background.ts), [services](services/) |
| Vocabulary popup | [App.vue](entrypoints/popup/App.vue), [components](components/) |
| Data types and permissions | [types/index.ts](types/index.ts), [wxt.config.ts](wxt.config.ts) |

Generated `.wxt/` and `.output/` directories are disposable. Static reference designs live outside this package under `frontend/designs/`.

## Troubleshooting

- Missing generated types: run `npm ci` to prepare the package, then retry the type check.
- Development server conflict: inspect the address/port in the actual WXT output and resolve the conflicting process or configure the dev server.
- Extension does not load: build the intended target, select its package-local output, and inspect browser extension errors.
- Selection does not work: verify the extension is enabled, the page allows content scripts, and the dictionary request is reachable. Browser-internal pages are restricted.
- Do not test selection on `chrome://extensions/` or another browser-internal page. Use a normal webpage. The extension's error page contains past errors; displaying one there does not mean that page was where it originated.
- Dictionary timeout or connection failure: packaged words such as `serendipity` should show **Offline dictionary · WordNet** without reaching the external provider. If these still time out, confirm the latest build is active and includes `dictionary/wordnet/`. Words outside the local index require the online fallback; changing its timeout cannot repair an unavailable network route. See [coverage and recovery](docs/dictionary.md).
- Page connection/notification failure: refresh the source webpage and retry. Local feedback builds also try one targeted script reinjection. If page notifications are unavailable, hover the toolbar icon's `!` badge for the error; `OK` means a save completed despite the missing page notification.
- Hot reload does not update: reload the extension or restart the development command.

## Paper & Sage interface

The popup now has a searchable vocabulary list and a dedicated reading view. Import/export live under More options. Use the sun/moon button in the header to switch Light / Dark; open page cards follow the same saved preference. New installations follow the system theme until manually switched. Lookups have bounded waits and retry actions, and Forget becomes available once a translation or English definition is ready.

Light mode uses paper-white and sage; dark mode uses the user's selected Codex-inspired charcoal gray palette. See the [dark palette comparison](http://127.0.0.1:3937/preview/paper-sage.html?compare=codex) for the supplied reference beside the actual components.

The page card keeps Remember / Forget beside the word while long definitions scroll underneath. Page scrolling and text/scrollbar drags do not dismiss it; use Escape, the close button, Remember or a deliberate outside click to close it.

For UI feedback with disposable data, open the [component preview](http://127.0.0.1:3937/preview/paper-sage.html) while the local service is running. This preview does not read or write your vocabulary. Actual English lookups use the packaged dictionary first; Chinese translations and English fallbacks require their external services.
