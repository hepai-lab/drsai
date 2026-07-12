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
