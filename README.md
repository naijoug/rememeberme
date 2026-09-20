# Remember Me

Remember Me is organized as a multi-surface product workspace.

## Structure

```text
rememberme/
├── frontend/   # Frontend clients
│   └── browser-extension/  # Current WXT/Vue browser extension
└── backend/    # Reserved for future backend services
```

The current browser extension lives in `frontend/browser-extension/`. Future mobile and desktop clients should be added as sibling directories under `frontend/`.

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

The repository root intentionally does not contain a Node package manifest. The current package boundary is the browser extension.

## Frontend

See [frontend/README.md](frontend/README.md) for frontend layout, and [frontend/browser-extension/README.md](frontend/browser-extension/README.md) for browser extension setup, loading instructions, and release commands.

## Working on the Project

[AGENTS.md](AGENTS.md) contains concise project boundaries and task-specific documentation pointers. Read the extension's [behavior](frontend/browser-extension/docs/behavior.md), [architecture](frontend/browser-extension/docs/architecture.md), or [verification guide](frontend/browser-extension/docs/testing.md) when the task needs them. Previous specifications and implementation reports are kept in the [historical archive](frontend/browser-extension/docs/archive/README.md).
