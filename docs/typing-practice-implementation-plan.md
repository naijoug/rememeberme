# Remember Me 拼写练习实施计划

更新日期：2026-11-05（America/Los_Angeles）。状态：P0–P4已实现；按用户反馈完成0.1.7连续跟打交互校正，当前规则见§2、§3和§13。正式复习和原生端打字仍为后续阶段。

首版历史基线：本地HEAD `2354b4b2c2e1074e131d8547973e1840ce43897e`，首版候选版本 **0.1.6**。本轮开始时工作区干净；期间出现的并行翻译缓存修改已保留，并纳入后续一致快照验证。未提交、推送或部署。具体证据与限制见[首版验证记录](../frontend/browser-extension/docs/verification/2026-11-05-typing-practice.md)。

本文替代 2026-10-19 聊天中的实施计划，作为仓库内的持续维护版本。目标仍是先交付 Chrome 扩展的本地拼写练习，再接正式复习。借鉴 Qwerty Learner 的交互需求，使用现有 Vue / TypeScript / Swift 技术栈独立实现。

## 1. 实施前代码基线（2026-11-04历史）

本节记录实施前状态；新实现以第11节及当前行为、架构文档为准。

| 观察与源码证据 | 对实施计划的影响 |
| --- | --- |
| [package.json](../frontend/browser-extension/package.json) 已为 0.1.5；[查询客户端](../frontend/browser-extension/services/public-lookup.ts) 使用共享预算并尊重服务端 retryable:false | 练习不等待查询成功，也不借用查询重试机制提交作答；保持现有恢复策略回归 |
| [类型](../frontend/browser-extension/types/index.ts) 和 [校验器](../frontend/browser-extension/services/definition-utils.ts) 接受 magpie、hermes、mymemory | 题目适配兼容三种来源，保留来源标识；历史快照不迁移、不改写 |
| [CloudVocabulary.getAllWords](../frontend/browser-extension/services/cloud-vocabulary.ts) 为匿名和账户词条都返回内部稳定 id | 复用已有生命周期 ID，不新增 ID 系统；新增轻量练习投影，避免传输整份阅读历史 |
| [WordDetail](../frontend/browser-extension/components/WordDetail.vue) 使用 currentDefinition，否则取历史最后一条 definition | 固定练习释义选择规则，处理空释义和词形释义；不假设每个生词都有中文提示 |
| [VocabularyDB](../frontend/browser-extension/services/vocabulary-db.ts) 已有 writeMany，但没有带版本条件的读改写接口；[串行队列](../frontend/browser-extension/services/cloud-vocabulary.ts) 是私有的 | 先补持久化边界；不能把「有 IndexedDB」当成「会话幂等、删除联动和并发校验已具备」 |
| [词库消息](../frontend/browser-extension/types/index.ts) 还没有练习或正式复习命令；[后台](../frontend/browser-extension/entrypoints/background.ts) 尚无练习处理器 | 增加内部页面专用 PRACTICE_* 消息；不能把现有原生复习当成浏览器已实现 |
| [ACCOUNT_SYNC_ENABLED](../frontend/browser-extension/config/backend.ts) 已为 true；[activateAccount/restoreAccountView](../frontend/browser-extension/services/cloud-vocabulary.ts) 会选中账户并启用或恢复同步，匿名词库迁入仍需单独确认 | 首版针对当前选中的匿名或账户词库本地数据；账户隔离、同步更新和远端删除前移到首版 |
| [原生队列与作答](../frontend/apple/Packages/RememberMeCore/Sources/RememberMeCore/LocalRepository.swift) 已有额度、版本检查和事件去重 | 后续对齐 review-v1；自由练习与正式作答继续分开 |
| [发布完整性检查](../frontend/browser-extension/scripts/release-integrity.mjs) 从 manifest 入口递归检查 import；不会把 runtime.getURL 字符串当成页面依赖 | 必须显式把 practice.html 加入检查根；单有文件清单不能证明练习页资源齐全 |
| [manifest](../frontend/browser-extension/wxt.config.ts) 与发布检查的权限已为 storage/contextMenus/identity/alarms | 保留这四项；不能再用旧两项权限断言检查新包 |
| [后台](../frontend/browser-extension/entrypoints/background.ts) 已接入 SITE_*、说明同意消息和查询 Port | 练习保留独立持久命令，不接入会在断线时取消的查询订阅；鉴权与网站策略分开 |
| [ReviewCardContent](../frontend/apple/Packages/RememberMeUI/Sources/RememberMeUI/ReviewCardContent.swift)、[SiteSettings](../frontend/browser-extension/components/SiteSettings.vue)、[ContextExplanationService](../frontend/browser-extension/services/context-explanation.ts) 已有工作区实现 | 本句解释已默认包含在构建中，显式 false 可关闭；服务能力和用户同意仍独立校验 |

以上是新增功能的接入风险和旧计划的缺口，不代表当前未包含练习功能的 0.1.5 已发生这些故障。

[10 月 27 日 0.1.5 发布记录](../frontend/browser-extension/docs/verification/2026-10-27-release.md) 已记录默认构建中的本句解释、个人查询入口和发布验收；它更新了此前10月26日“仅选择性构建”的状态。[原句复习验证](../frontend/apple/docs/verification/2026-10-26-original-sentence-review.md) 保留其模拟器和设备验收边界。这些是已有记录，本次未重新探测服务或重跑测试，不能证明拼写练习完成或服务当前在线。

当前查询与隐私入口由 [config/backend.ts](../frontend/browser-extension/config/backend.ts) 指向个人 workers.dev 域名。集成测试从配置读取目标，不硬编码旧 lookup.couplelabs.cn。账户服务地址保持独立；纯本地练习不得通过任何查询入口发送题目、原句或成绩。

## 2. 首版范围与固定规则

入口为工具栏词库列表中的 **Typing practice**，打开扩展内部完整标签页。0.1.7按用户指定的Qwerty参考采用居中单词、音标、释义和底部统计；独立深蓝/浅色样式，保留主题机制和英文界面。当前组件已有统一 Settings 页面，不重新引入旧 More options 菜单；练习主入口放词库列表，清除练习记录放现有 Settings。

| 项目 | 首版行为 |
| --- | --- |
| 选词 | 从当前选中词库的本地数据取最多 10 个合格词；匿名和已下载的账户词库都支持；随机抽样并固定顺序 |
| 跟打 | 无旧会话时默认跟打；居中显示拼写、音标和释义；正确字母变绿，错字闪红后清空本词输入；整词正确即保存并自动下一题，无需Enter |
| 默写 | 隐藏拼写与音标；显示可用释义；Enter后整词判定并显示正误/正确拼写，Continue或Enter后开始下一题；不提前反馈字母正误 |
| 答案 | 忽略 ASCII 大小写；容许首尾空白；内部撇号和连字符精确匹配，不合并词形或近义词 |
| 提示 | 主动显示答案；记录提示状态，提示后答对不算无提示通过 |
| 辅助输入 | 支持输入法组合事件；关闭纠错、拼写检查和自动大写；可检测粘贴按辅助输入处理 |
| 重练 | 失败或提示题隔至少两题再出现；剩余不足时放队尾；每词最多追加两次 |
| 跳过 | 记录为未通过，可进入有限重练；结束页列出待加强词 |
| 暂停 | 失焦或页面隐藏后暂停，明确继续；保存等待和暂停不计入有效耗时 |
| 恢复 | 恢复已确认的题目边界；未完成题重新输入，并保留中断标识 |
| 结果 | 分开记录首轮无提示通过、提示/辅助输入、跳过、重练结果和有效耗时；跟打展示WPM（非辅助正确字符÷5÷有效分钟）、词数、错字；默写展示首轮通过率 |

`count`、阅读 `history`、`updatedAt`、正式复习排期和同步 outbox 均不因练习改变。没有其他词库写入或同步更新的隔离测试中，练习前后 JSON 导出应完全一致。真实账户可同时拉取远端变化，不能把同步引起的合法导出差异判为练习污染；用固定远端输入的有/无练习对照检查练习无额外词库写入。

页面显示当前词库身份，不因进入练习而切到匿名或改变同步开关。账户尚未完成首次快照时提示等待或稍后返回；已有完整本地快照但临时断网时可继续练习。每词有待处理冲突时排除该词并说明数量；检测到 SYNC_EPOCH_CHANGED 则暂停该账户练习，等待现有恢复流程。

首版不做在线补词、AI 出题、听写、原句填空、词库商城或练习云同步。保留用户可见的清除练习记录确认。

即使用户已同意本句解释且服务 capability 为 true，启动、恢复和完成练习也不触发说明能力 GET 或 EXPLAIN_CONTEXT。练习不显示会自动查询能力的语境解释组件，不从其临时缓存生成题目。

## 3. 题目适配与成绩定义

新增 `practice-source.ts`，从后台内部词条生成有界投影：`owner`、账户 epoch（匿名无）、`entryId`、目标拼写、提示文本、来源和内容指纹。页面不接收全量 encounter、URL 或整个词库备份。不同 owner 下相同 entryId 也不能共享练习结果；匿名词库复制到账户不会自动迁移练习会话。

释义选择与当前阅读视图一致：先使用 `currentDefinition`，没有时取历史最后一条 `definition`。不静默向更早历史回溯；默写题目与持久指纹不读取独立翻译缓存。跟打展示层可优先显示已有本地中文缓存，并在tooltip标注来源；没有缓存时回退已存释义，不在线补查。当前释义没有可用文本时仍可跟打，并提示不能默写。

优先使用非空中文翻译，否则使用英文释义。三种中文来源全部兼容；来源标注只用于归属，不暗示内容质量。`definition.word` 可能是原形，答案始终是保存的 `entry.word`。

默写使用专用提示组件。隐藏标题、IPA、例句、同义词和笔记；不复用会显示答案的整个 `WordDetail`。遮盖提示中目标词及已知 `definition.word` 的完整匹配，按现有单词边界处理大小写、连字符和撇号；若遮盖后无有效提示，排除该默写题。词形线索与近义词歧义仍可能存在，不声称实现语义层面的完全防泄题。

仅接受 [isEnglishWord](../frontend/browser-extension/services/word-utils.ts) 支持的拼写。旧导入不合格词保留原数据，只从练习中排除并显示数量。提示按文本渲染，禁止把导入或模型文本作为 HTML 执行。

首轮无提示拼对率＝首轮首次提交正确且无错字、提示、粘贴或中断的词数 ÷ 首轮有效词数。跳过和中断不计通过；被删除、内容改变而失效的题排除分母，并单列数量。分母为零显示「无可评估题目」。跟打、默写和重练分别统计。

成绩是辅助学习反馈，不用于防作弊证明。不能可靠识别的输入法辅助与系统填充不作过度承诺。

## 4. 持久化、消息与恢复协议

### 数据布局

复用 `rememberme-vocabulary-v2 / partitions`，使用独立键 `practice:v1:<owner>`。词库聚合对象、数据库版本和旧 JSON 不变。每个 owner 只保留当前会话与最近结果；新会话替换旧结果，覆盖未完成会话前确认。

| 对象 | 拟新增字段与职责 |
| --- | --- |
| PracticeRecord / PracticeSession | Record保存schema、revision、回执；Session保存id、owner、epoch、mode、题目快照、有限队列及尝试；队首即当前游标 |
| PracticeAttempt | attemptId、entryId、题次、首次/重练、已提示/辅助/中断、结果、有效耗时 |
| 操作回执 | requestId、请求内容摘要、提交结果；相同 ID 相同内容返回原回执，改变内容则拒绝 |
| 页面作用域 | 当前后台实例随机标识、词库选择代数、会话 ID；用于拒绝过期页面提交 |

后台是唯一写入者。持久会话身份不依赖进程内 `generation`；worker 重启后创建新页面作用域，页面先重新连接并校验，才能继续提交。

账户会话同时保存已接受的 epoch；相同 owner 在恢复到新 epoch 后不能沿用旧会话或题目快照。epoch 未确定、首次快照未完成时不创建账户练习会话。

### 写入顺序

新增有条件事务辅助方法：在同一个 readwrite 事务中读取会话和相关词条，校验身份与 revision，再写入尝试、回执和新游标。现有 `writeMany` 只保证批量写入原子性，不自动提供此前读取的版本检查。

练习操作通过 CloudVocabulary 的窄协调入口进入同一串行边界。不能在其私有队列之外另建一套「查完再写」流程。事务内不进行网络请求、语音或其他长时间异步工作。

有效作用域校验后先检查相同请求的回执，再检查 expectedRevision。这样保存成功但回包丢失时，可以恢复原结果，而不会把自己已提交的操作误判为版本冲突。

实际消息为 `PRACTICE_GET` 和 `PRACTICE_COMMAND`，后者使用 `start/answer/reveal/resume/clear` 动作。限制 sender 为本扩展允许的顶层内部页面，验证载荷、ID、数值范围与长度；拒绝 content script 和任意网页来源。所有改变状态的命令使用稳定请求 ID，包括创建会话。

沿用当前后台消息分派结构增加独立分支。练习命令不加入 `lookup-port-handler.ts` 的查询白名单；查询 Port 断开会取消订阅，而已提交的练习事务不能因页面关闭被当成未发生。网站停用仅控制网页上的采集/查询，不禁用内部练习页；也不能以 SITE_ACCESS 代替练习消息鉴权。

### 中断与生命周期

提示标志必须先保存成功再展示答案。提交前崩溃或刷新恢复的未完成题保守标为中断，不允许通过刷新把提示或辅助输入清零为首次无提示成绩。不逐键落盘或保留完整键盘记录。

请求结果未知时进入恢复态，查询相同 ID 的回执或重发同一冻结请求；不能生成新 ID，也不能自动推进下一题。查询客户端新增的翻译重试逻辑不用于练习写入。

多个练习标签共享会话，以 revision 决定有效提交。旧标签收到冲突后停止输入并重新读取，不替用户覆盖新状态。

每次出题、恢复和提交时核对词条 ID 与提示指纹。单纯 count reset 不使题目失效；目标拼写或实际提示改变才失效。同名删除后新建是另一个生命周期。

本地删除词条时，把 tombstone 更新与练习快照、明细和结果引用清理放在同一事务。沿用现有词库 tombstone 规则，不把清理练习副本宣称为永久删除所有历史。已打开页面收到失效通知后清除当前题；恢复/提交再校验作兜底。

远端变化的合入和同步操作回执更新也必须联动练习状态，不能只修改本地 deleteWord。`perform()` 内合入远端词条、写入历史、处理操作回执的持久化点，以及 `archiveAndReloadCloud()` 都要检查相关练习副本。远端 tombstone 即使因本地 pending 操作尚未投影到 entry.deleted，也使该题暂停或失效；不能绕过现有冲突处理自行合并词库。

切换词库、登录状态改变或 epoch recovery 后，旧页面作用域失效；回到旧 owner 需重新连接。恢复发布新 epoch 时同步清除旧练习快照与结果引用。普通增量同步只使拼写或提示实际改变的题失效，不能把后台每次轮询都视为整场中断。首版不采集原句/URL，因此不额外建立这类来源副本；后续原句模式再加入来源撤回联动。

新增按 owner/session 的变化通知和恢复兜底，及时清除练习页中的旧题目。现有 popup 每五秒刷新整个词库只用于它自身；不要给练习页复制全词库轮询，也不要直接读写 storage 绕过后台。

## 5. 开发拆分与依赖

路径相对 `frontend/browser-extension/`；以下首版内容已实现，测试与浏览器证据见第11节。

| 交付 | 文件与工作 | 验收门槛 | 依赖 |
| --- | --- | --- | --- |
| P0 题目与规则 | `types/practice.ts`、`services/practice-source.ts`、合成 fixtures；冻结释义、owner/epoch 与成绩规则 | 匿名/账户缓存、快照未完成、冲突词、三来源和空释义均有明确结果 | 无 |
| P1 纯引擎 | `services/practice-engine.ts`；输入判定、有限重练、统计、暂停状态 | 最多 10 词/30 题；重复操作不重复结算；零分母与中断处理正确 | P0 |
| P2a 会话持久化 | `vocabulary-db.ts`、`practice-store.ts`、`practice-handler.ts`、`practice-client.ts`、`background.ts` | 原子保存、稳定回执、重启恢复、sender 拒绝、独立消息分支 | P0/P1 |
| P2b 同步联动 | `cloud-vocabulary.ts` 的本地写入、远端合入、回执与恢复发布；会话变化通知 | owner/epoch隔离、远端删词/改词、冲突、断网与切换往返通过 | P2a |
| P3 练习页面 | `entrypoints/practice/{index.html,main.ts,style.css}`、`components/practice/PracticeApp.vue`、`components/practice/`、`VocabularyPanel.vue`、`popup/App.vue` | 跟打与默写完整可用；融入现有 Settings；身份、下载/冲突/断网状态明确 | P2b |
| P4 打包与验收 | `scripts/release-integrity.mjs` 及测试、Chrome fixture 流程、当前文档 | 显式检查 practice.html 和资源；缺失页面/脚本/CSS 必须失败；真实扩展打开与刷新通过 | P3 |

P0/P1、P2a/P2b、P3、P4已实现。P4通过一次性Chrome安装/升级验收；实际用户浏览器、真实账号同步、物理IME和读屏语音仍保留独立验收边界。

P2 用窄接口复用已有内部 entry ID，不增加另一套词条 ID。P3 可以通过静态 `browser.runtime.getURL('practice.html')` 打开页面；保留当前 storage/contextMenus/identity/alarms 权限，不为该入口额外申请 tabs。

P4 对新版本显式声明必需入口，再递归校验页面引用。主要升级夹具改为现有0.1.5四权限包，不要求旧包包含practice.html。0.1.4可作附加四权限回归；如覆盖0.1.3，按其历史两权限清单单独验证。0.1.5的本句解释默认构建与显式false回滚构建均不得影响本地练习可用性。不能把所有历史包套用同一权限和入口断言。

首版不新增运行时依赖，不修改后端和 contracts，也不部署服务。版本号在准备发行包时统一更新 package/lockfile，不在计划阶段修改。

## 6. 检查矩阵与交付标准

| 层级 | 核心用例 |
| --- | --- |
| 题目投影 | 三种翻译来源；仅英文；空 definition；currentDefinition 与历史；词形答案；无网络请求；无历史 URL 投影 |
| 引擎 | 大小写、撇号、连字符、退格、跳过、提示、粘贴、中断、最大重练量、分模式统计 |
| 组件 | IME 组合期间 Enter 不提交；长按/双击；Tab 导航；暂停；提示隐藏；不可信文本按字面显示 |
| 消息/持久化 | 错误 sender；写入成功但回包丢失；相同 ID 改正文；worker 重启；两个标签 revision 冲突；事务中止 |
| 生命周期 | 本地/远端删除与答题交错；pending覆盖远端tombstone；同名重建；reset不失效；提示改变；账户切换与epoch恢复 |
| 成绩恢复 | 显示提示后刷新；粘贴后未提交就刷新；恢复不提升为首次无提示通过；未知提交不重复结算 |
| 回归 | 划词保存、兼容导出、导入、reset/history；无并发写入时导出一致；固定同步输入的对照验证无额外outbox |
| 当前集成 | 登录自动选账户、popup恢复、首次快照下载、账户断网缓存、同ID跨owner隔离、Settings导航、网站禁用不影响练习、查询Port取消不取消已提交练习 |
| 解释隔离 | 默认构建、显式false、用户未同意/已同意、服务能力开/关；启动/恢复/完成练习均无解释GET/POST，临时解释结果不变成题目 |
| 查询回归 | 沿用contracts/translation-policy.ts；保留retryable:false、取消与有界重试用例，练习提交不复用该客户端 |
| 发行包 | practice.html及传递资源缺失；0.1.5四权限主升级夹具；0.1.4/0.1.3附加回归按各自权限；新页打开、断网和刷新恢复 |

使用 Node 22.22.3 和包内 `npm ci`。按 [扩展验证指南](../frontend/browser-extension/docs/testing.md) 运行受影响 Vitest、`npm run compile`；后台/入口改动还需 Chrome 构建与真实流程检查。发行时完成相关完整套件、`npm run zip` 和新版本升级验收。

需要安装依赖或构建隔离验证时，优先采用现有验证记录中的一次性源码副本。已有健康 local feedback watcher 继续复用；先查 `local:status`，不重装用户扩展，不把真实词库作为测试数据。构建成功不代表 Chrome 已加载更新。

更新扩展 `docs/behavior.md`、`docs/architecture.md`、`docs/testing.md`、README 和发布材料中的新增入口与本地记录说明。验证结果分清自动化、一次性 Chrome、实际安装验收；未执行的项目标明未验证。

首版完成门槛：P0–P4 的功能和检查有证据，词库导出与计数语义保持兼容，练习不依赖在线查询，应用文档与实际行为一致。

## 7. 正式复习与原生端后续

后续 R1 在扩展实现本地正式复习存储、队列与三档自评，复用 [review-v1](../contracts/api-v1.ts) 和原生测试向量。到期优先、每日最多 20 个新词、时区/跨日与版本冲突保持一致；每轮 10 词不是新的每日额度。

同一词本次正式作答最多提交一次。拼写只是辅助，用户确认 Forgot/Fuzzy/Remembered 后才改变排期。跟打与本轮错词重练不提交正式复习事件。

后续 R2 处理的是“新增正式复习事件”与现有账户 outbox 的原子更新、离线恢复及跨端冲突，不是重新开放已启用的账户同步。首版本地练习的账户隔离与远端变化处理已经前移到 P2b。不能因为有 `review` wire 类型就把扩展正式作答视为已完成。拼写统计不塞入 review-v1，若需同步/备份另建版本化契约。

后续 R3 将拼写行为规范移植到 macOS 的 Swift 状态机与 SwiftUI 输入；共享合成测试数据，不强行共用 TypeScript 实现。iPhone 软键盘单独验收。

与 [Read Frog 借鉴计划](read-frog-adoption-plan.md) 协调：当前工作区已有原生原句卡、网站停用、共享查询取消及受开关保护的本句解释实现。原句卡用至多20条历史找到第一个字面完整词匹配，优先展示该次 encounter 释义，再回退当前释义；这是语境卡策略，不替换浏览器首版拼写的 currentDefinition/末次历史策略。

已有字面匹配用例可供后续原句填空复用，但 containsWord/excerpt 不是遮盖全部答案的实现，填空仍待设计与验收。本句解释默认构建开启，`VITE_CONTEXT_EXPLANATION_ENABLED=false` 可用于回滚；调用仍同时要求服务 capability 与用户同意。结果仅临时展示，不得自动保存为拼写题目或借由开始练习隐式请求原句解释。

原句填空与听写留待独立增强阶段。原句匹配、来源隐私、语音失败降级和提示难度都需要单独验收。

## 8. 2026-11-04审阅范围（历史）

本轮对照10月27日计划，复核当前入口与练习相关文件搜索、账户/存储/消息类型和发布检查差异、释义选择、说明开关/同意校验及查询恢复策略。此前核实的账户隔离和P2b设计继续适用；未把所有未提交修改都当作已审完或已发布。

本次只新增/修改计划文档及计划页，未修改应用代码，未重新运行应用测试、安装依赖或实测浏览器。已记录的历史测试结果不写作本次通过。文档交付检查包括本地链接、相对路径、计划页渲染和 `git diff --check`。

## 9. 2026-10-27 修订记录（历史）

下表记录10月27日处理的差异，不是当前状态表；其中0.1.4基线与解释默认关闭已由第10节更新。

| 文档位置（修订前） | 对应代码 | 确认差异与处理 |
| --- | --- | --- |
| 本计划开头/§1，以及 docs/architecture.md 的计划索引行 | 扩展 package.json；本地HEAD与工作区状态 | 旧基线0.1.3/干净HEAD已不适用；更新为0.1.4、3b090f5加未提交工作区，索引同步更新 |
| 本计划§1、§2、§4、§7 | config/backend.ts；cloud-vocabulary.ts 的 activateAccount、restoreAccountView、perform | 旧文称同步关闭、匿名首版和账户联动延后；按已开启同步改为当前词库本地练习，P2b纳入首版 |
| 本计划§5的权限与升级断言 | wxt.config.ts；scripts/release-integrity.mjs | 旧文仅storage/contextMenus，代码为四权限；保留identity/alarms，并分开0.1.3/0.1.4历史夹具 |
| 本计划§7的原句卡状态 | 原生 ReviewCardContent.swift、ReviewView.swift | 旧文称提案，工作区已实现原句选择与揭示；更新为已有实现，并保留填空与设备验收限制 |
| 本计划§7的网站停用状态 | services/site-settings.ts、site-messages.ts；后台与SiteSettings.vue | 旧文称提案，已有策略及UI；更新状态，并要求内部练习页不受网页停用误伤 |
| 本计划§7的语境解释状态 | services/context-explanation.ts、components/ContextExplanation.vue、config/backend.ts | 旧文称提案，已有实现但默认构建关闭；改为三重开关的可选底座，不作为本地练习依赖 |

额外设计校正：同步并行时不能要求整个账户导出绝对不变；查询Port的取消语义不能移植给持久写入。这两项是新接入条件下的计划完善，不据此声称当前应用存在对应缺陷。未核查的文档区域不作一致性保证。

## 10. 2026-11-04校正记录（历史）

| 文档位置（修订前） | 对应代码 | 差异与处理 |
| --- | --- | --- |
| 本计划开头、§1、§5/§6升级基线；docs/architecture.md计划索引 | frontend/browser-extension/package.json:5；本地HEAD | 原计划按0.1.4/3b090f5评估，当前为0.1.5/41e16c5加工作区；刷新评估和主要升级夹具，保留历史包差异 |
| 本计划§1验收说明、§7解释开关描述 | frontend/browser-extension/config/backend.ts:10；services/context-explanation.ts；services/explanation-settings.ts | 旧文称构建默认关闭；现在默认包含、显式false关闭，服务与用户同意仍必需；修正描述并补齐解释已开启时的本地练习隔离用例 |

实施顺序不变：P0题目适配 → P1引擎 → P2a持久化 → P2b同步联动 → P3页面 → P4验收。未发现打字入口、引擎、会话处理器或专门测试；所有拼写练习里程碑仍待实施。

共享查询策略与新入口是需要保留的现有行为，不构成新增打字功能。当前复核没有理由把在线出题、AI解释或正式复习提前并入首版。


## 11. 2026-11-05首版实现与验收

- 已实现当前匿名/账户词库的本地跟打和默写，每轮最多10词、每词最多两次重练。
- 后台事务、稳定回执、未知提交恢复、启动作用域、跨标签版本检查和owner/epoch隔离已实现。
- 词库本地写入、远端合入、历史合并、操作回执及恢复路径在同一持久化边界内清理失效练习副本。
- 已接入词库入口和Settings清除确认。确认固定原词库作用域；账户变化不能转移清除目标。
- 0.1.6发布检查显式覆盖practice.html与传递资源，旧版本按历史权限检查。代码不改后端契约或已有用户数据。
- 完整测试套件375项通过；最后模式恢复/焦点调整后的组件回归6项通过，二者不相加。类型检查与ZIP检查通过。
- 最终ZIP在Chrome for Testing 151.0.7922.34通过同身份0.1.5→0.1.6升级、离线练习、重启、双标签协调、删除及清除确认。全程仅合成词库，记录到的网络请求为零。

实际细化：统一PRACTICE_COMMAND动作代替多个写消息名；revision与回执位于独立PracticeRecord；页面主体位于可挂载测试的components/practice。以上是实施组织选择，保持计划行为和旧JSON兼容。

已更新[行为](../frontend/browser-extension/docs/behavior.md)、[架构](../frontend/browser-extension/docs/architecture.md)、[测试](../frontend/browser-extension/docs/testing.md)、README和发布候选说明。公共隐私政策只更新源文档，本轮不执行发布或商店提交。原生端打字、正式复习写入、听写和原句填空未提前实现。

本轮文档校正：原计划§5与项目架构索引仍称待实现，现已按实际入口、引擎、消息、存储和验收结果更新。其他日期化审阅保留历史语境，不把未审阅区域宣称一致。


## 12. 2026-11-05实施复审

首版范围保持P0–P4，不提前扩大到后续功能。[复审记录](../frontend/browser-extension/docs/verification/2026-11-05-typing-practice-review.md)逐项列出文档要求、对应代码、复现与修复。

- §2输入法：组合期间不取消原生Enter行为，同时禁用作答、提示和跳过按钮；模拟事件测试与Chrome检查通过，物理输入法仍需单独验收。
- §4同步变化：其他题目失效不再清空当前输入、辅助标记或计时；每次恢复轮换activationId，仍能识别其他标签重复接管同一道题。
- §4故障隔离：验证嵌套会话、题目、尝试、回执与引用。损坏练习不会阻塞词库写入；直接读取显示只读修复状态，用户确认后清除。清理时推进可读revision，防止旧请求重新执行。
- §4冻结请求：克隆action后再保存和发送，调用方后续修改不会改变未知提交的恢复正文。
- §2答案判定：只折叠ASCII大小写，K不再被当作k；逐字反馈采用相同规则。

兼容性：早期0.1.6记录没有activationId时使用turnId作为回退；未知旧释义source只在练习投影中规范为saved，不修改词库或导出。

核心修复后完整套件386项通过；最后兼容性回归19项通过，数量不相加。最终类型检查、安装包完整性及Chrome升级/离线/恢复/删除/修复验收通过，网络请求和页面错误均为零。仍为0.1.6本地候选，未部署或提交商店。


## 13. 2026-11-05 用户反馈后的交互校正（当前）

本轮基线为已提交首版 `0674fac`；当前候选0.1.7，尚未提交、推送或部署。用户明确要求参考[Qwerty Learner](https://qwerty.kaiyi.cool/)的直接跟打形式；此决定替代旧计划中表单式操作的选择。§11/§12保留历史验收，不作为本轮证据。

| 原文档位置 | 对应实现 | 校正及处理 |
| --- | --- | --- |
| §2：沿用Paper & Sage主体 | `entrypoints/practice/style.css`、`PracticeApp.vue` | 改为参考图的居中大字、音标/释义、细进度条和底部统计；保留本项目品牌和主题偏好 |
| §2：跟打Enter提交 | `TypingInput.vue`、`PracticeApp.vue`、`practice-engine.ts` | 默认Copy；逐字反馈，错字清空重打，完整正确后同事务保存并启动下一题。默写仍用Enter；现有会话不被静默替换 |
| §2/§3：不显示WPM、首次提交正确即通过 | `PracticeApp.vue`、`practice-engine.ts` | 跟打增加标准WPM和错字；纠错后正确不算首轮无错通过，进入有限重练；辅助输入不增加WPM字符数 |
| §3：不读取独立翻译缓存 | `PracticeMeaning.vue`、`translation-cache.ts` | 仅跟打展示可读已有本地中文缓存，独立有界等待；不影响默写题目、指纹或词库。普通查询150ms预算不变 |

新增 `PracticePronunciation.vue`：仅直接读打包IPA并使用本机en-US语音；手动点击/Alt+P播放，无可用本机声音时禁用按钮，不走在线发音服务。它不改变正式复习、账号同步或词库字段。

验收：完整46文件/398测试通过；最终局部22测试和类型检查通过（数量不相加）。0.1.6→0.1.7同身份升级、连续跟打、错字反馈、暂停恢复、双标签、模式确认、浅色/深色/390px通过一次性Chrome验收。记录到的外部请求及页面错误均为零。物理IME与实际发音质量仍需人工体验。

证据：[交互验收记录](../frontend/browser-extension/docs/verification/2026-11-05-typing-flow.md)、[视觉QA](../frontend/browser-extension/design-qa.md)。


## 14. 0.1.7重做复审

本次确认并修复三项差异：

- §2暂停规则与 `PracticeApp.vue/run`：延迟保存回包会覆盖期间的Esc、失焦或Settings暂停；增加暂停代数检查，显式继续前保持暂停。
- §2默写及行为文档“答案后显示拼写”与 `PracticeApp.vue/submit`：此前默写也自动下一题，未展示判定或正确拼写；改为反馈页后继续，Copy仍连续自动推进。
- §2结果/待加强词与 `PracticeApp.vue`结束页：原UI只显示首轮总数和重练按钮；恢复重练、提示、辅助、中断、跳过明细和待加强词列表。

新增四个回归用例先失败再通过。完整402测试、最终组件13测试（与全量重叠）、类型及ZIP检查结果见[本轮复审记录](../frontend/browser-extension/docs/verification/2026-11-05-typing-flow-review.md)。§13的398项及原hash为此前快照，本轮记录覆盖最新候选。
