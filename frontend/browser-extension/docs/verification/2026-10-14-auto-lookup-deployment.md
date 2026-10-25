# Automatic lookup and Tencent deployment — 2026-10-14

Executed on macOS arm64 using Node 22.22.3 locally and the existing authenticated Tencent OrcaTerm connection to `lhins-g5atn8ei` (Beijing). The host reports Node 22.23.2. The user's final product direction is automatic selection lookup, without a visible API address or login requirement. Optional account synchronization is separate.

## Final implemented behavior

The popup opens directly to vocabulary. The former top connection panel and API-address input were removed. Optional **More options → Account & sync** retains explicit GitHub login/copy/enable controls, using a product origin defined in `config/backend.ts`; it never displays the URL. Normal word lookup requires no login and sends no account credentials. It does not copy, switch or upload vocabulary.

The extension's local WordNet/IPA assets remain usable. Online misses use `/api/v1/public/lookup/dictionary`; Chinese uses `/api/v1/public/lookup/translation`. Public routes validate a single English word and Chinese target, reject context/URL/provider parameters, enforce exact origin checking and 30 requests/minute per IP, and create no users/sessions/vocabulary rows. Provider concurrency/cache/body limits remain bounded. The authenticated lookup routes are retained for native clients, and vocabulary/account APIs still require authentication.

Server English lookup now reads the same checked-in licensed WordNet shards first, then Free Dictionary API for uncovered words. Chinese prefers isolated Hermes, with server-side MyMemory fallback for timeout/busy/upstream error. Profile-isolation failures remain explicit. MyMemory has a four-second provider deadline after the twelve-second Hermes budget; browser transport/service allows twenty seconds and the UI twenty-two seconds. WordNet attribution is **Dictionary · WordNet**, avoiding an offline-only claim for server results. Legacy snapshots/JSON remain compatible.

## Local checks

| Executed check | Observed result |
| --- | --- |
| Backend `npm run typecheck` | Pass |
| Backend `npm test` | 49 tests in 9 files passed |
| Extension `npm run compile` | Pass |
| Extension `npm test` | 238 tests in 29 files passed |
| Final affected extension tests: translation, popup, account settings | 18 passed; no initial connection panel/API input; legacy cache retained; optional login uses internal address |
| Final backend public lookup/runtime tests | 12 passed; CORS/IP limits, protected accounts and real WordNet assets |
| Backend `npm run test:browser` | Pass; actual anonymous extension lookup client/services through real loopback HTTP, synthetic providers, no direct provider network |
| Backend `npm run package:deploy` and `npm run test:release` | Pass; license/assets packaged, extracted startup/capabilities/auth boundary and disposable WAL backup/restore |
| Extension final `npm run zip` | Pass |
| Existing `npm run local:status` | Pass; development assets reachable, no second watcher or reinstallation |
| `git diff --check` | Pass |

The fixture Paper & Sage preview was inspected in Chrome for light/dark vocabulary layouts. It uses synthetic words and does not touch installed vocabulary; this is component visual verification, not installed-client acceptance.

## Host preflight findings and corrections

The first candidate archive `44b2b737a600b9381e89dbbf963113f7c378f4c4fcb1878f14007d711b986211` was staged only, never activated. Live Hermes translated synthetic in about 7.21 seconds, but Free Dictionary API timed out. Certificate-validated checks against both published IPv4 addresses (172.67.153.59 and 104.21.3.60) also timed out. MyMemory responded HTTP 200 in about 2.47 seconds, exceeding the former 1.8-second budget. The revised candidate adds server WordNet and uses a four-second MyMemory deadline.

Final candidate preflight used a disposable database and synthetic session. Real authenticated Hermes passed in about 5.96 seconds. Server WordNet returned two meanings for synthetic; anonymous translation succeeded without login. A forced upstream error in that disposable runtime then exercised actual MyMemory fallback, returning Chinese text and `source: mymemory`. The script ignores production database/OAuth settings and prints no credentials.

## Activated deployment and recovery

Active runtime: `/opt/rememberme/releases/20261014-4c2222236a8a/runtime`.
Archive SHA-256: `4c2222236a8ab67f9ab0d92f584706f4fc2d1f436540fd5637fa26975f0a6780`.
The uploaded archive digest matched on the host.

A consistent verified backup was created before activation at `/var/lib/rememberme/backups/pre-auto-lookup-20261014-2112.sqlite`. The former private configuration remains `/etc/rememberme/api.env.pre-auto-lookup-20261014-2112`. The previous runtime `/opt/rememberme/releases/20261014-80bfe7fb0c9d/runtime` is retained. The release pointer changed atomically and only the API service restarted. Production data was not replaced; users/sessions/vocabulary/encounter counts remained unchanged by anonymous acceptance. Other services and Caddy/DNS/firewall configuration were retained.

The installed Chrome popup accessibility state exposed extension ID `blmbjchnpodecheenfmajdjfpmgimdcj`. Its exact origin and derived `identity.getRedirectURL('auth/callback')` allowlist entry were appended while retaining existing entries/settings. `/etc/rememberme/api.env` remains root-owned mode 0600. No credentials were generated or rotated.

Server-local, certificate-validated checks of the running release passed:

| Check | Result |
| --- | --- |
| Health/capabilities | 200; dictionary, translation and publicLookup enabled |
| Anonymous dictionary with exact extension origin | 200, `source: wordnet`, expected CORS header |
| Anonymous translation | 200, actual `source: hermes` |
| Protected account `/me` without token | 401 |
| Exact installed extension CORS preflight | 204 |
| Different extension origin | 403 |
| Exact optional GitHub extension callback | 302 to github.com |
| Existing OAuth configuration script | Pass: PKCE, exact callback, secure cookie and protected API using in-memory fixtures |
| API, Hermes, Caddy, lesson-ledger service status | All active |

Chrome ZIP: `frontend/browser-extension/.output/remember-me-0.1.0-chrome.zip`.
Final ZIP SHA-256: `3d669fe497b28e64640419bd32c4faed97b09aeb11db7d624eb6367374ace12e`.

## Remaining external blockers and acceptance

The initial Mac HTTP check redirected to Tencent's filing-block page. After deployment, Mac HTTP returned an empty response (curl exit 52) and HTTPS still reset during TLS (exit 35). Server-local trusted HTTPS succeeds; it does not establish public access.

The refreshed Tencent filing console shows Tencent review passed, submitted to the communications authority, **SMS verification unverified**, and a notice that SMS delivery is delayed. The user said no SMS had arrived. The console asks the user to verify all 12381 messages within 24 hours of receipt; authority review follows. No duplicate filing, identity changes or workaround to evade the filing block was attempted.

The actual installed popup login attempt before the UI correction failed with “Authorization page could not be loaded.” No real OAuth exchange completed, and no account vocabulary was copied/uploaded. Browser automation later rejected direct navigation to the extension's internal `chrome-extension:` page. Its policy forbids alternate-surface workarounds; component preview/testing was used instead. Latest installed popup visuals and public anonymous selection lookup remain unaccepted until the user can inspect the updated extension and public service is available. No reinstallation or real-vocabulary fixture tests were performed.

Uncovered English words still depend on the Free Dictionary provider, whose Tencent egress remained unavailable. Native clients accept MyMemory source but retain their pre-existing fifteen-second timing/cache policies; a twelve-second Hermes timeout plus slow fallback can exceed native timing. Those native changes remain separate work.

Screenshots are saved as standalone task artifacts: `deployed.jpg`, `callback-ready.jpg` and `vocabulary-preview.jpg` under this chat's visualization directory. The vocabulary preview uses disposable fixture data; deployment screenshots show server acceptance, not public acceptance.
