# Dictionary sources and offline coverage

Chinese translation and English definitions are independent. English lookup first reads packaged WordNet 3.1; a hit needs no external **English dictionary** request and is marked **Offline dictionary · WordNet**. English misses or unavailable local assets use Free Dictionary API. In parallel, Chinese translation checks a separate local cache, then uses authenticated backend Hermes when connected, or MyMemory when disconnected. Thus even a word present in WordNet can make a Chinese translation request. The extension is not completely offline.

## Chinese translation and API keys

MyMemory's public `GET https://api.mymemory.translated.net/get?q=<word>&langpair=en|zh-CN` endpoint needs no key. Only the word and language pair are sent: no sentence, page URL, email, key, or vocabulary list. Successful responses are marked **Online translation · MyMemory**. Translation is word-level and may not capture the meaning of the surrounding sentence.

The [official API specification](https://mymemory.translated.net/doc/spec.php) makes `key` optional. The [usage limits](https://mymemory.translated.net/doc/usagelimits.php), checked 2026-09-30, specify 5,000 characters/day for anonymous use. Availability, quality and quota are not guaranteed. Exhausted quota, timeout, unavailable service and missing translation have distinct messages; no account or quota upgrade is configured automatically.

`local:translationCache` holds up to 500 successful word translations. Entries are reused for seven days, expired entries are ignored and removed on subsequent successful cache writes. The cache is separate from vocabulary and exports; closing the card does not add vocabulary, but a successful translation can still be cached. Concurrent requests for one normalized word are coalesced. Client network/body reads have a fifteen-second deadline; the content-side message deadline is seventeen seconds. Connected refresh adds its own transport deadline. Hermes itself has a twelve-second backend deadline. Cache keys separate providers, origins and accounts.

Results render as each source finishes. The bookmark counter records the selected word, sentence, click time and URL even if neither source has succeeded, using an empty definition snapshot in that case. Saving stores results available when clicked, not future responses. The separate context-menu shortcut waits for both bounded sources and retains whichever succeed; if both fail, that shortcut still reports failure without saving.

Chinese translation display converts recognized bracketed numbered pinyin to tone marks: `哄騙 哄骗 [hong3 pian4]` appears as `哄騙 哄骗 [hǒng piàn]`. Tones 1–4 receive diacritics; 0/5 are neutral, and `v` / `u:` normalize to `ü`. The formatter checks complete syllable annotations following Chinese text, preserving ordinary numbers, non-pinyin brackets, malformed annotations and already marked pinyin. Traditional/simplified wording is retained. This is display formatting only: provider text, existing translation caches, saved snapshots and exported JSON are unchanged. Both the page card and saved-word reading view use it, including older cached/imported entries; text is still rendered literally with Vue interpolation.

## Pronunciation

The page card and vocabulary reading view show US/UK phonetic transcriptions labeled with United States / United Kingdom SVG flag icons, each followed by a small speaker icon. They load exact selected spellings from a separate packaged [ipa-dict](https://github.com/open-dict-data/ipa-dict) dataset, independently of WordNet/translation results. This adds no external phonetic lookup: `GET_PHONETICS` reads one local shard in the background. Transcriptions are display data, not new vocabulary fields; old saved words receive them without rewriting history or JSON backups.

The shipped data covers **146,548** supported spellings: **124,987 US** and **65,119 UK** entries, with overlap. All IPA strings, including multiple pronunciations, are retained as supplied; no context-based heteronym choice is made. Some words have only one accent or no entry. An existing matching-word dictionary phonetic remains a general fallback; a base word's IPA is never used for a selected inflection. Missing data is stated explicitly and loading failures offer retry without blocking playback or definitions.

There are 64 JSON shards (5,934,514 bytes); the service retains at most 16 parsed shards and coalesces simultaneous reads. Local headers/body have a 1.5-second deadline and the UI message has two seconds. Sources, SHA-256 hashes, counts and limitations are in [metadata.json](../public/dictionary/ipa/metadata.json). The [notice](../public/dictionary/ipa/NOTICE.txt) identifies upstream sources and modifications: US data is cmudict-ipa-derived, with MIT/CMU notices; UK data is ipacards-derived under GPL-3.0. Full permission notices and unmodified corresponding TSV sources (`en_US.txt.gz`, `en_UK.txt.gz`) ship with the assets. To reproduce, decompress those sources into a directory with the accompanying license files and run `python3 scripts/build-ipa.py /path/to/source-directory`; the converter verifies pinned hashes before writing assets. Broad source transcriptions may differ from familiar learner-dictionary notation.

Playback uses the browser's [SpeechSynthesis voice list](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/getVoices) for exact `en-US` / `en-GB` voices, preferring a device voice. A matching remote voice may send the clicked word to the browser's speech provider. No context, URL or vocabulary list is passed to speech synthesis, and no imported/provider audio URL is fetched. Voice availability is device-dependent; missing accents are disabled with system-voice guidance and playback failures/timeouts remain retryable. The system voice chooses its own pronunciation variant; displaying multiple IPA variants does not let the extension select a specific one. Nothing plays automatically and no account or manifest permission is added.

## Packaged data

- 82,810 single English headwords, filtered to the extension's selection alphabet. Multiword entries are omitted because phrase selection is not supported.
- Nouns, verbs, adjectives and adverbs, preserving WordNet's sense order. Exact headwords take priority. On a miss, common WordNet suffix rules try plural, verb and comparative/superlative forms, verifying both the candidate and its part of speech in the packaged data (for example, `having` → `have`). The card keeps the selected spelling and identifies the base form. This is an English lexical database, not a Chinese translation or pronunciation dictionary. It does not include phonetics/audio, comprehensive function-word coverage, recent terminology or morphological exception lists. Irregular and ambiguous forms remain incomplete; unsupported forms can still require an online lookup.
- 256 JSON shards, approximately 13.8 MB uncompressed in total. An exact lookup loads one packaged shard; a suffix lookup may read additional shards concurrently. At most 24 parsed shards are retained in the background's memory. The browser loads these from its own extension URL, not from a CDN. No API key, account or new host permission is required.
- The entire local lookup, including suffix candidates, has a 1.5-second deadline; individual file/body reads are also bounded. English fallback finishes within an 8.5-second total service budget, leaving headroom before the card's ten-second English-message deadline.
- Unknown words are not assigned invented English definitions. For example, the packaged `curate` entry contains only the clergy noun sense, so it must not be used as the verb definition of `curated`. A successful Chinese result may still be shown and saved separately.

The current source is [WordNet](https://wordnet.princeton.edu/), using the data distribution [wordnet-db 3.1.14](https://github.com/moos/wordnet-db). Original permission and copyright notices ship in [LICENSE.txt](../public/dictionary/wordnet/LICENSE.txt), [DATA-LICENSE.txt](../public/dictionary/wordnet/DATA-LICENSE.txt) and [NOTICE.txt](../public/dictionary/wordnet/NOTICE.txt). The checked-in [metadata](../public/dictionary/wordnet/metadata.json) identifies the pinned archive and SHA-512 integrity. The WordNet source does not endorse this extension.

## Reproduce the assets

Download the archive named in `metadata.json`, then run from this package:

```sh
python3 scripts/build-wordnet.py /path/to/wordnet-db-3.1.14.tgz
```

The [conversion script](../scripts/build-wordnet.py) rejects an archive with a different SHA-512 digest, reads only known data members and executes no package scripts. It uses WordNet's index files for sense ordering and data files for definitions/examples, as described in the [database format](https://wordnet.princeton.edu/documentation/wndb5wn). No extra npm dependency is installed. Generated source assets under `public/dictionary/wordnet/` are committed and copied by WXT; users do not run the conversion step.

`Definition.source` is optional and additive. Old saved vocabulary and JSON backups remain valid; exports of new records retain their source identifier. Source links are hardcoded by the UI, never taken from imported data.

The optional `Definition.translation` object contains `{ text, target: 'zh-CN', source: 'mymemory' | 'hermes' }`. A Chinese-only result uses an empty English `meanings` array. Imports validate this optional field, retain literal text and accept older records without it; no migration is required.

Word-form matching uses the regular detachment rules documented in [WordNet Morphy](https://wordnet.princeton.edu/documentation/morphy7wn), with exact-match priority. It is not a complete implementation of Morphy's exception handling. Saving keeps the user's selected word as the vocabulary key and the matched headword in `definition.word`; counts and history are not silently merged into a different word.

## Connected Hermes provider

Cloud login routes Chinese requests through the authenticated business API.
Hermes runs privately on the server with an isolated translation profile, no
tools/MCP/memory, and a server-side bearer key. Only the selected word and target
are accepted by the business endpoint; webpage context/URL and vocabulary are
excluded. The model provider configured in Hermes may receive that word. Hermes
results display their own attribution; existing MyMemory snapshots are unchanged.
An unavailable/misconfigured connected backend reports an error and does not
silently send the word to a different provider. The live server API is not yet
configured/verified. See [deployment status](../../../backend/docs/tencent-deployment.md).
