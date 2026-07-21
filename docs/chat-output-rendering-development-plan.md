# DrSai 聊天输出格式化：功能规格与开发方案

> 状态：方案稿  
> 调研日期：2026-07-12  
> 范围：`apps/desktop/drsai-desktop` 为首要落地点，同时统一 WebUI 与 TUI 的消息协议。

> 实施修正（2026-07-12）：用户截图对应的实际产品入口是 `apps/desktop/windows`，因此首要落地点已调整为 Windows 新桌面；旧 `drsai-desktop` 保留兼容，不作为本轮发布入口。

## 0. 实施状态（2026-07-12）

已完成：

- 共享 `ChatMessagePart` 判别联合与会话快照安全净化；
- reasoning 原生事件隔离，以及 `<think>`/转义标签/未闭合流式标签兼容状态机；
- 每请求单调事件序号、重复/倒退事件丢弃、40ms delta 合批；
- GFM Markdown、代码块头与复制、diff、表格滚动与复制、受限图片和安全外链；
- reasoning 折叠、工具生命周期卡片、失败态、长输出截断与复制；
- file/patch/artifact SSE 事件进入聊天时间线；
- reasoning、工具、结构化 parts 随线程快照持久化；
- 靠近底部时自动跟随，用户上滚后停止抢滚动；
- 500 条历史消息快照和 `content-visibility` 长会话优化；
- parser、SSE、类型、综合 verify、视觉 E2E、packaged chat 正常与七类失败路径验证。

产品已有 Approval Center，审批继续由其统一承载，聊天只展示状态/引导，不在 Markdown 内生成审批按钮。该取舍保留了明确审批协议，避免出现两套可产生不同决策的审批 UI。

## 1. 结论摘要

当前问题的根因不是 Markdown CSS 不够漂亮，而是消息协议把“最终正文、推理、工具调用、工具结果、审批、错误”过早压成了一个字符串。桌面端只能再用 `<think>` 正则、JSON 猜测和文案正则恢复语义，因此出现截图中的：

- `<think>` 原样泄漏；
- 推理与最终回答重复拼接；
- 流式阶段标签未闭合，整段被当作普通正文；
- 工具调用、工具结果和正文视觉层级不清；
- 代码、列表、段落的边界和留白不稳定；
- 审批依赖英文文案匹配，存在误判和漏判。

推荐方案是建立统一的 **结构化 Message Part 协议**，让后端在产生事件时就区分语义，前端按 part 类型渲染。Markdown 仅负责 `text`/`reasoning` part 内部的排版，不再承担协议解析。

目标体验可概括为：

1. 正文像 Codex 一样干净，默认只突出最终结论；
2. 推理像 Hermes/OpenCode 一样独立、可折叠且不重复；
3. 工具像 Codex/OpenCode 一样具有 started/running/completed/error 生命周期；
4. 代码、表格、引用、图片、文件引用、diff 均有专用渲染；
5. 流式更新稳定，不闪烁、不跳滚动、不因未闭合 Markdown 崩坏。

## 2. 本地现状审计

### 2.1 桌面端

- `AgentMarkdown.tsx` 使用 `react-markdown + remark-gfm + react-syntax-highlighter`，已有代码复制、diff、表格横向滚动、图片和安全链接处理。
- `MessageRow.tsx` 用 `parseThinkBlocks()` 从普通字符串识别 `<think>`，并通过 `ToolRow` 猜测 JSON 内容。
- `ChatMessage` 仍以 `role + content` 为中心；工具名等是旁路字段，并非可扩展的 part 联合类型。
- 审批通过 `APPROVAL_RE` 匹配自然语言，而不是明确的 approval event。

这些实现可作为兼容层保留，但不应继续作为主架构扩展。

### 2.2 WebUI

`apps/webui/frontend/src/components/common/markdownrender.tsx` 的能力比桌面端完整：

- 单独的 `ThinkBubble`；
- 完整/未完整 `<think>` 流式解析；
- 标题、段落、列表、引用、代码块定制；
- GFM Markdown。

但它仍然依赖字符串标签解析，且存在 `dangerouslySetInnerHTML` 分支。该实现适合迁移视觉规范，不适合直接复制协议设计；HTML 分支还需要统一 sanitize 策略。

### 2.3 本项目 TUI（值得复用）

TUI 已定义独立事件：`message.delta`、`message.complete`、`reasoning.delta`、`reasoning.available`、`tool.start` 等，并把正文、reasoning、tool 分开存储。这比当前桌面端的字符串模型更接近目标架构。建议以 TUI gateway 语义为基础做统一协议，而不是新造一套互不兼容的桌面协议。

## 3. 外部实现调研

### 3.1 OpenDrSai WebUI

实现特点：

- ReactMarkdown + GFM；
- Prism 代码高亮和代码复制；
- `<think>` 被解析成独立 ThinkBubble，支持流式未闭合状态；
- 标题、列表、引用、行内代码均有定制样式；
- 文件预览通过扩展名映射语言；
- 部分 HTML 直接渲染。

可借鉴：现有视觉密度、Reasoning 折叠组件、代码块交互。

不建议照搬：以 `<think>` 作为长期协议、重复的 Markdown 组件配置、未经统一净化的 HTML 渲染。

### 3.2 Codex

Codex 将 UI 输入输出建模为事件和 item。app-server 会发出 `item/started`、`item/completed`，并为 agent message、reasoning、command execution 分别提供 delta；reasoning 还区分 summary 与 raw text。命令、文件变更、审批、错误不是伪装成 Markdown 的文本，而是独立 item。

关键启示：

- 以稳定 `itemId` 聚合 delta，避免流式重复；
- started → delta → completed 是统一生命周期；
- reasoning summary 默认可展示，raw reasoning 可按能力和策略控制；
- 命令输出有独立增量事件与最终聚合结果；
- 审批是请求/响应协议，不靠文本识别；
- UI 可针对不同 item 做专用视图，同时保留纯文本降级。

### 3.3 Hermes Agent

Hermes 的 assistant message 将 reasoning 存在独立字段；TUI 用 JSON-RPC 将 `message.delta/complete`、`tool.start/progress/complete`、`approval.request` 等事件送到 Ink 前端。桌面端采用 Electron + React + `@assistant-ui/react`，但同样以 gateway 的结构化事件为边界。

关键启示：

- 一个 agent core 可服务 CLI/TUI/桌面，展示层不应反向决定消息格式；
- reasoning 与 final content 从存储开始就分离；
- 工具活动是 feed/part，不嵌入正文；
- UI 组件库可提高聊天无障碍与流式状态处理质量，但协议分层比换库更重要。

### 3.4 OpenCode

OpenCode 的消息是 `{ info, parts }`，Part 是判别联合：Text、Tool、File、Reasoning、Patch、Subtask、StepStart/Finish 等。客户端先拉取会话消息，再通过 SSE 接收 `message.part.updated` 等实时事件。

关键启示：

- Part 联合类型适合多模型、多工具、多客户端；
- part 自带 ID 和状态，可原位更新，不必追加重复字符串；
- Patch/File/Subtask 使用专用 part，使复杂 agent 任务仍保持清晰；
- REST 快照 + SSE 增量便于断线恢复和最终一致性。

## 4. 目标信息架构

每个 turn 下展示以下有序内容：

1. 用户输入：文本、附件、图片、技能/应用引用；
2. Agent 活动：推理摘要、工具调用、命令、文件变更、子任务、审批；
3. 最终回答：Markdown 正文；
4. 元信息：耗时、token、模型、停止原因、错误与重试。

默认展示策略：

- 最终回答展开；
- reasoning 折叠，仅显示“已思考 · 8s”或摘要首行；
- 成功工具折叠，运行中和失败工具展开关键状态；
- 长输出折叠到 12 行，支持“展开/复制/在终端打开”；
- diff 显示文件摘要，点击进入完整变更视图；
- approval 固定为可交互卡片，禁止由 Markdown 生成按钮。

## 5. 统一数据协议

建议新增 `ChatMessageV2`，旧 `ChatMessage` 通过 adapter 转换：

```ts
type PartStatus = "pending" | "running" | "completed" | "error" | "cancelled";

interface ChatMessageV2 {
  id: string;
  turnId: string;
  role: "user" | "assistant" | "system";
  createdAt: string;
  parts: ChatPart[];
  status: PartStatus;
  meta?: { model?: string; usage?: Usage; durationMs?: number; stopReason?: string };
}

type ChatPart =
  | { id: string; type: "text"; text: string; format: "markdown" | "plain"; status: PartStatus }
  | { id: string; type: "reasoning"; text: string; visibility: "summary" | "raw"; status: PartStatus; durationMs?: number }
  | { id: string; type: "tool"; callId: string; name: string; input: unknown; output?: unknown; status: PartStatus; error?: string }
  | { id: string; type: "command"; callId: string; command: string; cwd?: string; output: OutputChunk[]; exitCode?: number; status: PartStatus }
  | { id: string; type: "file"; name: string; uri: string; mime?: string; size?: number; status: PartStatus }
  | { id: string; type: "patch"; files: FilePatch[]; status: PartStatus }
  | { id: string; type: "approval"; requestId: string; kind: string; prompt: string; options: ApprovalOption[]; status: PartStatus }
  | { id: string; type: "error"; code?: string; message: string; retryable: boolean; status: "error" }
  | { id: string; type: "citation"; url: string; title?: string; status: "completed" };
```

事件统一为：

```ts
type ChatEvent =
  | { type: "turn.started"; turnId: string }
  | { type: "part.started"; turnId: string; messageId: string; part: ChatPart }
  | { type: "part.delta"; turnId: string; messageId: string; partId: string; seq: number; delta: PartDelta }
  | { type: "part.completed"; turnId: string; messageId: string; partId: string; part: ChatPart }
  | { type: "turn.completed"; turnId: string; meta: ChatMessageV2["meta"] }
  | { type: "turn.error"; turnId: string; error: SerializedError };
```

协议约束：

- `partId` 在一个 turn 内稳定；
- `seq` 单调递增，客户端丢弃重复 delta，检测缺口并请求快照；
- complete 事件携带权威最终值，修正增量累计偏差；
- 同一段 reasoning 不得同时进入 text part；
- provider adapter 负责把 `<think>`、reasoning_content、原生 reasoning item 归一化；
- 数据库存 V2 结构；旧记录读取时即时迁移，暂不批量重写。

## 6. 前端组件设计

```text
ConversationView
└─ TurnGroup
   ├─ UserMessage
   ├─ ActivityStack
   │  ├─ ReasoningPart
   │  ├─ ToolPart / CommandPart
   │  ├─ PatchPart / FilePart
   │  └─ ApprovalPart / ErrorPart
   └─ AssistantTextPart
      └─ MarkdownRenderer
```

### MarkdownRenderer

支持：CommonMark/GFM、标题、段落、粗斜体、列表/任务列表、引用、表格、分隔线、行内代码、围栏代码、链接、图片。

增强项：

- Shiki 或 Prism 按需加载；首屏先纯文本，加载后无尺寸跳变；
- 代码头含语言、复制、换行切换；diff 增加增删行号；
- 表格可横向滚动并提供复制 CSV；
- 外链确认与 `http/https/mailto` allowlist；
- 禁用原始 HTML，确需支持时使用严格 DOMPurify allowlist；
- 对 Windows 本地文件路径通过 IPC 转换为安全资源 URL；
- Mermaid 作为后续可选 part，不在 Markdown 内直接执行脚本。

### 流式渲染

- store 按 `turnId/messageId/partId` 归一化；
- delta 先进入 buffer，每 32–50ms 合并一次 React 更新；
- 仅重渲染变化的 Part，`React.memo` + selector；
- 未完成 fenced code 采用容错解析，complete 后做最终解析；
- 用户距底部小于 80px 才自动跟随；用户上滚后显示“回到底部”；
- 流式时保留高度锚点，避免 reasoning/tool 折叠导致页面跳动。

### 消息操作

每条最终回答提供：复制、重新生成、继续、朗读、反馈；开发模式增加“查看原始事件”。工具卡提供复制输入/输出、展开、定位相关文件/终端。

## 7. 截图问题的专项修复

### P0：推理泄漏与重复

1. provider/gateway 层识别原生 reasoning 字段；
2. 对只返回 `<think>` 的兼容模型使用流式状态机，不使用跨全文正则；
3. 维护 `TEXT` / `THINKING` 状态，标签可以跨 chunk；
4. complete 时去重：若 final text 是历史 reasoning+answer 的重复拼接，只依据明确事件边界裁切，禁止模糊字符串删除；
5. 增加原始事件录制 fixture，覆盖截图对应案例。

### P0：编码异常

源码当前可见多处 mojibake 风格字符。统一要求：源码 UTF-8、SSE/JSON UTF-8、响应声明 charset、CI 扫描 `�` 和常见乱码序列；图标使用 Lucide/SVG，不使用易受编码影响的 emoji 充当功能图标。

### P1：排版

- assistant 内容最大宽度 760–840px，用户气泡最大宽度 70%；
- 中文正文 15px/1.75，英文 15px/1.65；
- 段落 0 0 0.75em，列表项 0.25em；
- 长单词、URL、JSON 可换行，代码保持横向滚动；
- 桌面窄屏取消头像占位，降低无效左右留白。

## 8. 开发拆分与里程碑

### Phase 0：可观测性与基线（1–2 天）

- 保存脱敏原始事件与归一化事件；
- 建立 20 组 golden fixtures：中文、英文、混排、长代码、表格、diff、图片、未闭合标签、多工具并行、断线重连；
- Storybook/测试页展示所有 part 状态；
- 对截图案例建立回归测试。

### Phase 1：协议与适配器（3–5 天）

- 定义 `ChatMessageV2/ChatPart/ChatEvent`；
- 将 TUI gateway 事件映射成统一事件；
- 实现 provider reasoning normalizer 和 `<think>` 流式状态机；
- 建立 V1 → V2 历史消息 adapter；
- 审批从文案识别迁移为明确事件。

### Phase 2：桌面端 Part Renderer（4–6 天）

- 新建归一化 store 与 reducer；
- 实现 Text/Reasoning/Tool/Command/Error/Approval Part；
- 重构 MarkdownRenderer 与视觉 token；
- 完成复制、展开、代码高亮、diff、表格、链接安全；
- 增加平滑自动滚动和流式批处理。

### Phase 3：文件与复杂任务（3–5 天）

- File/Patch/Subtask/Plan part；
- 文件预览、定位、diff summary；
- 长工具输出虚拟化/截断；
- 断线后用 snapshot 校正。

### Phase 4：WebUI/TUI 对齐与清理（3–4 天）

- WebUI 消费统一 part；
- 抽取共享 TypeScript schema/fixtures；
- 删除主链路中的 `<think>` 正则和 `dangerouslySetInnerHTML`；
- 保留旧服务端兼容 adapter 一个版本周期。

总估算：单人约 14–22 个开发日；两名前后端并行约 8–12 个工作日。不含 Mermaid、LaTeX 和完整 artifact 面板。

## 9. 测试与验收标准

### 功能验收

- `<think>`、`</think>`、tool JSON 不出现在最终正文；
- reasoning、正文、工具结果不重复；
- 所有 GFM 元素正确展示；
- 代码块可复制，diff 增删色和行号正确；
- 工具卡状态完整，失败原因可见；
- approval 不依赖模型措辞；
- 刷新/恢复后展示与流式完成态一致；
- 中文、emoji、CJK 标点无乱码。

### 性能验收

- 10,000 个 delta 不丢失、不重复；
- delta 到可见内容的 P95 < 100ms；
- 500 条消息滚动保持可用，长会话采用虚拟列表；
- 单个 1MB 工具输出不阻塞主线程超过 100ms；
- 代码高亮包不进入初始主 chunk。

### 安全验收

- `javascript:`、`data:text/html` 等危险链接不可执行；
- Markdown 默认不执行 HTML/脚本；
- 本地文件只允许 workspace/显式授权路径；
- 工具输出按文本处理，不使用 `dangerouslySetInnerHTML`；
- 复制和外链打开失败均有非阻塞反馈。

### 自动化测试

- parser/state machine 单测：chunk 边界穷举；
- reducer 单测：乱序、重复、缺 seq、complete 校正；
- renderer 组件测试：每个 part 的所有状态；
- Playwright/Electron E2E：发送 → reasoning → tool → answer → 恢复；
- 视觉回归：浅色/深色、100%/125%/150%、中英文、窄屏。

## 10. 推荐落地顺序与取舍

第一版必须完成：结构化 part、reasoning 隔离、稳定 delta reducer、Markdown 基础组件、Tool/Approval/Error 卡片、历史兼容、回归测试。

第一版暂缓：Mermaid、LaTeX、可执行 HTML、复杂 artifact、全文虚拟化。它们不能解决截图中的根因，且会扩大安全面和测试矩阵。

不建议直接切换到 `@assistant-ui/react` 作为“修复”。组件库可在协议稳定后评估，但当前已有 UI 与 Electron IPC 较多，直接迁移成本高；先把结构化事件和 part renderer 做对，收益最大且能同时服务 WebUI/TUI。

## 11. 参考资料

- 本项目 OpenDrSai WebUI：`apps/webui/frontend/src/components/common/markdownrender.tsx`
- 本项目桌面端：`apps/desktop/drsai-desktop/src/renderer/src/components/AgentMarkdown.tsx`
- 本项目桌面消息：`apps/desktop/drsai-desktop/src/renderer/src/screens/Chat/MessageRow.tsx`
- 本项目 TUI 事件：`apps/ui-tui/src/gatewayTypes.ts`
- Codex protocol：https://github.com/openai/codex/blob/main/codex-rs/docs/protocol_v1.md
- Codex app-server：https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md
- Hermes Agent：https://github.com/NousResearch/hermes-agent
- Hermes architecture：https://github.com/NousResearch/hermes-agent/blob/main/AGENTS.md
- OpenCode：https://github.com/anomalyco/opencode
- OpenCode message model：`packages/opencode/src/session/message-v2.ts`（上游仓库）

## 12. 结构化会话文档补充方案（2026-07-17）

### 12.1 定位与边界

回复区域不是一段可任意混排的富文本，也不是终端日志。它是面向用户的
**结构化会话文档**；Markdown/GFM 只用于渲染最终叙述性正文。推理、运行状态、
成果、交互请求等内容必须通过有类型的 part 表达，不能依赖 `<think>`、工具日志标题
或自然语言正则恢复语义。

运行明细与原始协议事件不属于会话文档：它们进入右侧现有的文件、浏览器、终端、调试
面板。本方案不为会话额外新增一组与现有右栏竞争的“活动/来源/预览”顶层页签。

### 12.2 用户可见的八类 AssistantPart

| 类型 | 用途 | 聊天区默认呈现 | 右侧承载的详细信息 |
| --- | --- | --- | --- |
| `markdown` | 最终回答、说明、代码、公式、表格、引用 | 完整 Markdown/GFM 正文 | 超大表格、长代码或报告可在文件预览中打开 |
| `reasoning` | 推理阶段与可展示摘要 | 每个回复至多一个可折叠“思考过程” | 调试记录原始 reasoning 事件和 provider 来源 |
| `progress` | 长运行任务的用户可理解进度 | 仅在等待超过短阈值时显示一行，例如“正在检索文献” | 调试显示阶段、重试、耗时和关联事件 |
| `artifact` | 文件、图像、数据表、报告、补丁等成果 | 可打开的紧凑成果卡片 | 文件面板负责目录、预览、diff 和定位；浏览器承载网页成果 |
| `citation` | 网页、论文、数据集、工作区文件等证据 | 正文中的引用标记和简短来源列表 | 浏览器打开网页；文件面板打开本地文献/数据；调试保留检索与抓取细节 |
| `interaction` | 审批、选择、补充输入、确认继续 | 留在聊天区的可操作卡片，不能隐藏到右栏 | 调试保留请求、响应、审计 ID 与协议内容 |
| `subtask` | 子 Agent、委派任务、后台研究任务 | 一行汇总状态和最终结果入口 | 调试按子任务展示生命周期、事件和失败原因 |
| `notice` | 用户可行动的完成、警告或失败结果 | 简洁、可理解的提示；不显示技术栈信息 | 调试显示错误码、请求 ID、模型、重试与原始异常 |

工具调用不是独立的聊天区 part。它是运行事件：在聊天区被聚合为 `progress`、
`artifact`、`subtask` 或 `notice` 的用户结果；工具名、参数、完整输出、调用 ID 只进入
终端或调试。这样既保留可复现性，也不会把回答区域变成日志窗口。

### 12.3 右侧栏与会话的协作

现有右侧栏的四个入口维持其职责：

| 现有入口 | 与会话文档的关系 | 适合承载的详细内容 |
| --- | --- | --- |
| 文件 | `artifact` 的主落点 | 生成/修改的文件、图片、数据、报告、表格、diff 与本地引用 |
| 浏览器 | `citation` 和网页型 `artifact` 的落点 | 论文网页、检索来源、可交互网页成果、外部链接预览 |
| 终端 | 命令型活动的工作台 | 用户主动查看或继续操作的 shell；不自动塞入每次工具原始输出 |
| 调试（F12） | 执行活动与协议的审计面板 | 工具时间线、原始 SSE、模型调用、重试、日志、错误、子任务事件 |

因此“活动”不是新增右栏页签，而是调试面板内的默认可读视图；“来源”不是新增页签，
而是引用到浏览器或文件面板；“预览”由现有文件和浏览器面板承担。调试可提供
“活动 / 原始记录”两个内部视图：前者是低噪声时间线，后者面向开发排障。

### 12.4 展示与协议约束

1. 同一个回复只允许一个 `reasoning` part；多次 thinking 追加为带顺序的 segment，绝不产生多个思考框。
2. `markdown` 与 `reasoning` 互斥：推理文本不得再次写入正文。
3. 流式正文和最终快照使用同一 `partId`；最终事件用于校准/替换，不得追加第二份正文。
4. 每个运行事件必须关联 `turnId`、`partId`、`sequence`、`dedupeKey`、时间戳和来源。
5. 只有用户需要决策、阅读结论或取得成果时才在聊天区出现；其余技术细节保持在右栏。

推荐将本节的八类 part 作为后续 V2 schema 的产品边界，并以 TUI 已有的
`message.delta`、`thinking.delta`、`tool.start`、`tool.complete`、`message.complete` 事件作为
传输层基础。

## 13. V2 完整开发方案与验收（2026-07-17）

本章是结构化会话区的当前实施基线；与前文中将工具卡片直接放入聊天正文、或为右栏
新增独立“活动/来源/预览”顶层入口的描述冲突时，以本章为准。

### 13.1 产品目标和非目标

目标：让科研用户在聊天区阅读结论、获得成果、完成必要决策；让文件、网页、终端和
运行细节各归其位，并让历史恢复、重连和多 Agent 情况下的内容保持唯一、不重复。

第一期非目标：执行任意 HTML、在 Markdown 中执行脚本、完整工作流编排器、Mermaid
执行渲染、把所有历史工具输出全文索引。它们不解决当前重复 thinking 和日志污染问题，
且会明显扩大安全与测试范围。

### 13.2 信息架构（固定）

主聊天区是结构化会话文档，右栏保留既有四个顶层入口：`文件`、`浏览器`、`终端`、
`调试`。新建聊天时右栏保持隐藏；用户点击成果、来源或“查看详情”后，才打开相应入口。

`调试` 由 F12 切换显示，内部包含两个视图：

- `活动`：可读、低噪声的运行时间线，按阶段聚合工具、子任务与重试；
- `原始记录`：SSE、请求 ID、模型、工具参数、完整输出、异常和协议细节。

“来源”不是新页签：网页来源进入浏览器，本地论文或数据进入文件面板；“预览”也不另起
入口，分别由文件和浏览器承担。

### 13.3 模块总览

本计划共 **12 个开发模块、51 个功能点**。其中 M1--M5 是协议与数据基础，M6--M9 是
用户界面，M10--M12 是持久化、可观测性与质量保障。M1--M5 完成前，不应继续以字符串
规则修补重复 thinking 或工具日志问题。

| 模块 | 功能点数 | 主要责任 | 依赖 |
| --- | ---: | --- | --- |
| M1 事件契约与版本化 | 5 | 定义跨 Gateway/Desktop/WebUI/TUI 的 V2 事件 | 无 |
| M2 Provider 归一化 | 4 | 统一 provider streaming、thought 与最终结果 | M1 |
| M3 Gateway 投影 | 4 | 将 Agent 事件完整、稳定地投影给客户端 | M1, M2 |
| M4 桌面 IPC/SSE 适配 | 4 | 将传输事件变为共享前端事件 | M1, M3 |
| M5 会话状态 reducer | 5 | 唯一内容来源、顺序、去重、重连校准 | M4 |
| M6 正文与推理渲染 | 5 | Markdown、单一思考容器与流式展示 | M5 |
| M7 交互与通知渲染 | 4 | 审批、追问、失败与恢复动作 | M5 |
| M8 成果与引用路由 | 4 | 文件/浏览器跳转与成果卡片 | M5 |
| M9 右栏调试活动 | 4 | 活动时间线、原始记录、复制与清空 | M4, M5 |
| M10 历史与断线恢复 | 3 | V2 快照、旧记录兼容和重连 | M5 |
| M11 安全、性能与可访问性 | 4 | 安全渲染、限流、长会话和键盘支持 | M6--M10 |
| M12 测试与发布守门 | 5 | fixtures、单测、E2E、视觉回归、迁移检查 | M1--M11 |

### 13.4 模块、功能点与验收

#### M1. 事件契约与版本化（5）

1. 定义 `AssistantPart` 八类判别联合：`markdown`、`reasoning`、`progress`、`artifact`、`citation`、`interaction`、`subtask`、`notice`。
2. 定义运行态 `ActivityEvent`：工具、模型调用、重试、文件变化、子任务生命周期。
3. 所有事件包含 `turnId`、`partId`、`sequence`、`dedupeKey`、`timestamp`、`source`。
4. 定义 `part.started`、`part.delta`、`part.completed`、`turn.completed`、`turn.error` 生命周期。
5. 通过版本字段和 V1 adapter 保持旧 Gateway 与历史记录可读。

验收：TypeScript/Python schema 对同一 fixture 序列化结果一致；缺失 ID、非法 part、倒退
sequence 被明确拒绝或记录为协议错误；V1 消息可被转换为只读 V2 快照。

#### M2. Provider 归一化（4）

1. 原生 reasoning、`reasoning_content` 和 `<think>` 流统一为 `reasoning`。
2. 任何 reasoning 文本不得同时流入 `markdown`。
3. streaming delta 与 provider 最终结果以同一 part 生命周期合并。
4. 对未闭合 think 标签、跨 chunk 标签和空 reasoning 提供确定性处理。

验收：20 组 provider fixture 中，正文与推理无交集；同一问题的多次 thinking 只生成一个
`reasoning` part 和多个 ordered segment；最终结果不会追加第二份正文。

#### M3. Gateway 投影（4）

1. 以 TUI translator 语义投影正文、推理、工具、文件、审批、子任务和错误。
2. `AgentLogEvent` 依据结构化字段分类，禁止用英文标题猜测工具活动。
3. 工具请求、进度、完成和失败转换为 `ActivityEvent`，而非聊天字符串。
4. 结束事件包含权威 snapshot/meta，用于校正增量传输。

验收：Gateway contract tests 覆盖八类 part；工具 ID、参数、完整输出不会出现在 markdown
事件；同一 Agent 事件在 Desktop 与 TUI 的语义相同。

#### M4. 桌面 IPC/SSE 适配（4）

1. 增加 V2 named SSE/IPC 事件解析，同时保持旧 OpenAI SSE fallback。
2. 将网络重连、取消、超时映射为明确 turn 状态。
3. 为每条事件保留可追溯关联字段，但不把原始 payload 写入聊天正文。
4. 传输层将可读错误和调试细节分离。

验收：模拟乱序、重复、缺包、取消、断线重连时，桌面端不会崩溃；兼容模式仍可完成现有
普通文本聊天；开发者可从调试面板定位输入事件。

#### M5. 会话状态 reducer（5）

1. `parts` 成为 Assistant turn 的唯一内容来源，废弃并迁移并行的 content/reasoning/status/tool 字段。
2. 依据 `partId + sequence + dedupeKey` 幂等合并 delta。
3. 完成快照只校正对应 part，禁止 append 到已经显示的文本尾部。
4. 每个 reasoning part 内维护有序 segment，保证每个 turn 至多一个 reasoning part。
5. 将 ActivityEvent 与文档 parts 关联，但分别存储和渲染。

验收：10,000 个重复/乱序 delta 不产生重复文本；刷新或重连后 V2 快照与完成态视觉一致；
“FCPPL2026 是什么”这类多次 thinking fixture 只出现一个思考容器。

#### M6. 正文与推理渲染（5）

1. `markdown` 采用安全 Markdown/GFM，支持段落、列表、代码、表格、链接、图片和引用。
2. 每个回复只显示一个可折叠 reasoning 容器，默认显示摘要与状态。
3. 流式 Markdown 在代码围栏、表格、中文段落下保持稳定，不跳动、不闪烁。
4. 长表格、长代码和大图片提供受控展开或跳转至成果预览。
5. 回复操作仅针对最终用户可见正文，不复制思考或调试日志。

验收：不渲染原始 HTML/脚本；代码可复制；表格不撑破窄窗口；think 标签永不泄漏；100%
和 150% 缩放下无重叠或水平布局破坏。

#### M7. 交互与通知渲染（4）

1. 审批、补充信息、选择项以 `interaction` 卡片表达，不从 Markdown 文案推断。
2. `notice` 只显示用户可行动的完成、警告、失败与恢复建议。
3. 长任务使用单一 `progress` 行，完成、失败或取消后更新原位置。
4. 模型重试、鉴权、请求 ID、堆栈不在聊天区显示。

验收：审批可完成、拒绝、超时并正确持久化；连续十次工具调用只保留一个可理解进度，不出现
黄色日志框；模型错误在聊天区不泄露技术信息，但能一键定位调试细节。

#### M8. 成果与引用路由（4）

1. `artifact` 卡片包含名称、类型、简述、状态和目标资源 ID。
2. 点击本地成果打开文件面板并定位到文件或 diff。
3. 点击网页成果和外部引用打开浏览器面板；本地引用打开文件面板。
4. 正文引用与 artifact/citation 之间具备稳定双向关联。

验收：文件、图像、表格、报告、网页五类成果均能从聊天区正确打开；无效 URI 有用户提示且
不会打开任意本地路径；打开右栏不改变当前会话滚动位置。

#### M9. 右栏调试活动（4）

1. 维持现有文件、浏览器、终端、调试四个顶层入口，禁止新增重复入口。
2. 调试内提供 `活动` 与 `原始记录`；活动默认按 turn/阶段分组并折叠成功细节。
3. 原始记录包含 SSE、模型、重试、工具输入输出、错误，并支持复制、清空、筛选。
4. F12 仅切换调试面板的打开/关闭，不强制改变用户正在使用的文件、浏览器或终端。

验收：新建聊天右栏默认隐藏；点击成果、引用、详情仅打开对应现有面板；活动视图不显示无意义
ID，原始记录可复制完整单条事件；清空只清除调试历史，不删除会话或文件。

#### M10. 历史与断线恢复（3）

1. 以 V2 parts 与 activity snapshot 持久化会话，支持进行中的 turn 恢复。
2. 历史 V1 记录在读取时转换，不进行破坏性批量迁移。
3. 断线恢复后以服务端权威 snapshot 纠正局部状态。

验收：刷新、重启桌面端、切换会话后内容不丢失、不重排；旧历史可阅读；恢复后不会再次发送
已完成工具或重复最终回答。

#### M11. 安全、性能与可访问性（4）

1. Markdown 链接、图片、本地资源和 HTML 使用明确 allowlist/sanitize 策略。
2. delta 批处理、选择性渲染和长会话虚拟化避免主线程阻塞。
3. 工具输出、图片和表格均有大小限制与按需加载策略。
4. 所有折叠、成果卡片和调试操作支持键盘、焦点和读屏语义。

验收：恶意链接和 HTML 不可执行；500 条历史消息滚动可用；1 MB 工具输出不阻塞界面；键盘可
完成展开、复制、打开成果和关闭调试。

#### M12. 测试与发布守门（5）

1. 建立覆盖八类 part、四类右栏路由的脱敏 golden fixtures。
2. 为 parser、normalizer、reducer、renderer 分别编写单元测试。
3. 增加 Gateway 到 Electron 的集成测试与断线恢复测试。
4. 添加浅色/深色、100%/125%/150%、窄屏的 Playwright 视觉回归。
5. 设立发布门禁：schema、类型、fixture、E2E、性能和安全检查全部通过。

验收：至少覆盖多 thinking、stream/final 双写、并行工具、工具失败、审批、文件成果、网页引用、
断线重连、旧历史九类主路径；每次发布自动产出测试报告和失败事件样本。

### 13.5 分期、依赖和交付物

| 阶段 | 范围 | 主要交付物 | 完成条件 |
| --- | --- | --- | --- |
| P0 基线 | M1、fixture 框架 | V2 schema、事件录制、20 组 golden fixtures | 协议评审通过，旧聊天不回归 |
| P1 正确性 | M2--M5 | provider normalizer、Gateway mapper、桌面 reducer | 重复 thinking/正文与工具日志污染归零 |
| P2 核心体验 | M6、M7 | 正文、思考、进度、审批、通知组件 | 主聊天区可完成全部基本对话 |
| P3 成果与右栏 | M8、M9 | 文件/浏览器路由、调试活动/原始记录 | 四入口协作完成，右栏不膨胀 |
| P4 可靠性 | M10、M11、M12 | 恢复、安全、性能、E2E 与发布门禁 | 达到发布验收线 |

建议实施顺序为 P0 -> P1 -> P2 -> P3 -> P4。P1 是当前问题的根因修复；不应先做大规模
视觉重构。按一名前端、一名后端并行估算，P0--P4 为 12--16 个工作日；单人顺序实施约
18--24 个工作日。时间不含新的 Agent 协议或外部平台功能开发。

### 13.6 总体验收清单

- 任何回复中，正文、thinking、最终快照只显示一次；
- 工具名、工具 ID、工具输出、重试和技术错误不再污染主聊天区；
- 用户仍能在调试中获得全部可复现证据，在文件/浏览器/终端中继续工作；
- 新建聊天时右栏隐藏，聊天输入区保持居中；
- 点击产物、引用、详情时准确打开现有右栏，不新增竞争性入口；
- 历史、刷新和断线恢复后，视觉内容、顺序和状态与完成态一致；
- WebUI、Windows Desktop、TUI 对同一 Agent 事件保持一致语义。

### 13.7 实施进度

#### 2026-07-17：第 1 轮（P0 基线 / P1 正确性启动）

总体完成度：**9/51 功能点完成，4 个部分完成，38 个待实施**。

已完成：

- M1-1 至 M1-4：八类 `StructuredAssistantPart`、六类 `StructuredActivityEvent`、稳定事件标识和完整 turn/part 生命周期；
- M2-4：支持原始/转义 `<think>`、跨 chunk 标签、多段和未闭合 reasoning 的确定性状态机；
- M5-2 至 M5-5：按 sequence/dedupeKey 幂等归并、完成快照原位校正、单一 reasoning part、多 segment 和独立 activity 存储；
- Windows Desktop 流式正文、reasoning、工具活动和完成/取消/失败已并行接入 V2 state，旧字段暂由 V2 反向投影；
- 新增 `verify:structured-conversation` 并加入默认 `npm run verify` 发布门禁；
- golden fixture 已覆盖八类 part、两段 thinking、重复完成事件、活动事件、sequence gap 和取消状态。

部分完成：

- M1-5：已有 schema 版本与运行时校验，V1 历史 adapter 尚未实现；
- M2-1 至 M2-3：桌面主进程已区分原生 reasoning 与标签 reasoning，并抑制双源重复；Python provider/Gateway 仍需归一化；
- M5-1：V2 state 已成为新流式内容的累积来源，但持久化与组件仍保留 legacy 字段；
- M12-1：首组 fixture 已建立，尚未扩充到计划要求的完整矩阵。

本轮自动化验收：

- `npm run typecheck:node`：通过；
- `npm run typecheck:web`：通过；
- `npm run verify:structured-conversation`：通过；
- `npm run verify:chat-sse`：通过；
- `npm run verify:chat-output`：通过；
- `npm run verify:ui`：通过（58 checks）。

下一轮从 M3 Gateway V2 投影开始，同时实现桌面 named SSE 解析和 V1 -> V2 历史 adapter；完成后再切换渲染组件直接消费 V2 parts。

#### 2026-07-17：第 2 轮（P1 Gateway / IPC / 历史闭环）

总体完成度：**21/51 功能点完成，5 个部分完成，25 个待实施**。

本轮新增完成：

- M1-5：V2 运行时校验、named SSE 版本识别和 V1 历史消息只读迁移 adapter；
- M2-1 至 M2-3：Python 与桌面两侧统一原生 reasoning、`<think>` 和最终快照，双源内容互斥；
- M3-2 至 M3-4：Gateway 使用 TUI translator 统一语义，工具进入 activity，完成事件提供权威 part/turn 快照；
- M4-1、M4-3、M4-4：`drsai.event` named SSE、旧 OpenAI SSE fallback、完整关联字段和用户错误/调试信息分离；
- M10-2、M10-3：旧快照读取迁移，服务端完成快照原位校准；
- Gateway 已映射正文、推理、工具、日志、文件成果、长任务、后台命令、输入请求和子 Agent；
- renderer 收到首个 V2 事件后锁定该请求为 V2，抑制同请求的旧正文、推理、工具和终态帧，避免兼容双轨再次造成重复；
- V2 `structuredTurn` 已进入线程快照持久化，并对正文、reasoning、活动参数、工具输出、ID 和集合数量做有界清洗；
- 错误与取消终态分别保留 `error`/`cancelled` part 状态，失败必有用户可读 notice，不产生空白回复。

仍为部分完成：

- M3-1：projector 已支持八类 part，文件、长任务、输入请求已接真实消息；citation 还需接 provider 搜索/引用注解；
- M4-2：本地 Gateway 的完成、错误、取消已映射；远程平台和 Codex runtime 的网络恢复仍使用 legacy adapter；
- M5-1：V2 state 是 Gateway V2 请求的权威来源，但组件仍通过 legacy fields 投影显示；
- M10-1：V2 快照已持久化，进行中 turn 的服务端续流恢复尚未完成；
- M12-1：fixtures 已覆盖八类 part 与主要重复/终态场景，完整发布矩阵仍待扩充。

本轮自动化验收：

- Python projector：8 组行为检查通过；
- Python `py_compile`：projector、TUI translator、Gateway 通过；
- `npm run typecheck`：Node/Web 全部通过；
- `verify:structured-conversation`、`verify:chat-sse`、`verify:chat-output`：通过；
- `verify:ui`：通过（58 checks）；
- Python projector 验证已加入桌面默认 `npm run verify` 门禁。

下一轮进入 P2：让 `ChatWorkspace` 直接渲染 V2 parts，首先完成 Markdown、单一 reasoning、progress、notice 和 interaction；同时保留文件/浏览器路由所需的 artifact/citation 接口。

#### 2026-07-17：第 3 轮（P2 直接渲染 / P3 成果路由启动）

总体完成度：**33/51 功能点完成，8 个部分完成，10 个待实施**。

本轮新增完成：

- M5-1：`ChatWorkspace` 已直接消费 `structuredTurn.parts`；V2 请求不再向 legacy `parts` 双写，旧字段只保留只读兼容投影；
- M6-1、M6-2、M6-3、M6-5：正文直接使用安全 Markdown/GFM 渲染；一个 turn 只呈现一个 reasoning disclosure，多段 thinking 在内部按 segment 合并；复制与搜索只读取用户可见 markdown；
- M7-1 至 M7-4：`interaction`、`notice` 和单行 `progress` 已按类型渲染；已完成的 progress/interaction 从正文退出；技术错误仍进入调试记录，正文只显示可行动提示；
- M8-2、M8-3：本地 artifact/citation 打开现有文件面板并定位路径，网页 artifact/citation 打开现有浏览器面板；网页目标增加 HTTP(S) 协议白名单；
- M12-2：新增直接 renderer 契约验证，覆盖八类 part、无 tool 正文分支、终态可见性、文件/浏览器路由和样式约束；
- 模拟 Desktop API 已改为发送完整 V2 turn，覆盖 reasoning、流式 markdown、progress、artifact、citation、subtask 与 notice，可作为后续 E2E 夹具。

仍为部分完成：

- M3-1：provider 原生 citation/search 注解尚未全部接入 projector；
- M4-2：远程平台与 Codex runtime 的断线重连仍需统一到 V2 turn 状态；
- M6-4：长表格、长代码和大图已有基础约束，但尚缺 100%/125%/150% 与窄屏视觉证据；
- M8-1、M8-4：成果卡片和引用卡片已可用，但资源状态/稳定双向关联还需完善；
- M10-1：V2 snapshot 已持久化，进行中 turn 的续流恢复仍未闭环；
- M11-1：Markdown 和网页协议已有安全策略，仍需完成本地资源/大图/HTML 的完整安全矩阵；
- M12-1：已有八类 golden fixture 和模拟会话，四类右栏路由及异常场景矩阵仍需扩充；
- M12-4：生产构建已通过，但当前自动化环境没有可连接的应用内浏览器，本轮未把截图式视觉验收计为完成。

本轮自动化验收：

- `npm run typecheck:web`：通过；
- `npm run verify:structured-renderer`：通过（8 类 part、终态可见性、4 项路由/正文规则）；
- `npm run verify:ui`：通过（58 checks）；
- `npm run verify:structured-conversation`：通过；
- `npx electron-vite build`：生产构建通过；
- 浏览器视觉验收：未完成，原因是本轮环境没有可连接的应用内浏览器；保留为发布前必补证据，不以静态断言替代。

下一轮进入 P3：实现调试面板的“活动 / 原始记录”双视图及 part/activity 定位关联，同时补齐 artifact 状态、引用双向关联和右栏路由测试矩阵。

#### 2026-07-17：第 4 轮（P3 调试活动 / 原始记录）

总体完成度：**37/51 功能点完成，7 个部分完成，7 个待实施**。

本轮完成 M9-1 至 M9-4：

- 保持文件、浏览器、终端、调试四个既有右栏入口，没有新增与它们竞争的顶层页签；
- 调试面板增加“活动 / 原始记录”双视图：活动按 turn 分组，同一 activity 的状态更新按活动 ID 原位覆盖，成功组默认折叠，进行中与失败组默认展开；
- 活动视图只显示可读标题、类型、状态、时间与耗时，不暴露 call ID 等低价值标识；点击活动可滚动并短暂高亮对应聊天 turn；
- 原始记录保留每个 V2 协议事件、模型/重试/工具活动和 renderer 日志，支持级别筛选、文本筛选、逐条复制与当前视图导出；
- 调试清空继续只清除调试存储，不删除会话、V2 snapshot、文件或终端内容；
- F12 仍只负责调试右栏的打开/关闭，不改变文件、浏览器和终端的数据状态；
- 单条原始记录设置 256 KiB 上限并明确标记截断，调试存储维持 1000 条上限，避免长工具输出阻塞 renderer。

本轮新增验证：

- `npm run verify:structured-debug`：通过；真实执行调试 store，验证 activity running -> completed 原位更新、原始协议关联字段、清空隔离和 turn 回跳契约；
- `npm run typecheck:web`：通过；
- `npm run verify:ui`：通过（58 checks）；
- `npm run verify:structured-renderer`：通过；
- `npx electron-vite build`：生产构建通过；
- `git diff --check`（本方案涉及文件）：通过，仅有仓库既有 LF/CRLF 提示。

下一轮处理 P3 剩余项与 P4 恢复：完善 artifact 状态和 artifact/citation 稳定关联，扩充四类右栏路由 fixture，并实现进行中 V2 turn 的恢复判定与安全终态降级。

#### 2026-07-17：第 5 轮（P3 关联闭环 / P4 恢复）

计数校正：模块表中的功能点实际合计为 **51**，此前“47”是求和错误。本轮已同步修正 13.3 与历轮分母；各轮已完成分子不变，不通过错误分母放大进度。

总体完成度：**40/51 功能点完成，8 个部分完成，3 个待实施**。

本轮完成：

- M8-1、M8-4：artifact 卡片补齐名称、类型、描述、状态和稳定 `artifactId`；V2 增加 markdown `citationIds`、citation `markdownPartId/artifactId` 与 artifact `citationIds`；
- Gateway 在 `citation.added` 时发出 `markdown.citations` 增量，历史快照和流式状态使用同一组稳定 ID，不再依靠 URL 或标题猜测关联；
- 正文引用编号可定位并高亮来源卡片，来源卡片可返回关联正文；打开来源仍使用现有文件/浏览器右栏；
- M10-1：加载 running/pending V2 snapshot 时按 `turnId` 重建 request -> assistant 映射，继续接收主进程事件；
- 30 秒未收到权威事件时，将 turn 安全降级为 cancelled，保留已有正文并追加一次可读 notice，不重发工具或答案；迟到的服务端终态仍可原位校正；
- fixture、模拟 Desktop API、TypeScript sanitizer 与 Python projector 均已覆盖稳定关联字段。

本轮验证：

- `npm run typecheck:web`：通过；
- `npm run verify:structured-conversation`：通过，新增中断恢复幂等与迟到终态校正；
- `npm run verify:structured-renderer`：通过，新增引用双向定位与 artifact 身份/状态契约；
- `npm run verify:structured-debug`：通过，新增恢复映射与超时边界契约；
- Python Gateway projector：通过（9 checks），新增 citation/markdown/artifact 双向关系；
- `npm run verify:ui`：通过（58 checks）；
- `npx electron-vite build`：生产构建通过。

下一轮进入 M11/M12：逐项审计安全、长内容性能、键盘/读屏语义，扩充异常与右栏路由矩阵，并建立可执行的性能和视觉发布门禁。

#### 2026-07-17：第 6 轮（P5 质量门禁 / 发布集成）

总体完成度：**47/51 功能点完成**。

本轮完成：

- M11-1 至 M11-4：关闭原始 HTML，限制图片协议并启用懒加载；对消息、正文、状态、工具输出和调试原始记录设置边界；V2 增量按 16 ms 合批；长会话启用 `content-visibility`；交互控件补齐键盘焦点；
- 建立 10,000 次增量归并性能基准，当前验证耗时约 42 至 46 ms；
- M12-1、M12-3、M12-5：补齐八类内容、四类右栏路由和失败恢复 fixtures；建立 Gateway named SSE -> Desktop parser -> reducer 端到端协议验证；发布验证输出机器可读报告；
- 所有结构化会话验证已加入桌面默认 `npm run verify`，不再依赖开发者手工选择测试脚本。

本轮验证：

- `npm run verify`：完整通过，耗时 56.7 秒；包含 Node/Web 类型检查、结构化协议、Gateway projector、renderer、debug、quality、integration、release、OIDC、平台认证、工作区、Gateway smoke、启动性能和 UI 58 项检查；
- `npx electron-vite build`：生产构建通过；
- 发布报告：生成 `out/verification/structured-conversation-report.json`。

未完成项收敛为：provider 原生引用注解、远程/Codex 重连 V2 状态、长内容多缩放视觉证据和 Playwright 视觉回归。

#### 2026-07-17：第 7 轮（Provider 引用 / 网络恢复）

总体完成度：**49/51 功能点完成**。

本轮完成：

- M3-1：TUI/Gateway translator 从 provider 的 `citations`、`annotations`、`sources` 以及嵌套 citation 结构归一化引用；使用稳定摘要 ID 去重，并保留 URL、定位信息及 artifact 关联；
- M4-2：本地 Gateway、远程 Gateway 和 Codex runtime 的连接失败统一产生 `retrying/restored` 事件；旧式运行映射为 V2 retry activity，原生 V2 流保持服务端状态权威；
- 连接活动只进入调试时间线，同一活动从“恢复中”原位更新为“已恢复”，不会把技术状态或重复文本写进 Agent 正文；
- 新建本地结构化 turn 使用 request ID 作为 turn ID，使恢复事件、持久化快照和后续权威事件可稳定关联；
- 异常 fixtures 新增远程连接恢复序列，并验证调试活动、正文隔离和 V2 权威保护。

本轮验证：

- Python structured conversation：通过（10 checks，含 provider 引用归一化与去重）；
- `npm run typecheck`：Node/Web 通过；
- `npm run verify:structured-debug`：通过；
- `npm run verify:structured-integration`：通过。

剩余 **2/51** 均为可视化发布证据：M6-4 的长表格、长代码、大图多缩放/窄屏验收，以及 M12-4 的 Playwright 截图回归。二者使用同一组真实应用场景完成，不以源码断言代替截图。

#### 2026-07-17：第 8 轮（视觉回归 / 最终验收）

总体完成度：**51/51 功能点完成**。

本轮完成：

- M6-4：建立包含 13 列宽表格、28 行超长代码和大图的结构化回复 fixture；在桌面 100%、125%、150% 及 860px 窄屏下验证；
- M12-4：新增 Playwright 视觉发布门禁，使用生产 renderer 构建和无 preload 的显式测试入口，自动进入 mock 开发工作区并发送 fixture；
- 每档生成整体视口、表格、代码和图片四张证据，共 16 张；同时校验 PNG 尺寸/最小内容量、全局横向溢出、表格/代码内部滚动、图片加载和正文边界；
- 视觉测试发现并修复旧 `.message-body table` 规则覆盖表格容器的问题；宽表格现保持自然列宽，由单一外层滚动槽承载，不再挤压单元格或形成双重滚动；
- `verify:structured-visual` 已加入默认 `npm run verify`，并排在结构化发布报告之前；截图失败时不生成“通过”的发布报告；
- Playwright 仅作为开发依赖；正式 Electron 无查询参数时仍使用 preload 注入的真实 Desktop API，视觉 fixture 只在显式 `structuredVisualFixture=1` 浏览器验收入口启用。

最终验收：

- `npm run verify:structured-visual`：通过，4 个布局场景、16 张截图；
- `npm run verify`：完整通过，包含生产构建、视觉门禁、结构化协议/Gateway/renderer/debug/quality/integration/release、OIDC、平台认证、工作区、Gateway smoke、启动性能与 UI 58 项检查；
- 性能基准：10,000 次 V2 增量归并 38 ms；
- 视觉报告：`apps/desktop/windows/out/verification/structured-visual/report.json`；
- 发布报告：`apps/desktop/windows/out/verification/structured-conversation-report.json`。

本方案定义的 12 个模块、51 个功能点均已实现并进入可重复执行的发布门禁。
