# Remember Me

Remember Me currently runs as a browser extension for looking up English words and keeping a local vocabulary encounter history. The repository separates frontend clients, future backend services and project documentation.

## Structure

```text
rememberme/
├── docs/       # Current architecture and future implementation plans
├── frontend/   # Frontend clients
│   ├── browser-extension/  # WXT / Vue 3 / TypeScript
│   ├── apple/              # Native macOS/iOS implementation foundation
│   └── designs/            # Static design references
└── backend/    # Local Hono/Workers/D1 API package
```

The browser extension lives in `frontend/browser-extension/`. It contains its own dependencies, tests, configuration and generated output. Native macOS/iOS targets and shared Swift packages exist under `frontend/apple/`, with local features and explicit account ownership/sync controls; complete release acceptance remains in progress. The unified API under `backend/` is not deployed; real Swift/HTTP-to-local-Worker integration passes with separate synthetic device processes, while hosted Mac/iPhone acceptance remains unfinished. The extension has no cloud sender. The full website remains planned.

See the [project architecture](docs/architecture.md) for runtime/data flows, directory responsibilities and the boundary between implemented features and plans. Extension vocabulary stays in extension local storage; native clients use an independent local store. In the extension, packaged English hits stay local, while Chinese translations and online English fallbacks send the selected word to external providers.

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

The repository root intentionally does not contain a Node package manifest or workspace manifest. The Node package boundary is the browser extension; root-level Node dependencies and utilities are not required. Use this package's `.nvmrc` and lockfile. Load build output from the package's `.output/`, not any legacy root output. Native packages use their own SwiftPM manifests.

## Frontend

See [frontend/README.md](frontend/README.md) for frontend layout, and [frontend/browser-extension/README.md](frontend/browser-extension/README.md) for browser extension setup, loading instructions, and release commands.

## Working on the Project

[AGENTS.md](AGENTS.md) contains concise project boundaries and task-specific documentation pointers. Read the extension's [behavior](frontend/browser-extension/docs/behavior.md), [architecture](frontend/browser-extension/docs/architecture.md), or [verification guide](frontend/browser-extension/docs/testing.md) when the task needs them. Previous specifications and implementation reports are kept in the [historical archive](frontend/browser-extension/docs/archive/README.md).

The [Cloudflare implementation plan](docs/cloudflare-implementation-plan.md) describes the planned website, backend, vocabulary migration, synchronization and review reminders. See [backend setup and evidence](backend/README.md) for the local API, isolated tests and remaining hosted/native integration. The extension commands and its independent package remain unchanged.

The [macOS and iOS implementation plan](docs/apple-clients-implementation-plan.md) tracks native client implementation. See the [Apple README](frontend/apple/README.md) for Xcode/SwiftPM commands, implemented local foundations and remaining work; builds and domain tests do not establish full first-release acceptance.
