# Remember Me

Remember Me currently runs as a browser extension for looking up English words and keeping a local vocabulary encounter history. The repository separates frontend clients, future backend services and project documentation.

## Structure

```text
rememberme/
├── docs/       # Current architecture and future implementation plans
├── frontend/   # Frontend clients
│   ├── browser-extension/  # Only runnable package: WXT / Vue 3 / TypeScript
│   └── designs/            # Static design references
└── backend/    # Reserved for future backend services
```

The current browser extension lives in `frontend/browser-extension/`. It contains its own dependencies, tests, configuration and generated output. The backend has no runtime yet. Website, cloud sync, mobile and desktop clients are planned or potential additions, not implemented applications.

See the [project architecture](docs/architecture.md) for runtime/data flows, directory responsibilities and the boundary between implemented features and plans. Vocabulary stays in browser extension local storage; packaged English hits stay local, while Chinese translations and online English fallbacks send the selected word to external providers.

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

The repository root intentionally does not contain a Node package manifest or workspace manifest. The current package boundary is the browser extension; root-level dependencies and utilities are not required. Use this package's `.nvmrc` and lockfile. Load build output from the package's `.output/`, not any legacy root output.

## Frontend

See [frontend/README.md](frontend/README.md) for frontend layout, and [frontend/browser-extension/README.md](frontend/browser-extension/README.md) for browser extension setup, loading instructions, and release commands.

## Working on the Project

[AGENTS.md](AGENTS.md) contains concise project boundaries and task-specific documentation pointers. Read the extension's [behavior](frontend/browser-extension/docs/behavior.md), [architecture](frontend/browser-extension/docs/architecture.md), or [verification guide](frontend/browser-extension/docs/testing.md) when the task needs them. Previous specifications and implementation reports are kept in the [historical archive](frontend/browser-extension/docs/archive/README.md).

The [Cloudflare implementation plan](docs/cloudflare-implementation-plan.md) describes the planned website, backend, vocabulary migration, synchronization and review reminders. These features are planned; the current runtime and commands above remain unchanged until implementation.
