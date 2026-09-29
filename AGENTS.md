# Working in Remember Me

- The runnable package is `frontend/browser-extension/` (WXT, Vue 3, TypeScript). Run npm commands there. The repository root has no Node package; `backend/` is reserved for future services.
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
- Vocabulary is stored locally, but dictionary lookups send the selected word to an external API. Do not describe the extension as fully offline or exports as free of sensitive data.
- Keep user-facing deletion confirmation. That product requirement does not require approval for editing code or disposable test fixtures.
- Distinguish observed implementation from intended behavior. Record unresolved differences instead of silently treating either code or an old plan as the product decision.

## Finish and verify

- Continue authorized local edits and checks through completion. Current automated tests use disposable mocks with no production access; fix failures caused by the change and rerun affected checks without repeated approval.
- Match verification to the change using the extension's verification guide above. Do not run every browser or add tests for prose-only edits. Expand checks when shared contracts change or failures justify it.
- This checkout supports automatic local Chrome feedback via `npm run local:start` / `local:status` (see `docs/local-feedback.md` in the extension). When an already-running local service is in use, let it rebuild source edits and check for build errors; do not edit generated output, reinstall the extension, or start a second watcher. Do not claim the browser loaded an update solely because the build succeeded.
- Finish when the requested scope is implemented, relevant checks pass, and affected current docs are updated. Report what changed, what was tested and any unverified behavior; do not claim a browser check from a mocked test.
- Follow explicit user scope over repository workflow preferences. Use existing authorization for external actions; prepare a reviewable result before asking for missing authorization. Never substitute real vocabulary for test fixtures.
