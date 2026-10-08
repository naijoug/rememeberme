# Backend

This directory is reserved for future backend services.

No backend runtime is defined yet. Keep backend-specific code, configuration, tests, and documentation under this directory when that work starts.

The current vocabulary store and request handlers run inside the browser extension's background runtime in `frontend/browser-extension/`; that runtime is not a server in this directory. Vocabulary is local, and external definition/translation requests go directly from the extension to their providers.

See the [current project architecture](../docs/architecture.md) for implemented boundaries. The [Cloudflare implementation plan](../docs/cloudflare-implementation-plan.md) proposes a Hono Worker, D1, authentication and synchronization; none of those services has been implemented here yet.
