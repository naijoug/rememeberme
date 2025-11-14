# Implementation Plan

- [x] 1. 初始化项目结构和核心类型定义
  - 使用 WXT 创建浏览器插件项目，配置 Vue 3 和 TypeScript
  - 创建 types/index.ts 定义 WordEntry、HistoryRecord、Definition、Position 等核心接口
  - 配置 wxt.config.ts，设置插件名称、权限（storage、activeTab、host_permissions）
  - _Requirements: 1.1, 2.1, 2.2, 3.1_

- [x] 2. 实现词典服务（Dictionary Service）
  - [x] 2.1 创建 dictionary.ts 服务类
    - 实现 getDefinition 方法调用 Free Dictionary API
    - 解析 API 响应，提取 word、phonetic、phonetics、meanings 等完整信息
    - 返回符合 Definition 接口的数据结构
    - _Requirements: 1.2_
  
  - [x] 2.2 实现错误处理和重试机制
    - 处理网络错误、404、429 等 HTTP 状态码
    - 实现 3 秒超时和最多 2 次重试
    - 返回友好的错误消息
    - _Requirements: 1.5_

- [x] 3. 实现存储服务（Storage Service）
  - [x] 3.1 创建 storage.ts 服务类
    - 使用 WXT storage API 封装 IndexedDB 操作
    - 实现 getAllWords、getWord 方法读取数据
    - _Requirements: 2.6, 3.2_
  
  - [x] 3.2 实现单词保存和更新逻辑
    - 实现 saveWord 方法：创建或更新 WordEntry
    - 新单词：创建 WordEntry，count=1，添加第一条 HistoryRecord
    - 已存在单词：count+=1，追加新的 HistoryRecord
    - 更新 createdAt 和 updatedAt 时间戳
    - _Requirements: 2.1, 2.2, 2.3, 2.6_
  
  - [x] 3.3 实现删除和重置功能
    - 实现 deleteWord 方法从存储中移除单词
    - 实现 resetCount 方法将计数重置为 0
    - _Requirements: 4.1, 4.2_
  
  - [x] 3.4 实现导出和导入功能
    - 实现 exportData 方法生成包含所有 WordEntry 和 HistoryRecord 的 JSON 字符串
    - 实现 importData 方法解析 JSON 并合并数据
    - 处理重复单词：合并 history 数组，更新 count
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 4. 实现上下文提取服务（Context Extractor）
  - [x] 4.1 创建 context-extractor.ts 服务类
    - 实现 extractSentence 方法从 Selection 对象提取完整句子
    - 使用句子边界检测（. ! ? \n）查找句子起止位置
    - _Requirements: 6.1, 6.2_
  
  - [x] 4.2 实现上下文截断和高亮逻辑
    - 当句子超过 200 字符时，截取选中单词前后各 100 字符
    - 在上下文中标记选中单词的位置（用于高亮显示）
    - 处理无法提取句子的情况，返回空字符串
    - _Requirements: 6.3, 6.4, 6.5_

- [x] 5. 实现 Content Script 和文本选择功能
  - [x] 5.1 创建 content.ts 入口文件
    - 监听 mouseup 事件检测文本选择
    - 使用防抖（300ms）优化性能
    - 验证选中文本是否为英文单词（基本正则验证）
    - _Requirements: 1.1_
  
  - [x] 5.2 实现弹窗显示逻辑
    - 计算选中文本的位置，确定弹窗坐标
    - 调用 context-extractor 提取上下文句子
    - 通过消息通信向 background 请求单词释义
    - 动态创建或更新 SelectionPopup 组件实例
    - _Requirements: 1.1, 1.2, 6.1_
  
  - [x] 5.3 实现单词保存功能
    - 监听 SelectionPopup 的 forget 事件
    - 调用 storage.saveWord 保存单词、释义、上下文、URL
    - 显示"第 N 次忘记该单词"的提示消息
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  
  - [x] 5.4 实现弹窗关闭逻辑
    - 监听 remember 事件和 close 事件关闭弹窗
    - 监听页面点击事件，点击弹窗外区域时关闭
    - _Requirements: 1.4, 2.5_

- [x] 6. 实现 SelectionPopup 组件
  - [x] 6.1 创建 SelectionPopup.vue 组件
    - 定义 props：word、position、visible、definition、error
    - 实现弹窗定位逻辑（根据 position 计算 CSS）
    - 显示单词、音标、释义（词性、定义、例句）
    - _Requirements: 1.1, 1.2, 1.3_
  
  - [x] 6.2 实现操作按钮和事件
    - 添加 Remember 和 Forget 按钮
    - 触发 @remember、@forget、@close 事件
    - 显示加载状态和错误提示
    - _Requirements: 1.3, 1.4, 1.5_
  
  - [x] 6.3 添加样式和动画
    - 编写 content.css 样式文件
    - 实现弹窗阴影、圆角、过渡动画
    - 确保在不同网站上的样式隔离（使用 Shadow DOM 或唯一类名前缀）
    - _Requirements: 1.1_

- [x] 7. 实现 Background Service Worker
  - [x] 7.1 创建 background.ts 入口文件
    - 监听来自 content script 的消息
    - 定义消息类型：GET_DEFINITION、SAVE_WORD、GET_WORDS、DELETE_WORD
    - _Requirements: 1.2_
  
  - [x] 7.2 实现 API 请求代理
    - 接收 GET_DEFINITION 消息，调用 dictionary.getDefinition
    - 返回释义数据或错误信息给 content script
    - 避免 CORS 问题
    - _Requirements: 1.2, 1.5_

- [x] 8. 实现 Popup UI - 单词列表界面
  - [x] 8.1 创建 popup/App.vue 主组件
    - 实现顶部工具栏：排序选择器（按 count、按 updatedAt）、导出按钮
    - 调用 storage.getAllWords 加载所有单词
    - 根据选择的排序方式对单词列表排序
    - _Requirements: 3.1, 3.2, 3.3, 3.4_
  
  - [x] 8.2 创建 WordList.vue 组件
    - 显示单词列表，每项包含：单词文本、count、最后收藏时间
    - 实现点击单词展开详情的交互
    - 添加删除和重置按钮
    - _Requirements: 3.2, 3.5_
  
  - [x] 8.3 创建 WordDetail.vue 组件
    - 显示单词的完整释义（音标、词性、定义、例句）
    - 显示所有 HistoryRecord 列表
    - _Requirements: 3.5, 3.6_
  
  - [x] 8.4 创建 HistoryItem.vue 组件
    - 显示单条历史记录：时间戳、上下文句子、页面 URL、释义
    - 实现点击 URL 在新标签页打开链接
    - 在上下文句子中高亮显示单词
    - _Requirements: 3.6, 3.7, 6.4_

- [x] 9. 实现删除和重置功能
  - [x] 9.1 在 WordList 组件中添加删除按钮
    - 点击删除按钮显示确认对话框
    - 确认后调用 storage.deleteWord
    - 更新 UI，从列表中移除该单词
    - _Requirements: 4.1, 4.3, 4.4_
  
  - [x] 9.2 在 WordList 组件中添加重置按钮
    - 点击重置按钮调用 storage.resetCount
    - 更新 UI，显示 count=0
    - _Requirements: 4.2_

- [x] 10. 实现导出和导入功能
  - [x] 10.1 在 Popup UI 中添加导出按钮
    - 点击导出按钮调用 storage.exportData
    - 生成 JSON 文件并触发浏览器下载
    - 文件名格式：vocabulary-counter-YYYY-MM-DD.json
    - _Requirements: 5.1, 5.2_
  
  - [x] 10.2 在 Popup UI 中添加导入按钮
    - 点击导入按钮打开文件选择对话框
    - 读取 JSON 文件内容
    - 调用 storage.importData 合并数据
    - 显示导入成功或失败的提示
    - _Requirements: 5.3, 5.4_

- [x] 11. 集成和端到端测试
  - [x] 11.1 测试完整的取词流程
    - 在测试网页上选中单词
    - 验证弹窗显示、释义加载、保存功能
    - 验证重复保存时 count 增加和提示消息
    - _Requirements: 1.1, 1.2, 2.1, 2.3, 2.4_
  
  - [x] 11.2 测试 Popup UI 功能
    - 打开 Popup，验证单词列表显示
    - 测试排序功能
    - 测试单词详情和历史记录展示
    - 测试删除和重置功能
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2_
  
  - [x] 11.3 测试导出导入功能
    - 导出数据，验证 JSON 格式正确
    - 导入数据，验证数据合并逻辑
    - 测试重复单词的合并
    - _Requirements: 5.1, 5.2, 5.3, 5.4_
  
  - [x] 11.4 测试上下文提取功能
    - 测试不同长度的句子提取
    - 测试超过 200 字符的截断
    - 测试特殊字符和边界情况
    - _Requirements: 6.1, 6.2, 6.3, 6.5_

- [x] 12. 优化和错误处理
  - [x] 12.1 实现 API 响应缓存
    - 缓存已查询的单词释义（24 小时有效）
    - 减少重复 API 请求
    - _Requirements: 1.2_
  
  - [x] 12.2 添加全局错误处理
    - 捕获存储错误（quota exceeded、read/write error）
    - 捕获 API 错误并显示友好提示
    - 记录错误日志（console.error）
    - _Requirements: 1.5_
  
  - [x] 12.3 性能优化
    - 实现文本选择事件的防抖（300ms）
    - 单词列表超过 100 条时使用虚拟滚动
    - 最小化 DOM 操作和重绘
    - _Requirements: 1.1, 3.2_
