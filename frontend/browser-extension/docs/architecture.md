# Extension architecture and data boundaries

Use this document for changes to messaging, persistence or external data flow. Setup is in the [package README](../README.md); observable behavior and unresolved requirements are in [behavior.md](behavior.md).

Reviewed against the current working-tree source on 2026-10-08. This source review is not a new browser verification run. See the [project architecture](../../../docs/architecture.md) for repository structure and the separate website/backend plan.

## Package and source boundaries

This is the only runnable package. It uses WXT, Vue 3 and TypeScript, with npm and the package-local lockfile. `.nvmrc` pins Node 22.22.3; `package.json` requires Node `^22.12.0`. There is no repository-root Node package or shared utilities package.

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
| [VocabularyPanel.vue](../components/VocabularyPanel.vue) | Pure UI: word search/list, reading view, menus, themes and confirmation |
| [WordHistory.vue](../components/WordHistory.vue) / [HistoryItem.vue](../components/HistoryItem.vue) | Numbered encounter disclosures with sentence, precise time and safe source link |
| [WordPronunciation.vue](../components/WordPronunciation.vue) | Shared US/UK speech controls, voice discovery, playback lifecycle and literal phonetic text |
| [theme.ts](../services/theme.ts) | Watch/persist System / Light / Dark under local:appearance, separately from vocabulary |
| [storage-client.ts](../services/storage-client.ts) | Content/popup vocabulary client, using background messages only |
| [storage.ts](../services/storage.ts) | Background-owned vocabulary operation queue, persistence and JSON validation/merge |
| [lookup-client.ts](../services/lookup-client.ts) | Page-to-background lookup messages, UI deadlines and cancellation of pending UI responses |
| [dictionary.ts](../services/dictionary.ts) | Local-first lookup, online fallback, retries and in-memory cache |
| [translation.ts](../services/translation.ts) | Keyless Chinese translation, provider deadline and separate persistent success cache |
| [phonetics.ts](../services/phonetics.ts) | Exact-spelling US/UK IPA from packaged shards, bounded reads and memory cache |
| [pinyin-format.ts](../services/pinyin-format.ts) / [TranslationText.vue](../components/TranslationText.vue) | Display numbered Chinese pinyin with tone marks; preserve provider/cache/history/export text and literal rendering |
| [bilingual-lookup.ts](../services/bilingual-lookup.ts) | Combine successful sources for context-menu saves |
| [offline-dictionary.ts](../services/offline-dictionary.ts) | Packaged WordNet shards, bounded local reads and memory cache |
| [word-forms.ts](../services/word-forms.ts) | Regular suffix candidates, accepted only when the matching WordNet part of speech exists |
| [local-feedback.ts](../services/local-feedback.ts) | Local feedback builds only: development-server reconnection and script replacement without reloading tabs |

There is no backend runtime. The runnable package is this directory; generated `.wxt/` and `.output/` directories are not sources. WXT configuration is in [wxt.config.ts](../wxt.config.ts), and shared data types are in [types/index.ts](../types/index.ts).

The vocabulary write boundary applies to `local:words`: only the background storage service writes it. Theme preferences are written directly through the theme service, and translation caching has its own background storage writes. Neither belongs to the vocabulary operation queue. The popup loads words on mount and reloads after its own successful mutations; it does not currently watch vocabulary changes from other pages.

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

Context-menu requests address the clicked `frameId` and capture context before waiting for the dictionary. The local feedback build can reinject its existing content script once into that frame if connection fails, using its existing development permissions. Browser-internal pages are rejected before lookup/injection. Page notifications can fall back to the existing toolbar action/browserAction badge and title; no new manifest permissions are needed, and a notification failure does not cause a storage retry.

## Persistence and compatibility

| Persistent key | Owner | Contents / export |
| --- | --- | --- |
| `local:words` | Background `storage.ts` | `WordEntry[]`, included in vocabulary JSON |
| `local:translationCache` | Background `translation.ts` | Bounded seven-day Chinese success cache, excluded from export |
| `local:appearance` | Shared `theme.ts`, written by popup | System / Light / Dark preference, excluded from export |

The page reads only its selected word through `GET_WORD`. Every counter click sends a distinct `SAVE_WORD` with the sentence/URL captured at selection and an optional finite, nonnegative `timestamp` captured at click time. Older callers can omit that field and use the background's current time. The returned full `WordEntry` updates the visible count and record list after persistence. Pending clicks remain independent; no failed write is retried automatically. Read and write reply ordering is guarded in the active card so stale replies cannot roll back its confirmed count.

`WordEntry` contains `word`, `count`, `history`, `createdAt` and `updatedAt`. Each `HistoryRecord` contains `timestamp`, `context`, `url` and a `Definition` snapshot. There is no separate current-definition field: the vocabulary reading view takes its displayed definition from the last history record. Later lookup completions update the active page UI, but do not rewrite already saved snapshots. Any future manual-entry or synchronization model must account for this history-based definition ownership.

The host page cannot traverse the closed shadow root through `host.shadowRoot`, which matters now that prior encounter sentences and URLs may be rendered there. The extension keeps its shadow reference privately. Test code captures roots in a disposable fixture; no debug reference is exposed to webpages. This is a DOM encapsulation measure, not a claim of protection from browser developer tools or other privileged extensions.

- WXT storage (`wxt/utils/storage`) uses the browser extension's local storage area. `local:words` contains a `WordEntry[]`; there is no IndexedDB database or object-store index in this implementation.
- Words are trimmed and lowercased for saving/importing. Each entry contains its independent count, history, creation time and update time. Timestamps are milliseconds since the Unix epoch.
- Saving increments count and appends history. Reset retains history. Preserve both fields independently when changing data formats.
- Export is a plain JSON array with no version envelope. Existing backups must continue to import unless a requested migration defines compatibility and recovery.
- `Definition.translation` is optional. Chinese-only saved results have an empty English `meanings` array. Imports validate the optional translation object; old records remain valid. `local:translationCache` is a separate, bounded seven-day success cache and is not included in vocabulary exports.
- Import validates entries before writing, merges counts additively and concatenates histories. It does not deduplicate repeated imports. See [storage.test.ts](../services/storage.test.ts) for round-trip and validation coverage.
- The background owns one promise queue for all read/modify/write operations, including context-menu saves, imports, deletes and resets. Reads/exports wait for earlier queued writes. Failed operations reject to their caller without blocking later work. Clients in different tabs share this queue through runtime messaging.
- Writes still replace the entire array. This is serialization within the running background, not a transactional database or durable job queue. Browser/process termination can interrupt pending work; a disconnected caller must not assume a failed response means a write was never committed. Do not automatically retry mutations. Reload existing webpages after updating the extension so old content scripts cannot keep writing directly.

## Dictionary and privacy

For English, the background first checks packaged WordNet 3.1 JSON shards. Hits do not contact the remote English dictionary; misses or local file failures use HTTPS requests to `api.dictionaryapi.dev`. Independently, uncached Chinese translation requests send the selected word and `en|zh-CN` to `api.mymemory.translated.net/get`, without a key, email, credentials or referrer. Thus a local English hit can still trigger an online Chinese request. Neither provider receives the sentence context, page URL or vocabulary list from this extension. There is no vocabulary cloud sync or first-party server. See [sources, limits and coverage](dictionary.md).

English lookup has an 8.5-second service budget covering the local lookup (capped at 1.5 seconds), online headers/body and at most one retry with 400ms backoff. Each online attempt is capped at 8 seconds and the remaining budget. This leaves reply headroom before the ten-second content-message deadline. 404, 429 and invalid-definition responses are not retried. Chinese fetch/body reads are bounded at 4.5 seconds and their UI message at six seconds. Both sources coalesce concurrent requests for a normalized word and allow recovery after failure. English results retain a 24-hour in-memory cache, with at most 24 parsed local shards; Chinese successes use a separate persistent seven-day cache capped at 500 entries. Raw remote text is rendered literally. Context-menu saves wait for the bounded results and require at least one success; the page counter can record a word/context even if both sources fail, using an empty definition snapshot.

Source URLs and contexts may contain sensitive information and are included in backups. History rendering must preserve text without interpreting it as HTML. Navigable source links are restricted to HTTP(S), with `noopener noreferrer` for new tabs.

Release manifest permissions are `storage`, `contextMenus`, and `<all_urls>` host access. Static content scripts support selection across readable pages; host access also allows the external dictionary request. The unused `activeTab` grant was removed for 0.1.0: release code does not dynamically inject scripts or read protected tab metadata. Selection is enabled broadly on pages that permit injection. Permission changes need browser validation; an all-URLs declaration does not enable browser-internal pages. See [release materials](release/README.md) for permission justifications and remaining browser checks.

## Pronunciation runtime

The shared pronunciation component requests `GET_PHONETICS` independently of definitions and translations. The background phonetics service reads one of 64 packaged IPA shards for the exact lowercase selected spelling (never the definition's base form), coalesces reads and retains at most 16 parsed shards. Local headers/body are bounded at 1.5 seconds and the UI message at two seconds; word/view changes abort pending UI replies. Data is validated, rendered literally and displayed beside small US/UK speaker icons. Missing IPA is stated explicitly; file/message errors offer retry without disabling speech. General saved/provider IPA is only a same-spelling fallback. No definition snapshot, vocabulary key or export format is changed. The sample preview injects a direct local-asset lookup; production uses the background message path. Source hashes, original compressed TSVs, licenses and modification notices ship with the assets; see [pronunciation coverage](dictionary.md#pronunciation).

Playback uses browser speech synthesis with exact `en-US` / `en-GB` voices, preferring local voices. Remote matching voices may send the clicked word to the browser's speech provider; no context or source URL is passed. Voice discovery updates asynchronously. Playback starts only after a click, stops when that word/view closes or changes, and has an eight-second deadline. It uses no dictionary audio URLs, new manifest permissions or persisted fields. Speech chooses its own variant independently of the displayed IPA.

## Future changes

IndexedDB, persistent English-definition lookup caching, cloud sync, URL recording controls and phrase lookup are not part of the current implementation. Chinese translation success caching is already persistent, and English definition snapshots persist in vocabulary history. The [Cloudflare implementation plan](../../../docs/cloudflare-implementation-plan.md) proposes website/backend storage and synchronization changes; it is not an implemented runtime. Record an actual decision and its compatibility implications when one is requested, instead of copying proposed APIs into this document as existing behavior.
