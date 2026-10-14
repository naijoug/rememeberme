# Remember Me

Remember Me currently runs as a browser extension for looking up English words and keeping a local vocabulary encounter history. The repository separates frontend clients, backend services and project documentation.

## Structure

```text
rememberme/
├── docs/       # Current architecture and future implementation plans
├── frontend/   # Frontend clients
│   ├── browser-extension/  # WXT / Vue 3 / TypeScript
│   ├── apple/              # Native macOS/iOS implementation foundation
│   └── designs/            # Static design references
└── backend/    # Node/Hono/SQLite API for Tencent Lighthouse
```

The browser extension lives in `frontend/browser-extension/`. It contains its own dependencies, tests, configuration and generated output. Native macOS/iOS targets and shared Swift packages exist under `frontend/apple/`, with local features and explicit account ownership/sync controls; complete release acceptance remains in progress. The unified API under `backend/` now runs Node/SQLite on Tencent Lighthouse with verified live isolated Hermes translation and configured GitHub login credentials. Both clients have authenticated translation and explicit account sync paths. Public access is blocked by Tencent domain filing; exact extension callbacks and installed Mac/browser acceptance remain pending. The full website remains planned.

See the [project architecture](docs/architecture.md) for runtime/data flows, directory responsibilities and the boundary between implemented features and plans. Extension vocabulary uses account-partitioned IndexedDB while retaining the old local storage snapshot; native clients retain their independent Core Data store. Cloud upload requires explicit account copy/import and sync enablement. In the extension, packaged English hits stay local, while connected Chinese lookups go through the authenticated backend to private Hermes; disconnected Chinese lookups use MyMemory. Online English fallbacks send the selected word to the dictionary provider.

## Browser Extension Commands

Run extension commands from `frontend/browser-extension/`:

```bash
cd frontend/browser-extension
nvm install
nvm use
npm ci
npm test
npm run compile
npm run build
npm run dev
```

The repository root intentionally does not contain a Node package manifest or workspace manifest. The browser extension and backend have separate Node package boundaries; root-level Node dependencies and utilities are not required. Use this package's `.nvmrc` and lockfile. Load build output from the package's `.output/`, not any legacy root output. Native packages use their own SwiftPM manifests.

## Frontend

See [frontend/README.md](frontend/README.md) for frontend layout, and [frontend/browser-extension/README.md](frontend/browser-extension/README.md) for browser extension setup, loading instructions, and release commands.

## Working on the Project

[AGENTS.md](AGENTS.md) contains concise project boundaries and task-specific documentation pointers. Read the extension's [behavior](frontend/browser-extension/docs/behavior.md), [architecture](frontend/browser-extension/docs/architecture.md), or [verification guide](frontend/browser-extension/docs/testing.md) when the task needs them. Previous specifications and implementation reports are kept in the [historical archive](frontend/browser-extension/docs/archive/README.md).

The [Cloudflare implementation plan](docs/cloudflare-implementation-plan.md) describes the planned website, backend, vocabulary migration, synchronization and review reminders. See [backend setup and evidence](backend/README.md) for the local API, isolated tests and remaining hosted/native integration. The extension commands and its independent package remain unchanged.

The [macOS and iOS implementation plan](docs/apple-clients-implementation-plan.md) tracks native client implementation. See the [Apple README](frontend/apple/README.md) for Xcode/SwiftPM commands, implemented local foundations and remaining work; builds and domain tests do not establish full first-release acceptance.
