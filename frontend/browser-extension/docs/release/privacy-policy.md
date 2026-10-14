# Remember Me Privacy Policy

Draft for version 0.1.0 · Updated 2026-10-14 · Unpublished draft

Publication checklist: replace the developer/contact placeholders below, set the effective date, and publish this policy at an accessible HTTPS URL before submitting the store listing.

## What Remember Me does

Remember Me helps you look up single English words while reading and keep a vocabulary history of words you forget. Local vocabulary does not require an account. Optional GitHub login connects an HTTPS backend for Hermes translation and explicitly enabled account vocabulary synchronization.

## Information processed on your device

On supported pages, the extension reads your selected text to recognize an English word and show its definition. When you click the bookmark counter or use the **Remember Me** context-menu item, it stores the word, dictionary definition, forget count, surrounding sentence context, full source page URL, and timestamps in the browser's extension IndexedDB. The full URL may include query parameters or fragments. Imported JSON files are also processed and merged locally.

This information is used to display your vocabulary, sort it, show encounter history, and support import/export. Without enabled account sync, saved vocabulary stays local. After explicit account copy/import and sync enablement, words, definitions, counts, timestamps and encounter identities are sent to your configured backend. This extension excludes surrounding sentence context and source URLs from outgoing synchronization. It does not include advertising or analytics code, and does not sell this data or use it for advertising, profiling, or credit decisions.

## External dictionary requests

Selecting a valid English word automatically starts English lookup and Chinese translation before you choose whether to record the word. The context-menu shortcut starts both after a page connection is established. English first checks packaged WordNet and its in-memory cache; misses or local file failures send the selected word to **Free Dictionary API** at `https://api.dictionaryapi.dev/api/v2/entries/en/<word>`. Disconnected Chinese lookup checks its local success cache, then sends uncached words and the language pair `en|zh-CN` to **MyMemory** at `https://api.mymemory.translated.net/get`. A local English hit therefore does not imply that no external request occurs.

These providers receive the queried word and connection information normally exposed by HTTPS, including your IP address. The extension does not add your saved vocabulary, sentence context, source page URL or email to those requests. Provider practices govern their processing and retention; this policy makes no retention promises on their behalf. Service information: <https://dictionaryapi.dev/> and <https://mymemory.translated.net/>.

Connected Chinese lookup sends the selected word and `zh-CN` to the authenticated backend, which calls a private Hermes translation profile and its configured model provider. The backend receives device credentials and connection metadata; Hermes credentials stay server-side. Connected translation does not silently switch to MyMemory on failure. Provider/account caches are kept separate. GitHub handles authentication and the backend stores an opaque account/device identity with hashed session credentials. Browser device access/refresh credentials are retained in extension local storage; they are excluded from vocabulary exports.

Chinese translation and the English fallback need a network connection; the extension is not completely offline. Closing the card does not add vocabulary, but does not undo requests already sent. Successful Chinese translations are cached locally for reuse for seven days, up to 500 entries; expired entries are ignored and removed on subsequent successful cache writes. This cache is separate from vocabulary and is excluded from vocabulary exports. Use browser site-access controls to restrict where selection lookup runs.

## Backups and history links

Export creates a JSON file on your device containing all saved entries, including sentence contexts and full source URLs. These files can contain sensitive browsing information. You control where they are stored and with whom they are shared. Import processes the file locally. In an account partition, it prepares word/definition/history operations for transmission when sync is enabled, excluding local contexts and URLs. Repeated imports add counts and history again.

Opening a saved HTTP(S) history link navigates to that website, which receives a normal browser request and is governed by its own privacy practices. Other URL schemes are displayed as text rather than opened from history.

## Retention and deletion

Vocabulary remains in extension IndexedDB until browser storage is removed. Deleting a word requires confirmation and hides its active lifecycle; account deletion operations create cloud tombstones to prevent accidental resurrection. Reset retains history. Upgrade snapshots and explicitly created recovery copies retain old words/requests privately, including local source text, until extension storage is removed; deleting an active word does not erase those copies. Server retention/account erasure must be documented for the actual deployed service before publication.

Disconnecting clears local device credentials and attempts server revocation, while retaining local/account vocabulary copies. It does not erase cloud data. Exported files remain separate copies and must be deleted separately. This version adds no extension-managed local encryption layer.

## Pronunciation

Phonetic transcriptions are read from a separately packaged IPA dictionary. This lookup is local and does not send the selected word to an external service. It does not rewrite saved vocabulary or history. Missing transcriptions are not generated from your context or uploaded for processing.

Pronunciation uses browser speech synthesis only when you click **US** or **UK**, and prefers a matching local device voice. When only a matching remote voice is available, the browser's speech provider may process the clicked word. The extension passes no sentence context, source URL or vocabulary list to speech synthesis, and does not fetch audio URLs from dictionary or imported data. Voice availability and any remote processing depend on your browser/device.

## Permissions

- **Storage:** retain settings, translation caches, device credentials and the original vocabulary snapshot. Vocabulary/outbox use IndexedDB.
- **Identity:** open GitHub/backend PKCE login with an exact installed-extension callback.
- **Alarms:** trigger bounded synchronization attempts while sync is enabled.
- **Context menus:** offer the Remember Me shortcut for selected text.
- **Site access:** detect selections, extract surrounding text when saving, show lookup cards and notifications on supported pages, and reach dictionary providers and your configured backend. Browser-internal and other restricted pages are unsupported. Local-file access requires the browser's separate permission where applicable.

## Changes and contact

Changes to these practices will be reflected in this policy and, where necessary, in the extension's permissions or consent flow.

- Developer/publisher: **[DEVELOPER NAME — required before publication]**
- Privacy/support contact: **[PUBLIC EMAIL OR SUPPORT URL — required before publication]**
- Effective date: **[PUBLICATION DATE]**
