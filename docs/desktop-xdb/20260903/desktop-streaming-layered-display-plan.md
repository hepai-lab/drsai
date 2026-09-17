# 桌面版流式输出：层次化消息分类与渲染优化方案

> 调研日期：2026-09-03 ｜ 范围：`apps/desktop`（Electron 前端）↔ `cores/python/packages/drsai/src/drsai/backend/{runtime,desktop_gateway,tui_gateway}`（中转后端）↔ `.../modules/agents/skills_agent/drsai_assistant.py`（核心 Agent）
> 目标：大量流式思考、工具输出、子智能体过程不再造成"大段平铺展示 + 前端渲染资源消耗"，做到**有层次的分类展示**。

---

## 0. 先回顾记忆中的调研记录

本次会话开始前已确认的既往调研（session MEMORY）：

1. `[2026-09-02]` Desktop gateway 启动提示错乱修复（feature/desktop-v2）：双就绪源、bootstrap epoch、GatewayStatus.startState 等——**与本问题相关的是已确认桌面走 desktop-v2 gateway 架构**（`shared/main/gateway.ts` 管理网关进程、/health + /v1/models 双探活）。
2. `[2026-09-03]` "Tool event without a call identity"定位：raise 在 `desktop_gateway/_agent_backend.py:220-224`（`tool.start/complete` 缺 call_id）；**真凶多为 `tui_gateway/adapter/event_translator.py:475-488`**：`ToolCallSummaryMessage` 无 pending 时 tool_id 硬编码 `""`；上游裸 summary 来自 `drsai_assistant.py:2733-2736`（Skill 分支）+ `:3189`（最终 wrap Response）。同一守卫复制于 `gateway_legacy.py:3348-3351`。→ 本次调研已复核，这直接关联下文"Skill 大文本直接平铺"的问题点。

这些记忆没有覆盖"流式消息分类/渲染"本身，因此本次重新从三层链路做了代码级调研。

---

## 1. 现状链路（三层）与消息分类的实际情况

### 1.1 链路总览（本次确认）

```
DrSaiAssistant.run_stream/on_messages_stream        ← Python 核心
   │  产出 autogen BaseAgentEvent|BaseChatMessage|Response
   ▼
desktop_gateway/_agent_backend.py:DesktopAgentBackend.execute()
   │  translate_conversation_event(event, translation)   ← event_translator.py
   │  _normalize_event() → services.emit(kind, data)     ← Runtime 事件
   ▼
backend/runtime/{engine,journal,conversation,normalized_events}.py
   │  RuntimeEngine/Journal + StructuredConversationProjector (part.* / reasoning 段)
   │  + OAEP P1→P2 投影 (_oaep.py)
   ▼
Electron main（oaepSessionStream / runtimeClient / threadRuntimeProjection …）
   ▼
Renderer：structuredConversation.ts（StructuredTurnState reducer）＋
          threadSnapshotPatch（item.upsert/delta/remove, run.state）+ ChatWorkspace
```

**注意：apps/desktop/drsai_gateway_server.py 的 docstring 已过时**——`shared/main/gateway.ts:550-557` 实际以 `uvicorn drsai.backend.desktop_gateway.app:app`（端口 28643）启动桌面网关；旧 `gateway_legacy` 与新的 `desktop_gateway` 共享同一 Runtime 但 HTTP 层不同（`desktop_gateway/app.py` docstring 明确说明）。

### 1.2 上游事件/消息谱系（`drsai_assistant.py` 实测 yield 点）

`on_messages_stream`（L1664 起）主循环里，一轮任务会产出以下对象（文件内 yield 行号）：

| 类别 | 对象 | 行号（drsai_assistant.py） | 内容/去向 |
|---|---|---|---|
| **流式正文** | `ModelClientStreamingChunkEvent`（经 `_call_llm` 透传） | 1802 / 2213 / 2227 | 真正的零延迟 token 流；translator 判 `source.startswith("sub:")` 走子代理 |
| **思考** | `ThoughtEvent`（`model_result.thought`） | 1908-1909 | DeepSeek 等 reasoning_content；translator → `thinking.delta` |
| **工具声明/参数** | `ToolCallRequestEvent(content=FunctionCall[])` | 2524-2527 | 一次声明整批工具 + 完整 JSON 参数（含 Delegate 的 prompt/context 全文） |
| 工具日志 | `AgentLogEvent(content_type="tools")` | 2534 / 2589 / 2727 / 2755 / 2860 | "I am using tools…/reading skill…/parallel subagents…" |
| **Skill 输出** | `ToolCallSummaryMessage`（裸，无 tool_call_id） | 2733-2736 | skill_content 全量平铺（memory[2] 的 tool_id="" 源头之一） |
| **特殊工具正文** | `TextMessage`（TodoWrite / ScheduledTaskManager 等） | 2783 / 2888 / 3055 / 3070 | 直接面向用户可见 |
| **大输出旁路** | `FilesEvent`（超出 inline 上限的 tool 输出转 artifact） | 3152 | `_max_inline_tool_output_chars`（来自 runtime/agent_kernel）判定 |
| **工具结果汇总** | `Response(chat_message=ToolCallSummaryMessage)` | 3189 | 一轮全部 tool 的 summary 拼接（memory[2] 的 tool_id="" 源头之二） |
| **子代理** | 见 §1.3 | 3575 / 3684 / 3692 | `sub:*` 标签递归透传 |
| **最终答复** | `Response(chat_message=TextMessage/StructuredMessage)` | handle_str_reponse(约1969-1971) | turn 收尾正文 |
| 中断/错误 | `Response(TextMessage)` / `StopMessage` | 1976 / 1988 / 2021 / 2801 | 通知型 |
| 内存压缩/重试 | `AgentLogEvent(title=...)` | 1817 / 1875 / 2094 / 2108 | system 级日志 |

要点：
- 同一轮里 `_call_llm` 的 streaming chunk（L1802）先裸透传，随后 Content 若是 str 再出最终 `TextMessage`；若是 FunctionCall 列表则进 `_process_model_result`。
- **事件流本身没有统一的"角色轴"字段**：区分正文/思考/工具/子代理主要靠「对象类型 + source 前缀 sub: + metadata.internal」三点，分散且易混。
- 上游已做了第一道体积控制：超大 tool 输出在 `drsai_assistant.py` L3130-3170 前被 `_max_inline_tool_output_chars` 截断并转 `FilesEvent`（artifact），正文里只放 bounded preview。

### 1.3 子代理（Delegate）的产出与渲染现状

- `_execute_subagent`（约 L3570-3640）与 `_execute_subagents_parallel`（约 L3641+）是两条路：
  - 串行：`async for msg in subagent.on_messages_stream(...)` → **逐条 `yield self._tag_message(msg, sub_agent_name)`**（L3575/3684）→ 递归！子代理的全部事件（它的流式 chunk、tool、thought…）会 `sub:{name}` 打标后**原样平铺进父流**。
  - 并行：`run_one` → queue → 也是逐条 `_tag_message` 后 yield（L3684），最后补一条带 `metadata.subagent_result_call_id` 的收尾 `TextMessage`（L3690-3692）。
- 结果：桌面端必须靠 `source=sub:xxx` 前缀从"一条长流"里切分各子代理，而父代理正文流、思考流、工具输出和 N 个子代理的内容**共用一个线性流**——这就是"大段平铺、无层次"的根源之一。v2 structured 层有 `subtask` part 雏形，但上游信息不足以稳定切分（见 §1.5）。

### 1.4 中转/翻译层实际分类（`event_translator.py` 首部注释即设计表）

```
ModelClientStreamingChunkEvent → message.delta       （source 以 sub: 开头 → subagent.thinking）
TextMessage(assistant)        → message.complete 或跳过（internal=yes 跳过 / 已流式去重）
TextMessage(user)             → 跳过
ToolCallRequestEvent          → tool.start（逐 call，含 parsed args）
ToolCallExecutionEvent        → tool.complete（逐 call）
ToolCallSummaryMessage        → 已归档（仅当无 pending 时残留为空 tool_id 的兜底分支 L475-488）
Response                      → message.complete + usage.update
AgentLogEvent                 → status.update kind=log
ThoughtEvent                  → thinking.delta
```

之后 `_agent_backend._normalize_event`（L203-245）再把 conversation 事件映射成 Runtime 事件：`message.delta→agent.message.delta`、`tool.start/complete→tool.started/tool.completed`（**缺 call_id 直接抛 tool_identity_missing，即 memory[2]**），并补 operation/correlation identity。

因此：**中转层已经能输出 `agent.message.delta / thinking.delta / tool.started / tool.completed / status.update / agent.completed` 这几类线级事件**——分类轴是存在的，但 (a) 子代理没有独立事件类型；(b) `tool.completed` 的 payload 仍可能携带整段工具输出；(c) thinking 与正文可能跨 `message.delta`/`thinking.delta` 双通道重复（上游裸 summary + translator 兜底）。

### 1.5 v2 Structured 投影（runtime/conversation.py + renderer structuredConversation.ts）

`StructuredConversationProjector`（runtime/conversation.py L85+）把上面的事件投成 **turn/part/segment 结构**并编码 SSE（`encode_structured_sse`）：

- part 类型（structuredConversation.ts L130+）：`markdown | reasoning | progress | artifact | citation | interaction | subtask | notice`
- reasoning 段：`reasoning.append {segmentId,text}` + `<think>` 归一器（`_ThinkStreamNormalizer`），`ThoughtEvent→native-*` 段、`message.delta` 里混的 thinking 用 tagged-stream 段切出
- 工具活动：`_tool_activity` → activity kind=tool（status/name/call id 等，输出内容是否全文携带待验证）
- 子代理：`_subtask`（L281+）按 source_id 生成 `subtask` part 雏形（标题取 `sub:` 剥离后的名字，summary 取文本），**仅把子代理文字压成 summary，但上游子代理流仍整体线性透传**。

Renderer 侧已具备的硬性保护（本次调研确认）：
- `threadSnapshotPatch.ts`：解码校验（数组≤10000、单 message ≤8MB、总编码 ≤16MB、delta 文本 ≤16MB、递归深度 20）
- `threadPatchFrameBatcher.ts`：rAF 合并相邻 `item.delta`，完成/错误事件 urgent flush
- `threadSnapshotStore.ts`：会话级 128/64MB/10min 缓存与 LRU 淘汰
- `ChatWorkspace`：`memo` + `VirtualizedMessage`（IntersectionObserver 900px，视口外空占位）+ 高度估算缓存；`StructuredMessageParts` 用 `<details>` 折叠 process、reasoning disclosure、`boundedProcessWindow`（ACTIVITY=16、PART=8）翻页
- `reactPerformanceGuard` / `streamingRenderMetrics` / `threadSyncMetrics` 已有度量打点

**小结：前端并非没有层次结构（v2 structured turn 模型已相当完整），缺的是：**
1. 上游没有稳定的"语义角色/嵌套边界"元数据，导致 thinking / tool / subagent 只能靠"对象类型 + sub: 前缀 + 字符串嗅探"（如 `<think>`）分类，容易串流、重复；
2. reasoning / tool 正文 / subagent 过程在**事件级**没有统一的体积预算，大文本先横穿整条链路再到前端才被折叠/翻页；
3. 父代理正文与子代理正文在 `message.delta`/`markdown.append` 上共用通道，多子代理并发时互相穿插；
4. 折叠/翻页在渲染层生效，但"先全量收下再折叠"仍然消耗 IPC/内存/JS 解析（尤其是 markdown 全量重解析、超大字符串拼接）。

---

## 2. 优化方案总原则

1. **源头打标，链路传递，展示端消费**：语义角色在 `drsai_assistant.py` 产出时就打上（metadata 元数据），中转层**归一化但不再发明**，前端按同一枚举消费。
2. **分类先于展示，预算先于传输**：每类内容在"进入事件流"时就带明确边界与体积上限；超过上限的**正文不进 UI 流**，转 artifact（上游已示范 FilesEvent 做法，需下沉为通用策略）。
3. **嵌套子代理 = 子 turn 容器，不平铺**：子代理是"盒中盒"，有独立的 start/boundary/end、独立 part、独立预算，父正文流不被污染。
4. **前端渲染分四级**：默认折叠/摘要行 → 展开看过程 → 翻页/虚拟列表 → 全量走 artifact 预览。杜绝"一整块大文本直接铺满"。
5. **每帧增量最小化**：正文只追加 delta、markdown 延迟解析、part 级 memo，React 不因长文本整体重渲染。

---

## 3. 目标信息架构：统一的"语义角色 + 层级"模型

### 3.1 语义角色（role）——建议在事件/消息 metadata 上新增统一字段

在现有 `TextMessage/AgentLogEvent/各类事件` 的 metadata 上增加 `md: { role, layer, ... }`（或直接顶层 `role`），枚举（对齐现有 translator 已用 kind）：

| role | 含义 | 现有可识别线索 | 展示策略 |
|---|---|---|---|
| `user` | 用户消息 | source=user | 左侧气泡，不参与流 |
| `answer` | 助手最终正文 | TextMessage(assistant)/message.complete | 主区域 markdown，流式 |
| `answer_delta` | 流式正文增量 | ModelClientStreamingChunkEvent / message.delta | 追加到 markdown part |
| `reasoning` | 思考 | ThoughtEvent / thinking.delta | reasoning part，默认折叠+可展开 |
| `tool_call` | 工具调用声明/参数 | ToolCallRequestEvent / tool.start | process 行（名称+参数摘要） |
| `tool_output` | 工具执行输出 | ToolCallExecutionEvent / tool.completed | 默认折叠 / >N行进 artifact |
| `subagent` | 子代理容器（boundary + 内部全部） | source=sub:* | subtask part / 独立子 turn |
| `system` | 通知/日志/retry/压缩 | AgentLogEvent | notice/日志区，弱化 |
| `interaction` | 需用户批准/输入 | UserInputRequestedEvent/approval | interaction 卡片 |

### 3.2 层级模型（四级，从粗到细）

```
Turn（一轮 assistant 回复）
 ├─ Header/status（run.state: running/completed/error…）
 ├─ Layer 1 正文区（Answer）        = markdown part（只放 answer 流）
 ├─ Layer 2 思考区（Reasoning）     = reasoning part（segments 数组）
 ├─ Layer 3 过程区（Process）       = tool activity 列表 + progress + subtask 条目
 │    └─ 每个 subagent = 一个 subtask/子进程容器
 │         ├─ 子代理头部（name, call_id, status, elapsed）
 │         ├─ 子过程 activities（只读自己的）
 │         └─ 子结论摘要（而非把子代理全文塞进父 markdown）
 └─ Layer 4 资源区（Artifacts/Citations）
```

### 3.3 统一事件表（新增线级类型）

在中转层把现有翻译输出升级/补齐为（在既有 `agent.*`/`tool.*` 基础上**增补**，不破坏兼容）：

```
agent.turn.started            {turn_id, run_id, model, queued_at}
agent.reasoning.delta         {segment_id, text, source}            ← 替代/增强 thinking.delta
agent.tool.started            {call_id, name, args_summary, args_size}
agent.tool.output             {call_id, name, status, output_preview, full_ref(artifact)?}
agent.subagent.started        {subagent_id, name, call_id, depth}
agent.subagent.delta          {subagent_id, name, kind(text/tool/…), delta}   ← 子代理内部统一走此通道
agent.subagent.completed      {subagent_id, name, summary, elapsed, out_ref?}
agent.message.delta/complete  （不变，仅承载 answer）
agent.completed               （不变）
```

前端若仍走 v2 structured projector，则 projector 依据这些事件生成 part/activity，并保证：
- **markdown part 只 append role=answer 的增量**；
- reasoning 段独立累加，超预算后只留首段+末段摘要；
- subagent 平铺流改成"每子代理一个 subtask part / 一个独立内部 context"。

---

## 4. 分层改造清单

### 4.1 Python 核心（`drsai_assistant.py` + messages 模块）——打标 + 结构 + 预算

| # | 改动 | 文件/位置（建议） | 目的 |
|---|---|---|---|
| A1 | **统一事件 metadata 打标**：`on_messages_stream` 产出点统一注入 `role`/`layer`；子代理 tag（`_tag_message`）扩展为带 `subagent_id`/`depth`/`parent_turn` 的结构化 metadata（保留 `sub:` source 兼容） | drsai_assistant.py `_tag_message` / run_stream / on_messages_stream | 让 translator/前端不再靠类型+前缀+字符串猜分类 |
| A2 | **子代理容器化**：`_execute_subagent` 与 `_execute_subagents_parallel` 外层发 `subagent.start`；内部事件带 `subagent_id` 进入独立容器；收尾发 `subagent.completed{summary, elapsed}`；**父 turn 内不再把子代理 TextMessage 正文与父 answer 混流**（子代理结论摘要另行携带） | `_execute_subagent`/`_execute_subagents_parallel` | 解决并发穿插与平铺（§1.3） |
| A3 | **修复 Skill 裸 summary**：`ToolCallSummaryMessage`（2733-2736）补 `tool_call_id=call_id` 与 role=tool_output；3189 的最终 summary 也带各自 call_id | drsai_assistant.py | 消除 memory[2] 的 tool_identity_missing 失败 + 让前端可归组 |
| A4 | **正文/思考分流**：`ThoughtEvent` 保证只在 reasoning 通道；正文 TextMessage 不带 think 文本；`_call_llm` streaming chunk 只透传 answer 增量 | drsai_assistant.py `_call_llm` | 防止 thinking 在 message.delta 与 thinking.delta 双通道重复 |
| A5 | **内容预算统一收口**：为 `ToolCallSummaryMessage`/`AgentLogEvent`/工具 summary 明确 `_max_inline_*`（沿用 runtime/agent_kernel 常量），**超限一律走 FilesEvent→artifact，正文只留引用**；Skill content 截断 + 完整内容按 artifact 交付 | drsai_assistant.py L2726-2755 / 3189、agent_kernel 常量 | 让"大文本不进 UI 流"成为通则而不是个别工具的特例 |
| A6 | 补充 TextMessage 语义 metadata：`internal=yes` 的纯通知可统一降级为 system 角色（避免误入 answer markdown） | run_stream / on_messages_stream | 前端展示分类更稳 |

### 4.2 中转/翻译层（`event_translator.py`、`desktop_gateway/_agent_backend.py`、runtime/conversation.py）

| # | 改动 | 目的 |
|---|---|---|
| B1 | 按 §3.3 补齐翻译表：子代理边界事件、reasoning.delta、tool.output 显式化；保留旧 kind 映射以兼容（映射表 docstring 同步更新） | 分类稳定 |
| B2 | `ToolCallSummaryMessage` 兜底分支（475-488）改为**直接消费上游 A3 带来的 call_id**，无 call_id 时拒绝或降级为 `status.update` 而非空 tool_id 工具事件 | 根除 tool_identity_missing |
| B3 | **reasoning 归段与预算**：`StructuredConversationProjector` 的 reasoning 段按 segment 追加，超过单段预算（如 8k 字符）开始滚动丢中段，只在 complete 时补"已省略 N 字"标记；`<think>` 归一器与 native 通道去重 | 防止 reasoning part 无限膨胀 |
| B4 | **子代理投影容器化**：projector 增加 subagent part 逻辑（start→内部 part.delta→completed summary），不把 subagent 文本 append 到父 markdown part | 前端拿到容器而非长流 |
| B5 | 服务端 flush 节奏：turn 活跃时 SSE/事件按 ~50-100ms 或 N 条合并一次（复用 threadPatchFrameBatcher 思想的下游，但源头减少小包风暴）；同一 item 的相邻 delta 后端先 coalesce | 减少 IPC/解析开销 |
| B6 | 在 journal/normalized 层固化体积上限（对齐 renderer patch 上限的 1/2 级别作为源头红线，避免 16MB 才兜底） | 防"先爆后裁" |

### 4.3 前端渲染（`structuredConversation.ts`、`ChatWorkspace`、`StructuredMessageParts` 等）

| # | 改动 | 目的 |
|---|---|---|
| C1 | **Part 展示策略表**（对齐 role）：reasoning 默认折叠只显示摘要行 + 展开按钮；tool activity 单行（icon+name+状态+耗时），输出 >120 字符折叠预览、完整输出按钮只读 artifact；subagent = 折叠卡片（name/status/elapsed/结论摘要），展开才看其内部 process | 默认态紧凑 |
| C2 | **markdown 渲染代价控制**：answer 流式期间用增量/延迟解析（如 120ms 节流 + 仅在文本稳定段全量 parse），用 `content-visibility:auto` / `contain` 限制 layout 影响 | 减少全量重解析 |
| C3 | **超长 part 文本降级**：reasoning/markdown 文本在 store 层即截断（保留可检索全文的索引或 artifact），UI 内只放预览；不再把 8MB 上限当常态 | 前端内存 |
| C4 | **父子正文分离渲染**：answer markdown part 不渲染任何 role=subagent 内容；subagent 内容一律在 process/subtask 容器 | 解决穿插/重复 |
| C5 | 折叠态记忆（per part id）与会话级偏好（如"默认不展开 reasoning"） | 一致体验 |
| C6 | 复用/增强现有 `boundedProcessWindow`、`VirtualizedMessage`、`threadPatchFrameBatcher`，并把渲染耗时指标（streamingRenderMetrics）接入可视化面板用于验收 | 可度量 |

### 4.4 需要先做的最小验证（P0，半天~1天）

1. **抓一条真实桌面流的线级样本**：跑一个含 Delegate+DeepSeek thinking+长 tool 输出的任务，在 renderer 收到的 `item.delta`/part.delta 序列里核对：哪些段目前以 `message.delta` 平铺、thinking 是否双通道、subagent 文本进了哪个 part——据此校准 §3.3 表与 C1 策略（不要凭代码猜测 UI 行为）。
2. 确认 desktop 网关当前在 28643 端口跑的是 `desktop_gateway.app`（而非 18642 legacy），并定位 main 进程 SSE 订阅到 patch 的转换点（`threadRuntimeProjection.ts`/`oaepPresentationProjector.ts`），确认 projector 输入输出字段名。
3. 用 `streamingRenderMetrics`/DevTools Performance 量 3 类场景基线：纯长文、thinking-heavy、多工具+并行子代理。

---

## 5. 落地阶段划分

| 阶段 | 内容 | 产出/验收 |
|---|---|---|
| **P0 摸底** | §4.4 三项：真实流样本、网关/投影接线确认、性能基线 | 一张"现状事件→part 映射表"（带每类文本量实测）；基线数字 |
| **P1 后端分类+预算**（不依赖前端） | A1-A6 + B1-B3；先不引入新事件类型也能做的是 A3/A5（tool_id、截断转 artifact、metadata 打标） | 流中不再出现空 tool_id、超大正文不进 UI；typecheck/py 测试绿；回归 suite 通过 |
| **P2 子代理容器化** | A2 + B4 + §3.3 新事件类型；旧消费端兼容 | 多子代理流可在前端按 subtask 归组 |
| **P3 前端分层渲染** | C1-C6 按 part 类型逐步上线，每类一个开关（feature flag） | 长文本/thinking/工具场景 DOM 节点与渲染时长显著下降，视觉默认态紧凑 |
| **P4 度量与回归** | 渲染指标面板、threadSyncMetrics 阈值告警、折叠偏好持久化 | 验收指标稳定通过 |

建议**优先落地 P1 里 A3/A5 + B2**：它们独立、风险小，直接消掉 memory[2] 的线上失败 + 把"大文本不进 UI 流"做成通则；随后再动子代理容器化（P2），最后做前端视觉（P3）。

---

## 6. 风险与注意

- **兼容性**：新增 role 元数据/事件类型必须向后兼容旧 translator 与旧的 TUI/WebUI 消费端；`source=sub:` 约定被多端依赖，改动需同步 `gateway_legacy.py` 侧同类逻辑（其 3348-3351 有同款守卫）。
- **子代理结果进 model_context**：A2 容器化不能改变 `_execute_subagent` 向 model_context 回填 exec_results 的语义，只改"展示流"的分发，注意 `_process_model_result` 对 Response 的 break 逻辑。
- **thinking 双通道**：DeepSeek 的 reasoning 与正文流在不同模型/网关形态下有差异，A4 需要以 P0 样本为准，避免误删合法正文。
- **两套 gateway 并存**：18642 legacy 与 28643 desktop v2 共享 Runtime，改造点若落在 translator（两者共用）需确保不破坏 legacy 面（frozen route/OpenAPI 快照约束）。
- **折叠≠删除**：折叠仅是视图态，store 仍可能持全文——C3 才是真正省内存的手段；两者要一起做。

---

## 7. 附：本次调研关键证据索引

- 上游 yield 点/分类：`drsai_assistant.py` L1664-2299（on_messages_stream）、L1908（thought）、L2524-2534（ToolCallRequestEvent+日志）、L2727-2755（Skill）、L3152（FilesEvent）、L3189（ToolCallSummaryMessage）、L3575/3684/3692（子代理）
- 子代理递归：`_execute_subagent`（L3570+）、`_execute_subagents_parallel`/`run_one`（L3641+）、`_tag_message`（L3460+）
- 翻译表：`tui_gateway/adapter/event_translator.py` L1-24 docstring、L225+ translate、L475-488（summary 兜底）
- 网关归一：`desktop_gateway/_agent_backend.py` L86-145（execute）、L203-245（_normalize_event，含 tool_identity_missing）
- 桌面网关接线：`apps/desktop/shared/main/gateway.ts` L540-560（`-m drsai.backend.desktop_gateway`）；`desktop_gateway/app.py`（28643、ROUTERS）
- v2 structured：`backend/runtime/conversation.py`（projector/_ThinkStreamNormalizer/encode_structured_sse）、`backend/runtime/normalized_events.py`（事件枚举）
- 前端保护与渲染：`structuredConversation.ts`（part 类型/reducer）、`threadSnapshotPatch.ts`（解码上限）、`threadPatchFrameBatcher.ts`（rAF 合并）、`threadSnapshotStore.ts`（缓存）、`boundedProcessWindow.ts`（WINDOW=16/8）、`ChatWorkspace.tsx`/`StructuredMessageParts.tsx`（虚拟化+折叠）
