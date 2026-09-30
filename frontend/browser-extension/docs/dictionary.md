# Dictionary sources and offline coverage

Chinese translation and English definitions are independent. English lookup first reads packaged WordNet 3.1; a hit needs no external **English dictionary** request and is marked **Offline dictionary · WordNet**. English misses or unavailable local assets use Free Dictionary API. In parallel, Chinese translation checks a separate local cache, then sends an uncached selected word to MyMemory. Thus even a word present in WordNet can make a Chinese translation request. The extension is not completely offline.

## Chinese translation and API keys

MyMemory's public `GET https://api.mymemory.translated.net/get?q=<word>&langpair=en|zh-CN` endpoint needs no key. Only the word and language pair are sent: no sentence, page URL, email, key, or vocabulary list. Successful responses are marked **Online translation · MyMemory**. Translation is word-level and may not capture the meaning of the surrounding sentence.

The [official API specification](https://mymemory.translated.net/doc/spec.php) makes `key` optional. The [usage limits](https://mymemory.translated.net/doc/usagelimits.php), checked 2026-09-30, specify 5,000 characters/day for anonymous use. Availability, quality and quota are not guaranteed. Exhausted quota, timeout, unavailable service and missing translation have distinct messages; no account or quota upgrade is configured automatically.

`local:translationCache` holds up to 500 successful word translations. Entries are reused for seven days, expired entries are ignored and removed on subsequent successful cache writes. The cache is separate from vocabulary and exports; Remember closes the card without adding vocabulary, but a successful translation can still be cached. Concurrent requests for one normalized word are coalesced. Network/body reads have a 4.5-second deadline; the content-side message deadline is six seconds.

Results render as each source finishes. Chinese can be saved when the English dictionary fails; English remains usable when Chinese fails. Saving stores the results available when clicked, not future responses. Context-menu saves wait for both bounded sources and retain whichever succeed. If both fail, no new word is saved.

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

The optional `Definition.translation` object contains `{ text, target: 'zh-CN', source: 'mymemory' }`. A Chinese-only result uses an empty English `meanings` array. Imports validate this optional field, retain literal text and accept older records without it; no migration is required.

Word-form matching uses the regular detachment rules documented in [WordNet Morphy](https://wordnet.princeton.edu/documentation/morphy7wn), with exact-match priority. It is not a complete implementation of Morphy's exception handling. Saving keeps the user's selected word as the vocabulary key and the matched headword in `definition.word`; counts and history are not silently merged into a different word.
