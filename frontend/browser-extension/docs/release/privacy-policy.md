# Remember Me Privacy Policy

Draft for version 0.1.0 · Prepared 2026-09-29

Publication checklist: replace the developer/contact placeholders below, set the effective date, and publish this policy at an accessible HTTPS URL before submitting the store listing.

## What Remember Me does

Remember Me helps you look up single English words while reading and keep a vocabulary history of words you forget. No account is required. The extension has no developer-operated backend or cloud vocabulary synchronization.

## Information processed on your device

On supported pages, the extension reads your selected text to recognize an English word and show its definition. When you click the bookmark counter or use the **Remember Me** context-menu item, it stores the word, dictionary definition, forget count, surrounding sentence context, full source page URL, and timestamps in the browser's local extension storage. The full URL may include query parameters or fragments. Imported JSON files are also processed and merged locally.

This information is used to display your vocabulary, sort it, show encounter history, and support import/export. The extension does not upload your saved vocabulary, surrounding sentence context, or source page URLs to a developer server. It does not include advertising or analytics code, and does not sell this data or use it for advertising, profiling, or credit decisions.

## External dictionary requests

Selecting a valid English word automatically starts English lookup and Chinese translation before you choose whether to record the word. The context-menu shortcut starts both after a page connection is established. English first checks packaged WordNet and its in-memory cache; misses or local file failures send the selected word to **Free Dictionary API** at `https://api.dictionaryapi.dev/api/v2/entries/en/<word>`. Chinese checks its local success cache, then sends uncached words and the language pair `en|zh-CN` to **MyMemory** at `https://api.mymemory.translated.net/get`. A local English hit therefore does not imply that no external request occurs.

These providers receive the queried word and connection information normally exposed by HTTPS, including your IP address. The extension does not add your saved vocabulary, sentence context, source page URL or email to those requests. Provider practices govern their processing and retention; this policy makes no retention promises on their behalf. Service information: <https://dictionaryapi.dev/> and <https://mymemory.translated.net/>.

Chinese translation and the English fallback need a network connection; the extension is not completely offline. Closing the card does not add vocabulary, but does not undo requests already sent. Successful Chinese translations are cached locally for reuse for seven days, up to 500 entries; expired entries are ignored and removed on subsequent successful cache writes. This cache is separate from vocabulary and is excluded from vocabulary exports. Use browser site-access controls to restrict where selection lookup runs.

## Backups and history links

Export creates a JSON file on your device containing all saved entries, including sentence contexts and full source URLs. These files can contain sensitive browsing information. You control where they are stored and with whom they are shared. Import does not upload the file; repeated imports add counts and history again.

Opening a saved HTTP(S) history link navigates to that website, which receives a normal browser request and is governed by its own privacy practices. Other URL schemes are displayed as text rather than opened from history.

## Retention and deletion

Vocabulary remains in local extension storage until you delete entries or the browser removes that storage, for example when the extension is uninstalled. Deleting a word requires confirmation and removes its stored definition and history. Resetting its count retains its history. Exported files are separate copies and must be deleted separately. Local data is not protected by an additional extension-managed encryption layer.

## Pronunciation

Phonetic transcriptions are read from a separately packaged IPA dictionary. This lookup is local and does not send the selected word to an external service. It does not rewrite saved vocabulary or history. Missing transcriptions are not generated from your context or uploaded for processing.

Pronunciation uses browser speech synthesis only when you click **US** or **UK**, and prefers a matching local device voice. When only a matching remote voice is available, the browser's speech provider may process the clicked word. The extension passes no sentence context, source URL or vocabulary list to speech synthesis, and does not fetch audio URLs from dictionary or imported data. Voice availability and any remote processing depend on your browser/device.

## Permissions

- **Storage:** persist your vocabulary and history locally.
- **Context menus:** offer the Remember Me shortcut for selected text.
- **Site access:** detect selections, extract surrounding text when saving, show lookup cards and notifications on supported pages, and reach the external dictionary API. Browser-internal and other restricted pages are unsupported. Local-file access requires the browser's separate permission where applicable.

## Changes and contact

Changes to these practices will be reflected in this policy and, where necessary, in the extension's permissions or consent flow.

- Developer/publisher: **[DEVELOPER NAME — required before publication]**
- Privacy/support contact: **[PUBLIC EMAIL OR SUPPORT URL — required before publication]**
- Effective date: **[PUBLICATION DATE]**
