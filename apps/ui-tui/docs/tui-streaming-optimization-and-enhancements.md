# DrSai TUI 流式渲染优化与功能增强

> **文档版本**: 2026-01-10  
> **涉及模块**: `apps/ui-tui` (前端) + `cores/python/packages/drsai/src/drsai/backend/tui_gateway` (后端)  
> **状态**: 全部已实施，tsc + build + backend tests 通过

---

## 目录

1. [流式渲染崩溃修复 (P0 + P1)](#1-流式渲染崩溃修复-p0--p1)
2. [P2 方案分析（未实施）](#2-p2-方案分析未实施)
3. [动态输入框（上下界约束 + 软换行 + 滚动窗口）](#3-动态输入框上下界约束--软换行--滚动窗口)
4. [实时 Token 消耗显示](#4-实时-token-消耗显示)
5. [操作工具渲染增强](#5-操作工具渲染增强)
6. [文件变更总览](#6-文件变更总览)

---

## 1. 流式渲染崩溃修复 (P0 + P1)

### 1.1 问题现象

TUI 在长时间流式输出后崩溃退出。表现：
- 终端被清屏，用户失去滚动位置
- `<Static>` 历史内容被重复输出数十次
- 内存持续增长直至 OOM
- `eraseLines()` 擦除错误行数，底部出现累积空白行

### 1.2 根因分析（6 层）

| # | 根因 | 触发条件 | 后果 |
|---|------|----------|------|
| **P0-1** | Ink 的 `fullStaticOutput` 无限增长 | 每完成一轮对话，`<Static>` 累积全部已完成轮次输出 | 堆内存耗尽 → 崩溃 |
| **P0-2** | 动态帧高度 ≥ 终端行数 | 流式内容 + StatusBar + Composer 总高度 ≥ `stdout.rows` | 触发 Ink 全屏分支 (`clearTerminal + fullStaticOutput + output`) |
| **P0-3** | reasoning 文本 O(n²) 拼接 | 每次 `thinking.delta` 执行 `reasoning += chunk` | 长 reasoning 轮次中 CPU 飙升、渲染卡顿 |
| **P1-4** | `contentParts` 数组无限增长 | 每个文本段 + 工具调用都是独立 part | 一轮 50+ 工具调用时内存暴涨 |
| **P1-5** | `clipContentParts()` O(N) 全量扫描 | 每次渲染遍历所有 contentParts | 渲染延迟随 part 数量线性增长 |
| **P1-6** | 旧轮次内存未回收 | `$transcript` 保留全部历史文本 + 工具结果 | 长会话堆持续增长 |
| **P1-7** | finalize 后 chunk 未释放 | `chunks[]` 和 `reasoningChunks[]` 在轮次结束后仍占用内存 | 已提交的轮次仍占堆 |

### 1.3 P0 修复（3 项）

#### P0-1: 清除 `fullStaticOutput`

**文件**: `app/inkInstanceRef.ts`, `app/turnController.ts`

新增 `clearInkFullStaticOutput()` 函数，在 `finalize()` 中调用：

```typescript
// inkInstanceRef.ts
export function clearInkFullStaticOutput(): void {
  const inst = _instance
  if (!inst) return
  try {
    inst.fullStaticOutput = ''
  } catch { /* best-effort */ }
}

// turnController.ts — finalize()
cancelPendingInkThrottles()
resetInkLastOutputHeight()
clearInkFullStaticOutput()   // ← 清除已提交轮次的内存副本
```

已完成轮次已经写入终端 scrollback，`fullStaticOutput` 是冗余的内存副本，清除后不影响显示。

#### P0-2: 动态帧高度上限

**文件**: `components/streamingAssistant.tsx`

```typescript
const MAX_FRAME_FRACTION = 0.55  // 流式内容区不超过终端行数的 55%

const maxBudget = Math.floor(effectiveRows * MAX_FRAME_FRACTION)
const budget = Math.max(MIN_STREAM_ROWS, Math.min(rawBudget, maxBudget))
```

24 行终端 → 最大 ~13 行流式内容，剩余 11 行留给 StatusBar + Composer + margin。  
即使 `RESERVED_ROWS` 估算偏低，55% 硬上限也能防止全屏分支触发。

#### P0-3: reasoning chunk 化

**文件**: `app/types.ts`, `app/createGatewayEventHandler.ts`

```typescript
// types.ts — TextContentPart & AssistantTurn
reasoningChunks: string[]  // 增量段（O(1) push）

export function getReasoningText(turn: AssistantTurn): string {
  if (turn.reasoningChunks.length > 0 && !turn.reasoning) {
    turn.reasoning = turn.reasoningChunks.join('')  // 懒连接
  }
  return turn.reasoning
}

// createGatewayEventHandler.ts — thinking.delta handler
case 'thinking.delta':
  updateCurrent(c => ({
    ...c,
    reasoningChunks: [...c.reasoningChunks, r],  // O(1) push
  }))
```

每次 flush 只 push（O(1)），连接只在渲染时发生一次（O(n) 总计），消除 O(n²)。

### 1.4 P1 修复（4 项）

#### P1-4: contentParts 压缩

**文件**: `app/createGatewayEventHandler.ts`

```typescript
const MAX_CONTENT_PARTS = 50  // 超过时合并旧文本段

// 在 message.delta handler 中
if (parts.length > MAX_CONTENT_PARTS) {
  const keepFromIdx = parts.length - (MAX_CONTENT_PARTS - 1)
  const toMerge = parts.slice(0, keepFromIdx).filter(p => p.kind === 'text')
  const merged: TextContentPart = { kind: 'text', id: 'merged', chunks: [], text: toMerge.map(...).join('') }
  parts = [merged, ...parts.slice(keepFromIdx)]
}
```

当 contentParts 超过 50 个时，将最旧的文本段合并为一个，保持数组长度有界。

#### P1-5: clipContentParts 扫描限制

**文件**: `components/streamingAssistant.tsx`

```typescript
const MAX_SCAN_PARTS = 20  // 只扫描最后 20 个 part

function clipContentParts(parts, tools, budget, cols, toolDetail) {
  const scanStart = Math.max(0, parts.length - MAX_SCAN_PARTS)
  const scanParts = parts.slice(scanStart)  // 只估算最后 20 个
  // ...
}
```

每次 flush 的 height estimation 成本从 O(全部 parts) 降为 O(20)。

#### P1-6: 旧轮次截断

**文件**: `app/turnStore.ts`

```typescript
const KEEP_FULL_TURNS = 10       // 保留最近 10 轮完整内容
const MAX_TRUNCATED_TEXT = 200   // 旧轮次文本截断为 200 字符
const MAX_TRUNCATED_TOOL = 200   // 旧轮次工具结果截断为 200 字符
const HARD_CAP_TURNS = 5000      // 硬上限：超过 5000 轮清空

function truncateTurn(turn: AssistantTurn): AssistantTurn {
  return {
    ...turn,
    text: truncateText(turn.text, MAX_TRUNCATED_TEXT),
    reasoningChunks: [],  // 清除 chunk 释放内存
    reasoning: truncateText(turn.reasoning, MAX_TRUNCATED_TEXT),
    contentParts: turn.contentParts.map(p => 
      p.kind === 'text' ? { ...p, text: truncateText(getPartText(p), MAX_TRUNCATED_TEXT), chunks: [] } : p
    ),
    tools: turn.tools.map(t => ({ ...t, result: t.result ? truncateText(t.result, MAX_TRUNCATED_TOOL) : t.result })),
  }
}
```

#### P1-7: finalize 后释放 chunk

**文件**: `app/createGatewayEventHandler.ts`, `app/turnController.ts`

```typescript
// createGatewayEventHandler.ts — message.complete handler
if (t.reasoningChunks.length > 0 && !fullReasoning) {
  fullReasoning = t.reasoningChunks.join('')
}
updateCurrent(c => ({
  ...c,
  reasoning: fullReasoning,
  reasoningChunks: [],  // 释放 chunk 数组
  status: 'complete',
  // ...
}))

// turnController.ts — finalize()
// 清除所有已提交文本 part 的 chunks
for (const part of turn.contentParts) {
  if (part.kind === 'text' && part.chunks.length > 0) {
    part.chunks = []  // text 已 join 到 part.text，chunk 可释放
  }
}
```

### 1.5 内存常量表

| 常量 | 值 | 作用 | 文件 |
|------|----|------|------|
| `MAX_FRAME_FRACTION` | 0.55 | 流式帧不超过终端 55% | streamingAssistant.ts |
| `MAX_CONTENT_PARTS` | 50 | contentParts 数组合并阈值 | createGatewayEventHandler.ts |
| `MAX_SCAN_PARTS` | 20 | clipContentParts 扫描上限 | streamingAssistant.ts |
| `KEEP_FULL_TURNS` | 10 | 完整保留的最近轮次数 | turnStore.ts |
| `MAX_TRUNCATED_TEXT` | 200 | 旧轮次文本截断长度 | turnStore.ts |
| `MAX_TRUNCATED_TOOL` | 200 | 旧轮次工具结果截断长度 | turnStore.ts |
| `HARD_CAP_TURNS` | 5000 | 轮次硬上限 | turnStore.ts |
| `MAX_TOOL_RESULT_CHARS` | 5000 | 工具结果内存上限 | types.ts |

所有常量均可通过环境变量覆盖（如 `DRSAI_TUI_MAX_PARTS=100`）。

---

## 2. P2 方案分析（未实施）

### P2-8: 移除 `<Static>`，全部动态渲染

**结论: 不推荐实施**

`<Static>` 是 Ink 的 append-only 机制，已完成轮次一次写入后不再重绘。移除后：
- 每次渲染需要重绘全部历史 → CPU 随轮次数线性增长
- `eraseLines()` 覆盖范围扩大 → 更容易触发全屏分支
- 终端原生 scrollback 与 Ink 的动态渲染冲突

### P2-10: 移除 `MAX_FRAME_FRACTION` 上限

**结论: 不推荐实施**

移除 55% 上限后，流式内容区可以占用更多终端行，但：
- 在小窗口终端（如 tmux 分屏）中，流式内容 + StatusBar + Composer 容易 ≥ 终端行数
- 一旦触发全屏分支，所有 P0 修复失效

### P2-9: 动态调整 `MAX_FRAME_FRACTION`

**结论: 可选**

根据终端大小动态调整：小终端用 0.55，大终端可用 0.7。未实施，当前 0.55 已满足需求。

---

## 3. 动态输入框（上下界约束 + 软换行 + 滚动窗口）

### 3.1 问题

原输入框：
- 只有上边界（`─` 分割线），底部开放
- 高度固定，不随终端大小变化
- 长行不软换行，超出终端宽度后不可见
- 无滚动支持，无限增长会触发 P0 崩溃

### 3.2 架构设计

```
┌─────────────────────────────────┐
│  › first line of input          │  ← TextInput 组件
│    continuation line            │     (软换行 + 滚动窗口)
├─────────────────────────────────┤  ← 底部分割线（闭合输入区）
│ ● assistant                     │
│   streaming content...          │  ← StreamingAssistant
│                                 │     (budget = rows - reservedRows)
├─────────────────────────────────┤
│ ● status bar                    │  ← StatusBar
└─────────────────────────────────┘
```

### 3.3 关键组件

#### `textInput.tsx` — 多行输入 + 软换行 + 滚动

```
softWrap(line, maxCols) → string[]
  将逻辑行按 contentCols 宽度软换行为多个视觉行

buildVisualLines(allLines, cursorLine, cursorCol, contentCols) → VisualLine[]
  将逻辑行转换为视觉行，标记光标位置

contentCols = max(10, cols - 2 - prompt.length)
  cols = 终端宽度, 2 = AppLayout paddingX×2, prompt = " › " (3字符)
```

滚动窗口逻辑：
```typescript
const effectiveMaxRows = maxRows && maxRows > 0 ? maxRows : totalVisualLines
const needsScroll = totalVisualLines > effectiveMaxRows + 1  // 允许 1 行溢出

// 光标居中的滚动窗口
scrollStart = max(0, min(
  cursorVisualIdx - floor(effectiveMaxRows / 2),
  totalVisualLines - effectiveMaxRows,
))

const hiddenAbove = needsScroll ? scrollStart : 0
const hiddenBelow = needsScroll ? totalVisualLines - scrollStart - effectiveMaxRows : 0

// 高度上报：按需预留箭头行（不浪费空间）
const reportedHeight = showPlaceholder ? 1
  : needsScroll
    ? effectiveMaxRows + (hiddenAbove > 0 ? 1 : 0) + (hiddenBelow > 0 ? 1 : 0)
    : max(1, totalVisualLines)
```

渲染效果：
```
  ↑ 3 earlier lines         ← 隐藏行标记（有隐藏时才显示）
  › visible line 1
    visible line 2          ← 滚动窗口（effectiveMaxRows 行）
  ↓ 2 more lines            ← 隐藏行标记
```

#### `composerPane.tsx` — 输入框容器

```typescript
const { cols, rows } = useTerminalSize()
const dividerWidth = Math.max(20, cols - 2)           // 动态分割线宽度
const inputMaxRows = Math.max(5, Math.min(Math.floor(rows * 0.4), 15))  // 40% 上限

// 传给 TextInput
<TextInput
  prompt=" › "
  maxRows={inputMaxRows}
  cols={cols}
  onHeightChange={handleInputHeightChange}
  // ...
/>
// 底部分割线
<Box><Text color={theme.border}>{'─'.repeat(dividerWidth)}</Text></Box>
```

`inputMaxRows` 对照表：

| 终端行数 | 旧值 (25%, cap 12) | 新值 (40%, floor 5, cap 15) |
|---------|-------------------|----------------------------|
| 8       | 2                 | **5**                      |
| 10      | 2                 | **5**                      |
| 24      | 6                 | **9**                      |
| 40      | 10                | **15**                     |
| 50+     | 12                | **15**                     |

#### `uiStore.ts` — `$composerInputHeight` 全局原子

```typescript
export const $composerInputHeight = atom<number>(1)
// TextInput 通过 onHeightChange 上报当前高度
// StreamingAssistant 订阅此原子，动态调整 RESERVED_ROWS
```

#### `streamingAssistant.tsx` — 动态 RESERVED_ROWS

```typescript
const RESERVED_BASE_ROWS = 6  // marginTop(1) + divider(1) + StatusBar(3) + safety(1)
const reservedRows = composerInputHeight + RESERVED_BASE_ROWS
// 输入框增长 → reservedRows 增长 → 流式 budget 缩小 → 总帧 < rows
```

### 3.4 滚动箭头过早出现的修复

**问题**: 用户反馈"超过两行自动跳新的箭头行"

**根因**（3 层叠加）：
1. `inputMaxRows = 25%` 太小 → 24 行终端只有 6 行，小终端只有 2 行
2. `needsScroll = totalVisualLines > effectiveMaxRows` → 刚超出 1 行就切换到滚动模式
3. `reportedHeight = effectiveMaxRows + 2` → 即使只有 1 个箭头也预留 2 行，浪费 1 行

**修复**（3 处改动）：
1. `inputMaxRows` 从 25% 提升到 40%，下限 5，上限 15
2. `needsScroll` 阈值从 `> effectiveMaxRows` 改为 `> effectiveMaxRows + 1`，允许 1 行溢出
3. `reportedHeight` 按需预留：`effectiveMaxRows + (hiddenAbove > 0 ? 1 : 0) + (hiddenBelow > 0 ? 1 : 0)`

**效果**: 输入框自然增长到 `maxRows + 1` 行后才进入滚动模式，切换时高度无跳变（箭头行恰好替代溢出行的高度）。

---

## 4. 实时 Token 消耗显示

### 4.1 问题

原方案：每轮结束后才在 StatusBar 显示 token 消耗（`message.complete` 事件中的 `usage`）。  
长轮次中用户无法知道当前已消耗多少 token。

### 4.2 全链路追踪

```
后端 LLM 调用                    前端 TUI
─────────────────────────────────────────────────────────────────
drsai_assistant.py:1602
  streaming loop:
    yield ModelClientStreamingChunkEvent (str, 无 usage)
    yield CreateResult (有 .usage)         ─┐
                                             │
LLMClient.py:331                              │ stream_options:
  create_stream()                             │   include_usage: True
  → 最终 chunk 有 usage                       │
  → 其余 chunk usage = None                  │
                                             │
drsaiagent.py:1737                           │
  call_llm():                                │
    extra_create_args = {                    │
      "stream_options": {                    │
        "include_usage": True  ──────────────┘
      }
    }
    yield ModelClientStreamingChunkEvent (str)
    yield CreateResult (有 .usage)
                                             │
event_translator.py                          │
  _capture_usage(message, state):           │
    → TurnState 累积 prompt_tokens_total     │
    → TurnState 累积 completion_tokens_total │
    → id() 去重防双计                         │
                                             │
  Response 分支:                              │
    emit ("usage.update", payload)  ─────────┐
  TextMessage 分支:                           │
    emit ("usage.update", payload)  ─────────┤
                                             │
                                     gatewayTypes.ts
                                     UsagePayload {
                                       prompt_tokens
                                       completion_tokens
                                       prompt_tokens_total?
                                       completion_tokens_total?
                                       total_tokens_accumulated?
                                       status: 'streaming' | 'complete'
                                     }
                                     GatewayEvent |= usage.update
                                             │
                                     createGatewayEventHandler.ts
                                     message.start:
                                       streamingCharCount = 0
                                       $streamingTokenEstimate.set(0)
                                     message.delta:
                                       streamingCharCount += text.length
                                       est = ceil(charCount / 4)
                                       $streamingTokenEstimate.set(est)
                                     usage.update:
                                       $lastUsage 更新累积值
                                       $streamingTokenEstimate 清零
                                     message.complete:
                                       $lastUsage 最终更新
                                       $streamingTokenEstimate 清零
                                             │
                                     statusBar.tsx
                                     三种显示模式:
                                       1. streaming + estimate:
                                          ~N tokens (est.) · Σ total
                                       2. streaming + real usage:
                                          prompt↑ completion↓ · Σ total
                                       3. not streaming:
                                          prompt↑ completion↓ = total · Σ total
```

### 4.3 后端改动

**文件**: `backend/tui_gateway/adapter/event_translator.py`

```python
@dataclass
class TurnState:
    # ... 已有字段 ...
    prompt_tokens_total: int = 0       # 跨多次 LLM 调用累积
    completion_tokens_total: int = 0   # 跨多次 LLM 调用累积
    _captured_ids: set[int] = field(default_factory=set)  # id() 去重

    def usage_payload(self, status: str = "complete") -> dict:
        return {
            # ... prompt_tokens, completion_tokens, model ...
            "prompt_tokens_total": self.prompt_tokens_total,
            "completion_tokens_total": self.completion_tokens_total,
            "total_tokens_accumulated": self.prompt_tokens_total + self.completion_tokens_total,
            "status": status,
        }

def _capture_usage(message: Any, state: TurnState) -> bool:
    msg_id = id(message)
    if msg_id in state._captured_ids:
        return False  # 已捕获，跳过
    state._captured_ids.add(msg_id)
    # ... 提取 usage 并累积到 _total 字段 ...
    return True

# Response 分支：
captured = _capture_usage(message, state)
if captured:
    out.append(("usage.update", state.usage_payload("streaming")))

# TextMessage 分支：
captured = _capture_usage(message, state)
if captured:
    out.append(("usage.update", state.usage_payload("streaming")))
```

### 4.4 前端改动

**`gatewayTypes.ts`** — 扩展 UsagePayload + 新增事件类型：

```typescript
export interface UsagePayload {
  // ... 已有字段 ...
  prompt_tokens_total?: number
  completion_tokens_total?: number
  total_tokens_accumulated?: number
  status?: 'streaming' | 'complete' | 'error'
}

export type GatewayEvent =
  // ... 已有事件 ...
  | (BaseEvent & { type: 'usage.update'; payload: UsagePayload })
```

**`uiStore.ts`** — 新增流式估算原子：

```typescript
export const $streamingTokenEstimate = atom<number>(0)
// message.delta 时按字符数估算 (~4 chars/token)
// usage.update 到达后清零（真实数据替代估算）
```

**`createGatewayEventHandler.ts`** — 处理新事件：

```typescript
let streamingCharCount = 0  // 闭包变量，跨 delta 累积

case 'message.start':
  streamingCharCount = 0
  $streamingTokenEstimate.set(0)
  break

case 'message.delta':
  streamingCharCount += text.length
  const est = Math.ceil(streamingCharCount / 4)  // ~4 chars/token
  if (est !== $streamingTokenEstimate.get()) {
    $streamingTokenEstimate.set(est)
  }
  break

case 'usage.update':
  // 更新 $lastUsage 的累积字段
  // 清除估算
  streamingCharCount = 0
  $streamingTokenEstimate.set(0)
  break

case 'message.complete':
  // 最终更新 $lastUsage
  streamingCharCount = 0
  $streamingTokenEstimate.set(0)
  break
```

**`statusBar.tsx`** — 三模式显示：

```tsx
// 模式 1: 流式中 + 仅估算（无 usage.update）
//   ~42 tokens (est.) · Σ 1.5k
isStreaming && streamingEstimate > 0 && !hasRealUsage
  → ~${estimate} tokens (est.) · Σ ${total}

// 模式 2: 流式中 + 有真实 usage（usage.update 已到达）
//   prompt↑ 1.2k completion↓ 300 · Σ 1.5k
isStreaming && hasRealUsage
  → prompt↑ ${pt} completion↓ ${ct} · Σ ${total}

// 模式 3: 非流式（轮次结束后）
//   prompt↑ 1.2k completion↓ 300 = 1.5k · Σ 3.2k
!isStreaming
  → prompt↑ ${pt} completion↓ ${ct} = ${total} · Σ ${accumulated}
```

---

## 5. 操作工具渲染增强

### 5.1 问题

原 `ToolCallLine.tsx` 对所有工具一视同仁：
```
✓ run_read path=src/foo.ts (12ms) → const foo = bar();
✓ run_edit path=src/foo.ts old_text=function foo() { (8ms) → Edited src/foo.ts
✓ run_bash cmd=ls -la (123ms) → total 48
```

问题：
- 工具名是 Python 函数名，不直观
- 第一个参数不总是最重要的（`run_edit` 应显示 path，不是 old_text）
- 结果预览不解析语义（`run_write` 应显示字节数，不是内容第一行）
- `run_edit` 不显示增加删减的内容

### 5.2 设计方案

为 `get_operator_funcs()` 返回的每个操作工具提供定制化渲染：

| 工具 | 图标 | 标签 | 关键参数 | 结果摘要 |
|------|------|------|----------|----------|
| `run_read` | 📖 | read | path | N lines |
| `run_write` | ✎ | write | path | N bytes / N KB |
| `run_edit` | ✎ | edit | path | edited / ✗ not found |
| `run_grep` | 🔍 | grep | "pattern" @ path | N files / N matches |
| `run_glob` | 📂 | glob | pattern | N files |
| `run_bash` | $ | bash | cmd (70字符) | exit code / timeout / error |
| `run_bash_background` | ⚡ | bg | cmd (70字符) | task ID |
| `get_bash_task` | ⏱ | task | task_id | status |
| `list_bash_tasks` | ☰ | tasks | — | N tasks |
| `kill_bash_task` | ☠ | kill | task_id [--force] | killed / failed |

图标颜色编码状态：绿 = 完成，橙 = 运行中，红 = 错误

### 5.3 实现结构

```
ToolCallLine (入口)
  ├─ isTodoWriteTool? → TodoWriteLine (checklist)
  ├─ isOperatorTool? → OperatorToolLine (本节)  ← 新增
  └─ otherwise → 通用渲染 (compact/expanded)
```

### 5.4 新文件: `operatorToolLine.tsx`

**路径**: `apps/ui-tui/src/components/operatorToolLine.tsx`

#### 核心接口

```typescript
interface ToolMeta {
  icon: string   // 工具图标
  label: string  // 人类可读标签
}

const TOOL_META: Record<string, ToolMeta> = {
  run_read:             { icon: '📖', label: 'read' },
  run_write:            { icon: '✎',  label: 'write' },
  run_edit:             { icon: '✎',  label: 'edit' },
  run_grep:             { icon: '🔍', label: 'grep' },
  run_glob:             { icon: '📂', label: 'glob' },
  run_bash:             { icon: '$',  label: 'bash' },
  run_bash_background:  { icon: '⚡', label: 'bg'   },
  get_bash_task:        { icon: '⏱',  label: 'task' },
  list_bash_tasks:      { icon: '☰',  label: 'tasks' },
  kill_bash_task:       { icon: '☠',  label: 'kill' },
  // PowerShell 对应项...
}

export function isOperatorTool(tool: ToolCall): boolean {
  return tool.name in TOOL_META
}
```

#### Compact 模式渲染示例

```
📖 read src/foo.ts (12ms) → 150 lines
✎ write src/foo.ts (5ms) → 1.2KB
✎ edit src/foo.ts (8ms) → edited
🔍 grep "foo" @ src/ (45ms) → 3 files
📂 glob **/*.py (10ms) → 12 files
$ bash ls -la (123ms) → total 48
⚡ bg npm run build → task abc123
⏱ task abc123 → running
☰ tasks → 3 tasks
☠ kill abc123 → killed
```

#### Expanded 模式 — `run_edit` 差异渲染（增加删减）

用户特别要求的核心功能：对 `run_edit` 显示 old_text → new_text 的行级差异。

```typescript
function lineDiff(oldText: string, newText: string): DiffLine[] {
  // LCS (最长公共子序列) 算法，行级差异
  // 返回: [{ text, type: 'added' | 'removed' | 'context' }]
}
```

渲染效果：
```
✎ edit src/foo.ts (8ms)
  path: src/foo.ts
  − function foo() {                    ← 红色，删除行
  + function bar() {                    ← 绿色，新增行
  −   return 1;                         ← 红色，删除行
  +   return 2;                         ← 绿色，新增行
    }                                   ← 灰色，上下文行
```

差异优化：
- 纯新增（old_text 为空）→ 全部 `+` 绿色行
- 纯删除（new_text 为空）→ 全部 `−` 红色行
- 大块编辑 → 保留 1 行上下文，最多显示 8 行 diff
- 超出显示 `…+N more lines`

#### Expanded 模式 — 其他工具

`run_read`:
```
📖 read src/foo.ts (12ms)
  path: src/foo.ts
  range: 10-50
  →
  150 lines                             ← 绿色，摘要
  const foo = bar();                    ← 灰色，预览
  function baz() {                      ← 灰色，预览
  …+147 more lines                      ← 截断标记
```

`run_grep`:
```
🔍 grep "foo" @ src/ (45ms)
  pattern: foo
  path: src/
  →
  3 files matched                       ← 绿色，摘要
  src/a.ts                              ← 灰色，预览
  src/b.ts                              ← 灰色，预览
  …+1 more line
```

### 5.5 高度估算更新

**文件**: `components/streamingAssistant.tsx` — `estimatePartHeight()`

```typescript
const opToolNames = new Set([
  'run_read', 'run_write', 'run_edit', 'run_grep', 'run_glob',
  'run_bash', 'run_bash_background', /* ... */
])

if (opToolNames.has(tool.name)) {
  const argCount = Object.keys(tool.args).length
  const maxResultLines = tool.name === 'run_edit' ? 8 : 5
  const resultLines = tool.result
    ? Math.min(tool.result.split('\n').filter(l => l.trim()).length, maxResultLines)
    : 0
  // header(1) + args(min(argCount,3)) + arrow(1) + result
  return 1 + Math.min(argCount, 3) + (resultLines > 0 ? 1 + resultLines : 0)
}
```

操作工具的 expanded 模式显示的参数行通常比通用渲染少（选择性展示），但结果行可能更多（5 行 vs 3 行），需要更精确的高度估算以避免裁剪偏差。

---

## 6. 文件变更总览

### 新增文件

| 文件 | 用途 |
|------|------|
| `src/components/operatorToolLine.tsx` | 操作工具定制化渲染（图标 + 差异 + 智能摘要） |
| `src/hooks/terminalSizeStore.ts` | 终端尺寸全局单监听（避免 MaxListeners 警告） |

### 修改文件

| 文件 | 改动项 |
|------|--------|
| `src/app/inkInstanceRef.ts` | 新增 `clearInkFullStaticOutput()` (P0-1) |
| `src/app/turnController.ts` | `finalize()` 调用 `clearInkFullStaticOutput()`，释放 chunks (P0-1, P1-7) |
| `src/app/types.ts` | `reasoningChunks[]` + `getReasoningText()` (P0-3)，`MAX_TOOL_RESULT_CHARS` (P1-6) |
| `src/app/createGatewayEventHandler.ts` | `reasoningChunks` push (P0-3)，`MAX_CONTENT_PARTS` 压缩 (P1-4)，chunk 释放 (P1-7)，`usage.update` + `streamingCharCount` (Token) |
| `src/app/turnStore.ts` | `KEEP_FULL_TURNS` + `truncateTurn()` (P1-6) |
| `src/app/uiStore.ts` | `$composerInputHeight` (输入框)，`$streamingTokenEstimate` + `UsageInfo` 扩展 (Token) |
| `src/app/gatewayTypes.ts` | `UsagePayload` 扩展 + `usage.update` 事件 (Token) |
| `src/components/streamingAssistant.tsx` | `MAX_FRAME_FRACTION=0.55` (P0-2)，`MAX_SCAN_PARTS=20` (P1-5)，动态 `RESERVED_ROWS` (输入框)，操作工具高度估算 (渲染) |
| `src/components/toolCallLine.tsx` | 委托 `OperatorToolLine` (渲染) |
| `src/components/textInput.tsx` | `softWrap` + `buildVisualLines` + 滚动窗口 + `onHeightChange` (输入框) |
| `src/components/composerPane.tsx` | `useTerminalSize` + `inputMaxRows` + 底部分割线 (输入框) |
| `src/components/statusBar.tsx` | 三模式 token 显示 (Token) |
| `backend/tui_gateway/adapter/event_translator.py` | `TurnState` 累积 + `_capture_usage` + `usage.update` 事件 (Token) |
| `backend/tui_gateway/scripts/gateway_cli.py` | `usage.update` 调试输出 (Token) |

### 关键常量表

| 常量 | 值 | 文件 | 作用 |
|------|----|------|------|
| `MAX_FRAME_FRACTION` | 0.55 | streamingAssistant.ts | 流式帧 ≤ 终端 55% |
| `RESERVED_BASE_ROWS` | 6 | streamingAssistant.ts | StatusBar + Composer 固定开销 |
| `MIN_STREAM_ROWS` | 3 | streamingAssistant.ts | 流式内容最小行数 |
| `MAX_CONTENT_PARTS` | 50 | createGatewayEventHandler.ts | contentParts 压缩阈值 |
| `MAX_SCAN_PARTS` | 20 | streamingAssistant.ts | 裁剪扫描上限 |
| `KEEP_FULL_TURNS` | 10 | turnStore.ts | 完整保留轮次数 |
| `MAX_TRUNCATED_TEXT` | 200 | turnStore.ts | 旧轮次文本截断 |
| `HARD_CAP_TURNS` | 5000 | turnStore.ts | 轮次硬上限 |
| `MAX_TOOL_RESULT_CHARS` | 5000 | types.ts | 工具结果内存上限 |
| `inputMaxRows` | `max(5, min(floor(rows*0.4), 15))` | composerPane.ts | 输入框上限 |
| `MAX_DIFF_LINES` | 8 | operatorToolLine.ts | edit diff 最大行数 |

---

> **文档结束**  
> 所有改动均已通过 `tsc --noEmit` + `npm run build` + 后端测试验证。
