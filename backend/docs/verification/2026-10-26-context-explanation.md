# Context explanation local implementation and verification

Date: 2026-10-26 (America/Los_Angeles). Base: `3b090f5` plus retained first-round changes. No deployment, credential change, account operation or new database migration was performed.

## Service and ingress

The separate Magpie explanation adapter sends fixed instructions plus JSON word/context data, with no tools, browser, session or client-selected provider. It validates finished, bounded JSON and assigns provider/version itself. A shared per-Node-runtime capacity gate allows two total Magpie jobs and one explanation at most, so a second explanation cannot occupy the ordinary-word slot. Existing word budgets/fallback/cache behavior remain tested.

The feature is off unless `CONTEXT_EXPLANATION_ENABLED=true` with Magpie configured. Public capabilities expose only enabled/schema/version/bounds. Explanation has an independent six/minute/IP limit under the existing public budget, a 15-second model budget and an 18-second API deadline. It has no retry, MyMemory fallback or server-side result cache. Request logging keeps static metadata, not source/generated text.

Client, gateway, bridge and API accept only the new fixed explanation POST and capability GET in addition to their previous routes. Ordinary word ingress stays at 2048 bytes, explanation POST at 16384 bytes, capability GET has no body. Context is additionally limited to 1000 UTF-16 units; no context is added to legacy word routes. The bridge now reads bounded response chunks instead of buffering an unchecked complete response.

## Executed checks

| Check | Result |
| --- | --- |
| Full Node backend suite | 16 files / 87 tests passed |
| Final explanation/bridge/gateway/Magpie recheck | 5 files / 24 tests passed |
| Node TypeScript check and bundled build | Passed |
| Lookup gateway TypeScript check | Passed |
| Shared TypeScript contract fixture runner | Passed |
| JSON Schema meta-validation and fixtures | Passed, including new request/response/capability/error fixtures |
| Real loopback HTTP → bridge → API | Passed with synthetic model response and disposable test database |

Node 22.22.3; locked installation in `/private/tmp/rememberme-round2-workspace/backend` used npm 11.21.0 as in repository CI. Bundled npm 10 initially rejected the existing peer-dependency lock layout; using CI's npm version resolved it without changing package manifests/locks. JSON Schema used jsonschema 4.25.1 in a disposable virtual environment; the system Python initially lacked that optional module.

Tests cover default-off and configuration rejection; exact request/response fields; UTF-16 surrogate, JSON-escape and byte limits; finished output, malformed/truncated/tool-call/oversize responses; stuck headers/bodies, cancellation and capacity release; shared word/explanation admission; origin, old-route exclusion, GET/OPTIONS policies, live disable, static logging and no vocabulary/account writes. The HTTP test sends a valid 1000-Chinese-character sentence (over the old 2 KiB ceiling), also checks escaped control text and surrogate pairs without truncation, proves the larger payloads pass only the new route, verifies >16 KiB rejection, and keeps private account routes inaccessible through the bridge.

The Worker keeps existing bindings and configuration. Current Cloudflare request/best-practice references and published Workers types were inspected; installed project types were used for the actual gateway check. References: [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/), [Request API](https://developers.cloudflare.com/workers/runtime-apis/request/). No raw Wrangler deployment or account login was used.

## Remaining rollout gates

All provider responses in this run were synthetic. The 1536-token explanation cap and prompt need live quality/completion/latency checks against the configured model; no such quality or cost result is claimed. Upstream retention and whether cancellation stops provider processing/billing are unverified. Normal word routes intentionally retain existing server-side coalescing after an abandoned first HTTP attempt.

The two privacy HTML assets were rendered locally from the updated source. They were not republished. Personal Cloudflare identity/resource verification, ingress readiness, public capability/POST acceptance and actual published policy remain required before enabling the new capability. Existing production word lookup was not changed or re-probed by this task. See the [implementation plan](../../../docs/read-frog-adoption-plan.md) and [extension evidence](../../../frontend/browser-extension/docs/verification/2026-10-26-context-explanation.md).
