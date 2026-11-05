# Magpie word routing and selected-model diagnostics — 2026-11-05

## Scope

The user requested actual-model logging, fast-route A/B tests, preserving
`group/translator`, avoiding changes to sentence explanation, then testing,
committing, pushing and deployment. Unrelated browser typing-practice edits are
outside this change. The checkout remains on its original `main` branch.

## Actual selected-model evidence

Installed Magpie is 0.1.3018. A fixture request's JSON body reported
`model: group/translator`, while `X-Magpie-Model` reported
`zhipu/glm-5.3-flash` and `X-Magpie-Provider` reported `zhipu`. A separately
correlated `/v1/magpie/route?session=...` trace confirmed the same selected member.
The response alias must therefore not be treated as the upstream model.

The adapter now sends an opaque UUID-based `X-Magpie-Session` per inference and
emits one structured `word_translation` event with call ID, requested model,
selected model/provider, header/complete timing, outcome and bounded error code.
It never logs the word, sentence, response text, account labels or credentials.
The HTTP translation response and saved vocabulary/export shape are unchanged.

Successful requests read the selection from response headers without another
network call. A failure without headers can resolve its attempted model from an
independent trace read, bounded to 250 ms and 16 KiB. This diagnostic never delays
the lookup response. Invalid, absent or uncorrelated metadata is explicitly
unknown. Cache hits, local capacity rejection and open-circuit rejection make no
new inference and consequently have no new upstream-selection event.

Primary references: [integration](https://usemagpie.ai/docs/integrate),
[selected-model headers and route traces](https://github.com/yetone/magpie/blob/main/docs/reference.md).

## Candidate experiment

All requests ran sequentially on the personal server through the existing
Magpie gateway, using the exact word prompt, low reasoning, 512-token ceiling,
non-streamed JSON and the production three-second primary budget. Candidate
order rotated for each fixture. Each sample used a fresh adapter, so application
result caches and the adapter's circuit did not suppress an arm. Vendor prompt
caching, provider queueing and gateway cooldowns are not controlled.

Fixtures: bank, charge, issue, stalactite, meticulous, tamarind, resilient and
benchmark. Every result received JSON/finish-reason/tool/length/Hanzi validation
and a small expected-meaning check. The fixture translations are retained for
review; these checks are not a general semantic-quality evaluation.

| Route | Valid / meaning checks | Median ms | Maximum observed ms | Selected model |
| --- | --- | ---: | ---: | --- |
| Existing group/translator | 8/8 | 1,639 | 2,726 | zhipu/glm-5.3-flash |
| DeepSeek directly through Magpie | 8/8 | 1,290.5 | 1,821 | deepseek/deepseek-flash |
| Zhipu directly through Magpie | 8/8 | 1,604 | 2,489 | zhipu/glm-5.3-flash |

The DeepSeek candidate's median was 21.3% lower than the existing group in this
small run. The direct Zhipu result suggests that nesting overhead alone was not
the main cost during these samples; the selected provider/model matters.

## Full group A/B

A separate `group/rememberme-word-ab-20261105` was created with DeepSeek Flash
first and Zhipu GLM Flash second, using ordered routing. The live translator group
was unchanged throughout the A/B run.

| Group | Valid / meaning checks | Observed median ms | Maximum / cutoff ms |
| --- | --- | ---: | ---: |
| Existing group/translator | 6/8 | 1,848.5 | 3,004 (timeout) |
| Candidate fast group | 8/8 | 1,359 | 2,256 |

The old group timed out on bank and meticulous. Their asynchronous traces still
identified Zhipu GLM Flash. The candidate selected DeepSeek Flash in all eight
calls and completed within the existing deadline. Its observed median was 26.5%
lower, counting timed-out attempts at their cutoff. Considering only successful
old-group calls gives 1,629 ms versus 1,359 ms (16.6% lower). No p95 or load-test
claim follows from eight samples per arm.

The chosen word policy is DeepSeek Flash first, Zhipu GLM Flash second, still
addressed as `group/translator`. Gateway errors can fail over within the existing
three-second whole-primary budget; a stalled first member does not receive an
additional unbounded backup budget. The existing MyMemory fallback and circuit
remain unchanged.

- [Candidate measurements](assets/2026-11-05-magpie-word-routing/candidates.json)
- [Full group A/B measurements](assets/2026-11-05-magpie-word-routing/group-ab.json)
- [Desired non-secret routing policy](../../deploy/word-translation-routing.json)

Runner: `scripts/benchmark-magpie-routing.mjs RUNTIME PRIVATE_ENV_FILE candidates`.
For a separate group comparison, use `trial group/TRIAL_ID`; `group-check` tests
the production alias. The runner is explicit live-provider work, not part of the
mocked test suite, and never opens an application database.

## Sentence-explanation isolation and rollback preparation

The existing outer translator policy was copied to
`group/rememberme-context-20261105` using Magpie's supported CLI. Its members,
order and rules match the original, excluding only ID/name. Inner groups and
providers were not changed. Magpie's CLI added a root `groupOrder` display list;
the verification distinguishes this display metadata from provider configuration.

`MAGPIE_CONTEXT_MODEL` now independently selects the explainer's model group. If
empty, it preserves the previous `MAGPIE_MODEL` fallback. Production activation
must explicitly select the preserved explanation group before changing the word
group. Explanation prompts, JSON mode, token/time limits, consent/capability
gates, shared capacity and response schema are unchanged.

Private backups of the gateway configuration, original translator group and API
environment were retained under `/etc/rememberme/routing-backup-20261105/` before
creating the groups. No credentials are included in this report or release.

## Validation and documentation

Regressions cover actual headers versus aliases, malformed/mismatched route
metadata, secret/input omission, logging exceptions, correlated failure traces,
bounded unavailable/stalled diagnostics, and independent versus legacy explanation
configuration. The existing word/circuit and sentence-explanation tests remain.

The final backend suite passed **99 tests in 17 files** using Node 22.22.3.
TypeScript, build, script syntax and diff checks passed. The exact packaged
archive passed isolated startup/auth-boundary and disposable WAL backup/restore
acceptance. No frontend source or dependency change was required.

Verified documentation differences handled:

1. `backend/README.md` said explanation always shared `MAGPIE_MODEL`;
   `backend/src/node-runtime.ts` now prefers `MAGPIE_CONTEXT_MODEL`. Updated the
   current guidance and the environment example, retaining backward compatibility.
2. `contracts/api-v1.md` described no session field; the model prompt remains
   stateless, while `backend/src/magpie.ts` now sends an opaque gateway-only
   correlation header. Clarified that distinction without changing the public API.
3. `scripts/verify-live-context-explanation.mjs` copied/reported only
   `MAGPIE_MODEL`. It now carries and reports the separate context setting, so
   live acceptance actually exercises the preserved explanation route.

## Deployment acceptance

Implementation commit `8b3ca3fd4e8756c7a6d6c1237eb212713889c22a` was pushed to
`naijoug/rememeberme` before activation. GitHub identity was verified as `naijoug`.
SSH verified `ubuntu` on `VM-0-9-ubuntu` using the dedicated strict host-key config.

- Active runtime: `/opt/rememberme/releases/20261105-routing-8b3ca3f-4f083178/runtime`.
- Previous runtime retained: `/opt/rememberme/releases/20261104-translation-db61a6e-0fc87366/runtime`.
- Archive SHA-256: `4f08317876a0fb3bdd1fb55294217059b559f3d07326e31915effb5402b957df`.
- Verified SQLite backup: `/var/lib/rememberme/backups/pre-word-routing-20261105-8b3ca3f.sqlite`.
- Private configuration/group backups: `/etc/rememberme/routing-backup-20261105/`.
- Activation completed at 2026-11-05T13:32:01Z (05:32:01 America/Los_Angeles).

All seven migrations were byte-identical to the active release. Before switching,
the candidate ran eight synthetic explanation cases with the preserved group and
a disposable database: all passed, including finance/river bank, charge/issue
sense differences, instruction-like text and a long sentence. No fixture account
or vocabulary records were created.

Activation appended only `MAGPIE_CONTEXT_MODEL=group/rememberme-context-20261105`
to the private API environment, switched the runtime atomically and restarted
only `rememberme-api`. The running process's word/context settings were verified.
A live finance explanation passed before changing `translator`. Only then was
the word group switched to the tested member order, and the same explanation
passed again. Original nested groups, provider credentials/settings, account and
database configuration remained unchanged. Neighboring service states and PIDs,
including Magpie itself, did not change. No Cloudflare deployment was needed.

Post-activation, the actual `group/translator` alias passed **8/8** fixture checks,
selected `deepseek/deepseek-flash` every time, had a **1,300.5 ms median**, and a
1,581 ms maximum. These are fresh adapter calls through the gateway, not browser
or public-network timings. The temporary A/B group was then removed; the two
production groups and provider settings were verified unchanged by cleanup.

| Public fixture via the current HTTP client | End-to-end ms | Attempts | Source |
| --- | ---: | ---: | --- |
| brisk | 2,544 | 1 | magpie |
| equator | 1,949 | 1 | magpie |
| meadow | 1,654 | 1 | magpie |

All public samples returned valid Chinese. Production journal entries for this
acceptance window recorded `requestedModel: group/translator`,
`selectedModel: deepseek/deepseek-flash`, `selectedProvider: deepseek`,
`routeSource: response-header`, and success. Their primary durations were
1,098 / 1,226 / 940 ms. No selected word or sentence appeared in those structured
model events. The gateway does not forward the backend's request-ID header, so
the public probe's `requestIds` are null; model traces use the opaque `callId`
instead and are not claimed to be joined to public HTTP IDs.

- [Deployment receipt](assets/2026-11-05-magpie-word-routing/deployment.json)
- [Preserved explanation acceptance](assets/2026-11-05-magpie-word-routing/context-preflight.json)
- [Production alias checks](assets/2026-11-05-magpie-word-routing/production-group.json)
- [Public HTTP samples](assets/2026-11-05-magpie-word-routing/public-after.json)

## Rollback

Restore the original translator member order from the private group backup
**before** rolling back the API runtime, since the previous runtime does not know
the separate context setting. Restore the previous runtime pointer and private
environment, restart only `rememberme-api`, and check health and explanation.
Retain the current production database; no schema changed and restoring a backup
would discard newer user data. The activation script had this rollback order
built in; no rollback was needed.

The current group is optimized for the tested short word prompt, not proven
globally fastest. Provider availability and load can change. Sentence-explanation
policy, prompt and limits are preserved, not a promise of identical generated
text or identical latency on every future request. No installed-browser timing
claim is made by these server/public-client checks.
