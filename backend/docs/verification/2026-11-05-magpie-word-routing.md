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

Deployment acceptance and exact release identifiers will be added after activation.
