# Chrome Web Store listing — 0.1.0

Prepared copy for the current implementation. Publishing account, contact and public policy URL remain owner-supplied. UI language is English; the Chinese copy is an optional localized listing, not a claim of Chinese UI support.

## English listing

**Name:** Remember Me

**Summary:** Look up English words as you read and keep a local vocabulary history of the words you forget.

**Description:**

Remember Me helps you keep track of English words you forget while reading.

Select a single English word on a supported webpage to see its definition. Click the bookmark counter to save the word and its sentence, click time and source URL. Each click increases the count and creates a separate record while the card stays open. Expand Records, then an individual entry to inspect its context. Use X or Escape to close without recording.

You can also select a word and choose Remember Me from the right-click menu to look it up and save it.

Open the toolbar popup to:

- Review definitions, forget counts, and encounter history.
- Sort words by count or last updated time.
- Reset a count while retaining history.
- Delete a word after confirmation.
- Export your vocabulary as JSON or import an existing backup.

Local vocabulary needs no account. Optional GitHub login connects your HTTPS backend for Hermes translation; account copy and sync enablement are explicit choices. Disconnected Chinese translation retains MyMemory. English definitions use packaged WordNet first, with Free Dictionary API as fallback. The sources load independently, so one failure does not hide the other result. Online services have network and quota limits. Saved history and JSON backups include surrounding text and full source URLs; keep backups private when they contain sensitive information.

The extension supports individual English words, not phrases. It does not run on browser-internal or other restricted pages. Import merges counts and history, so importing the same backup repeatedly adds its entries again. Optional account sync uploads words and definition history while keeping outgoing contexts and source URLs local. Conflicts/restored servers pause synchronization and retain private recovery copies.

## 中文商店文案

**名称：** Remember Me

**简介：** 阅读时查询英文单词，记录遗忘次数、上下文和来源，建立保存在浏览器本地的词库。

**详细介绍：**

在支持的网页上选中一个英文单词，即可查看释义。点击书签计数按钮，每次加 1，并保存当时的句子、点击时间和来源链接；弹窗保持打开。展开 Records 后点击单条记录即可查看上下文；X 或 Esc 关闭卡片。也可以在选中单词后，使用右键菜单中的 Remember Me 查询并保存。

在工具栏弹窗中查看词库和历史，按遗忘次数或最近更新时间排序，重置次数但保留历史，确认后删除单词，以及通过 JSON 导入、导出备份。

本地词库无需账号。可选 GitHub 登录连接 HTTPS 后端，中文翻译通过 Hermes；未连接时保留 MyMemory。复制词库和启用同步需要明确操作，插件上传单词与释义历史，不上传上下文和来源网址；英文释义优先使用内置 WordNet，缺失时使用 Free Dictionary API。中英结果分别加载，一方失败不会隐藏另一方的结果。在线服务有网络和额度限制。词库保存在浏览器本地，历史和导出文件包含上下文与完整来源网址，请妥善保管。仅支持单个英文单词，不支持浏览器内部或其他受限页面。可选账号同步遇到冲突或服务器恢复会暂停并保留恢复副本；重复导入同一备份会再次累加次数和历史。

## Privacy dashboard copy

**Single purpose:** Help users learn English vocabulary encountered while reading by showing definitions and keeping a local history of words they forget.

| Permission | Justification |
| --- | --- |
| `storage` | Persist settings, translation caches, origin-scoped device credentials and the original local snapshot; vocabulary and its durable queue use IndexedDB. |
| `identity` | Complete GitHub/backend PKCE login through the exact extension callback. |
| `alarms` | Trigger bounded account sync attempts when explicitly enabled. |
| `contextMenus` | Add a Remember Me action when text is selected, allowing the user to look up and save that word from the page's context menu. |
| `<all_urls>` / content-script site access | Users read on arbitrary websites. Static content scripts detect selected English words and display a definition card, and capture sentence context and the page URL when the user saves. Host access also permits HTTPS dictionary requests to api.dictionaryapi.dev. The extension does not bulk-upload page content or browsing history. Browser restrictions still apply. |

**Remote code:** No. Executable JavaScript and CSS are bundled in the extension. The external dictionary returns data parsed as JSON, not executable code. Submit the production ZIP; feedback builds use localhost development code and must never be submitted.

**Data handling notes for the owner:** Do not declare that no information leaves the device. Connected Chinese queries send the selected word through backend/Hermes and its model provider; disconnected queries use MyMemory, including on WordNet hits; English misses or local file failures may send it to Free Dictionary API. Full saved contexts and URLs remain local unless exported/shared or a history link is opened. Read current dashboard categories against these facts before certifying checkboxes. Selected words are website content even if no vocabulary is saved. Account sync, device credentials, private recovery copies, local caching, history, exports and provider metadata are described in the policy. Do not submit this draft until actual backend retention and installed-client OAuth/privacy flows are verified.

**Privacy policy URL:** pending public hosting of [privacy-policy.md](privacy-policy.md).

**Developer identity/support:** pending owner-provided public details.

## Reviewer instructions

No login or paid account is needed. Install the production build in a disposable profile and open an ordinary English webpage. Select `apple`, wait for a definition, and click the bookmark counter. Open the extension popup to inspect the stored entry; select it again and use X to close without saving. Test the right-click shortcut separately. Export a fixture backup and import into an empty disposable profile. Reset retains history; deletion opens a confirmation dialog. See [testing.md](../testing.md) for full expected behavior.

Packaged English entries such as `apple` and `serendipity` remain usable without an external connection. Check Chinese translation separately using `curated`; if English lookup fails but Chinese succeeds, the Chinese result stays visible and can be saved. If both lookups fail, the page counter can still record the word/context when explicitly clicked. Browser-internal pages, the web store, and other restricted pages are not supported. After an update, reload existing webpages so their content scripts match the installed version.

## Image assets

- Extension icon: [128 px PNG](../../public/icon/128.png), with [editable SVG](assets/icon.svg).
- Small promotional tile: [440 × 280 PNG](assets/promo-small.png), with [editable SVG](assets/promo-small.svg).
- [Selection screenshot](assets/screenshot-selection.png): 1280 × 800, captured from the installed production extension in a disposable Chrome for Testing profile, with synthetic article text and a fixture dictionary definition.
- [Popup verification image](assets/popup-verification.png): 400 × 600, for review only, not a store-sized upload. Captures count reset retaining history.
- Do not use historical design prototypes as product screenshots. See the release verification record for the limits of these captures.

Official references checked 2026-09-29: [privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy), [image requirements](https://developer.chrome.com/docs/webstore/images), [publishing](https://developer.chrome.com/docs/webstore/publish/).
