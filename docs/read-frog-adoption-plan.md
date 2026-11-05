# Remember Me 借鉴 Read Frog 的实施计划

创建：2026-10-19。更新：2026-10-27。状态：本句解释已完成发布验收并在个人入口启用，Chrome 0.1.5 正式包与日常安装已验证。Mac/模拟器候选验收已通过；个人开发团队签名与真机验收、实际 VoiceOver 朗读和原生分发仍独立待办。

目标是增强“阅读时遇到生词 → 记录遗忘 → 理解原句 → 到期复习”的流程。先改善本地学习与浏览器体验，再增加按需的语境解释。沿用 Vue、Swift 和现有后端边界。

## PR 7 当前发布结果（2026-10-27）

| 项目 | 结果 | 证据与边界 |
| --- | --- | --- |
| 个人查询入口 | 已部署 | `https://rememberme-lookup.couplelabs.workers.dev`；验证个人邮箱/账号后新建 Tunnel/VPC，没有操作公司资源或 DNS |
| 本句解释服务 | 已启用 | 腾讯运行时 `20261027-context-fac9579f94d8`，保留 `group/translator`；公开能力从 false 验收到 true |
| 真实模型 | 8 个样本通过 | 修复 JSON 输出稳定性；一词多义、长句、指令型文本均有记录，不代表普遍准确率 |
| 隐私 | 已发布有效 0.1.5 政策 | 本地请求归档与 OTLP 未开启，元数据保留与上游条款如实披露，不承诺零留存 |
| Chrome | 0.1.5 正式 ZIP 和日常安装通过 | 最终包 SHA-256 `c5fe63f32bfeee8061b8f27b4cf7906f7e09157196959b98be2c83739c350c9d`；首次同意仍由用户选择 |
| 原生候选 | Mac/模拟器通过 | 39 个界面包测试、2 项 iPhone 模拟器审计/复习测试；真实 Mac 快捷键、揭示、计数历史和深色界面通过 |
| 剩余原生工作 | 未冒充完成 | 用户已暂缓 Honoululu Inc. 公司签名，仅继续个人团队；个人 Team ID/有效签名尚未核实；实际 VoiceOver 朗读与原生安装包分发未完成 |

[服务发布与回退](../backend/docs/verification/2026-10-27-context-release.md)、[Chrome 发布验证](../frontend/browser-extension/docs/verification/2026-10-27-release.md)、[原生验收及签名边界](../frontend/apple/docs/verification/2026-10-27-pr7-accessibility.md)。

保留了旧运行时、数据库一致性备份、配置和 bridge 备份。可先关闭解释开关回退；不回滚当前词库数据库。旧账号入口及连接器保留，新入口只承载查询和政策。

## 1. 当前基础与实施范围

本轮实现基于 `ca60d0e`，保留开始时已有的架构文档、此计划和打字练习计划改动。当前代码已经启用扩展登录同步，设置集中在 Setting 页面；网站控制沿用该界面，不恢复旧版的账号开关行为。

| 第一轮交付 | 当前结果 | 验证边界 |
| --- | --- | --- |
| PR 1 原句复习卡 | 已实现，只读最近 20 条历史、历史释义优先、失败回退与迟到隔离 | Swift UI 包 39 项通过；iPad 模拟器原句揭示/计数 1 项通过；iOS 构建通过 |
| PR 2 网站开关 | 已实现，精确 hostname、后台校验、坏设置保护、明确恢复 | 扩展完整 309 项通过；后续站点相关 49 项复跑通过；Chrome 停用/重启/恢复通过 |
| PR 3 浮层几何 | 已实现，visualViewport、缩放坐标、多行锚点、事件合并和关闭清理 | 最终相关 36 项通过；compile/build 通过；Chrome 80%–200% 缩放与窄窗口检查通过 |
| PR 7 第一轮发布门槛 | 部分完成，本地自动验收有证据 | 未正式打包发布；未替换已安装 Mac；Mac/iPhone、VoiceOver、深色/动态字号仍待验收 |

证据：[浏览器第一轮](../frontend/browser-extension/docs/verification/2026-10-26-reading-controls.md)、[原生第一轮](../frontend/apple/docs/verification/2026-10-26-original-sentence-review.md)。以下第一、二轮结果保留其当时边界；10 月 27 日的发布状态以上方 PR 7 表为准。

### 第二轮实施结果（2026-10-26）

基于 `3b090f5` 与第一轮未提交实现继续，保留其他文档改动。代码工作包已完成，并未创建远程 PR 或部署服务。

| 第二轮交付 | 当前结果 | 验证边界 |
| --- | --- | --- |
| PR 4 共享查询取消 | 专用 Port、独立订阅、最后订阅取消 HTTP、保留一次恢复、旧消息兼容 | 扩展全套 328 项通过；最终相关 44 项通过；实际 Chrome Port 共享/取消通过 |
| PR 5 语境解释与入口 | 独立 Magpie 适配器、共享并发、公开 capability、逐路由限额/字节限制 | 后端全套 87 项、最终相关 24 项通过；真实 loopback bridge/API 通过；网关类型检查通过 |
| PR 6 解释交互 | 构建/服务/用户同意三重开关、逐次点击、纯文本临时结果与撤销 | 独立 Chrome 验证首次同意、取消、服务关闭和空词库/导出；模型响应是合成数据 |
| PR 7 第二轮启用门槛 | 保持关闭 | 未进行真实 Magpie 原句生成质量/留存验收、公开入口部署或政策发布 |

[第二轮扩展验证](../frontend/browser-extension/docs/verification/2026-10-26-context-explanation.md)、[第二轮服务验证](../backend/docs/verification/2026-10-26-context-explanation.md)记录命令、截图、失败修复及限制。默认构建和服务开关均关闭；仅在隔离测试副本中打开构建选项，不修改日常 watcher 的开关。

### 评估来源与当前差异

10 月 25 日的静态审查基线为本地 `HEAD 130416bcf6645498db0849ae117cc20c4ba97b1b`，当时工作区干净，重点检查 `581dea7..130416b` 的改动与 10 月 24–25 日记录。10 月 26 日的实现与实际测试以上方第一轮结果为准。Read Frog 参考版本仍固定为 [v1.52.0 对应提交 fcb00be](https://github.com/mengxi-ream/read-frog/tree/fcb00beb21a9d674c0262346fbc422fbbf317c03)，两轮均未重新拉取上游。

| 能力 | 当前基础 | 本轮增量 |
| --- | --- | --- |
| 原句采集 | 扩展保存 context、url、释义快照；原生 ReviewView 已按需读取历史原句 | 已实现，见上方第一轮结果 |
| 复习调度 | 原生端已有 review-v1、每日 20 个新词、三档反馈 | 改善卡片内容，不替换算法 |
| 划词交互 | 已有选区快照、视口夹取、滚动保持和按钮位置保护；本轮已增加网站规则与 visualViewport 适配 | 已实现，见上方第一轮结果 |
| 查询请求 | 同词合并、缓存、旧结果隔离；公开单词翻译新增最多一次自动恢复 | PR 4 已实现，保留恢复策略 |
| 翻译 | 普通接口仍只接受单词；另有独立的原句解释接口 | PR 5–6 已发布，个人同意后可用 |
| 来源兼容 | TS/Swift 接受 magpie、hermes、mymemory；浏览器 public:v3、原生 backend-v3 缓存命名空间 | 保留三种来源；语境解释另建契约与缓存 |
| 自动检查 | backend CI 已配置扩展安装、类型检查、测试、构建 | 扩充回归用例和新设置的版本迁移测试 |

首轮交付覆盖 macOS/iOS 原生复习和 Chrome 扩展。浏览器复习入口、短语自动查询、FSRS、全页翻译、字幕、通用提示词编辑器和更多模型选择器留待后续。原生数据模型已有 phrase 等类型；本轮不扩展浏览器的单词查询契约。

### 10 月 25 日评估结论与计划修正（历史）

以下记录 10 月 25 日评估时的源码与计划差异；取消机制、能力路由和发布状态已由后续实施更新，不再代表当前待办。

| 优先级 | 发现及依据 | 计划调整 |
| --- | --- | --- |
| 高 | [public-lookup.ts](../frontend/browser-extension/services/public-lookup.ts) 已有一次自动恢复；旧 PR 4 的“不自动重试”与实现冲突 | 冻结现有单词恢复预算；用户取消必须禁止后续重试 |
| 高 | [网关](../backend/lookup-gateway/index.ts)、[bridge](../backend/scripts/lookup-bridge.mjs) 仅接受两条查询路径及 2048 字节请求；不透传 capabilities | PR 5 补齐逐路由大小限制、专用公开能力查询和端到端测试 |
| 高 | [MagpieTranslator](../backend/src/magpie.ts) 已接入；Hermes 是可配置回滚选项，原计划仍以 Hermes 开发 | 新解释适配器使用 Magpie，独立提示词、输出额度与共享并发控制 |
| 中 | UI 取消只结束本地等待；[lookup-client.ts](../frontend/browser-extension/services/lookup-client.ts) 没有取消消息，底层网络有自己的超时 | PR 4 仍待实现；超时 abort 不等于用户取消已贯穿后台 |
| 中 | 10 月 25 日记录有真实 Chrome 首查成功；隐私静态页面发布仍待个人入口迁移 | 重用历史证据，新增能力上线前单独验收政策页面与个人入口 |

当前单词翻译预算为：Magpie 8 秒、MyMemory 回退 4 秒；浏览器第一次传输最多 5 秒，两次传输共享 19 秒；TranslationService 20 秒、UI 22 秒。仅网络失败、超时、HTTP 502/503/504 允许一次自动恢复。HTTP 4xx（含 429）、非法 JSON 与超大响应不重试；词典网络预算 8 秒且不重试。供应商侧限流可能由后端转换成 503 或回退结果，因此不能把“HTTP 429 不重试”表述为所有上游限流均不触发恢复。

证据：[10 月 24 日 Magpie 记录](../backend/docs/verification/2026-10-24-magpie.md) 包含 TS/Swift 兼容、隔离 HTTP、0.1.2 安装与导出/重启检查；[10 月 25 日首查记录](../backend/docs/verification/2026-10-25-first-lookup.md) 包含 0.1.3 的有限恢复、后端部署和三个实际 Chrome 首查样本。它们不证明长期可用性，也不证明本计划的新功能已实现；本轮不重新声称这些测试已执行。

部分当前文档仍保留旧 Hermes、12 秒预算或旧部署边界段落。实施时优先核对源码与日期较新的验证记录，并在 PR 7 清理相互矛盾的当前说明；历史记录保持原日期语境。

## 2. 不变量与默认产品决定

- count 与 history 长度保持独立。查看原句、生成解释、揭示答案都不增加遗忘次数；复习答案仅影响已有复习状态与事件。
- 旧 JSON 继续按原数组格式导入导出。新增设置、临时解释与缓存不塞入历史释义或旧导出格式。
- 保留本地 WordNet 优先、中英结果独立显示、释义失败仍可手工记录的行为。
- 保留 0.1.3 的单词翻译有限恢复、Magpie 实际来源标签及三来源 JSON 兼容。新解释功能不能改变现有缓存 TTL、历史快照或供应商回退语义。
- 沿用当前 `ACCOUNT_SYNC_ENABLED=true` 与登录后同步行为；匿名词库仍需显式确认复制，不因本轮网站设置或复习功能改变归属。
- 原句、网页文本和模型输出均按不可信文本处理。来源链接仍只允许 HTTP(S)。
- 延续用户可见的删除确认。后台查询的重试、取消机制不得套用于 SAVE_WORD 等计数写入。
- 第一版原句复习卡显示“词 + 原句”，隐藏释义直到揭示；挖空卡延后，避免重复词、词形和旧数据缺少位置造成错误遮挡。
- 本句解释能力已在已验收的部署启用，个人同意状态初始关闭，仍由独立按钮触发。第一次启用说明发送“当前单词与当前原句”；后续仍逐次点击，不在划词或收藏时自动请求。
- 本句解释第一版只临时显示，不保存到词条、同步或导出。未来需要保存时，再设计独立字段和完整备份契约。

## 3. 交付顺序

| PR | 交付内容 | 依赖 | 复杂度 | 完成判据 |
| --- | --- | --- | --- | --- |
| 1 | 原生原句复习卡 | 无 | 中 | 已实现；本地与 iPad 检查通过，剩余设备验证见 PR 7 |
| 2 | 网站停用开关与设置版本 | 无 | 低至中 | 已实现；站点、后台边界及重启检查通过 |
| 3 | 浮层定位与复杂页面回归 | PR 2 后集成 | 中 | 已实现；自动与 Chrome 几何检查通过 |
| 4 | 查询订阅与后台取消 | 固定 0.1.3 恢复策略；集成 PR 2 停用行为 | 中 | 已实现；取消/恢复与实际 Port 检查通过 |
| 5 | Magpie 本句解释及完整入口契约 | PR 4 的取消约定；入口迁移仅阻塞外部启用 | 中至高 | 已实现；隔离入口/模型/限额测试通过 |
| 6 | 扩展本句解释交互与发布材料 | PR 4、5 | 中 | 已实现；合成模型的浏览器验收通过 |
| 7 | 分阶段发布验收与当前文档校准 | 对应阶段 PR；第二轮须个人入口和政策发布就绪 | 中 | 自动检查、目标端和静态政策分别留证 |

里程碑一为 PR 1–3，可独立交付。里程碑二为 PR 4–6，只有解释服务与隐私说明就绪才开放功能。PR 7 分别为两个里程碑记录验收，不要求等待第二轮才交付第一轮。

复杂度表示相对工作量，不作为日历工期承诺。主要不确定性是原生签名设备验收、真实网页几何行为、Magpie 模型在更长输入/输出下的质量与延迟、个人入口迁移和静态政策发布。PR 1–6 的本地实现不必等待外部入口迁移；第二轮对外启用必须等待其就绪。

## 4. PR 1 原生原句复习卡（已实现）

### 目标行为

进入 Learn words 后，当前卡片展示词和一条历史原句。揭示答案后展示该条历史释义快照、原句来源和已有笔记。历史释义为空时回退当前词条释义，并标注为当前释义；两者均为空则显示“暂无释义”，不触发在线查询。

没有可用原句时继续使用现有普通词卡。原句读取失败应显示可重试提示，并允许继续普通词卡复习，不能把错误呈现成“复习完成”。

### 实现步骤

1. 新增纯展示模型 `ReviewCardContent`，保存词条身份、来源 encounter ID、原句、来源 URL、所用释义及回退类型。该模型不写入数据库。
2. 当前 `reviewQueue()` 不携带历史。仅为当前卡片读取最近 20 条 encounter，沿用现有 position 倒序，选择首条非空且包含目标词完整边界匹配的原句。无匹配时回退普通词卡；不遍历整个词库或无限翻页。
3. 使用大小写不敏感的字面匹配，不将词本身拼入正则。不做词干推测；显示用长度限制不修改原始历史。
4. 使用请求代次绑定词条、账号/分区和当前卡片。切卡、切账号、关闭或重新加载后，旧结果不能覆盖新卡。
5. 当前卡片或其历史内容改变时重新隐藏答案。保留 Space、1/2/3、会话计数和已有答题并发保护。
6. 为 VoiceOver 提供明确的词、原句与揭示状态；隐藏释义不能从辅助功能树提前读出。

主要落点：[ReviewView.swift](../frontend/apple/Packages/RememberMeUI/Sources/RememberMeUI/ReviewView.swift)、[LocalRepository.swift](../frontend/apple/Packages/RememberMeCore/Sources/RememberMeCore/LocalRepository.swift)、[Domain.swift](../frontend/apple/Packages/RememberMeCore/Sources/RememberMeCore/Domain.swift)。新增展示模型和测试放在对应 Swift package。

### 验收与回退

- 覆盖空历史、空原句、重复词、大小写、连字符/撇号、缺失释义、HTML 字符和非 HTTP(S) URL。
- 验证快照释义优先、当前释义回退、原句读取上限、切卡与账号切换后无旧数据泄漏。
- 揭示和提交答案前后，count 与 encounter 数量不变；reviewVersion、每日额度和重启后的调度仍按 review-v1 工作。
- Mac 检查键盘与 VoiceOver；iPhone/iPad 检查长句、小屏、动态字号和明暗主题。分别记录真实设备与模拟器结果。
- 回退为原词卡展示即可；不回滚数据或调度状态。

## 5. PR 2 网站停用与设置版本（已实现）

### 目标行为

扩展工具栏的 Setting → Websites 增加“在此网站停用/启用”，并提供可恢复的已停用网站列表。首版按精确 hostname 匹配，不支持通配符；不同子域独立，端口不参与匹配，域名由 URL 解析器规范化。

站点规则以顶层 HTTP(S) 页面为准，子 frame 继承。受限或无法可靠确定顶层站点的页面，开关显示不可用，不能创建空域名或从网页提供的数据猜测站点。

### 实现步骤

1. 新增 `services/site-settings.ts`，使用单独的 WXT local 键和显式 schemaVersion。设置不属于词库、不参与账号同步或旧 JSON 导出。
2. 背景页串行处理规则变更，验证消息发送者与目标站点。工具栏通过背景页取得当前页面的可用站点信息；先核对已有 host access 能力，不默认增加权限。
3. 设置迁移覆盖缺省、旧版本、重复/非法 hostname。遇未来版本或损坏数据时保留原始值并报错；自动划词先暂停，不以默认设置覆盖原数据。仅明确的恢复操作才能重置。
4. 内容脚本启动及设置变更时检查规则；停用后关闭卡片、清除延迟选区任务，禁止新的自动查询。
5. 背景页对页面来源的请求再次检查规则，避免旧脚本继续查询。停用站点上的右键记录也返回清晰提示，不查词或保存。普通词库管理不受影响。
6. 停用前已提交的保存仍按原有事务完成并反馈，不能当成可取消查询。与 PR 4 集成后，停用会解除本页面的查询订阅。

主要落点：[content.ts](../frontend/browser-extension/entrypoints/content.ts)、[background.ts](../frontend/browser-extension/entrypoints/background.ts)、[background-handler.ts](../frontend/browser-extension/services/background-handler.ts)、[context-menu-handler.ts](../frontend/browser-extension/services/context-menu-handler.ts)、[popup/App.vue](../frontend/browser-extension/entrypoints/popup/App.vue)。

### 验收与回退

使用两个不同站点的合成页面检查即时停用、再次启用、重启保留、子域区别、frame 继承和恶意规则输入。验证停用后没有新自动请求，切换不改词库，右键失败不产生记录。

回退时保留设置键。若使用尚不认识该设置的旧二进制，不能承诺仍遵守停用规则；发布说明应提示这一差异，必要时通过浏览器站点访问控制停用扩展。

## 6. PR 3 浮层定位与页面回归（已实现）

### 实现步骤

1. 从 `SelectionPopup.vue` 提取纯几何计算，统一布局视口、visualViewport 和浮层宿主坐标的换算。
2. 增补页面缩放、viewport 偏移、多行和反向选区、嵌套滚动、带 transform 的宿主测试。仅为有证据的问题修改行为。
3. 保留“鼠标或焦点进入卡片后按钮不因迟到结果移动”。卡片已被操作后只做必要的可见区域夹取，不持续追着选区跳动。
4. 保留滚动不关闭卡片。若采用交互前锚点跟踪，限定为当前选区并处理失效 Range；失效后保持最后安全位置，不读取新选区替换已有内容。
5. 所有 viewport/scroll/resize 监听、观察器和待执行帧在关闭、站点停用与 WXT invalidation 时清理。使用一帧合并，避免每次事件重复测量布局。

主要落点：[SelectionPopup.vue](../frontend/browser-extension/components/SelectionPopup.vue)、[content.ts](../frontend/browser-extension/entrypoints/content.ts)、[SelectionPopup.test.ts](../frontend/browser-extension/components/SelectionPopup.test.ts)、[content.test.ts](../frontend/browser-extension/tests/content.test.ts)。新增纯函数与合成页面夹具。

### 验收与回退

自动检查几何边界、监听器清理和旧选区隔离。实际 Chrome 检查 80%、100%、125%、200% 缩放、窄窗口、长释义、页面和卡片内部滚动。网页刷新和脚本替换后只能保留一套事件处理器。

若跟踪行为不稳定，回退到现有固定快照位置，保留坐标换算与视口夹取修复。测试通过不等于浏览器已加载新版本；已有 local feedback 服务应复用，并实际确认更新后的行为。

## 7. PR 4 查询订阅与后台取消（已实现）

### 请求契约

采用专用于查询的短生命周期 runtime Port，固定 requestId/sessionId 与 start/result/error/cancel 事件。Port 断开释放所属订阅。实现时在扩展架构文档记录协议；现有词库写消息不迁移到该协议。

逻辑查询身份跨一次恢复重试保持不变；传输 attempt 单独计数。实际 Port 连接本身隔离作用域，不接受客户端提供 tabId 来取消别人的连接。现有右键调用仍可使用内部服务函数，但必须注册自己的后台订阅。升级后滞留页面的旧查询消息继续作为受服务超时保护的兼容订阅处理，端口失效时要求刷新或手工重试；不能同时启动两条网络查询，也不能破坏现有词库写消息兼容。

背景页依据真实 sender 确定 tab/frame，再与 sessionId 组合成作用域。页面不能指定其他 tabId。共享请求的键包含查询类型、规范化单词和服务命名空间；语境解释再包含句子、目标语言与解释版本。

### 实现步骤

1. 在已有 dictionary/translation pending map 外明确订阅者生命周期。一个订阅取消，立即结束该订阅等待；其他订阅继续接收结果。
2. 只有最后一个订阅结束时才 Abort 底层网络请求并终止整个逻辑查询的恢复循环。不可取消的调用必须显式作为仍存活的订阅，不能被另一页面关闭所影响。
3. 取消状态必须覆盖请求尚未入队、排队中、执行中、超时和迟到响应。清理表项与监听器，并设置有界存活时间，避免长期运行扩展泄漏内存。
4. 关闭卡片、换词、站点停用、frame/页面销毁、Port 断开和 WXT invalidation 触发释放。老后台重启或旧协议不匹配时返回可恢复错误，不静默重发。
5. `PublicLookupClient` 支持调用者信号与每次尝试的超时信号组合；明确区分用户取消、尝试超时、总预算耗尽和网络失败。用户取消直接返回取消，不映射成可重试 LookupFailure；进入第二次尝试前再次检查逻辑查询是否仍有订阅。
6. 保留公开单词翻译的 5 秒首次尝试、19 秒总预算和最多一次恢复；两次请求体完全相同。4xx、非法/超大响应仍不重试。词典与新语境解释不继承该重试策略，词库写入始终在另一条协议上。
7. 当前普通单词网关/bridge/ServerTranslator 不传播页面调用者取消；PR 4 的交付边界是扩展后台到公开 HTTP 的取消。首次尝试 5 秒结束时，后端 8 秒主查询可能仍在执行，第二次尝试可复用同词 pending。后续若增加服务器断连取消，须保留这一共享逻辑任务，不能把单个传输断开等同于停止模型生成。
8. 后端/模型取消作为独立验证项，不在 PR 4 宣称完成；不承诺模型供应商一定停止计费。现有请求日志的 requestId、status、durationMs 可用于追踪，增加 attempt 关联时仅传不含原句或账号信息的标识。

主要落点：[lookup-client.ts](../frontend/browser-extension/services/lookup-client.ts)、[dictionary.ts](../frontend/browser-extension/services/dictionary.ts)、[translation.ts](../frontend/browser-extension/services/translation.ts)、[public-lookup.ts](../frontend/browser-extension/services/public-lookup.ts)、[background-handler.ts](../frontend/browser-extension/services/background-handler.ts)。

### 验收与回退

验证两页同词共享一次逻辑查询（最多两次传输）；关闭 A 不影响 B；关闭最后一页会 abort 且不再恢复。新增“在 5 秒边界前取消”“第一次失败后、第二次发送前取消”“第二次执行中取消”和“一个订阅退出而另一订阅完成恢复”用例。快速 A→B→A、取消早于注册、后台重启、超时后迟到结果均不串状态。成功缓存仍有效，取消和失败不缓存，SAVE_WORD 不自动重试。

现有 [public-lookup.test.ts](../frontend/browser-extension/services/public-lookup.test.ts) 与 [translation.test.ts](../frontend/browser-extension/services/translation.test.ts) 的首查恢复、总预算、迟到响应、同词合并和非词库写入回归是硬性保留项；不得用“支持取消”替换掉这些覆盖。

协议与客户端必须随同一扩展包交付。回退可恢复为现有消息方式、UI 超时和旧结果忽略，不变更词库。

## 8. PR 5 本句解释契约与服务（已部署启用）

### 独立能力

已新增 `POST /api/v1/public/lookup/context-explanation`。这是新能力，不放宽原 dictionary/translation 的单词接口。服务 capability 与客户端构建开关共同控制可用性。新服务安装仍默认关闭，已验收的生产实例和 0.1.5 构建已开启；个人同意保持独立。接口名与 schema 已在 contracts/context-explanation.ts 固定。

原有公开入口不透传账号 `/api/v1/capabilities`；本轮在客户端、网关、bridge、Node 源码中增加专用 `GET /api/v1/public/lookup/capabilities`，只返回解释开关、schemaVersion、输入限制与 explanationVersion，不暴露账号、配置地址或凭证。该路由须在 Node 的账号鉴权中间件之前注册，并经过 origin 校验、限流、网关与 bridge 白名单；客户端以独立方法读取，失败或版本不识别时关闭解释入口。它不替代已有账号 capabilities。

请求为 `{ word, context, target: "zh-CN", schemaVersion: 1 }`。不接收 URL、标题、整页、词库列表、任意 provider URL 或客户端凭证。word 沿用现有单词规则及上限；context 最多 1000 个 UTF-16 单元，整个请求体最多 16 KiB。两端校验并在契约中固定计数方式。

响应包含 `{ schemaVersion, contextualMeaning, sentenceTranslation, usageNote, provider, explanationVersion }`。schemaVersion 固定为 1；contextualMeaning 与 sentenceTranslation 为非空字符串，usageNote 可空。三个文本字段的建议字符上限分别为 500、2000、500。provider 和 explanationVersion 由服务填入，不让模型自报来源。

### 实现步骤

1. 在 `contracts/` 增加请求/响应 schema、成功和错误 fixtures。错误至少区分不可用、非法输入、限流、忙、超时和非法模型输出。
2. 新增独立的 Magpie 解释适配器与提示词版本，复用现有私有连接的配置校验、凭证隔离和响应清理原则；不通过放宽 `MagpieTranslator.translate(word)` 接收原句。当前请求使用 `group/translator` 路由组（具体模型由 Magpie 选择）；此前 `zhipu/glm-5.3-flash`、low reasoning 与单词 512-token 输出额度的验收只证明单词路径；解释的输出额度、完成原因和最长输入须独立评估。无工具、无会话、完整 JSON 验证继续保留。
3. 将网页原句作为待分析数据传入固定指令。模型不调用工具、不访问网页、不改变服务配置；服务校验完整结构后再返回。非法输出显式失败，不按部分文本冒充成功。
4. 解释服务当前预算：模型 15 秒、API 18 秒、公开 HTTP 20 秒、Port/UI 22 秒（包括能力和同意检查）；网关/bridge 截止时间需容纳内层截止时间与响应传输，由端到端夹具确认。独立按路由配置，不修改单词路径的 8+4 秒和 5/19/20/22 秒预算。解释首版不自动重试、不回退 MyMemory；模型只返回部分 JSON、截断或工具调用时显式失败。
5. 新接口限额独立配置，初始建议每 IP 每分钟 6 次；同时保留现有公开查询总额度。单进程共享 Magpie 并发预算保持 2，解释最多占 1，给单词请求保留容量；不得在两个 adapter 各自设置 2 而实际允许 4。无容量立即 busy，不排无界队列。多实例时不得把单进程预算表述为全局额度。
6. 浏览器只保留短期、有界的内存缓存：建议最多 100 项、存活 30 分钟。键含服务 origin、单词、原句、目标语言和解释版本；切服务、关闭功能或扩展重启清除。首版服务端不持久化原句、解释或成功缓存。
7. 日志沿用现有 requestId、status、durationMs，静态错误码由响应返回；不记录 word/context/输出。核查模型服务自身的内容留存设置，不能仅依据本服务不落盘就承诺上游零留存。
8. 在公开客户端、网关、bridge 和 Node API 统一定义逐路由策略。仅解释 POST 允许 16 KiB 请求，旧两条查询仍保持网关/bridge 的 2048 字节限制及原字段白名单；新的 capability GET 无请求体。不能只改 Node API 或全局增大限制。使用包含中文、代理对字符和 JSON 转义的合成句子验证字节与 UTF-16 上限，禁止任一层静默截断。
9. 网关与 bridge 仅为新 POST/GET 增加固定路由和所需预检方法，不开放通用代理。保留拒绝任意上游地址、账号路径、客户端凭证及多余字段的负例；两条旧查询的 origin 与方法策略不放宽。

主要落点：[contracts/api-v1.md](../contracts/api-v1.md)、[index.ts](../backend/src/index.ts)、[magpie.ts](../backend/src/magpie.ts)、[node-runtime.ts](../backend/src/node-runtime.ts)、[lookup.ts](../backend/src/lookup.ts)、[runtime.ts](../backend/src/runtime.ts)，新增独立解释模块与测试。完整入口还包括 [PublicLookupClient](../frontend/browser-extension/services/public-lookup.ts)、[lookup-gateway/index.ts](../backend/lookup-gateway/index.ts) 和 [lookup-bridge.mjs](../backend/scripts/lookup-bridge.mjs)；Pages 层目前仅转交绑定，不需要增加任意代理能力。

### 验收与回退

使用 mock provider 覆盖字段超长、额外 URL 字段、指令注入文本、非法 JSON、缺字段、截断、工具调用、429、忙、超时、断连和日志脱敏。bank、charge、issue 等不同语境不得串缓存；结果是否解释准确须另用合成例句人工核对。

新增真实本地 HTTP → bridge → API 的字节边界检查，并单独验证网关转发、capability GET/预检、功能关闭、旧路由拒绝 context 以及共享并发不饿死单词查询。保留 [magpie.test.ts](../backend/tests/magpie.test.ts) 的 8 秒回退、容量释放、实际来源和 TTL 检查。

先发布关闭状态的后端能力，再配置个人账号下的完整入口与静态政策。公开域名上的 capability、解释路由、大小和超时检查通过后，才启用客户端入口。出现问题关闭新 capability，原有单词查询继续工作。公开生成成本和上游留存设置未核实前保持关闭，不以 CORS 作为防滥用认证。

## 9. PR 6 扩展本句解释交互（0.1.5 已发布）

### 目标行为

查词卡增加“解释本句”次级操作。原句为空时不可请求，并说明需要从网页句子中选词。首次启用显示原句发送范围及服务说明，提供取消；该开关与账号同步的来源上传开关分开，不互相授权。

点击时冻结当前单词与选词时提取的原句。解释显示在独立区块，不覆盖字典释义；生成中、失败、取消和完成状态均不影响原有记录按钮。

### 实现步骤

1. 新增 `context-explanation-client.ts`、独立结果类型与 Vue 展示组件；复用 PR 4 的请求生命周期。
2. 对 API 回复再次校验；按纯文本展示。关闭卡片、换词、停用站点或关闭能力后忽略旧结果并释放订阅。
3. 失败后允许手动重试。普通词典和中文单词翻译继续可用，不把本句解释静默回退到只懂单词的接口。
4. 关闭能力即清除内存解释缓存，并停止新请求。不回写已保存 encounter，也不改旧导出内容。
5. 首版使用完整 JSON 回复。流式体验延后；只有长等待确实影响使用时，再设计 chunk/done/error 契约和增量校验。
6. 更新行为、架构、隐私政策和商店描述，准确区分常规查词发送单词、按需解释发送原句。同步更新渲染后的静态资产并实际检查公开政策 URL；源 Markdown/HTML 改完不代表已发布。

主要落点：[content.ts](../frontend/browser-extension/entrypoints/content.ts)、[SelectionPopup.vue](../frontend/browser-extension/components/SelectionPopup.vue)、[types/index.ts](../frontend/browser-extension/types/index.ts)、[隐私政策](../frontend/browser-extension/docs/release/privacy-policy.md)、[商店描述](../frontend/browser-extension/docs/release/store-listing.md)。

### 验收与回退

默认关闭时无上下文请求；拒绝启用无网络调用；点击只发送当前词和句子；两次选区结果不串用。记录次数、历史释义、JSON 导出、删除确认与词典失败回退保持原有语义。

实测一次点击到完成/失败、取消、重开卡片、后端关闭 capability、离线和版本不匹配。回退关闭入口并清理内存缓存，不涉及词库迁移。

## 10. 验证与发布门槛

| 变更范围 | 自动检查 | 实际验收 |
| --- | --- | --- |
| 原生展示与历史读取 | 受影响 Core/UI package tests；必要时包内完整 swift test | Mac、iPhone/iPad 的复习、键盘、VoiceOver、长句 |
| 扩展服务/组件 | 受影响 Vitest 文件及 npm run compile | 对应交互使用合成页面 |
| content/background/消息 | 相关回归、compile、Chrome build；共享路径扩大到完整 npm test | 实际安装 Chrome，多个页面、停用、取消、重启 |
| 查询取消与恢复 | 保留单词 5/19/20/22 秒预算；取消前后和共享订阅回归 | 首次失败自动恢复、最后订阅取消后不再次发送 |
| 新 API/契约 | schema fixtures、backend typecheck、相关 Vitest、Node build | 隔离 HTTP 联调，随后测试环境模型请求 |
| 网关/桥接 | 原 2 KiB 与新 16 KiB 边界、capability GET/预检、路由负例 | 公开域名的路径、origin、大小和超时限制 |
| 发布包 | 现有打包与升级检查 | 安装/升级后确认新版本行为 |
| 隐私与入口 | 源政策及渲染资产一致，个人入口配置已验证 | 实际公开政策内容、新能力开关和关闭回退 |

扩展 npm 命令在 `frontend/browser-extension/` 执行，后端命令在 `backend/` 执行。各包使用自身 `.nvmrc` 和 `npm ci`；原生检查按 [Apple testing](../frontend/apple/docs/testing.md)，浏览器检查按 [extension testing](../frontend/browser-extension/docs/testing.md)。已有 [backend CI](../.github/workflows/backend.yml) 继续复用，不重复新建同等流水线。

所有测试只用合成词库和一次性数据目录。已有本地 watcher 时复用服务并核对构建错误，不启动第二套 watcher；构建成功、模拟测试成功与真实浏览器更新分别留证。

每个里程碑交付一份日期化验证记录，列明源码状态、命令结果、实际设备/浏览器、失败及未执行事项。新功能的自动检查通过且目标端行为已观察后，才标记该目标发布可用。

第二轮发布前必须关闭以下事项：

- 按 [个人账号迁移文档](../backend/docs/cloudflare-account-migration.md) 验证入口归属、资源配置与实际连通性；最新部署记录仍指出 VPC 占位与政策静态发布待处理，不能把现有域名可用视为迁移完成。
- 在公开政策 URL 上检查 Magpie 和新增原句发送说明，与包内材料一致。10 月 24–25 日记录仅确认政策源资产更新，没有确认 Cloudflare 静态发布。
- capability 的关闭状态、客户端已缓存开启状态后的服务关闭、老网关 404 和不支持 schemaVersion 都能退回普通词典。服务端实际拒绝已关闭能力，不能只隐藏客户端按钮。
- 验证单词翻译仍可在不登录时使用；保留当前可选登录与登录后同步行为。原生匿名查询继续 MyMemory、已连接查询使用 backend 的区别不得写成“所有客户端都直连 Magpie”。
- 清理当前指南中相互冲突的旧段落，特别是 [扩展架构](../frontend/browser-extension/docs/architecture.md)、[原生行为](../frontend/apple/docs/behavior.md)、[contracts README](../contracts/README.md) 和 [API 文档](../contracts/api-v1.md)。日期化验证记录作为历史证据保留，不重写成当前事实。

外部部署沿用项目账号规则：操作前读取工作区 AGENTS.md，Cloudflare 仅使用已验证个人账号和项目 `backend/scripts/cloudflare.mjs`。历史公司资源不是发布目标。10 月 27 日用户已明确授权发布与启用，本轮执行记录见 PR 7 证据。

## 11. 文档维护与启动清单

实施时随功能更新以下文档，区分“已有行为”与“计划行为”：

- 扩展的 [behavior](../frontend/browser-extension/docs/behavior.md)、[architecture](../frontend/browser-extension/docs/architecture.md)、[testing](../frontend/browser-extension/docs/testing.md)。
- 原生的 [behavior](../frontend/apple/docs/behavior.md)、[architecture](../frontend/apple/docs/architecture.md)、[testing](../frontend/apple/docs/testing.md)。
- 新解释能力的 API schema、fixtures、[API 文档](../contracts/api-v1.md) 和发布隐私材料。

开始实现时先重新记录 HEAD 和工作区现状；如出现其他未提交修改，保留它们。围绕单个 PR 核对相关源码，不把旧评估中的内容视为实时事实。

已完成的基础能力（依据源码和已有记录；本轮未重跑）：

- [x] Magpie 单词翻译适配器、MyMemory 回退和三来源 TS/Swift 兼容。
- [x] 公开单词翻译最多一次自动恢复、固定总预算与迟到响应清理。
- [x] 基础 npm CI 配置，以及 10 月 24–25 日记录中的隔离测试、打包和 Chrome 样本验收；本轮未观察远程 CI 运行。

仍待交付的 Read Frog 增量：

- [x] PR 1：原句复习卡、包测试和 iPad 模拟器自动验收；剩余设备检查归入 PR 7。
- [x] PR 2：网站开关、设置版本与后台/Chrome 回归。
- [x] PR 3：定位边界、关闭清理与独立 Chrome 验收。
- [ ] 原生正式分发：Mac 与模拟器、主题/动态字号/对比度已验收；真机签名团队例外授权、实际 VoiceOver 朗读和原生安装包分发仍待完成。浏览器部分已随 0.1.5 发布。
- [x] PR 4：共享查询取消、保留有限恢复、取消与恢复竞态回归。
- [x] PR 5：Magpie 解释、公开能力查询、逐路由请求上限、共享并发与隔离入口验证；线上入口已于 10 月 27 日通过验收。
- [x] PR 6：解释交互、隐私源材料与独立 Chrome 合成模型验收；实际政策已于 10 月 27 日发布到个人入口。
- [x] 里程碑二：个人入口、有效政策与完整公网链路验收通过，能力已启用；用户首次同意仍独立。

10 月 25 日仅做计划静态复核。10 月 26 日完成两轮本地实现，10 月 27 日完成本句解释的发布与启用。命令、修复、测试边界和原生待办见各日期记录。

## 12. Read Frog 参考索引

借鉴行为和工程机制，按本项目契约独立实现。若拟复制具体代码或模板，应单独核对其 GPLv3/商业许可；README 中的特定团队授权不适用于本项目。

- [词典结构化字段](https://github.com/mengxi-ream/read-frog/blob/fcb00beb21a9d674c0262346fbc422fbbf317c03/src/utils/constants/custom-action-templates.ts)：原句、释义和记忆提示。
- [复习入口](https://github.com/mengxi-ream/read-frog/blob/fcb00beb21a9d674c0262346fbc422fbbf317c03/src/entrypoints/selection.content/selection-toolbar/review-due-tab.tsx)：阅读与复习的连接；不作为服务端 FSRS 实现证据。
- [网站控制](https://github.com/mengxi-ream/read-frog/blob/fcb00beb21a9d674c0262346fbc422fbbf317c03/src/utils/site-control.ts) 与 [定位模块](https://github.com/mengxi-ream/read-frog/blob/fcb00beb21a9d674c0262346fbc422fbbf317c03/src/entrypoints/selection.content/selection-toolbar/positioning.ts)。
- [请求队列](https://github.com/mengxi-ream/read-frog/blob/fcb00beb21a9d674c0262346fbc422fbbf317c03/src/utils/request/request-queue.ts)：共享订阅的取消保护。
- [配置迁移](https://github.com/mengxi-ream/read-frog/blob/fcb00beb21a9d674c0262346fbc422fbbf317c03/src/utils/config/migration.ts)：连续迁移与未来版本拒绝。
