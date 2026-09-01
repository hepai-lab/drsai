# 桌面前端子智能体渲染方案

## 一、问题根因

当桌面前端使用子代理（Delegate/Subagent）时，聊天界面"直接停止，不再显示运行内容"。

### 根因链路追踪

完整事件流转链路如下（✅ = 正常，❌ = 断裂点）：

```
engine.py (内核引擎)
  │  _start_subagents() 发出 subagent.started
  │  _model_chunk() 发出 subagent.thinking (subagent_id is not None)
  │  _subagent_completed() 发出 subagent.completed
  │  ❌ 不发出 tool.started / tool.result (delegate 路径绕过)
  ▼
desktop_kernel_coordinator.py (协调器)
  │  yield outbound (RUNTIME_EVENT 直接转发)
  │  ✅ 转发正常
  ▼
desktop_kernel_events.py (translate_kernel_event)
  │  ❌ subagent.* 全部落入 catch-all → AgentLogEvent
  │     source = state.assistant_name (非 "sub:" 前缀!)
  │     content = json.dumps(payload)
  │     metadata = {"kernel_event": "subagent.xxx"}
  ▼
event_translator.py (translate → 语义事件)
  │  AgentLogEvent → ("status.update", {"kind": "log", "text": ...})
  │  ❌ 不走 subagent.thinking / subagent.complete 路径
  │     (因为 source 不是 "sub:" 前缀)
  ▼
conversation.py (StructuredConversationProjector)
  │  status.update → _tool_activity() → activity 条目 (kind=log)
  │  ❌ 不创建 SubtaskPart (不走 _subtask() 路径)
  │  ✅ _subtask() 方法已存在，但从未被触发
  ▼
sseParser.ts / structuredConversation.ts (前端)
  │  activity.updated → 活动面板显示 (不显眼)
  │  ❌ 无 SubtaskPart 渲染
  ▼
StructuredMessageParts.tsx (前端渲染)
  │  ❌ 用户看不到子代理运行状态
  │  表现："停止了，不显示运行了"
```

### 三个断裂点

| # | 断裂位置 | 文件 | 原因 |
|---|---------|------|------|
| ❌1 | `translate_kernel_event()` | `desktop_kernel_events.py` | `subagent.*` 事件落入 catch-all → `AgentLogEvent`，而非可见的 Autogen 事件 |
| ❌2 | `translate()` TextMessage 跳过逻辑 | `event_translator.py` | `_is_subagent_source()` 检查在跳过逻辑之后，导致子代理 TextMessage 被错误跳过 |
| ❌3 | `_subtask()` 流式累积 | `conversation.py` | `subagent.thinking` 的 delta 每次覆盖而非累积 summary |

### 已有的正确基础设施

以下代码已经存在且正确，只是因为断裂点 ❌1 导致它们从未被触发：

- **`event_translator.py` translate()**:
  - `ModelClientStreamingChunkEvent` + source="sub:xxx" → `subagent.thinking` ✅
  - `TextMessage` + source="sub:xxx" → `subagent.complete` ✅
  - `ThoughtEvent` + source="sub:xxx" → `subagent.thinking` ✅
- **`conversation.py` StructuredConversationProjector.project()**:
  - `subagent.thinking` → `_subtask()` → `part.started` + `part.delta` (subtask.update) ✅
  - `subagent.complete` → `_subtask()` → `part.completed` ✅
- **`structuredConversation.ts`**:
  - `SubtaskPart` 类型定义 ✅
  - `subtask.update` delta 处理器 ✅
- **`StructuredMessageParts.tsx`**:
  - `subtask` kind 渲染分支 ✅ (但很简陋)

---

## 二、修复方案

### 分层修复，共 5 个修改点

```
修改层次:
  层1: desktop_kernel_events.py  — 翻译层修复 (核心)
  层2: event_translator.py      — 跳过逻辑修复
  层3: conversation.py          — 流式累积修复
  层4: desktop_oaep_bridge.py   — OAEP 桥接补全 (可选)
  层5: 前端 TypeScript           — 渲染增强
```

---

### 修改 1: `desktop_kernel_events.py` — 翻译层核心修复

**文件**: `cores/python/packages/drsai/src/drsai/backend/runtime/desktop_kernel_events.py`

#### 1a. `DesktopKernelTurnState` 新增字段

```python
@dataclass(slots=True)
class DesktopKernelTurnState:
    assistant_name: str
    text_parts: list[str] = field(default_factory=list)
    terminal_kind: str | None = None
    terminal_payload: dict[str, Any] = field(default_factory=dict)
    citation_candidates: list[dict[str, Any]] = field(default_factory=list)
    grounded: bool = False
    # ── 新增: 子代理 ID → 名称映射 ──
    subagent_names: dict[str, str] = field(default_factory=dict)
    # ── 新增: delegate 调用 ID 跟踪 ──
    delegate_call_counter: int = 0
```

#### 1b. `translate_kernel_event()` 新增 `subagent.*` 事件处理

在 `run.completed`/`run.cancelled`/`run.failed` 判断之后、catch-all 之前，插入：

```python
# ── 子代理事件翻译 ─────────────────────────────────────────────────
if kind == "subagent.started":
    subagent_id = str(payload.get("subagent_id") or "")
    agent_name = str(payload.get("agent_name") or subagent_id)
    title = str(payload.get("title") or "")
    if subagent_id:
        state.subagent_names[subagent_id] = agent_name
    state.delegate_call_counter += 1
    call_id = f"delegate:{subagent_id or state.delegate_call_counter}"
    return (ToolCallRequestEvent(
        content=[FunctionCall(
            id=call_id,
            name="delegate",
            arguments=json.dumps(
                {"subagent_id": subagent_id, "agent": agent_name, "task": title},
                ensure_ascii=False,
            ),
        )],
        source=state.assistant_name,
    ),)

if kind == "subagent.thinking":
    subagent_id = str(payload.get("subagent_id") or "")
    text = str(payload.get("text") or "")
    if not text:
        return ()
    agent_name = state.subagent_names.get(subagent_id, subagent_id)
    sub_source = f"sub:{agent_name}"
    return (ModelClientStreamingChunkEvent(content=text, source=sub_source),)

if kind == "subagent.completed":
    subagent_id = str(payload.get("subagent_id") or "")
    summary = str(payload.get("summary") or payload.get("result") or "")
    agent_name = str(
        payload.get("agent_name")
        or state.subagent_names.get(subagent_id, subagent_id)
    )
    sub_source = f"sub:{agent_name}"
    call_id = f"delegate:{subagent_id}"
    events: list[BaseAgentEvent | BaseChatMessage] = [
        TextMessage(content=summary, source=sub_source),
    ]
    # 同步发出 ToolCallExecutionEvent 让 delegate 工具调用闭环
    events.append(ToolCallExecutionEvent(
        content=[FunctionExecutionResult(
            content=json.dumps({"result": summary}, ensure_ascii=False),
            name="delegate",
            call_id=call_id,
            is_error=False,
        )],
        source=state.assistant_name,
    ))
    return tuple(events)
```

#### 修复后事件流转

```
subagent.started
  → ToolCallRequestEvent(delegate, source=parent_agent)
  → event_translator: tool.start (活动面板显示 delegate 工具开始)

subagent.thinking (多次)
  → ModelClientStreamingChunkEvent(content=delta, source="sub:agent_name")
  → event_translator: _is_subagent_source("sub:agent_name") = True
  → ("subagent.thinking", {"text": delta, "source": "sub:agent_name"})
  → projector._subtask(): part.started (首次) + part.delta (后续)

subagent.completed
  → TextMessage(content=summary, source="sub:agent_name")
  → event_translator: _is_subagent_source("sub:agent_name") = True
  → ("subagent.complete", {"text": summary, "source": "sub:agent_name"})
  → projector._subtask(): part.completed
  +
  → ToolCallExecutionEvent(delegate, source=parent_agent)
  → event_translator: tool.complete (活动面板显示 delegate 工具完成)
```

---

### 修改 2: `event_translator.py` — TextMessage 跳过逻辑修复

**文件**: `cores/python/packages/drsai/src/drsai/backend/tui_gateway/adapter/event_translator.py`

#### 问题

当前代码：
```python
# Skip if we've already streamed this turn's visible content
if state.streamed_visible and (
    not state.streamed_sources or source in state.streamed_sources
):
    return out  # ← 子代理的 TextMessage 在这里被跳过!

# Subagent final text
text = getattr(message, "content", "") or ""
if _is_subagent_source(source):
    out.append(("subagent.complete", {"text": text, "source": source}))
    return out
```

当父代理已经流式输出了内容（`streamed_visible=True`），且子代理的 source "sub:agent_name" 已被 `ModelClientStreamingChunkEvent` 添加到 `streamed_sources` 中时，`TextMessage` 会被跳过，导致 `subagent.complete` 事件永远不会发出。

#### 修复

将子代理检查移到跳过逻辑之前：

```python
# ── 子代理最终文本 (必须在跳过逻辑之前检查) ──
text = getattr(message, "content", "") or ""
if _is_subagent_source(source):
    out.append(("subagent.complete", {"text": text, "source": source}))
    return out

# Skip if we've already streamed this turn's visible content — the
# final TextMessage is just a duplicate from the assistant.
if state.streamed_visible and (
    not state.streamed_sources or source in state.streamed_sources
):
    return out
```

---

### 修改 3: `conversation.py` — 流式文本累积

**文件**: `cores/python/packages/drsai/src/drsai/backend/runtime/conversation.py`

#### 问题

`_subtask()` 方法中，`subagent.thinking` 事件的 delta 每次发送 `delta.summary = summary`（单个 chunk 文本），前端 reducer 用 `delta.summary` 覆盖 `part.summary`，导致用户只能看到最后一个 chunk，而非累积的完整思考流。

#### 修复

在 `_subtask()` 中累积流式文本：

```python
def _subtask(self, event_type: str, payload: dict[str, Any], source: str) -> list[dict[str, Any]]:
    source_id = re.sub(r"[^a-zA-Z0-9_.:-]+", "-", source).strip("-") or "subtask"
    part_id = f"{self.turn_id}:subtask:{source_id}"
    part = self.parts.get(part_id)
    events: list[dict[str, Any]] = []
    if part is None:
        part = {
            "id": part_id,
            "kind": "subtask",
            "status": "running",
            "taskId": source_id,
            "title": str(payload.get("title") or source.replace("sub:", "") or "Subtask"),
            "agentName": source.replace("sub:", ""),
        }
        self.parts[part_id] = part
        events.append(self._event("part.started", source, part=dict(part)))
    summary = str(payload.get("text") or payload.get("summary") or "")
    if event_type == "subagent.complete":
        part["summary"] = summary
        part["status"] = "completed"
        events.append(self._event("part.completed", source, part=dict(part)))
    else:
        # ── 修复: 累积流式文本而非覆盖 ──
        current = str(part.get("summary") or "")
        part["summary"] = f"{current}{summary}" if current else summary
        events.append(self._event(
            "part.delta", source, partId=part_id,
            delta={"kind": "subtask.update", "summary": part["summary"], "status": "running"},
        ))
    return events
```

---

### 修改 4: `desktop_oaep_bridge.py` — OAEP 桥接补全 (可选)

**文件**: `cores/python/packages/drsai/src/drsai/backend/runtime/desktop_oaep_bridge.py`

在 `_normalize()` 方法中添加 `subagent.*` 事件类型的标准化映射，确保 OAEP 日志也能正确记录子代理活动。

```python
def _normalize(self, event_type: str, payload: dict) -> tuple[str, dict]:
    mapping = {
        "message.delta": "agent.message.delta",
        "tool.start": "tool.started",
        "tool.complete": "tool.completed",
        # ── 新增 ──
        "subagent.thinking": "subagent.thinking",
        "subagent.complete": "subagent.completed",
    }
    # ...
```

---

### 修改 5: 前端渲染增强

#### 5a. `structuredConversation.ts` — SubtaskPart 类型扩展

**文件**: `apps/desktop/shared/api/structuredConversation.ts`

```typescript
export interface SubtaskPart extends StructuredPartBase {
  kind: "subtask";
  taskId: string;
  title: string;
  agentName?: string;
  summary?: string;
  // ── 新增 ──
  thinkingText?: string;  // 累积的思考流文本
  result?: string;        // 子代理最终结果
}
```

同时更新 `subtask.update` delta 类型：
```typescript
| { kind: "subtask.update"; summary: string; status?: StructuredPartStatus }
```
（不变，但 reducer 逻辑需要同步更新 — 见 5b）

#### 5b. `structuredConversation.ts` — reducer 更新

在 `applyPartDelta()` 函数中：

```typescript
if (part.kind === "subtask" && delta.kind === "subtask.update") {
  return {
    ...part,
    summary: delta.summary,  // 累积后的完整文本
    thinkingText: delta.summary,  // 别名，用于渲染
    status: delta.status ?? "running",
  };
}
```

#### 5c. `StructuredMessageParts.tsx` — 渲染增强

**文件**: `apps/desktop/shared/renderer/src/components/StructuredMessageParts.tsx`

当前渲染（L260）：
```tsx
if (part.kind === "subtask")
  return <div className={`structured-subtask ${part.status}`} key={part.id}>
    <ListChecks size={14} aria-hidden="true" />
    <span><strong>{part.title}</strong>{part.summary ? ` · ${part.summary}` : ""}</span>
  </div>;
```

增强渲染：
```tsx
if (part.kind === "subtask") {
  const isRunning = part.status === "running";
  const isCompleted = part.status === "completed";
  return (
    <div className={`structured-subtask structured-subtask--${part.status}`} key={part.id}>
      <div className="structured-subtask__header">
        {isRunning && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
        {isCompleted && <CheckCircle2 size={14} aria-hidden="true" />}
        <ListChecks size={14} aria-hidden="true" />
        <strong className="structured-subtask__title">{part.title}</strong>
        {part.agentName && (
          <span className="structured-subtask__agent">{part.agentName}</span>
        )}
      </div>
      {(part.summary || part.thinkingText) && (
        <div className={`structured-subtask__body ${isRunning ? "streaming" : ""}`}>
          <MarkdownRenderer content={part.summary || part.thinkingText || ""} />
        </div>
      )}
    </div>
  );
}
```

---

## 三、修复后完整事件流转

```
engine.py
  │  subagent.started {subagent_id, title, agent_name, ...}
  │  subagent.thinking {subagent_id, text=delta}  (多次)
  │  subagent.completed {subagent_id, summary, result, agent_name}
  ▼
desktop_kernel_events.py (translate_kernel_event)  ✅ 修复1
  │  subagent.started → ToolCallRequestEvent(delegate, source=parent)
  │  subagent.thinking → ModelClientStreamingChunkEvent(source="sub:agent")
  │  subagent.completed → TextMessage(source="sub:agent") + ToolCallExecutionEvent(delegate)
  ▼
event_translator.py (translate)  ✅ 修复2
  │  ToolCallRequestEvent → tool.start {name=delegate, args={...}}
  │  ModelClientStreamingChunkEvent + "sub:" → subagent.thinking {text, source}
  │  TextMessage + "sub:" → subagent.complete {text, source}
  │  ToolCallExecutionEvent → tool.complete {name=delegate, result=...}
  ▼
conversation.py (StructuredConversationProjector)  ✅ 修复3
  │  tool.start → activity.updated (delegate 工具开始)
  │  subagent.thinking → _subtask() → part.started + part.delta (累积文本)
  │  subagent.complete → _subtask() → part.completed
  │  tool.complete → activity.updated (delegate 工具完成)
  ▼
sseParser.ts → structuredConversation.ts  ✅ 修复5a/5b
  │  part.started → 创建 SubtaskPart
  │  part.delta (subtask.update) → 更新 summary (累积)
  │  part.completed → 标记完成
  ▼
StructuredMessageParts.tsx  ✅ 修复5c
  │  渲染: 图标 + 标题 + 代理名称 + 流式思考文本 + 完成状态
  │  用户看到: 子代理正在运行 ✅
```

---

## 四、实施顺序

| 步骤 | 修改 | 文件 | 优先级 | 风险 |
|------|------|------|--------|------|
| 1 | 修复1b: translate_kernel_event subagent.* | desktop_kernel_events.py | P0 | 低 |
| 2 | 修复1a: DesktopKernelTurnState 新增字段 | desktop_kernel_events.py | P0 | 低 |
| 3 | 修复2: TextMessage 跳过逻辑 | event_translator.py | P0 | 低 |
| 4 | 修复3: _subtask 流式累积 | conversation.py | P1 | 低 |
| 5 | 修复5c: 前端渲染增强 | StructuredMessageParts.tsx | P1 | 低 |
| 6 | 修复5a/5b: 前端类型+reducer | structuredConversation.ts | P1 | 低 |
| 7 | 修复4: OAEP 桥接补全 | desktop_oaep_bridge.py | P2 | 极低 |

步骤 1-3 是核心修复，完成后子代理内容即可在前端显示。
步骤 4-6 是体验增强，让流式显示更流畅。
步骤 7 是可选的日志补全。

---

## 五、测试验证

### 测试场景

1. **单子代理**: 主代理调用 delegate 工具，委派一个子代理执行任务
   - 验证: 活动面板显示 delegate 工具开始/完成
   - 验证: SubtaskPart 显示子代理名称、标题、流式思考文本
   - 验证: 子代理完成后 SubtaskPart 状态变为 completed

2. **多子代理**: 主代理同时委派多个子代理
   - 验证: 每个子代理有独立的 SubtaskPart
   - 验证: 流式文本不串扰

3. **子代理后继续输出**: 子代理完成后，主代理继续输出文本
   - 验证: 主代理的 message.delta 正常显示
   - 验证: SubtaskPart 保持 completed 状态

4. **子代理失败**: 子代理执行出错
   - 验证: SubtaskPart 状态变为 error
   - 验证: 错误信息显示

### 回归检查

- [ ] 普通工具调用（非 delegate）不受影响
- [ ] 流式文本输出不受影响
- [ ] 知识库引用不受影响
- [ ] 活动面板不受影响
- [ ] TUI 前端不受影响（共用 event_translator.py）
