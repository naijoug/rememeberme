# Translator routing group — 2026-10-27

The user requested the Magpie `group/translator` routing group shown in their
screenshot. Local Node runtime defaults (word translation and the optional
sentence explainer), deployment example, live diagnostic expectation, existing
Magpie tests and current product/privacy source documentation now reference the
group. Explicit `MAGPIE_MODEL` overrides still work. Provider selection belongs
to Magpie; no group membership or routing policy was edited. Dated deployment
records retain the model used at their original acceptance.

## Verification

- Used repository Node 22.22.3 and `npm ci` with the existing offline cache.
- Backend `npm run typecheck`: passed.
- `npm test -- tests/magpie.test.ts tests/context-explanation.test.ts`: 16 passed.
  The existing runtime test now checks that omitted model configuration sends
  `group/translator` in the actual mocked Chat Completions body.
- SSH used the dedicated personal host key configuration; the login identity
  was `ubuntu` and host was `VM-0-9-ubuntu`.
- The live Magpie `/v1/models` response advertised exact ID `group/translator`.
- The existing deployed `MagpieTranslator` was instantiated with the requested
  group and translated the synthetic fixture word `synthetic` successfully:
  valid Chinese, `source: magpie`, 2,585 ms. It used no vocabulary database.
  This checks the group with the existing eight-second deadline, low reasoning,
  512-token budget and JSON validation; it is not browser or failover acceptance.

## Activation completed

After the initial automatic approval rejection, the user explicitly authorized
proceeding without a backup and restarting. The only live configuration change was
`MAGPIE_MODEL=zhipu/glm-5.3-flash` → `MAGPIE_MODEL=group/translator` in
`/etc/rememberme/api.env`. The atomic replacement retained root ownership and
mode 0600. No backup file was created. Only `rememberme-api` was restarted;
the host was not rebooted.

Post-restart verification passed:

- `rememberme-api` reported `active`.
- Loopback `/health` returned HTTP 200.
- The running API's `/api/v1/public/lookup/translation` returned valid Chinese
  for synthetic fixture word `synthetic`, target `zh-CN`, `source: magpie`,
  in 1,901 ms. No vocabulary records were written by this lookup.
- The runtime remains
  `/opt/rememberme/releases/20261025-sessions-a5fe92f8a903/runtime`.
  No new application release or unrelated local feature work was deployed.

The production runtime continues using its explicit environment model setting;
its older bundled fallback default was not redeployed. The local source fallback
now uses the routing group for future releases. No browser acceptance was run.

Privacy source assets describe routing through multiple model providers (including
GLM and DeepSeek). These source changes have not been published to Cloudflare.
Existing client translation caches may continue returning earlier successful
translations until expiry; no client data or cache was cleared.
