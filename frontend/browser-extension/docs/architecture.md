# Extension architecture and data boundaries

Use this document for changes to messaging, persistence or external data flow. Setup is in the [package README](../README.md); observable behavior and unresolved requirements are in [behavior.md](behavior.md).

## Runtime ownership

| Source | Responsibility |
| --- | --- |
| [content.ts](../entrypoints/content.ts) | Selection events, definition card, context extraction, save requests, page notifications |
| [background.ts](../entrypoints/background.ts) | Dictionary request listener and context-menu lifecycle |
| [background-handler.ts](../services/background-handler.ts) | Validate and dispatch dictionary and vocabulary requests; report completed operations or errors |
| [context-menu-handler.ts](../services/context-menu-handler.ts) | Validate selection, retrieve definition/context, save and notify |
| [context-menu-status.ts](../services/context-menu-status.ts) | Toolbar badge/title fallback when page notifications cannot be delivered |
| [popup/App.vue](../entrypoints/popup/App.vue) | Storage/theme integration, import/export, deletion and reset |
| [VocabularyPanel.vue](../components/VocabularyPanel.vue) | Pure UI: word search/list, reading view, menus, themes and confirmation |
| [theme.ts](../services/theme.ts) | Watch/persist System / Light / Dark under local:appearance, separately from vocabulary |
| [storage-client.ts](../services/storage-client.ts) | Content/popup vocabulary client, using background messages only |
| [storage.ts](../services/storage.ts) | Background-owned vocabulary operation queue, persistence and JSON validation/merge |
| [dictionary.ts](../services/dictionary.ts) | Local-first lookup, online fallback, retries and in-memory cache |
| [translation.ts](../services/translation.ts) | Keyless Chinese translation, provider deadline and separate persistent success cache |
| [bilingual-lookup.ts](../services/bilingual-lookup.ts) | Combine successful sources for context-menu saves |
| [offline-dictionary.ts](../services/offline-dictionary.ts) | Packaged WordNet shards, bounded local reads and memory cache |
| [word-forms.ts](../services/word-forms.ts) | Regular suffix candidates, accepted only when the matching WordNet part of speech exists |
| [local-feedback.ts](../services/local-feedback.ts) | Local feedback builds only: development-server reconnection and script replacement without reloading tabs |

There is no backend runtime. The runnable package is this directory; generated `.wxt/` and `.output/` directories are not sources. WXT configuration is in [wxt.config.ts](../wxt.config.ts), and shared data types are in [types/index.ts](../types/index.ts).

The separate [feedback configuration](../wxt.feedback.config.ts) uses a loopback development server and `.output/chrome-mv3-feedback/`. Its script-refresh messages replace WXT's whole-tab reload behavior. Reconnected clients wait for an explicit build-complete signal before reloading, because WXT temporarily removes the output directory during a full build. Server-start hooks re-register the handshake after configuration restarts. Content contexts dispose their DOM, listeners, lookup deadlines and theme subscriptions when a new script replaces them. The page UI uses one reactive Vue app in an open ShadowRoot with an inline copy of the same token/component stylesheet used by the popup; only host positioning CSS is injected into the webpage. The optional macOS LaunchAgent runs that watcher at login; it is not a backend or vocabulary sync service. See [local-feedback.md](local-feedback.md) for setup and lifecycle limits.

## Messaging

`GET_DEFINITION` and `GET_TRANSLATION` accept a valid single English word and return independent English/Chinese results. The content script starts both, validates responses, renders each as it arrives and ignores stale completions after selection changes. A successful source stays usable if the other fails. Vocabulary requests are `GET_WORDS`, `SAVE_WORD`, `DELETE_WORD`, `RESET_COUNT`, `IMPORT_DATA` and `EXPORT_DATA`. Responses are `{ success: true, data }` or `{ success: false, error: string }`; operations without a result return `data: null`. Malformed or unsupported messages return failure before accessing storage.

Content and popup code use the storage client, never direct storage writes. The background dispatches vocabulary requests to its storage service, which is also used by the context-menu handler. A successful write response is sent only after persistence completes. Messaging failures are surfaced to the caller without retrying or falling back to local writes. Delete/reset accept any nonempty word so older imported vocabulary remains manageable; selection saves still require a valid single English word and a definition. Import validation remains in the storage service.

Background-to-content messages are `EXTRACT_CONTEXT` (returns the current context) and `SHOW_NOTIFICATION` (renders a page notification). These require a reachable content script. They are separate from the dictionary request contract.

Context-menu requests address the clicked `frameId` and capture context before waiting for the dictionary. The local feedback build can reinject its existing content script once into that frame if connection fails, using its existing development permissions. Browser-internal pages are rejected before lookup/injection. Page notifications can fall back to the existing toolbar action/browserAction badge and title; no new manifest permissions are needed, and a notification failure does not cause a storage retry.

## Persistence and compatibility

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

English lookup has an 8.5-second service budget covering the local lookup (capped at 1.5 seconds), online headers/body and at most one retry with 400ms backoff. Each online attempt is capped at 8 seconds and the remaining budget. This leaves reply headroom before the ten-second content-message deadline. 404, 429 and invalid-definition responses are not retried. Chinese fetch/body reads are bounded at 4.5 seconds and their UI message at six seconds. Both sources coalesce concurrent requests for a normalized word and allow recovery after failure. English results retain a 24-hour in-memory cache, with at most 24 parsed local shards; Chinese successes use a separate persistent seven-day cache capped at 500 entries. Raw remote text is rendered literally. Context-menu saves wait for the bounded results and require at least one success; the page card can save a result before the other source completes.

Source URLs and contexts may contain sensitive information and are included in backups. History rendering must preserve text without interpreting it as HTML. Navigable source links are restricted to HTTP(S), with `noopener noreferrer` for new tabs.

Manifest permissions are `storage`, `activeTab`, `contextMenus`, and `<all_urls>` host access. Selection is enabled broadly on pages that permit injection. Permission changes need browser validation; an all-URLs declaration does not enable browser-internal pages.

## Future changes

IndexedDB, persistent dictionary caching, cloud sync, URL recording controls and phrase lookup are not part of the current implementation. Record an actual decision and its compatibility implications when one is requested, instead of copying proposed APIs into this document as existing behavior.
