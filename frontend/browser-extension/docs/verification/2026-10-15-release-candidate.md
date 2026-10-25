# Fixed lookup entry and Chrome 0.1.0 candidate acceptance

Executed 2026-10-15 Asia/Shanghai on macOS arm64, Node 22.22.3, Chrome for Testing 151.0.7922.34. Working tree based on `39302c7`; existing API/native-client work was retained. This record concerns the Chrome word-lookup/local-vocabulary release, not store approval or hosted account sync.

## Outcome

Fixed trusted HTTPS lookup, real Hermes translation, Free Dictionary egress, internal-only service configuration, patched dependencies, production ZIP acceptance and public privacy/store materials are implemented. Publisher name naijoug and the public GitHub Issues support channel were explicitly approved. The canonical account domain remains filing-blocked; public Chrome account/login/sync is gated off while its stored partitions are retained.

## Infrastructure and live checks

- A dedicated DNSPod CNAME was added for the lookup custom domain; existing app/canonical records were retained. Cloudflare confirmed the domain and certificate active. The actual policy page opened over trusted HTTPS both in everyday Chrome and via the candidate's Privacy & support menu.
- Pages forwards in-process through a Worker service binding; a named QUIC tunnel/VPC Service restricts origin access to the loopback lookup bridge on 8788. The API and isolated Hermes remain loopback-only. Connector credentials use root-only storage/systemd LoadCredential, excluded from packages and output.
- Source `backend/lookup-gateway/index.ts` validates exact word-only JSON, allows syntactically valid Chrome origins across install identities, rejects website origins/private routes, limits IP request rates/body size and strips credentials/cookies. No vocabulary, context or source URL is forwarded.
- The initial Cloudflare redirect-error mode caused 503. Runtime classification identified it; final code uses manual mode and rejects redirects. Gateway tests require that supported mode. Temporary internal-error diagnostics were removed; application logs contain only static whitelisted fault codes.
- Fixed public health returned `{"apiVersion":1,"status":"ok"}` / 200. Real `serendipity` Chinese returned source Hermes. A direct server API request for `serendipity` returned Free Dictionary definitions/source `dictionary-api`. Tencent's direct provider egress had timed out; public English misses now try the Cloudflare edge first.
- Dedicated bridge/tunnel restart retained the hostname. Subsequent formal and native Chrome translation succeeded. The old random Quick Tunnel was disabled; fixed public health still returned 200 afterward. Local transfer-token file was removed.
- Some terminal requests experienced intermittent TLS/network timeout or 403; default workers.dev/pages.dev were not accepted as client endpoints. Browser custom-domain policy/translation and final fixed health passed. This session is not continuous uptime/load or all-network coverage. Workers VPC remains beta and has no SLA claimed here.

## Dependency/build results

`npm ci` completed with the package-pinned Node version. Frontend and backend audit results each have **0 vulnerabilities at every severity**, including development dependencies. Vue 3.5.44, WXT 0.21.4/module-vue 1.0.3, Vite 6.4.4, Vitest 4.1.11 and happy-dom 21.0.1 resolve the browser's previous advisory chain. Package/lockfile agree.

WXT metadata discovery uses Vue/CSS stubs only in its inline metadata importer. Real extension builds retain the normal Vue/CSS pipeline. Strict TypeScript is retained, with prior unchecked-index behavior explicit; stronger unchecked-index enforcement is not claimed.

Executed results:

| Check | Result |
| --- | --- |
| `npm test` in browser package | 29 files / 239 tests passed |
| `npm run compile` | Passed |
| `npm run zip` | Production Chrome ZIP built |
| `npm test -- tests/lookup-gateway.test.ts` in backend | 4 tests passed |
| `tsc -p lookup-gateway/tsconfig.json` | Passed |
| Frontend/backend dependency audits | 0 / 0 |
| Existing `npm run local:status` | Running; development assets reachable, reused existing watcher |
| ZIP inventory/security scan | 345 files; only storage/contextMenus; fixed origin; no quick-tunnel/dev endpoint, secret/config/log or sourcemap files |
| `git diff --check` | Passed |

The initial direct Vitest command selected the legacy Cloudflare pool and was blocked by sandbox loopback/log permissions. The supported Node package test command then passed. A frontend test retained the old temporary hostname; its expected fixed endpoint was updated, then the full suite passed. These were corrected failures, not counted as passes.

## Exact formal ZIP browser acceptance

`scripts/release-smoke.cjs` extracted the actual ZIP into a temporary directory and launched a clean test-owned Chrome profile. It never attached to the user's Chrome or used real vocabulary. A test-owned DevTools session read the closed shadow DOM; production encapsulation was unchanged. Results: [release-acceptance.json](../release/assets/release-acceptance.json).

Passed: real no-login Hermes Chinese plus packaged English/IPA; no exposed API/login controls; selection alone saves nothing; two intentional counter clicks retain count 2 and two sentence/time/URL histories; closing/reselecting another word does not save it; popup reset retains history; deletion cancel/confirm; JSON export/import; invalid import rejection; reload and real process-restart persistence; legacy chrome.storage migration retaining fractional count, original snapshot and literal HTML/non-HTTP source; count reset after migration retains history. Live requests contained only selected word/target; no direct client provider requests were observed.

The export comparison initially included UI metadata that the legacy JSON contract deliberately omits. The test was corrected to compare durable fields. A stale history selector was removed to match the current visible Records layout. The final script passed, and current runtime screenshots were generated from real live results rather than intercepted translation fixtures.

## Native menu and toolbar acceptance

`scripts/release-native.cjs` loaded the same extracted ZIP in a separate headed, disposable profile. Actual native UI actions selected serendipity, opened Chrome's right-click menu, clicked Remember Me, opened the real toolbar extension popup and its menu, and clicked Privacy & support. The notification and toolbar showed one saved word/count 1; a test-owned popup read verified exactly one history. Results: [native-acceptance.json](../release/assets/native-acceptance.json); [native toolbar screenshot](../release/assets/native-toolbar.jpg).

The first desktop attachment stalled, so that test window timed out without a pass record. A second attempt exposed an unsupported self-message from the service worker in the verifier; it was corrected to send from a test-owned extension page. The final native run and postcondition assertions passed. Extra empty Chrome for Testing windows opened by the desktop tool were closed; test profiles were disposed.

Observed UI limit: a card already open when the native context-menu action saves keeps its previous counter until refreshed/reopened. The save notification and toolbar reflect the committed count; no duplicate save was observed. This pre-existing cross-surface refresh behavior is recorded rather than inferred fixed.

## Candidate and materials

ZIP: `frontend/browser-extension/.output/remember-me-0.1.0-chrome.zip`, 8.4 MB.

SHA-256: `5471f37ee884f68976852c05e12ef0b2398177974e4f7d196d3db5a555a1b29a`.

[Store listing](../release/store-listing.md) includes single purpose, actual storage/contextMenus/site-access justifications, website-content/connection disclosure, no remote code, reviewer instructions and approved public support identity. [Policy](../release/privacy-policy.md) describes word-only online processing, providers, caches, local contexts/URLs/backups, recovery retention and speech synthesis. Published policy HTML is rendered from that source and served with a no-script CSP.

The release includes no account slot, identity/alarms grant, background sender or CLOUD_* account actions. Startup reads the anonymous local partition even with old development credentials/account selection present, preserving the old account and its recovery data. That condition has a dedicated regression.

## Boundaries

Chrome Web Store submission/certifications and review are not performed. Firefox, full hosted OAuth/cross-client sync, continuous uptime/load, audible voice/accent quality, all restricted/file-page behavior, large-store quotas and off-host production restore are not claimed by this candidate. Existing source and backup compatibility remain covered by unit/browser fixtures. The current scope can proceed as a Chrome lookup/local-vocabulary candidate with the network/beta and cross-surface refresh limitations disclosed.
