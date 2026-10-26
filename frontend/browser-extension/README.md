# Remember Me browser extension

## Magpie update (2026-10-24)

Current source supports backend Magpie translation with `zhipu/glm-5.3-flash`
and server-side MyMemory fallback. The new `magpie` source is accepted alongside
legacy `hermes` and `mymemory` snapshots without rewriting saved history.
Extension 0.1.2 uses `public:v3:` translation caches and displays the actual
source. Older installed clients must be updated before consuming Magpie results.
The descriptions and dated acceptance links below retain pre-Magpie context;
use the new deployment record for current host acceptance.

Select an English word to see a Chinese translation and English definitions, and record when you forget it. The toolbar popup provides vocabulary history, sorting, deletion, count reset and JSON backup/import. The extension uses WXT, Vue 3 and TypeScript.

Vocabulary is stored locally in account-partitioned IndexedDB; old `local:words` snapshots and legacy JSON remain retained. Selecting a word automatically uses the built-in service, with no API-address input or login requirement. Packaged WordNet/IPA stay local. Online English lookup uses server WordNet plus Free Dictionary API fallback; Chinese uses server Hermes with MyMemory fallback. Only the selected word is sent. While domain filing is pending, lookup uses an internal temporary HTTPS endpoint; account sync keeps the canonical endpoint. Neither address appears in the UI. Optional **More options → Account & sync** enables GitHub login and explicit account copy/sync; translation never enables vocabulary upload. Exports retain local contexts/source URLs. See [architecture](docs/architecture.md) and [privacy](docs/dictionary.md).

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
npm run zip            # Chrome archive from isolated staging + extracted resource checks
npm run zip:firefox    # Firefox distribution archive
```

For a production build:

- Chrome/Edge: open `chrome://extensions/` or `edge://extensions/`, enable Developer mode, select Load unpacked, and choose this package's `.output/chrome-mv3/`. For a formal ZIP, extract it to a stable installation directory instead. Keep that same directory for updates; do not load the disposable `.output/release-staging/` build directory. The `zip` command deliberately leaves `.output/chrome-mv3/` unchanged to avoid deleting files from an active unpacked installation.
- Firefox: open `about:debugging#/runtime/this-firefox`, select Load Temporary Add-on, and choose this package's `.output/firefox-mv2/manifest.json`.

Development output paths can differ from production paths. Use the path printed by `npm run dev` or `npm run dev:firefox`; do not load stale output from the repository root. Zip commands print the actual artifact name under this package's `.output/`; names include package/version/browser information.

After updating/reloading the extension, reload existing webpages as well. Vocabulary operations now go through the background queue; old content scripts must be replaced to stop using the previous direct-write path.

Use [the browser checklist](docs/testing.md) before claiming a browser target has been verified. Selection and page notifications require pages where the browser permits content scripts. Firefox build support alone does not prove Firefox runtime behavior.

## Documentation and source map

The [project architecture](../../docs/architecture.md) covers repository boundaries and planned applications. The [extension architecture](docs/architecture.md) covers the implemented runtime, message contracts, storage ownership and external data flow.

For store submission, start with the [release preparation guide](docs/release/README.md), including listing copy, privacy policy draft, assets and outstanding publication requirements.

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
- Dictionary timeout or connection failure: packaged words such as `serendipity` should show **Dictionary · WordNet** without reaching the external provider. If these still time out, confirm the latest build is active and includes `dictionary/wordnet/`. Words outside the local index require the online fallback; changing its timeout cannot repair an unavailable network route. See [coverage and recovery](docs/dictionary.md).
- Page connection/notification failure: refresh the source webpage and retry. Local feedback builds also try one targeted script reinjection. If page notifications are unavailable, hover the toolbar icon's `!` badge for the error; `OK` means a save completed despite the missing page notification.
- Hot reload does not update: reload the extension or restart the development command.

## Paper & Sage interface

The popup has a searchable vocabulary list and a dedicated reading view. Import/export live under More options. Use the sun/moon button in the header to switch Light / Dark; open page cards follow the same saved preference. New installations follow the system theme until manually switched. Lookups have bounded waits and retry actions; recording a word does not depend on lookup success.

Light mode uses paper-white and sage; dark mode uses the user's selected Codex-inspired charcoal gray palette. See the [dark palette comparison](http://127.0.0.1:3937/preview/paper-sage.html?compare=codex) for the supplied reference beside the actual components.

The page card has one bookmark-and-count button beside the word. Each click adds one to the count and saves a separate encounter with the selected sentence, click time and source URL. The card stays open for repeated recording. Expand **Records**, then a numbered entry to inspect its context, exact time and full source link; the vocabulary reading view shows the same records. Long contents scroll underneath the header. Use Escape, the close button or a deliberate outside click to dismiss the card.

For UI feedback with disposable data, open the [component preview](http://127.0.0.1:3937/preview/paper-sage.html) while the local service is running. This preview does not read or write your vocabulary. Actual English lookups use the packaged dictionary first; uncached Chinese translations and English fallbacks require a reachable product service; users do not configure its address or sign in.

Phonetic transcriptions appear beneath a word as **🇺🇸 IPA 🔊 / 🇬🇧 IPA 🔊** in the page card and vocabulary reading view. The interface uses small inline SVG US/UK flags, with country labels for screen readers and accent tooltips. IPA comes from a separate packaged dictionary, so supported words such as `trick` have it even when WordNet supplies the definition. Click the small speaker icon beside an accent to play it, or click again to stop. Playback uses matching browser/device voices, preferring local voices; missing voices show system guidance. No encounter is saved by playing audio. See [pronunciation sources, coverage and privacy](docs/dictionary.md#pronunciation).

## Backend connection

Build/deploy the API using [Tencent deployment](../../backend/docs/tencent-deployment.md).
The Chrome release uses a fixed HTTPS lookup gateway backed by a dedicated persistent Cloudflare tunnel to the Tencent API. The service address is internal in `config/backend.ts`; users neither enter nor see it. English WordNet hits stay local; misses and Chinese translation call word-only routes without credentials. The gateway's HTTPS hostname survives connector restarts. `/privacy` hosts the published policy.

The release disables account login/synchronization and its identity/alarms permissions. Existing local vocabulary and retained account/recovery partitions are preserved; release startup selects the anonymous local partition. Hosted OAuth/cross-client sync remains a separate unaccepted feature while canonical-domain filing is pending. The publisher is naijoug, with GitHub Issues support. See [Chrome release materials](docs/release/README.md) and dated verification for actual acceptance results and external store steps.

## 0.1.1 popup/package recovery

The release popup bounds stalled background reads at ten seconds with retry guidance; writes are never retried automatically. Production HTML/JS/CSS are bundled and work without the local feedback server. Release ZIP generation uses an isolated staging directory and fails if any linked resource is missing. [Upgrade acceptance](docs/verification/2026-10-15-011-package-upgrade.md) verifies the old formal ZIP upgraded at the same disposable install path/profile, offline popup reloads, data retention and process restart. This does not claim Chrome Web Store delivery or protection against externally deleting an installation folder.
