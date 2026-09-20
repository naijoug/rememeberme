# Extension architecture and data boundaries

Use this document for changes to messaging, persistence or external data flow. Setup is in the [package README](../README.md); observable behavior and unresolved requirements are in [behavior.md](behavior.md).

## Runtime ownership

| Source | Responsibility |
| --- | --- |
| [content.ts](../entrypoints/content.ts) | Selection events, definition card, context extraction, local saves, page notifications |
| [background.ts](../entrypoints/background.ts) | Dictionary request listener and context-menu lifecycle |
| [background-handler.ts](../services/background-handler.ts) | Runtime validation and dictionary response/error handling |
| [context-menu-handler.ts](../services/context-menu-handler.ts) | Validate selection, retrieve definition/context, save and notify |
| [popup/App.vue](../entrypoints/popup/App.vue) | List loading, sorting, import/export, deletion and reset |
| [storage.ts](../services/storage.ts) | Vocabulary persistence and JSON validation/merge |
| [dictionary.ts](../services/dictionary.ts) | External dictionary requests, retries and in-memory cache |

There is no backend runtime. The runnable package is this directory; generated `.wxt/` and `.output/` directories are not sources. WXT configuration is in [wxt.config.ts](../wxt.config.ts), and shared data types are in [types/index.ts](../types/index.ts).

## Messaging

Content-to-background requests support `GET_DEFINITION` only, with a valid single English word. The response is either `{ success: true, data: Definition }` or `{ success: false, error: string }`. Malformed or unsupported messages return failure.

`SAVE_WORD`, `GET_WORDS` and `DELETE_WORD` are not supported messages. Their former success-only handlers did no work and have been removed. Content and popup code call the storage service directly; the context-menu handler also calls that service.

Background-to-content messages are `EXTRACT_CONTEXT` (returns the current context) and `SHOW_NOTIFICATION` (renders a page notification). These require a reachable content script. They are separate from the dictionary request contract.

## Persistence and compatibility

- WXT storage (`wxt/utils/storage`) uses the browser extension's local storage area. `local:words` contains a `WordEntry[]`; there is no IndexedDB database or object-store index in this implementation.
- Words are trimmed and lowercased for saving/importing. Each entry contains its independent count, history, creation time and update time. Timestamps are milliseconds since the Unix epoch.
- Saving increments count and appends history. Reset retains history. Preserve both fields independently when changing data formats.
- Export is a plain JSON array with no version envelope. Existing backups must continue to import unless a requested migration defines compatibility and recovery.
- Import validates entries before writing, merges counts additively and concatenates histories. It does not deduplicate repeated imports. See [storage.test.ts](../services/storage.test.ts) for round-trip and validation coverage.
- Writes read and replace the entire array. There is no transaction or cross-context lock; concurrent writes can race. Do not describe this storage as transactional. A concurrency or storage-engine change needs its own targeted tests.

## Dictionary and privacy

The background uses HTTPS requests to `api.dictionaryapi.dev`, sending the selected word in the request URL. Vocabulary, source URLs and contexts are stored locally; the dictionary request itself is external. There is no vocabulary cloud sync or first-party server.

Dictionary requests use a 3-second request timeout and up to two retries with backoff; 404 and 429 responses are not retried. The cache is an in-memory map with a 24-hour TTL, not a durable promise to avoid requests for 24 hours after service-worker restarts.

Source URLs and contexts may contain sensitive information and are included in backups. History rendering must preserve text without interpreting it as HTML. Navigable source links are restricted to HTTP(S), with `noopener noreferrer` for new tabs.

Manifest permissions are `storage`, `activeTab`, `contextMenus`, and `<all_urls>` host access. Selection is enabled broadly on pages that permit injection. Permission changes need browser validation; an all-URLs declaration does not enable browser-internal pages.

## Future changes

IndexedDB, persistent dictionary caching, cloud sync, URL recording controls and phrase lookup are not part of the current implementation. Record an actual decision and its compatibility implications when one is requested, instead of copying proposed APIs into this document as existing behavior.
