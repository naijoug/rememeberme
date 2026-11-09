# Extension architecture and data boundaries

## Local typing practice (0.1.7)

`entrypoints/practice/main.ts` mounts `components/practice/PracticeApp.vue` as
`practice.html`. `practice-source.ts` projects identity and saved meanings without
encounter text/URLs. `practice-engine.ts` owns finite turns/scoring. Top-level popup
and practice pages alone may use `PRACTICE_GET` and `PRACTICE_COMMAND`; durable
practice commands are separate from cancellable lookup Ports and website policies.

`CloudVocabulary.practice` uses the existing serialized owner boundary.
`VocabularyDB.update` performs synchronous validation and writes in one strict
IndexedDB transaction. `practice:v1:<owner>` keys in the existing partitions store
hold a versioned session and bounded request-digest receipts. Database version,
vocabulary aggregate schema and old JSON exports remain unchanged.

Existing vocabulary writes use `persist/persistMany` to reconcile practice in the
same commit, including pulls, history merges, operation replies and recovery.
Deletion/conflicts/source changes remove copied questions and attempts. Scope changes
and commits emit `PRACTICE_CHANGED` without vocabulary payloads. Reads/reconnects
revalidate; page read generations reject late notification replies.

Each resumed turn rotates an activation ID (optional on early stored records, whose
turn ID is the fallback). The page compares turn identity/activation/content before
resetting input, so an unrelated source invalidation updates the revision without
interrupting the current answer. Stale-tab revision checks remain mandatory.

Practice records validate nested field types, bounds and references. A corrupt read
returns a blocked repair view; only confirmed clearing may replace it through the
practice API. Vocabulary commits discard invalid optional practice state and advance
any readable revision instead of aborting unrelated vocabulary writes.

The tab retains one unknown-outcome request in sessionStorage until acknowledgment
or explicit recovery. Recovery keeps owner/ID/revision/body and rebinds the backend
boot scope. It never replays into another owner. Receipts contain no submitted
spelling. Commands clone action payloads before retaining/sending them, so caller
mutations cannot alter the frozen recovery body. A damaged repair view cancels an
unreplayable pending request before the user confirms repair. Completed rounds release
meaning snapshots; records are excluded from sync
and vocabulary export. `practice.html` is an explicit release-integrity root from
0.1.6 onward, including transitive assets.

The 0.1.7 interaction uses a focusable input over the rendered word. Copy completion
sends an answer with optional `advance` and aggregate `mistakes`; the backend marks
the next turn started in that same transaction. Old messages/records without these
fields retain their earlier defaults. Corrected typos do not earn first-pass credit.
The current Copy meaning is a presentation projection; durable question fingerprints
and vocabulary snapshots retain their existing format.

`PracticePronunciation` reads packaged IPA directly and speaks only with a local
US device voice. `PracticeMeaning` may read the separate local translation cache;
it never calls a provider, explanation route or vocabulary writer. A 2s nonblocking
cache-display budget leaves the ordinary lookup cache's 150ms budget unchanged.
Spelling prompts do not use this cache. See the [interaction record](verification/2026-11-05-typing-flow.md).

## Magpie update (2026-10-24)

Current source supports backend Magpie translation through the `group/translator` routing group
and server-side MyMemory fallback. The new `magpie` source is accepted alongside
legacy `hermes` and `mymemory` snapshots without rewriting saved history.
Extension 0.1.2 uses `public:v3:` translation caches and displays the actual
source. Older installed clients must be updated before consuming Magpie results.
The descriptions and dated acceptance links below retain pre-Magpie context;
use the new deployment record for current host acceptance.

Use this document for changes to messaging, persistence or external data flow. Setup is in the [package README](../README.md); observable behavior and unresolved requirements are in [behavior.md](behavior.md).

Reviewed against the current working-tree source on 2026-10-14. This source review is not a new browser verification run. See the [project architecture](../../../docs/architecture.md) for repository structure and the separate website/backend plan.

## Package and source boundaries

The extension is an independent runnable package. It uses WXT, Vue 3 and TypeScript, with npm and the package-local lockfile. `.nvmrc` pins Node 22.22.3; `package.json` requires Node `^22.22.3`. There is no repository-root Node package or shared utilities package.

| Directory / configuration | Role |
| --- | --- |
| `entrypoints/` | WXT-discovered background, content script and toolbar popup |
| `components/` | Shared page/popup Vue components; UI emits actions to runtime owners |
| `services/` | Lookup, vocabulary messaging/persistence, context extraction, theme and feedback logic |
| `types/` | Vocabulary, lookup, message and theme contracts |
| `assets/` | Shared Paper & Sage styles and webpage host-positioning CSS |
| `public/` | Packaged icons and WordNet data, notices and licenses |
| `config/`, `scripts/` | Feedback constants, optional local service, explicit WordNet rebuild and release smoke tooling |
| `preview/`, `test-selection.html` | Sample-data component preview and manual selection fixture |
| `tests/`, colocated `*.test.ts` / `*.test.mjs` | Content-entrypoint and service/component/tool checks |
| `docs/` | Current guides, dated verification evidence, release preparation and historical archive |
| `wxt.config.ts` / `wxt.feedback.config.ts` | Release configuration / separate local feedback configuration |
| `vitest.config.ts`, `tsconfig.json` | Mocked automated tests / Vue and TypeScript checks using generated WXT types |

The sibling `frontend/designs/` directory contains static references. Generated `.wxt/`, `.output/` and installed `node_modules/` belong inside this package; root-level legacy outputs are outside the runtime boundary. WordNet files in `public/` are checked-in distributable assets, not disposable build output.

## Runtime ownership

| Source | Responsibility |
| --- | --- |
| [content.ts](../entrypoints/content.ts) | Selection events, definition card, context extraction, save requests, page notifications |
| [background.ts](../entrypoints/background.ts) | Wire lookup/vocabulary listeners, shared services, context-menu lifecycle and optional feedback |
| [background-handler.ts](../services/background-handler.ts) | Validate and dispatch dictionary and vocabulary requests; report completed operations or errors |
| [context-menu-handler.ts](../services/context-menu-handler.ts) | Validate selection, retrieve definition/context, save and notify |
| [context-menu-status.ts](../services/context-menu-status.ts) | Toolbar badge/title fallback when page notifications cannot be delivered |
| [popup/App.vue](../entrypoints/popup/App.vue) | Storage/theme integration, import/export, deletion and reset |
| [VocabularyPanel.vue](../components/VocabularyPanel.vue) | Pure UI: word search/list, reading view, unified settings, themes and confirmation |
| [WordHistory.vue](../components/WordHistory.vue) / [HistoryItem.vue](../components/HistoryItem.vue) | Numbered encounter disclosures with sentence, precise time and safe source link |
| [WordPronunciation.vue](../components/WordPronunciation.vue) | Shared US/UK speech controls, voice discovery, playback lifecycle and literal phonetic text |
| [theme.ts](../services/theme.ts) | Watch/persist System / Light / Dark under local:appearance, separately from vocabulary |
| [storage-client.ts](../services/storage-client.ts) | Content/popup vocabulary client, using background messages only |
| [cloud-vocabulary.ts](../services/cloud-vocabulary.ts), [vocabulary-db.ts](../services/vocabulary-db.ts) | Background vocabulary queue, partitioned IndexedDB and frozen sync outbox |
| [storage.ts](../services/storage.ts) | Shared legacy JSON validator and retained old-store tests |
| [backend-client.ts](../services/backend-client.ts), [CloudConnection.vue](../components/CloudConnection.vue) | Origin-scoped device credentials, PKCE login, refresh and explicit account/sync controls |
| [lookup-client.ts](../services/lookup-client.ts), [lookup-port-handler.ts](../services/lookup-port-handler.ts) | Dedicated cancellable lookup Ports; legacy message compatibility remains in background-handler |
| [dictionary.ts](../services/dictionary.ts) | Local-first lookup, built-in public server fallback, bounded in-memory cache |
| [translation.ts](../services/translation.ts) | Built-in public Magpie/MyMemory routing; persistent success caches |
| [phonetics.ts](../services/phonetics.ts) | Exact-spelling US/UK IPA from packaged shards, bounded reads and memory cache |
| [pinyin-format.ts](../services/pinyin-format.ts) / [TranslationText.vue](../components/TranslationText.vue) | Display numbered Chinese pinyin with tone marks; preserve provider/cache/history/export text and literal rendering |
| [bilingual-lookup.ts](../services/bilingual-lookup.ts) | Combine successful sources for context-menu saves |
| [offline-dictionary.ts](../services/offline-dictionary.ts) | Packaged WordNet shards, bounded local reads and memory cache |
| [word-forms.ts](../services/word-forms.ts) | Regular suffix candidates, accepted only when the matching WordNet part of speech exists |
| [local-feedback.ts](../services/local-feedback.ts) | Local feedback builds only: development-server reconnection and script replacement without reloading tabs |

The backend is a separate Node/SQLite package under `backend/` on Tencent Lighthouse. The configured translation provider is Magpie; public lookup uses the personal Worker and a private tunnel to the loopback bridge. Account-ingress and browser acceptance are recorded separately in dated deployment records, not established by these source descriptions. The extension runtime remains this package; generated `.wxt/` and `.output/` directories are not sources. WXT configuration is in [wxt.config.ts](../wxt.config.ts), and shared data types are in [types/index.ts](../types/index.ts).

Only the background owns vocabulary writes. `CloudVocabulary` serializes account/local mutations and atomically writes the selected partition's entries/outbox in IndexedDB. `local:words` is retained as an upgrade snapshot. Theme and translation caching remain separate. The popup restores the connected account view on mount and reloads after account actions. While visible it polls the selected vocabulary every five seconds, ignoring stale reads and retaining the current array when its content is unchanged. This reflects background downloads without remounting an unchanged list; there is no push-based cross-page vocabulary observer.

The separate [feedback configuration](../wxt.feedback.config.ts) uses a loopback development server and `.output/chrome-mv3-feedback/`. Its script-refresh messages replace WXT's whole-tab reload behavior. Reconnected clients wait for an explicit build-complete signal before reloading, because WXT temporarily removes the output directory during a full build. Server-start hooks re-register the handshake after configuration restarts. Content contexts dispose their DOM, listeners, lookup deadlines and theme subscriptions when a new script replaces them. The page UI uses one reactive Vue app in a closed ShadowRoot with an inline copy of the same token/component stylesheet used by the popup; only host positioning CSS is injected into the webpage. The optional macOS LaunchAgent runs that watcher at login; it is not a backend or vocabulary sync service. See [local-feedback.md](local-feedback.md) for setup and lifecycle limits.

## Messaging

`GET_DEFINITION` and `GET_TRANSLATION` accept a valid single English word and return independent English/Chinese results. The content script starts both, checks the translation shape, renders each as it arrives and ignores stale completions after selection changes. English provider data is validated in the background dictionary path. A successful source stays usable if the other fails. Vocabulary requests are `GET_WORDS`, `GET_WORD`, `SAVE_WORD`, `DELETE_WORD`, `RESET_COUNT`, `IMPORT_DATA` and `EXPORT_DATA`. Responses are `{ success: true, data }` or `{ success: false, error: string }`; operations without a result return `data: null`. Malformed or unsupported messages return failure before accessing storage.

| Request | Successful `data` | Validation / operation |
| --- | --- | --- |
| `GET_DEFINITION` / `GET_TRANSLATION` | `Definition` / `Translation` | Valid single English word; independent provider paths |
| `GET_PHONETICS` | `{ us?: string, uk?: string }` | Valid single English word; exact spelling in packaged IPA; empty object on a miss |
| `GET_WORDS` | `WordEntry[]` | Queued vocabulary read |
| `GET_WORD` | `WordEntry` or `null` | Nonempty word, normalized for lookup |
| `SAVE_WORD` | Updated `WordEntry` | Valid English word, structurally valid definition, text context/URL and optional finite nonnegative timestamp |
| `DELETE_WORD` / `RESET_COUNT` | `null` | Nonempty word; preserve management of older imported words |
| `IMPORT_DATA` | `null` | JSON string; storage validates the complete array before writing |
| `EXPORT_DATA` | JSON string | Queued read serialized as the compatible plain array |

Content and popup vocabulary operations use the storage client, never direct vocabulary storage writes. The background dispatches vocabulary requests to its storage service, which is also used by the context-menu handler. A successful write response is sent only after persistence completes. Messaging failures are surfaced to the caller without retrying or falling back to local writes. A structurally valid definition can have empty `phonetics` and `meanings`; the page counter sends this empty snapshot while lookup is pending or failed. Successful provider lookup is not a prerequisite for that page save. Import validation remains in the storage service.

Background-to-content messages are `EXTRACT_CONTEXT` (returns the current context) and `SHOW_NOTIFICATION` (renders a page notification). These require a reachable content script. They are separate from the dictionary request contract.

Context-menu requests capture a queued writer for the selected partition/generation before page/provider I/O, address the clicked `frameId` and capture context before waiting for the dictionary. The eventual save checks that scope inside the vocabulary queue. Switching away and back, changing account connection or publishing recovery invalidates the writer; the old request reports an error without saving into either partition. Pausing sync alone does not change the target. The local feedback build can reinject its existing content script once into that frame if connection fails, using its existing development permissions. Browser-internal pages are rejected before lookup/injection. Page notifications can fall back to the existing toolbar action/browserAction badge and title; no new manifest permissions are needed, and a notification failure does not cause a storage retry.

## Persistence and compatibility

| Persistent key | Owner | Contents / export |
| --- | --- | --- |
| IndexedDB `rememberme-vocabulary-v2` / `partitions` | Background `cloud-vocabulary.ts` | Anonymous/account entries, durable outbox/checkpoints, private recovery copies |
| `local:words` | Retained old extension snapshot | Not overwritten during migration; selected vocabulary exports stay a plain array |
| `local:backendConnection` | Background `backend-client.ts` | Origin-scoped device access/refresh credentials; excluded from exports |
| IndexedDB `rememberme-translation-cache-v1` | Background `translation-cache.ts` | Up to 10,000 origin/version-scoped word results; indexed eviction and 256-entry memory LRU; excluded from export |
| `local:translationCache` | Retained translation-cache migration source | Current public-v3/plain anonymous entries imported once; retained unchanged for rollback |
| `local:appearance` | Shared `theme.ts`, written by popup | System / Light / Dark preference, excluded from export |

The page reads only its selected word through `GET_WORD`. The counter locks synchronously before sending `SAVE_WORD`, preventing rapid duplicate clicks before Vue renders. A popup session permits one successful save, with the sentence/URL captured at selection and an optional finite, nonnegative `timestamp` captured at click time. Older callers can omit that field and use the background's current time. The returned full `WordEntry` updates the visible count and record list after persistence, replaces the spinner with a solid bookmark and keeps the counter locked. Failures restore manual availability without automatic retry. New selections reset the lock; definition retries retain it. Popup-session versions guard save replies independently of lookup versions, and read/write sequence guards stop stale reads from rolling back confirmed counts.

`WordEntry` contains `word`, `count`, `history`, `createdAt` and `updatedAt`. Each `HistoryRecord` contains `timestamp`, `context`, `url` and a `Definition` snapshot. Account list messages include lifecycle `id`, `currentDefinition` and `countKnown` presentation metadata. They do not change the legacy export shape; account definitions can exist with no encounter history. Later lookup completions update the active page UI, but do not rewrite already saved snapshots. Any future manual-entry or synchronization model must account for this history-based definition ownership.

The host page cannot traverse the closed shadow root through `host.shadowRoot`, which matters now that prior encounter sentences and URLs may be rendered there. The extension keeps its shadow reference privately. Test code captures roots in a disposable fixture; no debug reference is exposed to webpages. This is a DOM encapsulation measure, not a claim of protection from browser developer tools or other privileged extensions.

- IndexedDB `partitions` contains each anonymous/account aggregate and durable queue. WXT local storage retains the original `local:words` array and separate credentials/cache/theme; the current aggregate has no per-word index.
- Words are trimmed and lowercased for saving/importing. Each entry contains its independent count, history, creation time and update time. Timestamps are milliseconds since the Unix epoch.
- Saving increments count and appends history. Reset retains history. Preserve both fields independently when changing data formats.
- Export is a plain JSON array with no version envelope. Existing backups must continue to import unless a requested migration defines compatibility and recovery.
- `Definition.translation` is optional. Chinese-only saved results have an empty English `meanings` array. Imports validate the optional translation object; old records remain valid. Translation caches are separate from vocabulary exports and do not rewrite saved encounter snapshots.
- Import validates entries before writing, merges counts additively and concatenates histories. It does not deduplicate repeated imports. See [storage.test.ts](../services/storage.test.ts) for round-trip and validation coverage.
- The background owns one promise queue for all read/modify/write operations, including context-menu saves, imports, deletes and resets. Reads/exports wait for earlier queued writes. Failed operations reject to their caller without blocking later work. Clients in different tabs share this queue through runtime messaging.
- The current IndexedDB partition holds an aggregate entries/outbox array. Local intent and its queue commit atomically; this is not a bounded-row large-store implementation. A sync operation freezes exact JSON/ID/epoch before network I/O and retries that request after restart. Page mutation replies still must not be retried automatically: a lost reply may follow a successful local commit. Large-vocabulary memory/latency and real browser quota acceptance remain unverified.

## Dictionary and privacy

For English, approved Remember Me assets precede packaged WordNet; remaining misses/local-file failures call public `POST /api/v1/public/lookup/dictionary`. Chinese reads the approved local edition before the online-result cache and public `POST /api/v1/public/lookup/translation`. `config/backend.ts` has separate internal `LOOKUP_SERVICE_ORIGIN` and canonical account `SERVICE_ORIGIN` values; neither is a user input. The lookup origin directly targets the personal `workers.dev` Worker, with a dedicated named tunnel through a VPC Service to the lookup-only loopback bridge. Workers VPC is currently beta; persistence of the hostname is not a provider SLA. The public client omits credentials/cookies and bounds responses. Ordinary queries retain these two routes; the staged explanation contract adds its own POST and a public capability GET, described below. Lookup needs no login and never creates an account, changes sync settings or uploads vocabulary. The backend applies exact CORS and 30 requests/minute per IP; provider concurrency/caches are bounded. The ordinary dictionary/translation routes accept only a selected word and Chinese target, excluding context, URL and lists. Source context is accepted only by the separate opt-in explanation route.

The public gateway tries Free Dictionary API from its edge for client English misses, then recovers through the Tencent server’s identical licensed WordNet shards and server provider fallback. Direct/private API callers retain server-local-first routing. Magpie is the current preferred Chinese provider, with MyMemory fallback for timeout/busy/upstream error. Hermes remains a configured rollback option; profile isolation failures stay explicit. English has an 8.5-second service and ten-second UI budget; local server assets have 1.5 seconds and the remote dictionary six seconds. Chinese has a twenty-second service and twenty-two-second UI budget, allowing three-second Magpie plus four-second MyMemory. Public translation transport uses at most two attempts in 19 seconds, with a nine-second first attempt; dictionary transport has an eight-second budget without retries. Late service results are ignored. English caches hold at most 500 entries/day. Public Chinese cache keys include origin, public:v3 version, target and normalized word. The separate IndexedDB store holds at most 10,000 results and the memory LRU 256. Seven days (Magpie/Hermes/legacy anonymous) and one hour (public MyMemory) are freshness windows; valid stale results can render immediately for up to 30 days, then revalidate through the still-open Port. A failed refresh backs off for one minute. Legacy one-shot calls can reuse stale results without detached requests. Expired rows are pruned on writes; the original WXT cache stays read-only for migration/rollback. Read deadlines and storage errors never disable live lookup. Existing authenticated-account cache entries are not reused as public entries. Stored history/exports are unchanged.

The main popup renders vocabulary directly. Current source sets `ACCOUNT_SYNC_ENABLED=true`, enabling account/sync controls embedded in the unified Settings page, identity/alarms permissions, background sender and extension-page-only CLOUD_* actions. The gear opens Settings directly; appearance, backup actions and privacy/support are available on that same page even when account controls are disabled. Successful GitHub sign-in selects the account and enables sync automatically. Popup restoration activates a connected account if needed; an already selected account retains explicit pause/recovery state. Anonymous device words remain separate until a reviewed copy is confirmed. GitHub sign-in rejects an older backend lacking `refresh-retry-v1` / `refresh-logout-v1`. This source change does not establish hosted OAuth acceptance. “Privacy & support” opens the public policy; raw API URLs are not displayed.

`backendConnection.refreshRequestId` persists the refresh intent before I/O; a restarted background retries the same rotation rather than creating a new request. Successful credential persistence clears the intent. Logout sends the refresh token to revoke the device without relying on access expiry and reports unconfirmed remote revocation. Account partitions cache the `/me.displayName` used in the account panel and copy confirmation.

`CLOUD_PREVIEW_LOCAL` preserves the sync preference, downloads account state and returns a fingerprinted list of copy/skip candidates. Previewing never copies anonymous words; confirmation stages only reviewed new words and synchronizes them if sync is enabled. `CLOUD_COPY_LOCAL` requires that preview token. Confirmation rechecks account scope, generation, epoch, full local/account snapshots and empty outbox inside the vocabulary queue, then atomically publishes only new words and their pending operations. Existing words are skipped; anonymous data is retained. Tokens expire when the background restarts.

Source URLs and contexts may contain sensitive information and are included in backups. History rendering must preserve text without interpreting it as HTML. Navigable source links are restricted to HTTP(S), with `noopener noreferrer` for new tabs.

Current Chrome source permissions are `storage`, `contextMenus`, `identity`, `alarms`, and `<all_urls>` host access. Identity supports GitHub browser callbacks; alarms schedule sync for signed-in accounts with sync enabled. Previously accepted packages omitted identity/alarms. Static content scripts support selection across readable pages; host access also allows internal HTTPS lookup requests. The unused `activeTab` grant was removed for 0.1.0: release code does not dynamically inject scripts or read protected tab metadata. Selection is enabled broadly on pages that permit injection. Permission changes need browser validation; an all-URLs declaration does not enable browser-internal pages. See [release materials](release/README.md) for permission justifications and remaining browser checks.

## Pronunciation runtime

The shared pronunciation component requests `GET_PHONETICS` independently of definitions and translations. The background phonetics service reads one of 64 packaged IPA shards for the exact lowercase selected spelling (never the definition's base form), coalesces reads and retains at most 16 parsed shards. Local headers/body are bounded at 1.5 seconds and the UI message at two seconds; word/view changes abort pending UI replies. Data is validated, rendered literally and displayed beside small US/UK speaker icons. Missing IPA is stated explicitly; file/message errors offer retry without disabling speech. General saved/provider IPA is only a same-spelling fallback. No definition snapshot, vocabulary key or export format is changed. The sample preview injects a direct local-asset lookup; production uses the background message path. Source hashes, original compressed TSVs, licenses and modification notices ship with the assets; see [pronunciation coverage](dictionary.md#pronunciation).

Playback uses browser speech synthesis with exact `en-US` / `en-GB` voices, preferring local voices. Remote matching voices may send the clicked word to the browser's speech provider; no context or source URL is passed. Voice discovery updates asynchronously. Playback starts only after a click, stops when that word/view closes or changes, and has an eight-second deadline. It uses no dictionary audio URLs, new manifest permissions or persisted fields. Speech chooses its own variant independently of the displayed IPA.

## Account sync and recovery

Account partitions include the exact origin and opaque user identity; switching
accounts pauses the previous sender and retains anonymous vocabulary. Copying local
words requires confirmation and a completed cloud snapshot. Existing/colliding
words require an explicit import/merge choice. Same-source seed receipts are
idempotent; intentional imports use new request/event IDs and add counts again.
New history operations use at most 25 events and at most 256 KiB of UTF-8 JSON,
including operation IDs and the payload envelope. Copy/import plans complete in
memory before the partition/outbox transaction. A single oversize event or entry
rejects the whole account mutation with local-vocabulary guidance; anonymous
import/export remains compatible. Already-frozen requests keep their exact IDs
and bodies. Old queues paused by an oversize request require explicit archive/
cloud recovery and a new copy/import; this update does not silently rewrite them.
Fixed-boundary state pages and versioned history scans persist across flights and
restarts; history positions restore source ordering. Conditional reset/delete/merge
versions are captured with local intent, never silently rebased onto a pulled
remote version or an additive acknowledgment containing unseen edits.

Contexts/URLs are retained locally and omitted from outgoing operations regardless
of another device's consent. Cloud source removal preserves these private copies.
A server epoch change or permanent operation conflict pauses sending. Confirmed
Archive changes and use cloud vocabulary saves the full old partition/queue and
the fresh checkpoint in one transaction, downloads cloud state and stays paused.
Recovery JSON exports contain vocabulary only; old requests are never replayed.
Mac offers more granular merge/separate-copy choices. Full website UI, extension
review editing, source upload controls, phrase lookup, large-store optimization and
hosted/installed-client acceptance remain pending. The older Cloudflare plan is
historical design context; [Tencent deployment](../../../backend/docs/tencent-deployment.md)
is the current backend target.


## Historical temporary HTTPS lookup transport

The temporary Cloudflare connector forwards to a dedicated loopback bridge on 8788. The bridge permits health GET, ordinary dictionary/translation POST/OPTIONS, explanation POST/OPTIONS and the restricted explanation-capability GET/OPTIONS. It rejects all account/auth/vocabulary routes, query variants and other methods, strips auth/cookies/client XFF, keeps ordinary lookups at 2 KiB, allows 16 KiB only for explanation POST, accepts no capability GET body, and caps concurrency at eight. Valid edge CF-Connecting-IP becomes the local API's trusted forwarded IP, preserving the existing public IP limit. It has no database/provider credentials. The existing API/Hermes services remain on loopback; neither firewall nor canonical Caddy/OAuth configuration changes.

Cloudflare receives the lookup word in transit, then the existing server/provider routes handle it. The connector and bridge run as the existing dedicated service user with systemd hardening. The Quick Tunnel hostname stays usable while that connector process runs; a process recreation or reboot generates a new hostname, which must be reflected in `LOOKUP_SERVICE_ORIGIN` and rebuilt. Account sync continues to use the canonical hostname and still awaits filing. See [the actual public/Chrome verification](verification/2026-10-14-temporary-lookup.md).

## Website policy and positioning (2026-10-26)

`site-settings.ts` owns `local:siteSettings` (`schemaVersion: 1`, bounded exact disabled hostnames). The background serializes writes; schema 0 is normalized in memory, and corrupt/future values remain untouched until explicit reset. Settings are separate from vocabulary, credentials and cloud synchronization.

`site-messages.ts` resolves the top-level URL with browser.tabs metadata. Only extension pages may mutate rules; the active tab ID and expected hostname are checked for a toggle. Content scripts request `SITE_ACCESS`, watch storage only to trigger policy reload, and remain inactive until access succeeds. The background separately gates GET_DEFINITION, GET_TRANSLATION, GET_PHONETICS and SAVE_WORD from page tabs. The context-menu service checks the policy before provider I/O and immediately before saving. Existing saved data and submitted writes are not deleted or rolled back by a policy change.

`popup-position.ts` computes visual viewport bounds, host coordinate conversion and release-line anchors. SelectionPopup measures a hidden fixed 100px calibration element in the same tree, coalesces viewport/scroll events with requestAnimationFrame, and disconnects geometry observers/listeners on close. Translation/scaling are covered; arbitrary rotations/perspective and physical pinch gestures are not claimed from these checks.

## Cancellable query Ports and sentence explanation (2026-10-26)

New dictionary, translation and IPA clients use `rememberme-lookup-v1` Ports with one requestId/sessionId per connection and start/cached/result/error/cancel messages. A translation-only cached preview does not finish the Port; final result, cancellation or deadline still owns cleanup. The background validates actual sender metadata, enforces top-level site rules and refuses vocabulary writes on this channel. Each Port is its own cancellation scope: a client cannot cancel another Port by supplying IDs. Disconnect, deadline, site disable and consent revoke clean up subscriptions and policy listeners. Trusted extension pages remain usable when opened as tabs. Updating another hostname's rule no longer transiently closes an enabled page.

`SharedLookup` gives each dictionary/translation caller an independent subscription. The last subscriber leaving aborts the shared signal and prevents any later retry/cache write. Translation callers subscribe before asynchronous cache reads so concurrent misses share both disk lookup and provider work. Background context-menu and legacy sendMessage callers participate as bounded subscriptions without a page cancellation signal. Flights are capped at 128 per service and have service deadlines; old completions cannot delete a newer same-key flight. Vocabulary writes continue using the original message contracts and are never automatically retried by query recovery.

Public word translation gives its first attempt nine seconds for the complete three-second Magpie/four-second MyMemory chain and network overhead, with one eligible retry within nineteen seconds. Network/timeout and 502/503/504 can recover unless a bounded structured error explicitly says `retryable: false`; caller cancellation, 4xx, invalid JSON and oversized replies cannot. Error bodies are limited to 8 KiB within the same attempt deadline. A per-word-translator circuit opens after two consecutive upstream failures for 30 seconds, then admits one recovery probe. Local capacity rejection does not count, and old completions cannot close the circuit. The circuit is independent of sentence explanation and successful result caches. Shared budgets live in `contracts/translation-policy.ts`. Dictionary and sentence explanation never inherit this retry policy. Cancellation ends the extension's HTTP work; the word route's server pending/cache can still serve another transmission. No claim is made that a cancelled client stops an upstream model or its billing.

Sentence explanation requires a build that has not explicitly disabled it (`VITE_CONTEXT_EXPLANATION_ENABLED=false`), a compatible live public capability, and versioned local user consent. The released 0.1.5 build enables capability discovery by default (an explicit build false remains a rollback option); user consent stays off until accepted, and new backend installations remain off until configured. `ContextExplanationService` owns a per-client in-memory cache (100 entries, thirty-minute TTL), keyed by normalized word, exact sentence, language and explanation version; the fixed client instance scopes its origin. Capability is rechecked before cache use. Consent revocation increments a generation, aborts flights and clears cached results, including races during consent reads. Only the consent preference is persisted; explanations never become Definition/history/export/sync data.

The new input/output validators live in `contracts/context-explanation.ts`. Capabilities disclose only feature availability, schema/version and bounds. The first consent dialog explains the exact word-plus-sentence transfer; every generation still requires a click. The result renders literal text, independently of ordinary lookup success. Unknown/off capabilities hide the entry; an empty or over-limit sentence cannot be sent. See the [second-round verification](verification/2026-10-26-context-explanation.md) for executed and deferred checks.

## Personal production lookup ingress (2026-10-27)

Release 0.1.5 uses `https://rememberme-lookup.couplelabs.workers.dev` for lookup and `/privacy` for its policy. The Worker, VPC service and dedicated connector belong to verified personal account `5c11819c6fdb08421e6d58084e37f028`. Account/OAuth remains on its existing canonical origin; no old-company resource or DNS/domain association was modified. Resource IDs are recorded in `backend/deploy/personal-lookup-resources.json`.

The deployed API explicitly enables context explanation. Ordinary queries remain word-only and the explanation requires user consent plus an explicit click. The explanation adapter requests JSON output mode, uses the configured `group/translator`, and retains full-response validation. Its consent/result CSS lives in `paper-sage.css`, which is inlined into the closed ShadowRoot; SFC scoped CSS alone cannot style this surface. The release browser check verifies actual button separation there.

## Reviewed learner dictionary boundary

`reviewed-lookup.ts` binds the checked-in approved manifest to `LearnerDictionary`.
`learner-dictionary.ts` reads only extension-owned shards, verifies their byte
length and SHA-256, coalesces English/Chinese reads, and maps reviewed senses into
legacy-compatible snapshots. It retains at most 24 shards and bounds local work
to 1.5 seconds. It never interprets generated forms as aliases or writes vocabulary.
`dictionary.ts` falls through to WordNet before the public route; `translation.ts`
checks this pack before any stale online cache. Corruption recovers through those
existing paths. App-wide network independence is not claimed.

The optional dictionary publication metadata is additive. The original Magpie
generation identifier stays in `Translation.source` for current wire/native
compatibility; `Translation.dictionary` and `Definition.source` identify Remember
Me's reviewed publication. New labels read that metadata; raw text stays literal.
The separate backend SQLite master owns draft/review history and approved editions.
Its database and private review evidence never ship to the extension.

Category badge layout belongs in `assets/paper-sage.css`, which
`entrypoints/content.ts` injects into its closed ShadowRoot; Vue component-scoped
styles alone do not reach that root.
