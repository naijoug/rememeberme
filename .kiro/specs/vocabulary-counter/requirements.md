# Requirements Document

## Introduction

词汇量计数器是一个浏览器插件，用于帮助英语学习者追踪和管理不认识的单词。当用户在浏览网页时遇到不认识的单词，可以通过取词功能将单词收藏，系统会自动记录该单词被收藏的次数。这样用户可以了解哪些单词经常遇到但仍未掌握，从而更有针对性地进行学习。

## Glossary

- **VocabularyCounter**: 词汇量计数器系统，指整个浏览器插件
- **WordEntry**: 单词条目，包含单词文本、计数和时间戳的数据结构
- **SelectionPopup**: 选词弹窗，用户选中文本后显示的操作界面，包含 remember 和 forget 按钮
- **WordList**: 单词列表，显示所有已收藏单词的界面
- **Storage**: 存储系统，用于持久化保存单词数据
- **Dictionary**: 词典服务，用于查询单词释义的外部 API 或内置词典

## Requirements

### Requirement 1

**User Story:** 作为英语学习者，我想要在浏览网页时查看不认识单词的释义，以便快速理解单词含义

#### Acceptance Criteria

1. WHEN 用户在网页上选中一个或多个英文单词, THE VocabularyCounter SHALL 在选中文本附近显示 SelectionPopup
2. WHEN SelectionPopup 显示时, THE VocabularyCounter SHALL 通过 Dictionary 查询并显示选中单词的释义
3. THE VocabularyCounter SHALL 在 SelectionPopup 中显示 "remember" 和 "forget" 两个操作按钮
4. WHEN 用户点击 SelectionPopup 外的区域, THE VocabularyCounter SHALL 隐藏 SelectionPopup
5. WHEN Dictionary 查询失败, THE VocabularyCounter SHALL 在 SelectionPopup 中显示错误提示信息

### Requirement 2

**User Story:** 作为英语学习者，我想要标记我不认识的单词并追踪忘记次数，以便了解哪些单词需要重点学习

#### Acceptance Criteria

1. WHEN 用户在 SelectionPopup 中点击 "forget" 按钮且该单词不存在, THE VocabularyCounter SHALL 创建一个 WordEntry 并设置计数为 1
2. WHEN 用户在 SelectionPopup 中点击 "forget" 按钮且该单词已存在, THE VocabularyCounter SHALL 将该 WordEntry 的计数增加 1
3. WHEN 用户点击 "forget" 按钮且该单词已存在, THE VocabularyCounter SHALL 在 SelectionPopup 中显示提示信息，告知这是第几次忘记该单词
4. WHEN 用户在 SelectionPopup 中点击 "remember" 按钮, THE VocabularyCounter SHALL 关闭 SelectionPopup 而不修改任何数据
5. THE VocabularyCounter SHALL 记录每次点击 "forget" 的时间戳

### Requirement 3

**User Story:** 作为英语学习者，我想要查看我收藏的所有单词列表，以便复习和管理我的词汇本

#### Acceptance Criteria

1. WHEN 用户点击浏览器工具栏中的插件图标, THE VocabularyCounter SHALL 打开 WordList 界面
2. THE VocabularyCounter SHALL 在 WordList 中显示所有 WordEntry，包含单词文本、计数和最后收藏时间
3. THE VocabularyCounter SHALL 支持按计数从高到低排序 WordList
4. THE VocabularyCounter SHALL 支持按最后收藏时间排序 WordList
5. WHEN 用户在 WordList 中点击某个 WordEntry, THE VocabularyCounter SHALL 显示该单词的详细信息和释义

### Requirement 4

**User Story:** 作为英语学习者，我想要删除或编辑已收藏的单词，以便管理我的词汇本

#### Acceptance Criteria

1. WHEN 用户在 WordList 中选择删除某个 WordEntry, THE VocabularyCounter SHALL 从 Storage 中移除该 WordEntry
2. WHEN 用户在 WordList 中选择重置某个 WordEntry 的计数, THE VocabularyCounter SHALL 将该 WordEntry 的计数设置为 0
3. THE VocabularyCounter SHALL 在执行删除操作前显示确认对话框
4. WHEN 用户确认删除操作, THE VocabularyCounter SHALL 更新 WordList 界面

### Requirement 5

**User Story:** 作为英语学习者，我想要导出我的词汇本数据，以便在其他地方使用或备份

#### Acceptance Criteria

1. WHEN 用户在 WordList 界面点击导出按钮, THE VocabularyCounter SHALL 生成包含所有 WordEntry 的 JSON 文件
2. THE VocabularyCounter SHALL 在导出文件中包含单词文本、计数、时间戳和释义
3. WHEN 用户选择导入功能并提供有效的 JSON 文件, THE VocabularyCounter SHALL 将文件中的 WordEntry 合并到现有数据中
4. WHEN 导入的单词已存在, THE VocabularyCounter SHALL 保留较高的计数值
