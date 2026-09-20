# Remember Me browser extension

Select an English word to look up its definition and record when you forget it. The toolbar popup provides vocabulary history, sorting, deletion, count reset and JSON backup/import. The extension uses WXT, Vue 3 and TypeScript.

Vocabulary is stored in the browser's local extension storage. Dictionary lookups send the selected word to the external Free Dictionary API. Saved contexts and full source URLs are included in exports; there is no cloud vocabulary sync.

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
npm test               # Automated tests with mocked browser APIs
npm run test:watch      # Watch affected tests during development
npm run compile        # TypeScript and Vue checks
```

Choose the checks needed for a change using [testing.md](docs/testing.md). Unit/component test success does not establish installed-extension or native-menu compatibility.

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
- Hot reload does not update: reload the extension or restart the development command.
