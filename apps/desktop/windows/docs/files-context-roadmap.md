# Right Sidebar Files Context Roadmap

本文档定义 OpenDrSai Windows Desktop 右侧栏 `Files` 上下文的产品规划、
版本节奏、代码结构和测试策略。

## 核心定位

`Files` 不是聊天区的一种视图，也不是另一个 agent 列表。它是右侧栏里的
独立上下文环境，和 `Browser`、`Terminal` 并列。

右侧栏整体应理解为 `Context Environments`：

- `Files`：查看工作区文件、预览文件、选择要交给 Agent 的上下文。
- `Browser`：查看页面、采集页面文本/截图上下文。
- `Terminal`：运行命令、查看输出、把输出交给 Agent。
- 未来可扩展：Git、Artifacts、Docs、Database、Runs。

`Files` 上下文内部自己完成文件体验，不复用聊天栏，不替换主聊天区。

## 设计原则

- 文件预览属于 `Files Context`，不属于 `ChatWorkspace`。
- 点击文件只更新 `Files` 内部预览区，不切换主聊天页面。
- 聊天区只负责聊天；文件区只负责文件。
- Agent 只能接收用户显式加入的文件、diff 或摘要上下文。
- 所有发送给 Agent 的文件上下文都必须在 UI 中可见、可解释、可移除。
- 默认打开 `Files` 时显示当前工作区文件树。
- 右侧栏宽度有限，`Files` 内部布局应紧凑、稳定、可滚动。

## Files Context 布局

`Files` tab 内部采用三段式结构：

```text
Right Sidebar / Files Context
┌──────────────────────────────────────────────┐
│ 小标题栏：当前路径 / 打开 / 搜索 / 动作         │
├──────────────────────────────┬───────────────┤
│ 文件预览区                     │ 目录树          │
│ Markdown / code / table /     │ folders       │
│ image / metadata              │ files         │
│                              │ selection     │
└──────────────────────────────┴───────────────┘
```

区域职责：

- 小标题栏：显示当前 workspace、当前选中文件、刷新、打开、加入上下文等动作。
- 预览区：显示当前文件内容或 metadata-only 预览。
- 目录树：显示当前工作区树形结构、搜索过滤、Git 状态点、选中态。
- 上下文动作：把当前文件、当前 diff、指令文件加入 Agent 上下文篮子。

## Version 1: Files Context Viewer

目标：把右侧 `Files` 做成可用的文件上下文，而不是占位面板或聊天区替身。

功能点：

- 在右侧栏 `Files` tab 内显示独立的文件上下文布局。
- 默认加载当前工作区根目录的文件树。
- 支持目录和文件的树形展示。
- 支持文件名过滤。
- 支持当前选中文件高亮。
- 支持常见文件类型图标：
  - directory
  - markdown/text
  - code
  - json
  - yaml/toml
  - csv/tsv
  - image
  - pdf/office/binary/unknown
- 支持文件预览区：
  - Markdown：源码式正文预览，保留换行和代码块。
  - Code/Text：等宽文本预览。
  - JSON：格式化预览。
  - CSV/TSV：表格预览。
  - Image：图片预览。
  - PDF/Office/Binary/Large：metadata-only。
- 支持 Git changed 文件状态点。
- 支持把当前文件加入 Agent 上下文篮子。
- 支持把当前文件 diff 加入 Agent 上下文篮子。
- 右侧 `Files` 切换不影响聊天主区域。
- 工作区切换时清空文件选择和上下文篮子，避免跨项目污染。
- 处理 IPC handler 缺失、工作区路径为空、工作区不存在等错误状态。

验收标准：

- 打开 `Files` tab 后，默认看到当前工作区文件树。
- 点击 `README.md` 等文件后，预览区在 `Files` 内部更新。
- 聊天主区域不被文件预览替换。
- 文件可被显式加入下一条聊天的附件上下文。
- 大文件、二进制、PDF、Office 文件不会被误读为普通文本。
- 文件树加载失败时显示可理解的错误，不导致整个 app 崩溃。

测试项：

- IPC 注册测试：
  - `desktop:workspace-context-overview`
  - `desktop:workspace-files`
  - `desktop:workspace-file-preview`
  - `desktop:workspace-git-diff`
- 默认工作区测试：
  - `current` workspace 下能解析到当前 repo 根目录。
  - 空路径或 `Local workspace` 能 fallback 到 repo root。
  - 用户添加的 workspace 使用自己的真实路径。
- 文件树测试：
  - 忽略 `node_modules`、`.git`、`dist` 等噪声目录。
  - 查询过滤能返回匹配文件及其父级目录。
  - `maxDepth` 和 `maxEntries` 截断时不会卡死 UI。
- 文件预览测试：
  - `.md` 返回 `markdown`。
  - `.ts/.tsx/.py` 返回 `code`。
  - `.json` 返回格式化 JSON。
  - `.csv/.tsv` 返回 columns 和 rows。
  - `.png/.jpg/.svg` 返回 image data URL 或 metadata。
  - `.pdf/.docx/.xlsx` 返回 metadata-only。
  - 大文件返回 `large` metadata-only。
- 安全测试：
  - `../` 路径不能越过 workspace root。
  - 绝对路径必须在 workspace 内。
  - diff path 即使文件已删除也不能逃逸 workspace。
- UI 测试：
  - 文件树和预览区在窄右栏下不互相覆盖。
  - 长文件名省略显示。
  - 搜索框、刷新、打开、上下文、diff 按钮状态正确。
- Chat 集成测试：
  - 加入上下文后 composer 能显示附件 chip。
  - 发送消息后外部上下文被清空。
  - 未显式加入的预览文件不会发送给 Agent。

## Version 2: Context Controller

目标：让 `Files` 不只是看文件，而是控制 Agent 可以看到什么文件上下文。

功能点：

- 文件上下文篮子内置于 `Files Context`，而不是散落在聊天区。
- 支持 basket 明细：
  - 文件路径
  - 文件类型
  - 预估 token/字符大小
  - 是否包含原文
  - 是否只包含摘要/metadata
  - 是否包含 diff
- 支持对上下文项进行移除、清空、重新排序。
- 支持一次选择多个文件加入上下文。
- 支持目录级加入，但必须显示即将包含的文件列表和大小估算。
- 支持 instruction chain 预览：
  - `AGENTS.md`
  - `DRSAI.md`
  - `CLAUDE.md`
  - `.claude/rules/project.md`
- 支持 instruction chain 加入上下文或固定为 workspace instructions。
- 支持 Git diff 预览：
  - 全局 diff
  - 单文件 diff
  - staged/unstaged 区分
- 支持 markdown rendered/source 切换。
- 支持 JSON/YAML 树形结构视图。
- 支持 CSV 分页和列宽处理。
- 支持 PDF 文本抽取预览。
- 支持 Office 文档基础文本抽取。
- 支持大文件 head/tail/outline 预览。
- 支持文件打开方式：
  - 内部预览
  - 系统默认应用打开
  - 插入路径到聊天输入
- 支持 workspace trust 和权限提示。

验收标准：

- 用户能明确知道下一条消息会带哪些文件上下文。
- 用户能在发送前移除任意上下文项。
- 加入目录上下文时不会悄悄发送大量文件。
- 指令文件能被人看到，也能被 Agent 以结构化 metadata 接收。
- Git diff 能作为独立上下文发送，不伪装成普通文件。

测试项：

- Basket 测试：
  - 添加文件去重。
  - 移除单项。
  - 清空全部。
  - 工作区切换清空。
  - 发送成功后清空。
- Token/size 估算测试：
  - 文本文件按字符估算。
  - diff 按 diff 文本估算。
  - binary/metadata-only 不虚报内容 token。
- 多选测试：
  - 多文件选择能保持顺序。
  - 目录加入能显示包含清单。
  - 超过限制时提示截断。
- 指令链测试：
  - 多个 instruction 文件按优先级显示。
  - 超长 instruction 截断并标记。
  - 缺失 instruction 不报错。
- diff 测试：
  - modified/added/deleted/renamed/untracked 状态显示正确。
  - 单文件 diff 和全局 diff 内容正确。
  - 没有 diff 时按钮禁用或显示空态。
- 预览增强测试：
  - Markdown source/rendered 切换。
  - JSON/YAML 树展开折叠。
  - CSV 大表分页。
  - PDF/Office 抽取失败时 fallback metadata。
- 权限测试：
  - untrusted workspace 禁止加入 Agent 上下文或要求确认。
  - 超大目录上下文要求确认。

## Version 3: Agent Workbench Files

目标：让 `Files Context` 成为人和 Agent 协作理解、修改、审阅文件的工作台。

功能点：

- 显示 Agent 文件阅读痕迹：
  - Agent 读取过哪些文件
  - 读取时间
  - 来源任务/消息
  - 是否来自用户显式授权
- 显示 Agent 文件修改痕迹：
  - 创建
  - 修改
  - 删除
  - 重命名
  - patch/diff
- 支持 live diff：
  - 当前工作区 diff
  - Agent proposed diff
  - accepted/rejected 状态
- 支持审阅和批准：
  - 单文件 approve/reject
  - 单 hunk approve/reject
  - revert 未提交修改
- 支持 repo map：
  - 文件依赖关系
  - symbol outline
  - 最近修改
  - 热点文件
- 支持多 Agent 上下文隔离：
  - 每个 Agent run 的上下文篮子
  - 每个 Agent run 的文件读写记录
  - 不同 Agent 的修改冲突提示
- 支持上下文快照：
  - 发送给 Agent 的精确文件集合
  - 当时的 file hash
  - 当时的 instruction chain
  - 当时的 diff
- 支持 artifacts：
  - Agent 生成的文件
  - 下载/打开/预览
  - 与源文件关联
- 支持更强的语义预览：
  - Python/TS symbol outline
  - Notebook cell preview
  - Image metadata
  - Dataset schema

验收标准：

- 用户能追踪 Agent 看过什么、改过什么。
- 用户能在 `Files Context` 内审查 Agent 的文件修改。
- Agent 不能静默扩大上下文或静默修改文件。
- 多 Agent 或多 run 并行时，文件上下文和修改记录不混淆。

测试项：

- Agent trace 测试：
  - 文件读取事件能映射到文件树。
  - 文件写入事件能映射到 diff。
  - trace 和 run/session/thread 关联正确。
- Patch 审阅测试：
  - approve hunk 正确应用。
  - reject hunk 不应用。
  - revert 只撤销目标修改，不影响用户未关联修改。
- Snapshot 测试：
  - 发送上下文时记录文件 hash。
  - 文件变化后显示 stale context。
  - 可查看历史上下文快照。
- 多 Agent 测试：
  - 不同 run 的上下文篮子隔离。
  - 同一文件冲突修改有提示。
  - 切换 run 不丢失上下文状态。
- Repo map 测试：
  - symbol outline 对代码文件可用。
  - 依赖图加载失败不影响基础文件树。
  - 大 repo 下 repo map 懒加载。

## 建议代码结构

Renderer:

```text
src/renderer/src/components/files/
  FilesContextPanel.tsx          # Files tab 容器，管理布局和状态
  FilesContextHeader.tsx         # 小标题栏、路径、动作、搜索入口
  FilesTree.tsx                  # 目录树
  FilesTreeRow.tsx               # 单行目录/文件
  FilePreview.tsx                # 预览区容器
  previews/
    MarkdownPreview.tsx
    CodePreview.tsx
    JsonPreview.tsx
    TablePreview.tsx
    ImagePreview.tsx
    MetadataPreview.tsx
  ContextBasket.tsx              # V2 起：文件上下文篮子
  GitDiffPreview.tsx             # V2 起：diff 预览
  InstructionChainPreview.tsx    # V2 起：指令链预览
```

Renderer hooks:

```text
src/renderer/src/components/files/hooks/
  useWorkspaceFiles.ts           # list tree + search + refresh
  useFilePreview.ts              # selected file preview state
  useFilesContextBasket.ts       # add/remove/clear context items
  useWorkspaceDiff.ts            # diff loading
```

Shared types:

```text
src/shared/desktopApi.ts
  WorkspaceContextOverview
  WorkspaceFileNode
  WorkspaceFilePreview
  WorkspaceGitDiffResult
  WorkspaceContextAttachment     # V2 建议新增，替代把 diff 塞进 ChatAttachment
```

Main process:

```text
src/main/workspaceContext.ts
  getWorkspaceContextOverview()
  listWorkspaceFiles()
  previewWorkspaceFile()
  getWorkspaceGitDiff()
  resolveWorkspaceRoot()
  resolveInsideWorkspace()
```

IPC wiring:

```text
src/main/index.ts
  desktop:workspace-context-overview
  desktop:workspace-files
  desktop:workspace-file-preview
  desktop:workspace-git-diff

src/preload/index.ts
  getWorkspaceContextOverview()
  listWorkspaceFiles()
  previewWorkspaceFile()
  getWorkspaceGitDiff()
```

Tests and verification:

```text
scripts/verify-workspace-context.mjs
  static contract checks for IPC, preload, component placement, preview kinds

future:
src/main/workspaceContext.test.ts
  path safety, tree walking, preview classification, diff parsing

src/renderer/src/components/files/*.test.tsx
  tree rendering, preview state, basket actions

scripts/verify-files-context-visual.mjs
  Playwright screenshot checks for right sidebar layout
```

## 与 Chat 的边界

`ChatWorkspace` 不应该知道文件树、文件预览、目录结构或 preview state。

允许的交互只有：

- `FilesContextPanel` 把用户显式选择的上下文交给 App。
- App 把这些上下文作为 `externalAttachments` 传给 Chat composer。
- Chat composer 显示附件 chip。
- 用户发送消息后，附件随请求发送给 Agent。
- 发送成功后，App 清空这些 external attachments。

禁止的交互：

- `Files` 点击文件后替换 Chat 主区域。
- `ChatWorkspace` 内部渲染文件预览。
- 文件预览作为聊天消息自动插入。
- 未经用户显式选择，把当前打开文件自动发送给 Agent。

## 与 Browser 和 Terminal 的一致性

右侧栏的三个主要上下文环境应保持同一原则：

- 都在右侧栏内部完成自己的预览/运行/查看体验。
- 都可以把用户显式选择的内容转成 Agent 上下文。
- 都不主动替换聊天主区域。
- 都有自己的错误状态和权限边界。

对应关系：

```text
Files    -> selected files, file content, diff, instructions
Browser  -> page URL, visible text, screenshot, DOM snapshot
Terminal -> command output, selected output, command result
```

## 非目标

V1 不做：

- 完整 IDE 编辑器。
- 文件写入/保存。
- 多标签文件编辑。
- symbol index。
- PDF/Office 完整渲染。
- 大型 repo 全量索引。
- Agent 自动选择上下文。

V2 不做：

- Agent 文件修改审批。
- 多 Agent 上下文隔离。
- repo dependency graph。

V3 前不做：

- 自动应用 patch。
- hunk 级审批。
- 文件级权限策略 DSL。

## 当前实现需要调整的方向

短期应把现有实现改成：

- 删除 `WorkspaceFilePreviewPane` 对 App 主区域的接入。
- 将文件预览移动回 `FilesContextPanel` 内部。
- 将当前 `WorkspaceContextPanel` 拆成 `FilesContextPanel` 和若干子组件。
- `App.tsx` 只负责右侧 tab 切换和外部附件流转。
- 保留现有 main/preload workspace APIs。
- 将 `verify-workspace-context.mjs` 更新为检查：
  - 文件预览没有接入 Chat 主区域。
  - Files 组件内部存在 header、preview、tree 三块。
  - Chat 只接收显式 external attachments。

