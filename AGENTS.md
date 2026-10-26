# Working in Remember Me

## Personal Cloudflare account

- Before external account operations, read `/Users/guojian/Workspace/naijoug/AGENTS.md`. This also applies to worktrees and temporary checkouts originating here.
- Cloudflare must use verified `naijoug@outlook.com`; never use `guojian@hoxigames.com` or account `83d5b273d7ceb2b02a9f454f67ac495b` for deployment.
- Use `backend/scripts/cloudflare.mjs` for gateway/Pages deployment. It explicitly reads the shared workspace token from `/Users/guojian/Workspace/naijoug/.cloudflare/credentials.env` and verifies email, active membership and explicit account ID. Do not bypass it with raw Wrangler, inherited credentials or a global login.
- Read `backend/docs/cloudflare-account-migration.md` before migration work. Zero VPC IDs intentionally block gateway deployment until personal resources are verified; historical company IDs are inventory, not deployment targets.

- The browser package is `frontend/browser-extension/` (WXT, Vue 3, TypeScript). Run extension npm commands there. The unified Node/SQLite API has its own package/lockfile under `backend/`; use its README, `.nvmrc` and package commands for backend work. Native Apple clients use Xcode / SwiftPM under `frontend/apple/`; see its README and `docs/testing.md`. The repository root has no Node package.
- Use the package's `.nvmrc` and `npm ci`. Keep `package.json` and `package-lock.json` in sync when changing dependencies or runtime requirements.
- Edit source files, not generated `.wxt/`, `.output/`, or `node_modules/` directories. `frontend/designs/` contains reference prototypes, not the extension runtime.

## Read what the task needs

- Setup, browser loading and packaging: `frontend/browser-extension/README.md`.
- Product behavior and unresolved specification differences: `frontend/browser-extension/docs/behavior.md`.
- Storage, messaging and data boundaries: `frontend/browser-extension/docs/architecture.md`.
- Verification scope and browser checklist: `frontend/browser-extension/docs/testing.md`.
- `frontend/browser-extension/docs/archive/` is historical context, not a current checklist or proof that tests passed.

## Project constraints

- Preserve existing vocabulary and JSON import/export compatibility. A count reset retains history, so count need not equal history length.
- Treat imported data and webpage text as untrusted text. Highlight with text nodes; only HTTP(S) history URLs are navigable.
- Vocabulary is stored locally. Packaged English dictionary hits stay local; Chinese translation requests and online English fallbacks send the selected word to external APIs. Do not describe the extension as fully offline or exports as free of sensitive data.
- Keep user-facing deletion confirmation. That product requirement does not require approval for editing code or disposable test fixtures.
- Distinguish observed implementation from intended behavior. Record unresolved differences instead of silently treating either code or an old plan as the product decision.

## Finish and verify

- Continue authorized local edits and checks through completion. Current automated tests use disposable mocks with no production access; fix failures caused by the change and rerun affected checks without repeated approval.
- Match verification to the change using the extension's verification guide above. Do not run every browser or add tests for prose-only edits. Expand checks when shared contracts change or failures justify it.
- This checkout supports automatic local Chrome feedback via `npm run local:start` / `local:status` (see `docs/local-feedback.md` in the extension). When an already-running local service is in use, let it rebuild source edits and check for build errors; do not edit generated output, reinstall the extension, or start a second watcher. Do not claim the browser loaded an update solely because the build succeeded.
- Finish when the requested scope is implemented, relevant checks pass, and affected current docs are updated. Report what changed, what was tested and any unverified behavior; do not claim a browser check from a mocked test.
- Follow explicit user scope over repository workflow preferences. Use existing authorization for external actions; prepare a reviewable result before asking for missing authorization. Never substitute real vocabulary for test fixtures.

## Documentation and code discrepancies

- When repository documentation conflicts with the existing code, follow the conventions in the code. Explicit changes requested by the user take precedence.
- In the final response, report every documentation/code discrepancy found during the task individually, including the documentation location, corresponding code location, specific difference, and how it was handled. Report only verified differences; do not claim unchecked areas are consistent.
