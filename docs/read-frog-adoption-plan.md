# Remember Me 借鉴 Read Frog 的实施计划

日期：2026-10-19。状态：待实施。本文定义拟实现行为、工作拆分与验收条件，不代表功能已完成或测试已通过。

目标是增强“阅读时遇到生词 → 记录遗忘 → 理解原句 → 到期复习”的流程。先改善本地学习与浏览器体验，再增加按需的语境解释。沿用 Vue、Swift 和现有后端边界。

## 1. 当前基础与实施范围

本计划依据当前工作区源码，包含已有未提交修改。Read Frog 参考版本固定为 [v1.52.0 对应提交 fcb00be](https://github.com/mengxi-ream/read-frog/tree/fcb00beb21a9d674c0262346fbc422fbbf317c03)。

| 能力 | 当前基础 | 本轮增量 |
| --- | --- | --- |
| 原句采集 | 扩展保存 context、url、释义快照 | 在原生复习卡中利用已有原句 |
| 复习调度 | 原生端已有 review-v1、每日 20 个新词、三档反馈 | 改善卡片内容，不替换算法 |
| 划词交互 | 已有选区快照、视口夹取、滚动保持和按钮位置保护 | 网站停用、visualViewport 与复杂页面适配 |
| 查询请求 | 已有超时、成功缓存、同词请求合并、旧结果隔离 | 订阅级取消与后台请求清理 |
| 翻译 | 当前公开查询只接受单个英文词 | 新增独立的本句解释接口与显示区域 |
| 自动检查 | backend CI 已运行扩展安装、类型检查、测试、构建 | 扩充回归用例和新设置的版本迁移测试 |

首轮交付覆盖 macOS/iOS 原生复习和 Chrome 扩展。浏览器复习入口、短语自动查询、FSRS、全页翻译、字幕、通用提示词编辑器和更多模型选择器留待后续。原生数据模型已有 phrase 等类型；本轮不扩展浏览器的单词查询契约。

## 2. 不变量与默认产品决定

- count 与 history 长度保持独立。查看原句、生成解释、揭示答案都不增加遗忘次数；复习答案仅影响已有复习状态与事件。
- 旧 JSON 继续按原数组格式导入导出。新增设置、临时解释与缓存不塞入历史释义或旧导出格式。
- 保留本地 WordNet 优先、中英结果独立显示、释义失败仍可手工记录的行为。
- 本轮不开放发行版账号同步，也不把匿名词库自动复制到账号。
- 原句、网页文本和模型输出均按不可信文本处理。来源链接仍只允许 HTTP(S)。
- 延续用户可见的删除确认。后台查询的重试、取消机制不得套用于 SAVE_WORD 等计数写入。
- 第一版原句复习卡显示“词 + 原句”，隐藏释义直到揭示；挖空卡延后，避免重复词、词形和旧数据缺少位置造成错误遮挡。
- 本句解释由独立按钮触发，默认关闭。第一次启用说明发送“当前单词与当前原句”；后续仍逐次点击，不在划词或收藏时自动请求。
- 本句解释第一版只临时显示，不保存到词条、同步或导出。未来需要保存时，再设计独立字段和完整备份契约。

## 3. 交付顺序

| PR | 交付内容 | 依赖 | 复杂度 | 完成判据 |
| --- | --- | --- | --- | --- |
| 1 | 原生原句复习卡 | 无 | 中 | 本地历史可用，复习语义不变 |
| 2 | 网站停用开关与设置版本 | 无 | 低至中 | 当前站点即时停用，重启保留，可恢复 |
| 3 | 浮层定位与复杂页面回归 | PR 2 后集成 | 中 | 缩放和滚动稳定，已有交互保持 |
| 4 | 查询订阅与后台取消 | 无；集成 PR 2 停用行为 | 中 | 取消只影响所属订阅，资源最终释放 |
| 5 | 本句解释契约、服务与隔离测试 | PR 4 的取消约定 | 中至高 | 独立路由、受限输入、结构化输出 |
| 6 | 扩展本句解释交互与发布材料 | PR 4、5 | 中 | 显式触发、结果不串选区、失败可恢复 |
| 7 | 分阶段发布验收 | 对应阶段 PR | 中 | 自动检查与目标端实测分别留证 |

里程碑一为 PR 1–3，可独立交付。里程碑二为 PR 4–6，只有解释服务与隐私说明就绪才开放功能。PR 7 分别为两个里程碑记录验收，不要求等待第二轮才交付第一轮。

复杂度表示相对工作量，不作为日历工期承诺。主要不确定性是原生签名设备验收、真实网页几何行为、现有模型服务能否稳定输出结构化解释。

## 4. PR 1 原生原句复习卡

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

## 5. PR 2 网站停用与设置版本

### 目标行为

扩展工具栏增加“在此网站停用/启用”。另提供已停用网站列表，允许移除规则。首版按精确 hostname 匹配，不支持通配符；不同子域独立，端口不参与匹配，域名由 URL 解析器规范化。

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

## 6. PR 3 浮层定位与页面回归

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

## 7. PR 4 查询订阅与后台取消

### 请求契约

新增专用于可取消查询的 requestId/sessionId 与取消消息，或使用短生命周期 runtime Port；实现前在扩展架构文档固定一种协议，避免两条并行路径。现有词库写消息不迁移到该协议。

背景页依据真实 sender 确定 tab/frame，再与 sessionId 组合成作用域。页面不能指定其他 tabId。共享请求的键包含查询类型、规范化单词和服务命名空间；语境解释再包含句子、目标语言与解释版本。

### 实现步骤

1. 在已有 dictionary/translation pending map 外明确订阅者生命周期。一个订阅取消，立即结束该订阅等待；其他订阅继续接收结果。
2. 只有最后一个订阅结束时才 Abort 底层网络请求。不可取消的调用必须显式作为仍存活的订阅，不能被另一页面关闭所影响。
3. 取消状态必须覆盖请求尚未入队、排队中、执行中、超时和迟到响应。清理表项与监听器，并设置有界存活时间，避免长期运行扩展泄漏内存。
4. 关闭卡片、换词、站点停用、frame/页面销毁、Port 断开和 WXT invalidation 触发释放。老后台重启或旧协议不匹配时返回可恢复错误，不静默重发。
5. `PublicLookupClient` 支持调用者信号与自身超时信号组合；区分用户取消、超时、网络和 429。当前普通查词仍保持无自动重试，用户可手动重试。
6. 后端/模型侧仅在相应连接支持时传播断连取消。验收区分“客户端不再等待”和“服务端已停止工作”；不承诺模型供应商一定停止计费。

主要落点：[lookup-client.ts](../frontend/browser-extension/services/lookup-client.ts)、[dictionary.ts](../frontend/browser-extension/services/dictionary.ts)、[translation.ts](../frontend/browser-extension/services/translation.ts)、[public-lookup.ts](../frontend/browser-extension/services/public-lookup.ts)、[background-handler.ts](../frontend/browser-extension/services/background-handler.ts)。

### 验收与回退

验证两页同词只合并一次请求；关闭 A 不影响 B；关闭最后一页会 abort；快速 A→B→A、取消早于注册、后台重启、超时后迟到结果均不串状态。验证成功缓存仍有效、取消和失败不缓存、SAVE_WORD 不自动重试。

协议与客户端必须随同一扩展包交付。回退可恢复为现有消息方式、UI 超时和旧结果忽略，不变更词库。

## 8. PR 5 本句解释契约与服务

### 独立能力

拟新增 `POST /api/v1/public/lookup/context-explanation`。这是新能力，不放宽原 dictionary/translation 的单词接口。服务 capability 与客户端构建开关共同控制可用性，默认关闭；接口名在实现契约时定稿。

请求拟为 `{ word, context, target: "zh-CN", schemaVersion: 1 }`。不接收 URL、标题、整页、词库列表、任意 provider URL 或客户端凭证。word 沿用现有单词规则及上限；context 最多 1000 个 UTF-16 单元，整个请求体最多 16 KiB。两端校验并在契约中固定计数方式。

响应拟包含 `{ schemaVersion, contextualMeaning, sentenceTranslation, usageNote, provider, explanationVersion }`。前两项必填；usageNote 可空。建议字符上限分别为 500、2000、500。provider 和 explanationVersion 由服务填入，不让模型自报来源。

### 实现步骤

1. 在 `contracts/` 增加请求/响应 schema、成功和错误 fixtures。错误至少区分不可用、非法输入、限流、忙、超时和非法模型输出。
2. 为 Hermes 增加独立的解释适配器及提示词版本。先用合成输入验证服务能力；当前单词翻译适配器不能自动被视为支持长上下文和 JSON 输出。
3. 将网页原句作为待分析数据传入固定指令。模型不调用工具、不访问网页、不改变服务配置；服务校验完整结构后再返回。非法输出显式失败，不按部分文本冒充成功。
4. 首版建议模型超时 15 秒、接口总预算 18 秒、UI 预算 20 秒；值通过夹具和隔离联调核实。重试由用户触发，不套用全页翻译的长退避队列。
5. 新接口限额独立配置，初始建议每 IP 每分钟 6 次、单进程同时 2 个生成任务；满载直接返回 busy，不排无界队列。部署为多实例时不得把单进程额度表述为全局额度。
6. 浏览器只保留短期、有界的内存缓存：建议最多 100 项、存活 30 分钟。键含服务 origin、单词、原句、目标语言和解释版本；切服务、关闭功能或扩展重启清除。首版服务端不持久化原句、解释或成功缓存。
7. 日志只记录静态错误码、耗时区间与请求大小，不记录 word/context/输出。核查模型服务自身的内容留存设置，不能仅依据本服务不落盘就承诺上游零留存。
8. 网关和 lookup bridge 的路由白名单需显式新增此接口，并限制为固定上游；不会因为新增路径而开放通用代理。继续准确校验 origin，凭证不进入公开查询链路。

主要落点：[contracts/api-v1.md](../contracts/api-v1.md)、[backend/src/index.ts](../backend/src/index.ts)、[backend/src/lookup.ts](../backend/src/lookup.ts)、[backend/src/runtime.ts](../backend/src/runtime.ts)，新增服务模块与隔离测试。网关与 bridge 变更需核对 [backend/lookup-gateway](../backend/lookup-gateway/) 和 [lookup-bridge.mjs](../backend/scripts/lookup-bridge.mjs)。

### 验收与回退

使用 mock provider 覆盖字段超长、额外 URL 字段、指令注入文本、非法 JSON、缺字段、429、忙、超时、断连和日志脱敏。bank、charge、issue 等不同语境不得串缓存；结果是否解释准确须另用合成例句人工核对。

先发布关闭状态的后端能力，验证端到端超时和路由后再启用客户端入口。出现问题关闭新 capability，原有单词查询继续工作。公开生成成本和上游留存设置未核实前保持关闭，不以 CORS 作为防滥用认证。

## 9. PR 6 扩展本句解释交互

### 目标行为

查词卡增加“解释本句”次级操作。原句为空时不可请求，并说明需要从网页句子中选词。首次启用显示原句发送范围及服务说明，提供取消；该开关与账号同步的来源上传开关分开，不互相授权。

点击时冻结当前单词与选词时提取的原句。解释显示在独立区块，不覆盖字典释义；生成中、失败、取消和完成状态均不影响原有记录按钮。

### 实现步骤

1. 新增 `context-explanation-client.ts`、独立结果类型与 Vue 展示组件；复用 PR 4 的请求生命周期。
2. 对 API 回复再次校验；按纯文本展示。关闭卡片、换词、停用站点或关闭能力后忽略旧结果并释放订阅。
3. 失败后允许手动重试。普通词典和中文单词翻译继续可用，不把本句解释静默回退到只懂单词的接口。
4. 关闭能力即清除内存解释缓存，并停止新请求。不回写已保存 encounter，也不改旧导出内容。
5. 首版使用完整 JSON 回复。流式体验延后；只有长等待确实影响使用时，再设计 chunk/done/error 契约和增量校验。
6. 更新行为、架构、隐私政策和商店描述，准确区分常规查词发送单词、按需解释发送原句。

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
| 新 API/契约 | schema fixtures、backend typecheck、相关 Vitest、Node build | 隔离 HTTP 联调，随后测试环境模型请求 |
| 网关/桥接 | 项目已有网关/桥接测试与新增路由负例 | 目标环境的路径、origin、大小和超时限制 |
| 发布包 | 现有打包与升级检查 | 安装/升级后确认新版本行为 |

扩展 npm 命令在 `frontend/browser-extension/` 执行，后端命令在 `backend/` 执行。各包使用自身 `.nvmrc` 和 `npm ci`；原生检查按 [Apple testing](../frontend/apple/docs/testing.md)，浏览器检查按 [extension testing](../frontend/browser-extension/docs/testing.md)。已有 [backend CI](../.github/workflows/backend.yml) 继续复用，不重复新建同等流水线。

所有测试只用合成词库和一次性数据目录。已有本地 watcher 时复用服务并核对构建错误，不启动第二套 watcher；构建成功、模拟测试成功与真实浏览器更新分别留证。

每个里程碑交付一份日期化验证记录，列明源码状态、命令结果、实际设备/浏览器、失败及未执行事项。新功能的自动检查通过且目标端行为已观察后，才标记该目标发布可用。

外部部署沿用项目账号规则：操作前读取工作区 AGENTS.md，Cloudflare 仅使用已验证个人账号和项目 `backend/scripts/cloudflare.mjs`。历史公司资源不是发布目标。本计划不执行部署或修改线上服务。

## 11. 文档维护与启动清单

实施时随功能更新以下文档，区分“已有行为”与“计划行为”：

- 扩展的 [behavior](../frontend/browser-extension/docs/behavior.md)、[architecture](../frontend/browser-extension/docs/architecture.md)、[testing](../frontend/browser-extension/docs/testing.md)。
- 原生的 [behavior](../frontend/apple/docs/behavior.md)、[architecture](../frontend/apple/docs/architecture.md)、[testing](../frontend/apple/docs/testing.md)。
- 新解释能力的 API schema、fixtures、[API 文档](../contracts/api-v1.md) 和发布隐私材料。

开始实现时先记录工作区现状，保留已有未提交修改；围绕单个 PR 核对相关源码，避免把旧评估中的文件内容视为当前事实。按各阶段勾选交付状态：

- [ ] PR 1：原句复习卡与原生验收。
- [ ] PR 2：网站开关、设置版本与回归。
- [ ] PR 3：定位边界与真实 Chrome 验收。
- [ ] 里程碑一：发布包及设备证据。
- [ ] PR 4：共享查询取消与隔离测试。
- [ ] PR 5：解释接口、服务能力与限额验证。
- [ ] PR 6：解释交互、隐私材料与真实 Chrome 验收。
- [ ] 里程碑二：完整链路验收后开启能力。

## 12. Read Frog 参考索引

借鉴行为和工程机制，按本项目契约独立实现。若拟复制具体代码或模板，应单独核对其 GPLv3/商业许可；README 中的特定团队授权不适用于本项目。

- [词典结构化字段](https://github.com/mengxi-ream/read-frog/blob/fcb00beb21a9d674c0262346fbc422fbbf317c03/src/utils/constants/custom-action-templates.ts)：原句、释义和记忆提示。
- [复习入口](https://github.com/mengxi-ream/read-frog/blob/fcb00beb21a9d674c0262346fbc422fbbf317c03/src/entrypoints/selection.content/selection-toolbar/review-due-tab.tsx)：阅读与复习的连接；不作为服务端 FSRS 实现证据。
- [网站控制](https://github.com/mengxi-ream/read-frog/blob/fcb00beb21a9d674c0262346fbc422fbbf317c03/src/utils/site-control.ts) 与 [定位模块](https://github.com/mengxi-ream/read-frog/blob/fcb00beb21a9d674c0262346fbc422fbbf317c03/src/entrypoints/selection.content/selection-toolbar/positioning.ts)。
- [请求队列](https://github.com/mengxi-ream/read-frog/blob/fcb00beb21a9d674c0262346fbc422fbbf317c03/src/utils/request/request-queue.ts)：共享订阅的取消保护。
- [配置迁移](https://github.com/mengxi-ream/read-frog/blob/fcb00beb21a9d674c0262346fbc422fbbf317c03/src/utils/config/migration.ts)：连续迁移与未来版本拒绝。
