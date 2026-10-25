# Server lookup routing — 2026-10-14

Executed on macOS arm64 with Node 22.22.3 from both package `.nvmrc` files. This record covers the current working-tree lookup changes; concurrent account scope/history-upload changes are retained separately. It is not proof of installed-browser or Tencent hosted acceptance.

## Implemented

- All browser online dictionary/translation requests use authenticated business API routes. No direct Free Dictionary/MyMemory provider URL remains in extension service source.
- English keeps packaged WordNet first. A miss or broken local asset calls `POST /api/v1/lookup/dictionary`; the server calls Free Dictionary API, validates/bounds JSON, applies a six-second deadline, coalesces requests and bounds cache/concurrency.
- Chinese calls `POST /api/v1/lookup/translation`. Server routing prefers isolated Hermes and falls back to MyMemory for busy/timeout/upstream failure. Profile-isolation failures remain explicit; `MYMEMORY_ENABLED=false` keeps Hermes-only operation. Results preserve actual source. Fallback caches expire after one hour so later lookups retry Hermes.
- Anonymous local definitions/IPA and legacy anonymous translation caches remain usable. Uncached online lookups require account connection; lookup alone does not enable vocabulary sync.
- Browser cache namespaces include origin/account; service deadlines prevent late results from being cached. Provider calls exclude page context, URL and vocabulary lists. Existing saved snapshots/JSON formats remain unchanged.
- Account panel defaults to the selected Tencent hostname. A minimal native validator update accepts server-side MyMemory fallback; native English/disconnected Chinese paths remain unchanged.

## Commands and observed results

Used Node 22.22.3 with `npm ci` in `backend/` and `frontend/browser-extension/`. Offline cache attempts lacked package tarballs; normal lockfile installs then succeeded. Package manifests/lockfiles were not changed.

| Command | Result |
| --- | --- |
| Backend `npm run typecheck` | Pass |
| Backend `npm test` | 47 tests, 9 files passed; synthetic providers/real disposable SQLite |
| Extension `npm run compile` | Pass |
| Extension `npm test` | 238 tests, 28 files passed; includes concurrent account tests |
| Backend `npm run package:deploy` | Pass; bundled runtime/deployment archive generated |
| Extension `npm run zip` | Pass; Chrome build/ZIP generated |
| Backend `npm run test:browser` | Pass; actual extension dictionary/translation services → authenticated loopback HTTP → Node/SQLite with synthetic Free Dictionary/Hermes/MyMemory providers. Client network guard permits only business API origin. |
| Backend `npm run test:release` | Pass after updating expected default MyMemory/dictionary capabilities; extracted startup/auth/health, credential-free archive, WAL backup/restore and fresh epochs |
| Swift `swift test --filter 'backendChineseProvider\|backendTranslationUses'` with disposable caches/build output | 4 tests passed, including MyMemory acceptance and unknown-source rejection |
| Extension `npm run local:status` | Final pass: existing watcher running and Chrome development assets reachable; no second watcher started |
| `git diff --check` | Pass |

The release smoke initially expected translation disabled without Hermes. The new default has server-side MyMemory enabled; the expectation was updated and the check rerun successfully. Local watcher health temporarily failed while dependencies rebuilt; final health checks passed. This does not prove Chrome loaded a new extension runtime.

## Reviewable packages

- `backend/.build/rememberme-api.tar.gz`, SHA-256 `9e9aa05c8e8c293a2a885e1073d0a8921b35b00c27fc49c74fae3979634b1edc`.
- `frontend/browser-extension/.output/remember-me-0.1.0-chrome.zip`, SHA-256 `a9df765b9aeb38b183e4e20fcf2011420d7f879f92478f00e07e7002f695a04a`.

## Unverified / blocked

The new server routes/fallback are not uploaded or activated on Tencent. Public `https://rememberme.couplelabs.cn/api/v1/health` returned a TLS connection failure from this Mac (`curl` exit 35) during this run. Earlier deployment inspection established Tencent's domain-filing block; this run did not inspect or change server configuration, filing, OAuth allowlists or production databases.

No installed-extension UI/OAuth/lookup check, actual third-party MyMemory fallback, native hosted fallback or real cross-client sync was performed. Previous live Hermes acceptance is separate evidence in `backend/docs/verification/2026-10-14-tencent-hermes.md`. Upgrade native clients before enabling fallback: older installed native validators reject server MyMemory results. Native persistent translation caches retain their existing seven-day policy; the one-hour fallback policy in this change applies to the server and browser extension.

## Subsequent product correction and deployment

The authenticated-only design and visible API-address panel above were superseded by the user's later requirement for automatic selection lookup. The new version uses public rate-limited word-only routes, hides service configuration, keeps optional sync under More options and is activated on Tencent. See [the final automatic-lookup deployment record](2026-10-14-auto-lookup-deployment.md); this earlier record preserves its executed local checkpoint.
