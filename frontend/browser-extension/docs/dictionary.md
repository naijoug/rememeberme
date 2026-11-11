# Dictionary sources and offline coverage

## Reviewed Remember Me catalog (2026-11-09)

The extension ships **15,434 exact spellings / 29,399 senses** in catalog
`627b40fb6ca5ca2e4c763b0e`, combining amended pilot edition
`9a0d1938f1db80952aa0ead7` and fifteen reviewed expansion editions. The 256 JSON
shards total 12,330,112 bytes, excluding the manifest and notices. All entries
have explicit AI-assisted review decisions. Proposed revisions and incomplete
independent reviews received separate editorial adjudication before admission.
The final 3,434 entries include 303 corrections relative to their drafts.
These are selected common and study-list spellings, not 15,434 distinct lemmas
or a measured frequency ranking. Review is not human expert certification or a
guarantee of error-free, exhaustive senses.

English and Chinese first read the same approved local entry. English then falls
back to the existing WordNet lookup; Chinese then falls back to its online-result
cache and public service. Lookup trims whitespace and folds the input to lowercase before exact-key matching;
capitalized homographs therefore share an entry. Exact hits do not send the word
to a lookup provider.
Generated forms are not automatic aliases. A corrupt, missing or slow learner
shard falls through safely; reads have a 1.5-second deadline, byte/hash checks,
shared pending reads and at most 24 cached shards. Only approved packaged entries
can be returned. The ordinary overall lookup deadlines remain in force.

The UI shows bilingual examples and allows scrolling through all of the compact
entry's senses, without a dictionary/provider footer. IPA
and speech remain independent. Other spellings, optional sentence explanation,
and some speech providers can still require network access; the extension is
not fully offline. A capability check for sentence explanation can occur even
when the word itself is served locally.

Saved snapshots use `Definition.source = 'rememberme-dict'`. The existing
`translation.source = 'magpie'` remains a legacy wire/native compatibility value,
not a claim about the provider of every entry;
optional `translation.dictionary` identifies the actual publication with
`{ id, version, entryHash, review: 'ai-assisted-v1' }`. This additive metadata and
optional per-sense `glossZh`, `exampleTranslation`, and `collocations` survive
current sync, legacy backups and Apple imports without a new provider enum.
Older clients may display the generation provider. Imported provenance is stored
metadata, not an authenticity certificate. Source and license references remain in this document and the packaged notices.

The published dictionary is separate from vocabulary and translation caches.
Local entries take precedence over older online caches and are not written into
those expiring caches. Updates do not rewrite saved definitions, counts or
history. The backend master retains both original drafts and the immutable
reviewed edition. See [review and acceptance](verification/2026-11-06-reviewed-dictionary.md)
and [build/review commands](../../../backend/docs/dictionary-build.md).

## Exam word-list categories

The local catalog carries KET, 四级 (CET4), 六级 (CET6), 专八 (TEM8), TOEFL and
IELTS as overlapping memberships. Word details and selection cards show matching
labels; the saved vocabulary view can filter by a list. Unclassified old imports
remain in All word lists. Settings shows approved local coverage against each
selected source list and links to that source. Changing a filter never changes
counts, history, imports or sync payloads. Membership is local catalog metadata,
not a field written into a saved word.

KET uses the pinned Cambridge August 2025 alphabetical headwords; other categories
use pinned community study-list membership. These are source-scoped classifications,
not a guarantee of every exam word or automatic inheritance between levels.
Labels apply to spellings, not to the difficulty of every individual sense.
Phrases and unsupported spellings/abbreviations are reported separately. The original
1,000 entries retain their existing senses; May and Turkey each add a common
capitalized homograph sense. All 14,434 additional entries are now reviewed and
packaged. The final addition preserves the preceding 12,000 entries exactly.

| Category | Approved / supported source words | Missing | Excluded source items |
| --- | ---: | ---: | ---: |
| KET | 1,606 / 1,606 | 0 | 146 |
| 四级 | 3,846 / 3,846 | 0 | 3 |
| 六级 | 5,406 / 5,406 | 0 | 1 |
| 专八 | 12,197 / 12,197 | 0 | 0 |
| 托福 | 6,970 / 6,970 | 0 | 4 |
| 雅思 | 5,038 / 5,038 | 0 | 2 |

Coverage is complete for the pinned supported single-word sets. Excluded phrases,
unsupported spellings/abbreviations and the open-ended KET Appendix 1 sets are not
part of these denominators. Categories overlap, so their counts must not be added
to obtain the catalog size. All 15,434 English and Chinese local lookups passed
in disposable Chrome; see the [completion receipt](../../../backend/docs/verification/2026-11-09-dictionary-progress.md).

## Magpie update (2026-10-24)

Current source supports backend Magpie translation through the `group/translator` routing group
and server-side MyMemory fallback. The new `magpie` source is accepted alongside
legacy `hermes` and `mymemory` snapshots without rewriting saved history.
Extension 0.1.2 uses `public:v3:` translation caches and displays the actual
source. Older installed clients must be updated before consuming Magpie results.
The descriptions and dated acceptance links below retain pre-Magpie context;
use the new deployment record for current host acceptance.

Chinese translation and English definitions are independent. English reads the reviewed local edition first, then packaged WordNet; local hits need no external English request. Source metadata distinguishes WordNet results in data and exports; the lookup UI does not show a source footer. Local misses or broken assets call the built-in service. After a reviewed-local miss, Chinese uses a separate success cache, then the same service. No user API input or login is required. The plugin never directly calls third-party dictionary/translation providers. It is not completely offline.

## Service dictionary, translation and API keys

Public `POST /api/v1/public/lookup/dictionary` sends `{ word }`; the fixed gateway tries [Free Dictionary API](https://dictionaryapi.dev/) through Cloudflare egress and recovers through the Tencent server’s checked-in WordNet/fallback chain. Private/direct API calls retain the server’s local-first order. Public `POST /api/v1/public/lookup/translation` sends `{ word, target: 'zh-CN' }`; the server prefers Magpie `group/translator` and falls back to MyMemory for timeout/busy/upstream errors or an open word circuit. Profile-isolation failures remain explicit. The built-in service origin is internal configuration, not a UI input. Routes are word-only, origin-checked, limited to 30 requests/minute per IP and eight distinct concurrent requests per service. Public requests omit credentials and never enable sync or create an account.

Magpie/Hermes/model credentials remain server-side. [MyMemory](https://mymemory.translated.net/doc/spec.php) receives only the word and language pair. No page sentence/URL, email or vocabulary list is sent to lookup providers. Cloudflare carries that same selected word through HTTPS and a persistent private connection. The server shares its anonymous MyMemory quota; `MYMEMORY_ENABLED=false` disables fallback. Returned data retains provider/source metadata, while translation and definition text display without provider/source footers. Translation is word-level; quality and availability are not guaranteed.

IndexedDB `rememberme-translation-cache-v1` retains at most 10,000 successful word results, with an indexed per-entry store and a 256-entry memory LRU. Keys include the lookup origin, `public:v3`, target language and normalized word. Freshness is seven days for Magpie/Hermes/legacy anonymous results and one hour for public MyMemory. Valid results remain usable for at most 30 days: the page card receives a cached preview immediately while its cancellable Port awaits revalidation. Failures retain the old result and back off for one minute. One-shot legacy/context-menu callers reuse stale results without detached refresh work. Entries older than 30 days are never served; expired rows are pruned on cache writes. The old `local:translationCache` is imported once for current public-v3 and plain anonymous keys, retained unchanged for rollback, and never confused with account caches. Writes are best-effort, cache reads have a 150 ms budget, and storage failure falls back to live lookup. Both caches remain separate from vocabulary/exports. Chinese has a nineteen-second HTTP budget, twenty-second service deadline and twenty-two-second UI deadline. The first HTTP attempt has nine seconds, exceeding the three-second Magpie plus four-second MyMemory provider budgets. Two consecutive Magpie failures open a 30-second circuit; one probe then checks recovery. Local capacity rejection does not count. The circuit is separate from sentence explanation, and existing cached results remain usable. An eligible transport/upstream failure gets one retry; structured `retryable: false`, HTTP 4xx, malformed JSON and oversized responses do not. English keeps an 8.5-second service/ten-second UI budget; the server local dictionary has 1.5 seconds and the remote fallback six seconds.

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

The WordNet source is [WordNet](https://wordnet.princeton.edu/), using the data distribution [wordnet-db 3.1.14](https://github.com/moos/wordnet-db). Original permission and copyright notices ship in [LICENSE.txt](../public/dictionary/wordnet/LICENSE.txt), [DATA-LICENSE.txt](../public/dictionary/wordnet/DATA-LICENSE.txt) and [NOTICE.txt](../public/dictionary/wordnet/NOTICE.txt). The checked-in [metadata](../public/dictionary/wordnet/metadata.json) identifies the pinned archive and SHA-512 integrity. The WordNet source does not endorse this extension.

## Reproduce the assets

Download the archive named in `metadata.json`, then run from this package:

```sh
python3 scripts/build-wordnet.py /path/to/wordnet-db-3.1.14.tgz
```

The [conversion script](../scripts/build-wordnet.py) rejects an archive with a different SHA-512 digest, reads only known data members and executes no package scripts. It uses WordNet's index files for sense ordering and data files for definitions/examples, as described in the [database format](https://wordnet.princeton.edu/documentation/wndb5wn). No extra npm dependency is installed. Generated source assets under `public/dictionary/wordnet/` are committed and copied by WXT; users do not run the conversion step.

`Definition.source` is optional and additive. Old saved vocabulary and JSON backups remain valid; exports of new records retain their source identifier. Source links are hardcoded by the UI, never taken from imported data.

The optional `Definition.translation` object contains `{ text, target: 'zh-CN', source: 'mymemory' | 'hermes' | 'magpie' }`. A Chinese-only result uses an empty English `meanings` array. Imports validate this optional field, retain literal text and accept older records without it; no migration is required.

Word-form matching uses the regular detachment rules documented in [WordNet Morphy](https://wordnet.princeton.edu/documentation/morphy7wn), with exact-match priority. It is not a complete implementation of Morphy's exception handling. Saving keeps the user's selected word as the vocabulary key and the matched headword in `definition.word`; counts and history are not silently merged into a different word.

## Deployment status

The persistent personal `workers.dev` lookup gateway routes through a dedicated named tunnel to Tencent’s loopback-only bridge. It admits health, word lookup, sentence explanation, capability and public privacy paths, never accounts or sync. Restarting the connector keeps the public hostname. Workers VPC is beta; this is not a guaranteed service SLA.

Live fixed-gateway Hermes translation and Free Dictionary results have been observed. Tencent egress to Free Dictionary timed out, so the public gateway uses Cloudflare egress first for English misses. Uncovered inflections such as curated may still return provider failure; Chinese remains independent. WordNet and IPA coverage remain bounded. Current source enables account controls and sync on sign-in; dated release records establish the separately verified account-ingress and browser acceptance.

See [release materials](release/README.md) for package acceptance and [deployment](../../../backend/docs/tencent-deployment.md) for host recovery. Historical [temporary lookup verification](verification/2026-10-14-temporary-lookup.md) describes the replaced random Quick Tunnel, not the current configuration.

Latest completion and acceptance: [November 9 receipt](../../../backend/docs/verification/2026-11-09-dictionary-progress.md).
