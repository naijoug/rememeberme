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
npm test
npm run compile
npm run build
npm run dev
```

The repository root intentionally does not contain a Node package manifest. The current package boundary is the browser extension.

## Frontend

See [frontend/README.md](frontend/README.md) for frontend layout, and [frontend/browser-extension/README.md](frontend/browser-extension/README.md) for browser extension setup, loading instructions, and release commands.
