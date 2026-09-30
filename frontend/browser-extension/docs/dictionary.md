# Dictionary sources and offline coverage

Lookups first read a packaged WordNet 3.1 dictionary. A hit returns English definitions and any available examples without a request to an external dictionary service. The selection card and saved reading view identify the source as **Offline dictionary · WordNet**. Only a local miss or an unavailable local asset uses Free Dictionary API; those fallback requests still send the selected word to `api.dictionaryapi.dev`. The extension is not completely offline.

## Packaged data

- 82,810 single English headwords, filtered to the extension's selection alphabet. Multiword entries are omitted because phrase selection is not supported.
- Nouns, verbs, adjectives and adverbs, preserving WordNet's sense order. Exact headwords take priority. On a miss, common WordNet suffix rules try plural, verb and comparative/superlative forms, verifying both the candidate and its part of speech in the packaged data (for example, `having` → `have`). The card keeps the selected spelling and identifies the base form. This is an English lexical database, not a Chinese translation or pronunciation dictionary. It does not include phonetics/audio, comprehensive function-word coverage, recent terminology or morphological exception lists. Irregular and ambiguous forms remain incomplete; unsupported forms can still require an online lookup.
- 256 JSON shards, approximately 13.8 MB uncompressed in total. An exact lookup loads one packaged shard; a suffix lookup may read additional shards concurrently. At most 24 parsed shards are retained in the background's memory. The browser loads these from its own extension URL, not from a CDN. No API key, account or new host permission is required.
- The entire local lookup, including suffix candidates, has a 1.5-second deadline; individual file/body reads are also bounded. A failure falls back online within the same 10-second total lookup budget. The card separately bounds an unresponsive background request.
- Unknown words are not assigned invented definitions. If both local and online lookups fail, the existing retryable error state remains and saving stays disabled.

The current source is [WordNet](https://wordnet.princeton.edu/), using the data distribution [wordnet-db 3.1.14](https://github.com/moos/wordnet-db). Original permission and copyright notices ship in [LICENSE.txt](../public/dictionary/wordnet/LICENSE.txt), [DATA-LICENSE.txt](../public/dictionary/wordnet/DATA-LICENSE.txt) and [NOTICE.txt](../public/dictionary/wordnet/NOTICE.txt). The checked-in [metadata](../public/dictionary/wordnet/metadata.json) identifies the pinned archive and SHA-512 integrity. The WordNet source does not endorse this extension.

## Reproduce the assets

Download the archive named in `metadata.json`, then run from this package:

```sh
python3 scripts/build-wordnet.py /path/to/wordnet-db-3.1.14.tgz
```

The [conversion script](../scripts/build-wordnet.py) rejects an archive with a different SHA-512 digest, reads only known data members and executes no package scripts. It uses WordNet's index files for sense ordering and data files for definitions/examples, as described in the [database format](https://wordnet.princeton.edu/documentation/wndb5wn). No extra npm dependency is installed. Generated source assets under `public/dictionary/wordnet/` are committed and copied by WXT; users do not run the conversion step.

`Definition.source` is optional and additive. Old saved vocabulary and JSON backups remain valid; exports of new records retain their source identifier. Source links are hardcoded by the UI, never taken from imported data.

Word-form matching uses the regular detachment rules documented in [WordNet Morphy](https://wordnet.princeton.edu/documentation/morphy7wn), with exact-match priority. It is not a complete implementation of Morphy's exception handling. Saving keeps the user's selected word as the vocabulary key and the matched headword in `definition.word`; counts and history are not silently merged into a different word.
