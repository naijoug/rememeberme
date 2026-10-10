# Browser extension checkpoint verification

2026-10-10 (Asia/Shanghai), `main` working tree based on `0d9222f`, Node 22.22.3 from the package's `.nvmrc`. Existing dependencies installed with `npm ci` earlier in this session were reused; no dependency was added for pronunciation, flags or pinyin formatting.

The checkpoint includes the pending browser-extension encounter counter/history and sentence-extraction work, release preparation/version metadata, and the subsequent local US/UK IPA, speech controls, SVG country flags and Chinese numbered-pinyin display fixes. Source assets include their original data, source hashes and upstream license notices. Generated output and local service logs are excluded by Git ignore rules.

Executed before committing:

- `npm test`: **214 tests passed** in **25 files**, with disposable mocks and packaged source fixtures; no production vocabulary access or live dictionary calls.
- `npm run compile`: passed.
- `npm run build`: Chrome MV3 passed, approximately 21.41 MB.
- `npm run build:firefox`: Firefox MV2 passed, approximately 21.41 MB.
- `git diff --check`: passed.

No new installed-browser acceptance run was performed for this checkpoint. Earlier component-preview evidence is recorded in [pronunciation verification](2026-10-10-pronunciation.md) and [pinyin verification](2026-10-10-pinyin.md). Browser builds and mocked tests do not establish installed Chrome/Firefox behavior, audible accent quality or live provider availability. The prepared release materials remain drafts, and historical store screenshots require refresh before publication as documented in the release guide.

This checkpoint request authorizes a local Git commit. It does not publish the extension or deploy the separate backend/Apple clients.
