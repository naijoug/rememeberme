# Chrome Web Store materials — 0.1.1

## Magpie update (2026-10-24)

Current source supports backend Magpie translation with `zhipu/glm-5.3-flash`
and server-side MyMemory fallback. The new `magpie` source is accepted alongside
legacy `hermes` and `mymemory` snapshots without rewriting saved history.
Extension 0.1.2 uses `public:v3:` translation caches and displays the actual
source. Older installed clients must be updated before consuming Magpie results.
The descriptions and dated acceptance links below retain pre-Magpie context;
use the new deployment record for current host acceptance.

Publisher: **naijoug**. Support: [GitHub Issues](https://github.com/naijoug/rememeberme/issues). Public privacy policy: [Remember Me Privacy Policy](https://lookup.couplelabs.cn/privacy). UI language is English; the Chinese listing is an optional localization.

## English listing

**Name:** Remember Me

**Summary:** Look up English words as you read and keep a local vocabulary history of the words you forget.

**Description:**

Select a single English word on a supported webpage to see a Chinese translation, English definition and pronunciation. No login or service setup is needed. English lookup uses the packaged WordNet dictionary first. Online requests go through the Remember Me service, which combines isolated Hermes AI translation with MyMemory fallback and Free Dictionary API. Results identify the source actually used. Online results require internet access and may be limited by service availability or quotas.

Click the bookmark counter to save the word, its sentence, encounter time and source URL. Each intentional click adds one record and increases its count. Closing the card with X or Escape does not save it. The selection context-menu shortcut looks up and records the selected word.

Open the toolbar popup to search and sort vocabulary, review encounter history, reset a count while keeping history, delete with confirmation, and import/export JSON backups. Vocabulary remains on your device. This release has no login or cloud synchronization controls.

Only single English words are supported. Browser-internal pages, the Chrome Web Store and other restricted pages are unsupported. Saved histories and exports include surrounding text and complete URLs; keep sensitive backups private. Selecting a word can send that word for translation before saving. Sentences, page URLs and vocabulary lists are not uploaded. Repeated imports add counts and history again.

## 中文商店文案

**名称：** Remember Me

**简介：** 划词查询英文释义和中文翻译，记录遗忘次数、上下文和来源，词库保存在浏览器本地。

**详细介绍：**

在支持的网页上选中一个英文单词，即可查看中文翻译、英文释义和发音。无需登录或配置服务地址。英文优先使用内置 WordNet；在线查询统一通过 Remember Me 服务，整合隔离的 Hermes AI 翻译、MyMemory 回退和 Free Dictionary API，并显示实际使用的来源。

点击书签计数按钮，每次加 1，并保存当时的句子、时间和来源链接。X 或 Esc 关闭卡片不会保存；划词后使用 Remember Me 右键菜单会查询并记录该词。在工具栏弹窗中搜索、排序词库、查看历史，重置次数但保留历史，确认后删除，以及导入、导出 JSON 备份。

本版本没有登录或云同步入口。词库、句子和完整来源网址保存在本地，不上传到查询服务。选词时可能先发送该单词进行在线翻译；在线结果受网络和额度限制。历史和备份可能包含敏感信息，请妥善保管。仅支持单个英文单词；浏览器内部页、商店等受限页面不支持。重复导入会再次累加次数和历史。插件界面语言为英文。

## Privacy dashboard fields

**Single purpose:** Help users learn English words encountered while reading by showing definitions/translations and keeping a local encounter history.

| Permission | Justification |
| --- | --- |
| `storage` | Keep local settings, translation caches and compatibility/recovery snapshots; vocabulary uses IndexedDB. |
| `contextMenus` | Offer the Remember Me action for selected text to look up and record a word. |
| Site/host access | Detect English selections on arbitrary supported HTTP(S) pages and show a card. Capture sentence and URL locally only when the user records the word. Reach the internal HTTPS lookup service for word-only queries. Restricted browser pages remain unsupported. |

**Remote code:** No. Executable code and styles are packaged. Online services return validated JSON data. Submit the production Chrome ZIP; never submit development feedback output.

**Data-use disclosure:** Selected words are website content and can leave the device for lookup before saving. Infrastructure processes connection metadata such as IP address and timing. Saved context, complete URLs and vocabulary remain local; exports may contain sensitive browsing information. Do not select a blanket “no data leaves the device” declaration. Declare website content and the applicable interaction/connection metadata categories based on the live dashboard wording, consistently with the policy. This release collects no account identifiers, authentication information, payment, health or precise-location data for its lookup feature. No advertising, sale, analytics, profiling or creditworthiness use. Data-use certifications are the publisher's final submission action.

## Reviewer instructions

No login or payment is needed. Install the production ZIP in a disposable profile. Open an ordinary English webpage and select `serendipity`: packaged English and online Chinese load independently. Click the bookmark counter twice to save count 2 and two histories. Select another word and close the card without saving. Test the native right-click shortcut separately. In the popup, reset the count (history remains), cancel a deletion, export a fixture, confirm deletion and import that fixture once. Invalid JSON must leave vocabulary unchanged. Restart the browser and check persistence.

No service address or login configuration is displayed. “Privacy & support” opens the public policy. Online failures must leave a useful English result visible; explicit saving can still record a word when providers fail. Reload existing webpages after an extension update. Use only disposable examples; never submit private vocabulary or URLs as review evidence.

## Assets and evidence

- [128 × 128 icon](../../public/icon/128.png), [editable icon](assets/icon.svg).
- [440 × 280 promotional tile](assets/promo-small.png).
- [1280 × 800 installed selection screenshot](assets/screenshot-selection.png).
- [400 × 600 popup verification image](assets/popup-verification.png), for engineering review rather than store upload.
- [0.1.1 upgrade/offline popup acceptance](assets/upgrade-acceptance.json).
- [Historical 0.1.0 native toolbar and right-click acceptance](assets/native-acceptance.json) and [native screenshot](assets/native-toolbar.jpg).
- [Formal ZIP acceptance result](assets/release-acceptance.json) and the dated verification record distinguish actual checks from remaining manual/external steps.

Official requirements checked 2026-10-15: [privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy), [images](https://developer.chrome.com/docs/webstore/images). Prepared materials do not constitute store submission or approval.
