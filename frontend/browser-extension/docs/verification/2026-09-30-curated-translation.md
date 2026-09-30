# Curated and bilingual lookup — 2026-09-30

Scope: investigate the user's curated timeout and API-key question, then supply Chinese translation independently of English dictionary coverage. Existing release-preparation and repository documentation edits were preserved. No commit/push or new watcher was started.

Environment: macOS, Node 22.22.3, WXT 0.20.11, the existing Remember Me · Local extension in everyday Chrome. No API key or email was supplied and no new npm dependency was added.

## Reproduction and provider evidence

- The packaged WordNet index has no curated entry. Its curate entry has only a clergy noun sense, so the verb candidate is correctly rejected. Checking the Open English Wordnet 2025 source showed the same noun-only entry; simply changing WordNet releases would not establish a fix.
- A real Free Dictionary API request for curated timed out after 20 seconds with zero response bytes. This was not an authentication error.
- A real MyMemory GET request for curated with en|zh-CN returned HTTP 200, `精选`, in about 1.32 seconds. No key/email/context/page URL was included.
- Read the provider's official API specification and usage limits via HTTPS. Public GET supports an optional key; anonymous use is currently limited to 5,000 characters/day. This single successful request does not establish availability for every network, word or future request.

## Change and data boundaries

- `GET_TRANSLATION` runs independently of English lookup. Each successful source is rendered immediately and remains usable when the other source fails. Chinese-only results can be saved with an empty English meanings array.
- Translation calls send only the selected word and language pair, with credentials omitted and no referrer. Successes are cached separately in local storage for seven-day reuse, capped at 500 entries. Vocabulary exports retain saved translation text/source but exclude the lookup cache.
- Requests are coalesced; translation headers/body have a 4.5-second bound and the client message has six seconds. English service timeout is 8.5 seconds, below its ten-second client bound, so specific failures can be delivered instead of always losing a deadline race.
- Import/export remains compatible with legacy definitions. New optional translation values are validated and rendered as literal text. List summaries, details and older-history disclosures can show saved Chinese text.
- Context-menu lookup combines whichever bounded sources succeed. Its native save interaction was not exercised in the user's real profile.

## Checks executed

- Initial focused translation/content/background/dictionary suite: **50 passed**.
- Full suite after source orchestration and backup changes: **157 passed in 21 files**.
- After adding Chinese vocabulary-summary/history rendering and one popup regression case: **19 affected component tests passed**. The full suite was not repeated after that final display-only refinement.
- `npm run compile`: **passed** after the final refinement.
- Chrome and Firefox production builds: **passed**. Generated output remains separate from the already-running local feedback build.
- Optional release smoke script now also blocks MyMemory to avoid unplanned live translation requests. Syntax checked; the script was not executed.
- Whitespace and current documentation-link checks: **passed**.

## Actual installed Chrome

Added curated to the local selection-test article and selected it using the existing installed extension. No mock response or preview component was used for this browser check. The card displayed **中文翻译 / 精选**, MyMemory attribution, an English-unavailable note and enabled Forget. The English failure did not erase the translation. Captured page warning/error logs were empty; a screenshot was inspected in the task.

After the final build, refreshed only that fixture page and selected serendipity. The installed extension showed **意外发现** alongside the real WordNet noun definition and both source labels; captured warning/error logs were empty. The final local-service status check reported reachable development assets.

No real vocabulary was read, imported, saved, reset or deleted. The successful lookup may write its dedicated translation cache as intended. Saving, round-tripping Chinese-only entries, stale-result handling, quota failure and timeout recovery were verified with disposable mocks; native saved-word operations, browser quota exhaustion and Firefox runtime remain unverified.
