# Context explanation production release

Date: 2026-10-27 (America/Los_Angeles). Source base: `ac76a61` plus retained first/second-round work and the user-requested translator-group changes. The user explicitly authorized release acceptance, fixes, deployment and enabling sentence explanation.

## Result

Sentence explanation is enabled on the verified personal lookup origin:

- API/policy origin: `https://rememberme-lookup.couplelabs.workers.dev`.
- Public capability: `/api/v1/public/lookup/capabilities`, verified `enabled: true` through the exact extension ZIP in Chrome.
- Privacy policy: `/privacy`, HTTP 200, byte-identical to the effective 0.1.5 source asset at publication.
- Runtime: `/opt/rememberme/releases/20261027-context-fac9579f94d8/runtime`.
- Model setting remains `group/translator`; no group membership/routing policy was changed.
- Release archive SHA-256: `fac9579f94d86cfa7ce541148aee80aee9b19a0a57b28301b51c120ae49d217d`.
- Final Worker version: `2fcd1a40-4e08-44cc-8f3a-f5dbf03db164`.

The normal word path, account origin and existing database remain in place. No new database migration was added, no DNS/domain cutover was performed and no old-company resources were read or modified. This is a new personal lookup ingress; it does not claim the earlier account/domain migration is complete.

## Account and resource verification

The project wrapper verified `naijoug@outlook.com`, accepted membership and account `5c11819c6fdb08421e6d58084e37f028` before writes. Personal inventory initially contained no Remember Me tunnel, Pages project or VPC service. Provisioning used the same explicit credential source and verification functions; gateway deployments used `scripts/cloudflare.mjs`, including its VPC ownership check.

The new connector uses a private token file and a separate `rememberme-personal-lookup-tunnel.service`. The tunnel's public ingress defaults to 404. Its HTTP VPC service is restricted to `127.0.0.1:8788`; the lookup bridge still excludes account/auth routes. Original connectors remain available for rollback. The temporary local/remote transfer copies of the new tunnel token were removed; the persistent server credential remains root-owned mode 0600.

[Personal resource receipt](assets/2026-10-27-pr7/personal-resources.json) records the tunnel/VPC IDs. The account gateway's zero VPC placeholder remains intentionally blocked. Workers/Pages account policy was not weakened or bypassed.

## Model and retention acceptance

The initial eight-case live probe passed six sense-disambiguation cases and a long repeated sentence, but the instruction-like source case returned EXPLANATION_INVALID_RESPONSE. The malformed output was rejected; its raw vendor response was not retained, so the precise invalid field/format is not claimed.

The explainer now requests `response_format: { type: "json_object" }` and gives an explicit three-field example while keeping source text as untrusted data. Strict field/length/finish-reason/tool-call checks remain. The ordinary word translator was not changed by this fix.

The same eight-case probe then passed, with observed durations 1,779–5,203 ms. Finance/river bank, fee/accusation charge and publish/problem issue meanings were manually checked in the synthetic report. Instruction-like source text did not alter the output contract, and the long context returned a bounded explanation. These are small acceptance samples, not a general accuracy or availability benchmark.

- [Initial synthetic report](assets/2026-10-27-pr7/live-context-initial.json).
- [Passing synthetic report](assets/2026-10-27-pr7/live-context-final.json).

The probe instantiated the candidate with a disposable SQLite database; users, sessions, vocabulary and encounter tables stayed empty. No production vocabulary was used or written.

Read-only Magpie configuration/process checks found an empty OTLP configuration, no OTEL environment settings, no enabled request-archive setting and no request-archive directory. Inspected usage records contained model/token/timing/status metadata fields, not prompt or response fields. The release policy explicitly discloses local metadata and upstream-provider retention; it does not promise zero retention or that cancellation stops billing. Shared Magpie settings were not changed.

Primary references: [Magpie privacy/archiving](https://usemagpie.ai/docs/privacy), [Magpie integration](https://usemagpie.ai/docs/integrate), [DeepSeek JSON output](https://api-docs.deepseek.com/guides/json_mode/), [GLM structured output](https://docs.bigmodel.cn/cn/guide/capabilities/struct-output). Vendor terms are not replaced by this local inspection.

## Deployment and rollback

SSH verified `ubuntu` on `VM-0-9-ubuntu` using the dedicated host-key-checked configuration. Server Node is 22.23.2. Before activation, the candidate archive checksum/member paths and every migration's bytes were checked. A consistent SQLite backup passed integrity/foreign-key checks. Environment and bridge backups were retained privately on the host.

1. Staged and live-tested the candidate without changing the active API.
2. Deployed the personal Worker and verified HTTPS health.
3. Activated the candidate API/updated bridge with explanation explicitly false.
4. Verified the public capability false and an exact-ZIP Chrome POST rejected with EXPLANATION_DISABLED.
5. Published and verified the effective 0.1.5 policy on the personal origin.
6. Enabled only CONTEXT_EXPLANATION_ENABLED, restarted the API, and checked the local capability.
7. Ran actual public finance/river explanations from the exact 0.1.5 ZIP, including first-use cancel, source-field restrictions, consent revoke and unchanged empty local vocabulary/export.

The activation script retained the current database on rollback and automatically restored old runtime/config/bridge if initial health checks failed. No rollback was needed. [Deployment receipt](assets/2026-10-27-pr7/deployment.json) records exact paths.

To disable only the feature, restore the private before-enable config listed in the receipt and restart `rememberme-api`; verify public capabilities are false. For a complete runtime rollback, restore the recorded configuration/bridge backup and previous runtime symlink, restart the API/bridge, and check health/ordinary lookup. Preserve the live database: migrations were unchanged and a rollback must not replace newly written user data with an older backup.

The effective policy asset was deployed to the new personal Worker. The account-entry HTML source was updated locally but was not published to its historical account.

## Validation and limits

- Fresh isolated installs using Node 22.22.3 and repository lockfiles; backend npm 11.21.0 matches CI.
- Full backend suite: 87 passed; JSON-mode affected suite: 10 passed.
- Backend types/build and lookup-gateway types passed; Cloudflare guard suite passed (10 checks).
- Full extension release suite: 331 passed; final ShadowRoot UI subset: 39 passed; compile and exact ZIP integrity passed.
- Public off/on and live exact-ZIP Chrome acceptance passed. See [browser release evidence](../../../frontend/browser-extension/docs/verification/2026-10-27-release.md).

Some curl/Node administrative reads encountered transient TLS/connection failures. No TLS verification, DNS, proxy or trust settings were weakened. A bounded retry succeeded for capability reads; Chrome performed the authoritative off/on and live UI checks. The first policy redeploy stopped at identity verification before any write; the same guarded command then succeeded.

Native candidate/accessibility evidence is separate. Physical iPhone signing requires a clearly authorized team; matching developer identity metadata was found under a company team, not assumed to be a personal-team grant. Native installer distribution and actual VoiceOver speech are not inferred from browser/model success.
