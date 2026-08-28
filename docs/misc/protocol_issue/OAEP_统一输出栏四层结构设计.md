# OAEP 统一输出栏四层结构设计

状态：设计确认  
适用范围：OpenDrSai Desktop、OpenDrSai Agent Backend、Codex Backend，以及未来接入 OAEP 的其他 Agent Backend  
设计目标：由 OAEP 提供与 Backend 无关的统一语义，由 UI 根据统一语义稳定渲染会话输出。

## 1. 核心原则

1. 输出栏只消费 OAEP，不直接识别 Codex、OpenDrSai 或其他 Backend 的私有事件。
2. Backend Adapter 负责把私有事件映射为 OAEP 语义事件。
3. 最终回答是视觉主体；执行细节按需展开。
4. 不存在的能力不显示，不用空区域或伪造事件补齐。
5. “分析摘要”只表示允许向用户公开的阶段性推理摘要，不表示或暴露完整内部思维链。
6. 历史回放与实时流式输出使用相同的 OAEP reducer 和 UI projector，保证结构及顺序一致。

## 2. 最终四层结构

```text
运行状态层（单行）

处理过程层（可折叠）
├─ 执行概览
├─ 过程记录
├─ 分析摘要
├─ 操作与变更
└─ 子任务

待用户交互层（仅需要时出现）

结果层
├─ 最终回答
├─ 产出物
├─ 引用来源
└─ 后续操作
```

没有内容的分区直接省略。

## 3. 第一层：运行状态

### 3.1 单行设计

运行状态层尽量保持一行，不占用回答正文空间：

```text
OpenDrSai · Codex · 本地工作区                 已完成 · 28 秒
```

窄屏下按优先级收缩：

```text
Codex                                      已完成 · 28 秒
```

字段优先级从高到低：

1. 运行状态。
2. 执行耗时。
3. Backend 名称。
4. 工作区或连接位置。
5. OpenDrSai 品牌名称。

优先采用省略号或隐藏低优先级字段，不主动换成多行。完整信息可以通过悬停提示或详情入口查看。

### 3.2 状态映射

| OAEP 状态 | 用户文案 |
|---|---|
| `queued` | 等待处理 |
| `running` | 正在处理 · 12 秒 |
| `waiting_input` | 等待你的回复 |
| `waiting_approval` | 等待确认 |
| `completed` | 已完成 · 28 秒 |
| `cancelled` | 已停止 |
| `failed` | 执行失败 |
| `reconnecting` | 正在恢复连接 |

运行状态是 Run 的状态，不进入回答正文。状态为等待用户时不能显示“已完成”。

## 4. 第二层：处理过程

处理过程是一个可折叠容器，承载本轮所有非最终回答内容。

```text
处理过程  ▼
  执行概览
  过程记录
  分析摘要
  操作与变更
  子任务
```

交互规则：

- 执行中默认展开。
- 完成后默认收起。
- 失败时默认展开并定位失败操作。
- 没有任何过程内容时不显示容器。
- 标题可以附带摘要，如“处理过程 · 读取 3 个文件，修改 1 个文件”。

### 4.1 执行概览

由 UI 根据 OAEP 事件自动汇总，不依赖 Backend 生成自然语言：

```text
读取 3 个文件 · 执行 2 个工具 · 修改 1 个文件 · 2 项测试通过
```

### 4.2 过程记录

显示 Backend 主动提供的阶段性说明，对应 OAEP `progress`：

```text
正在定位项目文档
准备检查现有实现
测试完成，正在整理结果
```

### 4.3 分析摘要

显示允许向用户公开的阶段分析，对应 OAEP `reasoning_summary`。

- Codex reasoning summary 映射到这里。
- OpenDrSai Agent Backend 的阶段分析映射到这里。
- 不支持该能力的 Backend 不显示该分区。
- Backend 私有内部推理不得进入 OAEP 或 UI。

界面统一使用“分析摘要”，不再把它作为独立的“思考过程”区域。

### 4.4 操作与变更

对应 OAEP `activity`，统一容纳：

- 工具调用和命令执行。
- 文件读取、创建、修改和删除。
- 工作区或网络搜索。
- 浏览器、数据库、MCP 和外部服务操作。

默认显示用户可读摘要，展开后才显示参数、输出、耗时及错误详情。

### 4.5 子任务

对应 OAEP `subtask`，表示 Agent 的任务拆分和执行状态，不等同于工具调用。UI 默认只展开一层，完整嵌套关系进入详情视图。

## 5. 第三层：待用户交互

对应 OAEP `interaction`，仅在需要用户参与时出现，包括：

- 权限审批。
- 补充信息。
- 方案选择。
- 文件冲突。
- 是否继续。
- 外部操作确认。

交互卡片不能埋入折叠的处理过程，必须保持可见并自动滚动到视口。交互未完成时，Run 状态为 `waiting_input` 或 `waiting_approval`。

## 6. 第四层：结果

### 6.1 最终回答

只有 OAEP `final_response` 进入最终回答。`progress`、`reasoning_summary` 和工具输出不得混入正文。

最终回答始终展开，并作为输出栏的视觉主体。

### 6.2 产出物

对应 OAEP `artifact`，展示本轮产生或修改的实体：

- 文件与代码差异。
- 图片和报告。
- 测试结果。
- 网页、数据集及可下载附件。

### 6.3 引用来源

对应 OAEP `citation`。引用优先附着在最终回答的相关位置，同时可以在底部集中查看。

### 6.4 后续操作

仅展示与当前结果确实相关的操作，例如打开文件、查看差异、复制回答、重试或继续。UI 不自动制造无意义建议。

## 7. OAEP 领域结构

```text
Session
└─ Turn
   ├─ Run
   │  ├─ Progress
   │  ├─ ReasoningSummary
   │  ├─ Activity
   │  ├─ Subtask
   │  ├─ Interaction
   │  └─ Diagnostic
   ├─ FinalResponse
   └─ Artifact
```

- `Turn`：用户的一次提问及其对应回应。
- `Run`：某个 Backend 为完成这一轮执行的一次运行。
- `Message`：用户或 Agent 可见的对话内容。
- `Activity`：Agent 为完成任务执行的可观察操作。

同一个 Turn 可以因重试、恢复或 Backend 接管包含多个 Run，但聊天区域仍表现为同一轮对话。

## 8. OAEP 内容类型

```ts
type OaepPart =
  | TextPart
  | ProgressPart
  | ReasoningSummaryPart
  | ActivityPart
  | SubtaskPart
  | InteractionPart
  | ArtifactPart
  | CitationPart
  | NoticePart
  | DiagnosticPart;
```

协议使用 `reasoning_summary`，不设计 `chain_of_thought` 类型。

`activity.category` 使用开放命名，例如：

```text
file.read
file.write
command.execute
search.workspace
search.web
browser.navigate
database.query
service.call
agent.delegate
```

UI 遇到未知类别时使用通用操作卡片降级显示，不能静默丢弃。

## 9. Backend 映射

| OAEP 语义 | Codex Backend | OpenDrSai Agent Backend | 未来 Backend |
|---|---|---|---|
| `progress` | commentary | Agent 进度事件 | 状态说明 |
| `reasoning_summary` | reasoning summary | 阶段分析摘要 | 支持则映射 |
| `activity` | tool、command、file item | Function、Worker、Tool | 通用操作事件 |
| `subtask` | delegated task | Agent task | 子 Agent 或计划节点 |
| `interaction` | approval、request input | IF 交互函数 | 用户确认事件 |
| `final_response` | final assistant message | Agent 最终输出 | 最终文本 |
| `artifact` | file change、output | Workspace 产物 | 文件或外部结果 |
| `diagnostic` | app-server diagnostics | Runtime diagnostics | 私有诊断信息 |

Adapter 可以在 `extensions` 中保留 Backend 特有数据，但核心 UI 不能依赖扩展字段完成基本展示。

## 10. 顺序、流式更新与历史回放

排序优先级：

1. OAEP `sequence`。
2. Backend 原始序号。
3. 服务端接收时间。
4. 稳定 ID。

时间戳只用于显示，不作为主要排序依据。

流式事件通过稳定标识更新：

```text
run_id + item_id + content_index
```

同一内容的增量、完成快照和历史快照必须合并，不能重复追加。历史回放必须得到与实时执行相同的四层结构和顺序。

## 11. 典型状态

### 执行中

```text
Codex · 本地工作区                       正在处理 · 12 秒

处理过程  ▲
  正在读取项目文档……
  ◌ 读取 docs/design.md
```

### 执行完成

```text
Codex · 本地工作区                         已完成 · 28 秒

处理过程  ▼
  读取 3 个文件 · 修改 1 个文件 · 2 项测试通过

最终回答
  ……
```

### 等待用户

```text
OpenDrSai Agent                              等待确认

需要确认
  是否允许修改 .gitignore？
  [查看变更] [允许] [拒绝]
```

### 执行失败

```text
OpenDrSai Agent                          执行失败 · 18 秒

处理过程  ▲
  ✓ 读取配置文件
  ✕ 启动测试服务

未能启动测试服务
端口 4310 已被占用。
[重试] [查看技术详情]
```

## 12. 验收标准

1. Codex、OpenDrSai Agent Backend 使用相同四层组件渲染。
2. 运行状态层在常规桌面宽度下保持单行。
3. 窄屏优先隐藏低优先级元数据，不让状态和耗时丢失。
4. 执行中、完成、等待用户、失败的默认展开状态符合本方案。
5. 最终回答不包含过程说明、分析摘要或原始工具输出。
6. 历史回放和实时输出的内容、结构及顺序一致。
7. 流式增量、完成快照和历史快照不产生重复内容。
8. 未知 Backend 活动可以降级显示，并保留可诊断信息。
9. 不支持某种 OAEP Part 的 Backend 不产生空分区。
10. 未完成的用户交互始终可见，不被折叠容器隐藏。

