# Remember Me Privacy Policy

Version 0.1.3 · Effective 2026-10-25 · Developer: naijoug

## What Remember Me does

Remember Me translates single English words selected on supported webpages and lets you keep a local vocabulary with encounter counts and history. You do not need an account. Optional GitHub sign-in and account synchronization let you share vocabulary with the macOS client. Lookup works without signing in. Service addresses are internal configuration and are not shown or entered in the interface.

## Information processed on your device

The extension reads selected text to recognize an English word and display its Chinese translation, English definitions and pronunciation. When you click the bookmark counter or use the Remember Me selection context-menu action, it stores the word, encounter count, definition/translation snapshot, surrounding sentence, complete page URL and timestamps in extension IndexedDB. URLs may contain query parameters or fragments. Imported JSON backups are processed locally. Closing the card does not save vocabulary.

The saved vocabulary supports reading history, search, sorting, count reset, deletion and JSON import/export. Saved vocabulary remains local until you explicitly copy it to an account and enable synchronization. The extension excludes saved sentences and source URLs from outgoing sync requests. Local theme preferences and successful translation caches use separate extension storage. The extension contains no advertising or analytics integration and does not sell or use vocabulary for advertising or profiling.

## Online lookup and service providers

Selecting a supported word can send an online request before you decide whether to save it. English lookup first uses packaged WordNet and local caches. A local miss or unavailable asset sends only the selected word to the Remember Me lookup service; the service may call Free Dictionary API through Cloudflare for an uncovered word, with the server's packaged WordNet as a recovery source. Chinese lookup uses a local success cache, then sends only the selected word and target language to the lookup service.

Cloudflare carries lookup traffic over HTTPS and a private service connection to the backend hosted on Tencent Cloud. These infrastructure providers process connection information such as IP address and request timing. Anonymous lookups use a gateway that accepts only word lookup and strips account credentials and cookies. A separate authenticated account gateway on the same HTTPS service carries optional login and synchronization to the original backend database. It preserves only the required OAuth flow cookie and authenticated API headers. Provider keys and tunnel credentials remain on the server and are not included in the extension or backups.

The backend normally uses the same-server Magpie gateway with the zhipu/glm-5.3-flash model. The selected word may be processed by that model provider. If the preferred translation provider times out, is busy or returns invalid/unavailable output, the backend may send that same word to MyMemory and return its translation. Results show the provider actually used. A transient failed lookup may resend the same word once within the original request budget; vocabulary mutations are never retried by this lookup recovery. The backend does not pass page sentences, page URLs, saved vocabulary lists, email addresses or personal memory to lookup providers. It does not enable agent tools or MCP for translation.

Third-party processing and retention are governed by each provider's practices; this policy makes no promises on their behalf. Service references: [Cloudflare](https://www.cloudflare.com/privacypolicy/), [Tencent Cloud](https://www.tencentcloud.com/document/product/301/17345), [Magpie](https://usemagpie.ai/docs/privacy), [GLM provider](https://www.bigmodel.cn/), [MyMemory](https://mymemory.translated.net/) and [Free Dictionary API](https://dictionaryapi.dev/).

A packaged English hit does not mean that the separate Chinese request is offline. Closing a card cannot undo a request already sent. The extension requires internet access for uncached online results, and the provider may have availability or quota limits. Browser site-access controls can restrict where the extension runs.

## Caches and operational records

Successful Chinese translations are retained on the device in a cache with at most 500 entries. Magpie and retained Hermes results last up to seven days; MyMemory fallback results from the lookup service last up to one hour. Retained older anonymous translation caches keep their seven-day policy. English results use a bounded in-memory cache; packaged dictionary shards also have bounded memory caches. Translation caches are excluded from vocabulary exports.

The backend keeps bounded in-memory lookup caches, request coalescing and rate-limit counters. Successful server lookup caches hold at most 1,000 entries per service; translation successes use the same seven-day/one-hour provider policy. Restarting the backend clears its in-memory records. Normal lookup creates no account, session or vocabulary database record.

Remember Me application diagnostic logs use request IDs and response status, without word text, page sentences, URLs or credentials. The fixed gateway disables invocation logging and does not add request-body logging. Magpie maintains gateway usage and routing records under its server configuration. Hosting platforms may retain infrastructure metadata according to their own settings and policies. This version does not promise a specific retention period for provider/platform records.

## Backups and history links

Export creates a JSON file on your device containing saved vocabulary, counts, definition snapshots, sentences, URLs and timestamps. Such backups can contain sensitive browsing information. You decide where to keep or share them. Import adds counts and history, so repeatedly importing the same backup can duplicate those values. No import/export file is sent to the lookup service.

Opening a saved HTTP(S) source link makes a normal request to that website. Other URL schemes are displayed as text and are not opened as links. Websites you visit have their own privacy practices.

## Retention and deletion

Vocabulary remains in extension storage until it is deleted or the browser removes extension data. Deleting a word requires confirmation and removes it from the active vocabulary; resetting its count retains encounter history. Compatibility snapshots and existing local recovery copies can retain prior records until extension storage is cleared. Deleting an active word does not erase those snapshots, recovery copies or exported files. To remove all local extension data, remove the extension or clear its storage using browser controls; exported backups must be deleted separately.

This version adds no extension-managed encryption layer. Optional account data is protected in transit by HTTPS; this is not end-to-end encryption. GitHub sign-in supplies your GitHub numeric identity and login name to create or reopen your Remember Me account; the application requests no additional GitHub scopes. Session credentials are retained in extension storage, and the macOS client uses Keychain. After you confirm copying local vocabulary and enable sync, the service stores words, counts, definition snapshots, encounter identities/timestamps, review schedules/events and deletion state in your account. The original anonymous vocabulary remains on the device. Opening an account alone does not upload it. Contexts and URLs are excluded by the extension; native source sharing additionally requires explicit per-device/account consent. Pausing or disconnecting stops sending but does not delete already uploaded account data. Disconnect clears this device’s credentials and attempts to revoke its server session; when offline, the interface reports that server revocation could not be confirmed. The server stores hashed rotation metadata for a bounded 24-hour retry window, not raw session tokens. Local backups and recovery copies remain independent. Account deletion and device revocation are explicit authenticated actions; provider/platform backup retention is not controlled by removing the extension.

## Pronunciation

IPA is read from packaged US/UK dictionaries and does not require an online lookup. Clicking a speaker button uses browser speech synthesis and prefers an exact matching local voice. If a matching remote voice is used, the browser's speech provider may receive the clicked word. The extension sends no sentence, URL or vocabulary list to speech synthesis and does not fetch audio URLs from dictionary/imported data. Playback never records an encounter automatically.

## Permissions

- Storage: retain local vocabulary, caches, theme and compatibility/recovery snapshots.
- Context menus: offer the Remember Me shortcut for selected text.
- Identity: open the GitHub login flow and return to this installed extension through its exact registered callback.
- Alarms: request bounded synchronization of an explicitly enabled account.
- Site access: detect selections and display cards on supported pages, capture a sentence/URL only when recording, and reach the internal lookup service. Browser-internal pages and other restricted sites are not supported. File pages require the browser's separate file-access permission.

Remember Me handles user data only to provide its word lookup and local vocabulary features, consistent with the Chrome Web Store User Data Policy and Limited Use requirements. Data is not transferred for advertising, sold, or used to determine creditworthiness.

Account-enabled builds request identity and alarms permissions for optional sign-in and synchronization. Development feedback builds have additional localhost/update permissions and are not the store package.

## Contact and changes

Developer/publisher: **naijoug**. Support and privacy questions: [Remember Me GitHub Issues](https://github.com/naijoug/rememeberme/issues).

Issues are public. Do not post vocabulary exports, private page links, credentials or other sensitive information. If a request needs private details, first ask for a private communication method without including those details. GitHub processes support messages under its own policies.

Changes to these practices will be reflected in this policy and, where required, in the extension's permissions or user choices.
