# Temporary internal lookup endpoint — 2026-10-14

The user requested working selection lookup before filing finishes, with the address hidden inside the plugin. The existing canonical service/other HTTPS hostname both failed from the Mac. A temporary Cloudflare Quick Tunnel now reaches only the existing word-lookup API through a dedicated loopback bridge. Account/OAuth/sync configuration remains canonical.

## Implemented and deployed

- `config/backend.ts` separates temporary `LOOKUP_SERVICE_ORIGIN` from canonical account `SERVICE_ORIGIN`. Neither is displayed in the vocabulary UI or accepted as user input. The real public-lookup client uses the temporary origin, with no account credentials/cookies.
- `scripts/lookup-bridge.mjs` listens on loopback 8788. It only forwards exact public dictionary/translation POST or OPTIONS and health GET. Account/auth/vocabulary paths and query variants return 404. It strips auth/cookies/client XFF, validates edge CF-Connecting-IP, limits bodies to 2 KiB and concurrent requests to eight, and does not hold database/provider credentials.
- `rememberme-lookup-bridge` and `rememberme-lookup-tunnel` are enabled/active under the dedicated rememberme user. The connector uses HTTP/2 and `/opt/rememberme/temporary/cloudflared`; existing API/Hermes services/release remain active. No canonical DNS/proxy/firewall/OAuth or production vocabulary was changed.
- Current origin: `https://door-resumes-partly-repairs.trycloudflare.com`, recorded in internal config and `/etc/rememberme/temporary-lookup-origin`. It is not a secret or a UI field.

The official Cloudflare Debian package digest was verified against the official package index, then the extracted binary matched the official GitHub release digest. Version 2026.10.0; package SHA-256 `9721287c28f78cb623e77c7b95a63feea87e909054d75666a0ec9eff20e5d548`; binary SHA-256 `d33ff2d14475178d2012c2c56beba87389ac5ded27649519f198a7d3134a99db`. The initial GitHub asset download was slow on Tencent and failed TLS from the Mac. Cloudflare's official compressed package index/CDN worked, without changing certificate validation or adding a system repository.

## Actual checks

Local Node runtime: 22.22.3. The existing host runtime remains 22.23.2.

| Executed check | Result |
| --- | --- |
| Disposable real-HTTP bridge tests | 2 passed: route exclusions, omitted credentials, trusted IP, body limit, generic upstream errors |
| Extension compile | Pass |
| Affected public lookup/translation/account/popup tests | 19 passed |
| Extension build/ZIP | Pass |
| Public Mac health | 200, about 3.37 s |
| Public Mac dictionary synthetic | 200, WordNet, about 2.66 s |
| Public Mac translation synthetic | 200, real Hermes Chinese text, about 2.39 s; server success cache may be reused |
| Public account `/me` and login-start paths | 404, not forwarded |
| Public lookup with extra context parameter | 400 |
| Expected CORS for exact installed extension | Pass on dictionary/translation |
| Actual installed Chrome ephemeral selection | Pass: Chinese Hermes translation, English WordNet definition/example and packaged IPA shown |

Chrome test page: `http://127.0.0.1:3937/test-selection.html`. Double-clicked the synthetic fixture word ephemeral, waited for the real card, and scrolled its body to verify English/WordNet attribution, then returned to Chinese and closed with Escape. No save/counter/reset/import/account-login action was performed; the card's count stayed zero. This is installed-extension/live-network acceptance, not a mocked preview. The request contains only the word/target; fixture sentence and URL remain excluded from the lookup request.

Screenshot: `temporary-lookup-chrome.jpg` under this chat's visualization directory. It shows the actual page and Hermes card, with no service address or login prompt. The earlier browser policy rejection of internal extension-page navigation was respected; this check uses ordinary allowed HTTP webpage selection, not internal extension navigation.

Chrome ZIP SHA-256: `9f9da75528c027e6931891dd88ee12d7406e05f8b6152f9877b1a91340d0d3ca`. Installed local feedback build updated the lookup code successfully, evidenced by the actual Hermes selection check. Release ZIP installation in a separate browser profile was not performed.

## Lifecycle and remaining limits

[Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) are temporary with no uptime guarantee. The hostname changes if the connector process is recreated. Systemd manages the process and network reconnections, but a process restart/reboot requires updating the internal lookup address and rebuilding/verifying the extension. The recorded origin file does not auto-discover a new hostname.

After the canonical service becomes publicly reachable, set only `LOOKUP_SERVICE_ORIGIN` back to the canonical origin, build, verify actual selection and stop/disable the two temporary units. Optional account synchronization stays canonical and still awaits filing; the temporary bridge intentionally cannot log in or sync. Uncovered English words still depend on Free Dictionary API, whose separate Tencent egress limitation is unchanged. Remote MyMemory fallback passed earlier host acceptance; this turn's actual installed-card source was Hermes.
