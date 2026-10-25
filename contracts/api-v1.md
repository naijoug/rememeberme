# Unified API v1

The wire API is implemented/tested locally in `backend/`. It is separate from `operations-v1.schema.json`, which describes the native **logical** queue. Local `VocabularyEntry.version`/`reviewRevision` and server CAS values are different timelines; clients must retain a server base state and overlay pending logical operations. Merely adding these DTOs does not enable native synchronization.

## Authentication

| Endpoint | Behavior |
| --- | --- |
| GET `/auth/native/start?state=…&challenge=…&callback=…&deviceName=…` | Exact configured callback allowlist, 32–128-character client state, S256 challenge; creates a ten-minute browser flow and separate provider PKCE verifier, sets HttpOnly/Secure/SameSite=Lax flow cookie, redirects to GitHub |
| GET `/auth/github/callback` | Verifies server state against the same browser cookie, claims flow once, exchanges provider code and revalidates `/user`; returns a two-minute one-time native code plus the original client state |
| POST `/api/v1/auth/exchange` | `{code, verifier}` proves the native challenge; atomic redemption creates one device/session; response includes access/refresh credentials and their expiry milliseconds |
| POST `/api/v1/auth/refresh` | `{refreshToken}` rotates both credentials and rejects used/expired/revoked credentials |
| POST `/api/v1/auth/logout` | Bearer-authenticated current session revocation |
| GET/DELETE `/api/v1/devices[/id]` | Own-account device listing/revocation, with credentials invalidated |
| DELETE `/api/v1/account` | Erases this account's active data/credentials; native UI must confirm the user action before calling it |

The custom callback contains no long-term token. Client state/verifier must be generated and retained for the active ASWebAuthenticationSession. Access lifetime is 15 minutes; refresh lifetime is 30 days. Secrets/configuration for actual OAuth and HTTPS hosting remain unset. The native core implements origin-scoped Keychain credentials, PKCE callback validation, one concurrent refresh path and persisted sync bases/wire items/checkpoints. Settings now connects ownership, vocabulary selection and explicit sync controls; hosted/system-browser/device/end-to-end acceptance remains unfinished.

## Operations and state

`POST /api/v1/sync/operations` takes exactly one operation: `operationId`, `entryId`, `kind`, optional `baseVersion`/`sourceRevision`, and a kind-specific `payload`. Ownership/device identity is derived from the validated bearer session; client `userId`/owner fields are rejected. JSON requests are limited to 256 KiB actual stream bytes and a 10-second body-read deadline. Event chunks contain at most 25 items. Full runtime validation adds finite-number/depth/definition/privacy checks beyond the schemas.

| Kind | Payload / effects |
| --- | --- |
| create | Word/type/nullable count/current definition/notes/creation and update milliseconds; new lifecycle, no invented history. Optional allowDuplicate=true only for an explicit separate-lifecycle choice; normal source collisions remain atomically guarded |
| seed | Create fields plus original file SHA-256; ID is `seed:` + SHA-256 of compact UTF-8 JSON `["legacy-seed-v1", sourceDigest, normalizedKey]`; repeated baseline applies once |
| record | One stable event with time and definition snapshot, optional consented context/URL; only a new event increments count |
| importHistory | Event array, immutable event deduplication; no count increment or review advancement |
| legacyMerge | Explicitly confirmed batch's nonnegative countDelta and chosen current definition; current baseVersion required; history is uploaded separately without another increment |
| edit | Selected word/type/definition/notes fields; current server baseVersion required |
| reset | Empty payload; count becomes zero, history retained; baseVersion required |
| delete | Empty payload; tombstone blocks old lifecycle resurrection; baseVersion required |
| review | Stable event/result/time/baseReviewVersion/review-v1; current entity baseVersion and review version required; new admission limited to 20 per account/local date |
| restore | Chosen count/definition/notes/review snapshot plus current baseReviewVersion; current entity baseVersion required; imported history is a separate operation |
| enrichSource | Event IDs and explicitly enabled source fields; no count or review changes |

Request identity hashes use canonical JSON with sorted object keys; audit device metadata is not part of business identity. Same user/operation ID and same content returns the saved outcome; changed content conflicts. Success and known-conflict outcomes remain associated with the original ID. A corrected/user-resolved change uses a new operation ID. Original baseline fields come from the file, not device import time or subsequently edited local state.

Counts are independent from event length. Null means unknown/unrecorded; zero is explicit. Finite nonnegative old fractions/large values and millisecond times remain represented as binary64. Precision-losing increments and overflow are rejected, without an encounter. New version/cursor tokens are safe nonnegative integers; success entry versions start at 1. Backup/local versions must never be sent as authoritative server values.

Response/error fixtures are in `fixtures/sync-create-v1.json` and `fixtures/sync-errors-v1.json`, consumed by TypeScript and Swift. `sync-api-v1.schema.json` and `sync-responses-v1.schema.json` define request/reply envelopes. Errors contain `code`, `retryable` and `requestId`, never raw database details or credentials. A failed SQL statement rolls back receipt/business/events/change rows together. Additive races retry a bounded number of times; rejected conditional writes enter client conflict state rather than an endless retry loop.

## Pull, history and privacy

- GET `/api/v1/me` returns resolved user/device, preferences, epoch, literal displayName, syncCapabilities, current IANA-local reviewDay and at most 20 reviewAdmissionIds for that day. Native queues union known server/local admission IDs, avoiding duplicate quota consumption; epoch publication refreshes these known IDs without replaying answers. It omits session hashes/tokens. Native Settings requires `history-order-v1`, `history-version-v1` and `explicit-lifecycles-v1` before enabling the vocabulary sender; epoch recovery additionally requires the current quota snapshot.
- GET `/api/v1/sync/snapshot?epoch=…&after=0&limit=…` fixes a server boundary and returns one latest state per lifecycle as of that boundary, including tombstones. Continue with returned `boundary`/`nextCursor` until `hasMore=false`, then pull changes after the boundary.
- GET `/api/v1/sync/changes` uses monotonic server sequences and the same fixed-boundary paging fields. Maximum state page is 50. Wrong epoch/future cursor/boundary returns 409 and requires full recovery. Change retention is currently unbounded; expiration/remote restore-epoch tooling remains unfinished.
- GET `/api/v1/entries/id/history?version=…` pages at most 25 events with an immutable ID cursor. Responses echo entryVersion and return each encounter's immutable insertion position. Scans only include events introduced at or before the selected entry version, so later events cannot be mistaken for encounters in an older count snapshot. Native scans reconstruct the entry's retained order after completion; historyOrdering=timestamp (explicit legacy merge) uses timestamp then position. A future version is rejected. Omitting version uses the currently known entry version for older callers.
- PUT `/api/v1/preferences` updates IANA timezone and separate context/URL consent. Defaults exclude both. Nonempty source fields sent without consent are rejected; disabled flags suppress those fields on history reads. Turning off a preference does not erase already-uploaded fields. `/me` returns `sourceRevision` and advertises `source-privacy-v1`. Nonempty source writes require the current source revision (an omitted revision means 0 for legacy compatibility); consent and revision are rechecked in the D1 commit guard.

Native senders must split large logical baseline/history operations into bounded stable wire items and persist first-send projections before networking. Separate online restore actions may not replay backed-up outboxes/checkpoints/review events. Snapshot/delta application must preserve pending local edits, account stores must remain isolated, and epoch changes must invalidate prior server checkpoints. No native transport/checkpoint implementation is claimed by this API contract alone.

The native core coordinator now supplies `X-Sync-Epoch` on submissions, so an earlier-epoch request cannot enter the current epoch. The endpoint validates a supplied epoch; the D1 batch also rechecks the resolved user's epoch at commit, together with session/device/preferences. An epoch or preference race does not retain a permanent conflict receipt. Older API callers currently may omit the header; new native senders always include it. These local tests do not establish recovery of a remotely restored database.

Native epoch recovery now confirms a new-generation plan with a fresh online account/epoch/preference check, current bases, new conditional request IDs and a new checkpoint. Old wire requests remain in the private recovery generation and are not replayed. Missing lifecycle input stays a local conflict unless the user chooses a separate lifecycle; cloud/local tombstones cannot be implicitly resurrected. Publication keeps sending disabled until another explicit enable action. See [epoch recovery evidence](../frontend/apple/docs/verification/2026-10-09-epoch-recovery.md) for real local HTTP/process checks and remaining hosted acceptance.

Native account-backup merge now previews current cloud lifecycles/tombstones and rechecks relevant versions/source identities before local publication. It queues fresh conditional restore/delete/edit requests and independent history imports; backup versions are provenance only, incoming queues/checkpoints are rejected, and historical review answers are retained locally without replay. Existing unrelated current queues stay intact. Offline cached preview cannot confirm, and publication keeps sync paused. [Account backup evidence](../frontend/apple/docs/verification/2026-10-09-account-backup.md) records real HTTP staged-exit/resume/recheck and count/history/review independence.

`POST /api/v1/sources/clear` accepts exactly `{requestId, sourceRevision}`. A single guarded transaction disables both source consents, increments the account source revision, blanks all encounter contexts/URLs and writes an idempotent receipt. A matching retry returns the receipt without clearing later uploads; changed receipt input is rejected. Count, event identity/order, review, entry versions and local client copies are retained. The revision invalidates uncommitted old record/import/enrichment source writes even after re-enabling. Previously committed operation receipts return their original acknowledgment without rerunning mutations. A native unknown-outcome removal keeps sending paused across restart. Local conflict review or a new explicitly confirmed backfill is required for old source intents. Cloud source removal does not erase exported files or provider/database backups.

## Translation source extension (2026-10-14)

`Definition.translation.source` accepts both `mymemory` and `hermes`, with
`target: zh-CN` and nonempty bounded text. Existing histories are never rewritten.
Updated clients send `X-Client-Capabilities: translation-source-v2`; `/me` and
public `/api/v1/capabilities` advertise support. Upgrade old clients before
sharing Hermes snapshots: old validators may reject that new source.

Authenticated `POST /api/v1/lookup/translation` accepts exactly
`{"word":"synthetic","target":"zh-CN"}` and returns
`{"translation":{"text":"...","target":"zh-CN","source":"hermes"}}` or the same shape with `source: mymemory` for server fallback.
Only a normalized single English word is supported. The server prefers Hermes and uses MyMemory on timeout/busy/upstream failure; profile-isolation failures remain explicit. `MYMEMORY_ENABLED=false` disables the fallback. Provider failures remain separate from local English lookup and vocabulary persistence. Hermes credentials,
URLs, model selection and tools are never client parameters.

The default runtime now uses Node/SQLite with the existing SQL/atomic guards.
Exact extension callback/CORS allowlists support browser PKCE device sessions.
The API remains v1; the source extension does not change legacy number/history
semantics or operation IDs. Node/SQLite and Hermes have a private Tencent deployment; the automatic lookup release is activated and server-local acceptance passes; public/installed-client acceptance remains blocked by filing.

## Server dictionary lookup (2026-10-14)

Authenticated `POST /api/v1/lookup/dictionary` accepts exactly `{"word":"synthetic"}` and returns `{"definition":{...}}` using the existing Definition shape and `source: wordnet` or `source: dictionary-api`. The server checks its licensed packaged WordNet first, then a fixed Free Dictionary API URL, bounds body/timeout/concurrency and caches successful results. Both lookup routes normalize one English word, reject context/URL/provider parameters and use normal account authentication/rate limits. `capabilities.dictionary` reports configuration, not upstream readiness. Unknown words return `DICTIONARY_NOT_FOUND` (404); quota/unavailable/busy return 503, timeout 504 and invalid response 502. No vocabulary write or sync enablement occurs. The current Tencent release implements these routes and server-local acceptance passes; public access remains blocked by filing.

## Automatic public lookup (2026-10-14)

The browser's normal lookup uses public `POST /api/v1/public/lookup/dictionary` and `POST /api/v1/public/lookup/translation`. They accept the same exact word-only bodies and responses as the authenticated routes above, but require no account/session. They are registered before account middleware, after exact origin checking, and limited to 30 requests/minute/IP. No public route grants access to account data or vocabulary. Public lookup creates no user/session/vocabulary rows. `capabilities.publicLookup` reports availability of the limiter/configuration, not upstream readiness.

Dictionary source can be `wordnet` from server-packaged licensed assets or `dictionary-api` from the fixed external provider. Server WordNet uses identical spelling/shard/suffix rules as the extension. Uncovered words still require the remote provider; Tencent's observed Free Dictionary egress timeout remains a provider limitation. Hermes has twelve seconds, MyMemory four, and updated browser translation has a twenty-second service/twenty-two-second UI deadline. No API address or key appears as a user input.

## Account reminder device (`reminder-device-v1`)

SQLite migration `0006_reminder_device.sql` adds a nullable selected device and a monotonic revision to each account. `/api/v1/capabilities` and `/api/v1/me` advertise `reminder-device-v1`. `/me` adds `reminderDevice: { deviceId: string | null, revision: integer }`; older clients may ignore it. Missing capability/field means unsupported, not permission to schedule on every signed-in device.

`PUT /api/v1/reminder-device` accepts exactly `{ enabled: boolean, expectedRevision: integer }`. A true request selects the authenticated device; false releases only that device's own selection. Clients cannot supply another device/user ID. The database update atomically checks revision, live account/session/device and increments revision. Stale or unauthorized release returns nonretryable `REMINDER_SELECTION_CHANGED` (409). Exhausted revisions return `VERSION_EXHAUSTED`; malformed input is rejected. Response is the new `{ deviceId, revision }`.

This preference is separate from timezone, source-upload consent, vocabulary and local notification permission. Repeating a request after an unknown outcome does not bypass revision checks: reread `/me`, display the resulting selection, and require another explicit choice before reclaiming. Other devices cancel scheduled account notifications after refreshing the account. Offline schedules may continue until reconnection. Shared request/response fixtures and schema: `fixtures/reminder-device-v1.json`, `reminder-device-v1.schema.json`.
