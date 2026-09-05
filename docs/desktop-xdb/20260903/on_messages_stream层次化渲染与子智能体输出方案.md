# `on_messages_stream` 事件与子智能体输出的层次化渲染方案

> 对接文档：`docs/desktop-xdb/20260903/桌面版流式输出层次化分类与渲染优化方案.md`
> 覆盖问题：流式输出过长白屏、`Render frame was disposed` 崩溃、子智能体输出无层次展示

---

## 1. 问题根因回顾

### 1.1 白屏 / 卡顿根因链

```
Python on_messages_stream
  → OAEP event.item.delta (高频, 无体积限制)
    → projectOaepEventForPresentation (无截断, 原样透传)
      → IPC webContents.send (无背压)
        → threadSnapshotPatch.applyItemDelta (字符串拼接, 8MB 才兜底)
          → threadPatchFrameBatcher (rAF 合并, 1MB 上限)
            → ReactMarkdown 全量重解析 (每 64ms 一次)
              → 白屏 / Render frame disposed
```

**关键瓶颈点**：

| 层 | 文件 | 问题 |
|---|---|---|
| 投影层 | `oaepPresentationProjector.ts` | 无体积控制，大文本原样通过 |
| 中转层 | `agentRuns.ts` L49-56 | deliver 无 try/catch，帧 dispose 时崩溃传播 |
| 解码层 | `threadSnapshotPatch.ts` | delta 拼接无上限（8MB 才兜底） |
| 合并层 | `threadPatchFrameBatcher.ts` | 1MB 合并上限过大，单帧 DOM 过重 |
| 渲染层 | `ChatMessageContent.tsx` | ReactMarkdown 全量解析，每次 re-render 都重算 |
| 子代理 | `StructuredMessageParts.tsx` | subtask 只渲染摘要行，无内部过程展开 |

### 1.2 子智能体输出现状

当前子智能体输出通过 `subtask.summary.append` delta 处理，投影为 `SubtaskPart`：

```typescript
// structuredConversation.ts
export interface SubtaskPart extends StructuredPartBase {
  kind: "subtask";
  taskId: string;
  title: string;
  agentName?: string;
  summary?: string;  // ← 只有摘要文本
}
```

渲染为一个单行组件（图标 + 标题 + 摘要 + agentName badge），**无内部过程展开**：
- 子代理的 reasoning、工具调用、中间 markdown 输出全部丢失
- 子代理长时间运行时，用户只看到一行静态摘要，无法感知进度

### 1.3 已有优化盘点

| 文件 | 已有优化 | 不足 |
|---|---|---|
| `streamingDisplayBuffer.ts` | 64ms tick 逐步释放文本，grapheme 级步进（小文本）或字符级步进（大文本 >512 chars） | 大文本 backlog 仍会累积，MAX_CHARS_PER_TICK=4096 单帧仍可触发重解析 |
| `streamingMarkdown.ts` | stable/tail 分割，已完成块只渲染一次 | stable 和 tail 都用 ReactMarkdown 全量解析，stable 不变也可能被 re-render |
| `ChatMessageContent.tsx` | stableComponents 对象记忆化，MarkdownCallbackContext 避免 children 重挂载 | ReactMarkdown 本身仍全量解析整个 content |
| `StructuredMessageParts.tsx` | memo 包裹，boundedProcessWindow 翻页（ACTIVITY=16, PART=8） | subtask 无内部过程，reasoning 折叠但全量解析 |
| `threadPatchFrameBatcher.ts` | rAF 合并相邻 delta，1MB 合并上限 | 1MB 单帧仍过大 |
| `threadSnapshotPatch.ts` | 8MB/16MB 兜底上限 | 兜底阈值太高，远超渲染承受力 |

---

## 2. 事件分类 → Structured Part 映射表

### 2.1 `on_messages_stream` 事件谱系

Python `on_messages_stream` 通过 event_translator 转换为 OAEP 事件，再经 `projectOaepEventForPresentation` 投影为 `StructuredConversationEvent`：

| OAEP Event Type | Delta Kind | 投影事件 | 目标 Part | 渲染层级 |
|---|---|---|---|---|
| `event.run.created/started` | — | `turn.started` | — | Turn 头部状态 |
| `event.run.waiting` | — | `turn.waiting` | — | Turn 头部状态 |
| `event.run.resumed` | — | `turn.resumed` | — | Turn 头部状态 |
| `event.item.delta` | `message.text.append` | `part.delta` (markdown.append) | MarkdownPart | **主输出区** |
| `event.item.delta` | `reasoning.text.append` | `part.delta` (reasoning.append) | ReasoningPart | **折叠区** |
| `event.item.delta` | `reasoning.segment.added` | `part.delta` (reasoning.append) | ReasoningPart | **折叠区** |
| `event.item.delta` | `plan.text.append` | `part.delta` (progress.update) | ProgressPart | **过程区** |
| `event.item.delta` | `command.output.append` | `activity.updated` (tool) | ActivityEvent | **折叠活动区** |
| `event.item.delta` | `tool.output.append` | `activity.updated` (tool) | ActivityEvent | **折叠活动区** |
| `event.item.delta` | `subtask.summary.append` | `part.delta` (subtask.update) | SubtaskPart | **子代理区**（当前仅摘要行） |
| `event.item.completed/failed` | — | `part.completed` | 对应 Part | 状态更新 |
| `event.run.completed` | — | `turn.completed` | — | Turn 完成 |
| `event.run.failed` | — | `turn.error` | — | 错误展示 |
| `event.run.cancelled` | — | `turn.cancelled` | — | 停止展示 |

### 2.2 子智能体事件谱系

子智能体通过 `Delegate` 工具调用启动，其输出通过 OAEP 事件流回传。当前投影逻辑：

```typescript
// oaepPresentationProjector.ts — presentationDelta()
if (part.kind === "subtask") return { kind: "subtask.update", summary: part.summary || "", status: part.status };
```

**问题**：子智能体的 `reasoning`、`tool` 调用、中间 `markdown` 输出全部被丢弃，只保留 `summary`。

### 2.3 层次化展示目标

```
┌─ Turn 头部 (状态 + 时长 + backend)
├─ 重要 Notice (warning/error) — 始终可见
├─ 主输出 Markdown — 顶层可见，增量渲染
├─ 过程折叠区 <details>
│  ├─ Progress 进度行 (phase + 完成数/总数)
│  ├─ Reasoning 推理过程 (折叠，segment 级)
│  ├─ Subtask 子代理容器 (可展开)
│  │  ├─ 子代理标题行 (agentName + status icon)
│  │  ├─ 子代理摘要 (summary)
│  │  ├─ [展开] 子代理 reasoning
│  │  ├─ [展开] 子代理 tool activities
│  │  └─ [展开] 子代理中间 markdown
│  └─ Activities 活动 (tool/model/retry/file_change，翻页显示)
├─ Artifacts (文件/表格/补丁/报告)
├─ Citations (引用)
└─ 背景 Notice (info/success)
```

---

## 3. 投影层体积控制 (P1)

### 3.1 Delta 文本截断

**文件**：`apps/desktop/shared/main/oaepPresentationProjector.ts`

在 `presentationDelta()` 函数中增加体积守卫：

```typescript
// 新增常量
const DELTA_TEXT_SOFT_LIMIT = 65_536;  // 64KB — 单次 delta 文本软上限
const DELTA_TEXT_HARD_LIMIT = 262_144; // 256KB — 硬上限，超出截断

function clampDeltaText(text: string): string {
  if (text.length <= DELTA_TEXT_SOFT_LIMIT) return text;
  if (text.length <= DELTA_TEXT_HARD_LIMIT) return text;
  // 截断 + 标记
  const head = text.slice(0, DELTA_TEXT_HARD_LIMIT);
  return head + "\n\n<!-- output-truncated -->";
}

// 在 presentationDelta 中：
function presentationDelta(event, item, part): StructuredPartDelta | null {
  const delta = event.data.delta;
  const rawText = typeof delta?.text === "string" ? delta.text : "";
  const text = clampDeltaText(rawText);  // ← 截断
  // ... 其余逻辑不变
}
```

### 3.2 单 Part 累积体积守卫

在投影层增加 per-part 累积体积跟踪，当某个 part 的累积文本超过阈值时，自动将后续 delta 转换为 artifact：

```typescript
// OaepPresentationProjection 增加字段
export interface OaepPresentationProjection {
  // ... 现有字段
  readonly partByteBudgets: Map<string, number>; // partId → 累积字节数
}

const PART_SPILL_THRESHOLD = 131_072; // 128KB — 超过后转为 artifact

// 在 event.item.delta 处理中：
const currentBudget = projection.partByteBudgets.get(part.id) ?? 0;
const newBudget = currentBudget + text.length;
projection.partByteBudgets.set(part.id, newBudget);

if (newBudget > PART_SPILL_THRESHOLD && part.kind === "markdown") {
  // 将已累积内容转为 artifact，新 part 继续 markdown
  output.push({
    ...base(`part-spill:${part.id}`),
    type: "part.completed",
    part: { ...part, status: "completed" },
  });
  // 创建 artifact part 引用大文本
  const artifactId = `${part.id}:spill`;
  output.push({
    ...base(`part-started:${artifactId}`),
    type: "part.started",
    part: {
      id: artifactId,
      kind: "artifact",
      status: "completed",
      artifactId,
      artifactType: "report",
      name: "Full output",
      summary: `Output exceeded ${PART_SPILL_THRESHOLD / 1024}KB, saved as artifact`,
    },
  });
  // 重置 budget
  projection.partByteBudgets.set(part.id, 0);
  // 不再输出 delta — 用户点击 artifact 查看
  return output;
}
```

### 3.3 子智能体输出体积控制

子智能体的 `subtask.summary.append` delta 同样需要截断：

```typescript
// 在 presentationDelta subtask 分支：
if (part.kind === "subtask") {
  const clampedSummary = clampDeltaText(part.summary || "");
  return { kind: "subtask.update", summary: clampedSummary, status: part.status };
}
```

### 3.4 tool output 体积控制

`command.output.append` 和 `tool.output.append` 的 delta 同样需要在投影层截断：

```typescript
// 在处理 tool/command output delta 时：
if (deltaKind === "command.output.append" || deltaKind === "tool.output.append") {
  const clampedOutput = clampDeltaText(text);
  // 使用 clampedOutput 而非原始 text
}
```

---

## 4. 子智能体容器化展示 (P2)

### 4.1 SubtaskPart 类型扩展

**文件**：`apps/desktop/shared/api/structuredConversation.ts`

```typescript
export interface SubtaskPart extends StructuredPartBase {
  kind: "subtask";
  taskId: string;
  title: string;
  agentName?: string;
  summary?: string;
  // ─── 新增字段 ───
  /** 子代理内部 reasoning segments（折叠展示） */
  reasoningSegments?: ReasoningSegment[];
  /** 子代理内部 tool activities（翻页展示） */
  activities?: StructuredActivityEvent[];
  /** 子代理中间 markdown 输出（折叠展示） */
  markdownSummary?: string;
  /** 子代理状态详情 */
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  /** 子代理层级深度（0=顶层子代理, 1=嵌套子代理） */
  depth?: number;
}
```

同时扩展 `StructuredPartDelta` 以支持子代理内部增量：

```typescript
export type StructuredPartDelta =
  | { kind: "markdown.append"; text: string }
  | { kind: "markdown.citations"; citationIds: string[] }
  | { kind: "reasoning.append"; segmentId: string; text: string; source?: string }
  | { kind: "reasoning.summary"; summary: string }
  | { kind: "progress.update"; summary: string; phase?: string; completed?: number; total?: number }
  | { kind: "subtask.update"; summary: string; status?: StructuredPartStatus }
  // ─── 新增 delta ───
  | { kind: "subtask.reasoning.append"; segmentId: string; text: string; source?: string }
  | { kind: "subtask.activity.append"; activity: StructuredActivityEvent }
  | { kind: "subtask.markdown.append"; text: string };
```

### 4.2 投影层改造

**文件**：`apps/desktop/shared/main/oaepPresentationProjector.ts`

当前 `projectOaepAssistantItem` 只提取 subtask 的 title/agentName/summary。需要扩展以提取子代理的完整过程：

```typescript
// 新增：从 OAEP item 提取子代理内部过程
function projectSubtaskInternals(
  item: OaepItem,
  projection: OaepPresentationProjection,
): Pick<SubtaskPart, "reasoningSegments" | "activities" | "markdownSummary"> {
  const reasoningSegments: ReasoningSegment[] = [];
  const activities: StructuredActivityEvent[] = [];
  let markdownSummary = "";

  // 从 item.content 中提取子代理的 reasoning
  if (item.content?.reasoning) {
    for (const segment of extractReasoningSegments(item.content.reasoning)) {
      reasoningSegments.push({
        id: `${item.id}:reasoning:${reasoningSegments.length}`,
        text: clampDeltaText(segment.text),
        status: item.status === "completed" ? "completed" : "running",
        source: segment.source,
      });
    }
  }

  // 从 item.content 中提取子代理的 tool calls
  if (Array.isArray(item.content?.tool_calls)) {
    for (const call of item.content.tool_calls) {
      activities.push({
        id: `${item.id}:tool:${call.id}`,
        turnId: projection.turnId,
        timestamp: item.created_at ?? new Date().toISOString(),
        source: item.source?.backend ?? "runtime",
        status: "completed",
        title: call.name || "tool",
        kind: "tool",
        toolName: call.name,
        callId: call.id,
        input: clampJsonObject(call.arguments, 4096),  // 工具输入截断到 4KB
        output: clampJsonOutput(call.output, 16384),    // 工具输出截断到 16KB
      });
    }
  }

  // 从 item.content 中提取子代理的中间 markdown
  if (typeof item.content?.markdown === "string") {
    markdownSummary = clampDeltaText(item.content.markdown);
  }

  return { reasoningSegments, activities, markdownSummary };
}
```

### 4.3 前端 SubtaskContainer 组件

**文件**：`apps/desktop/shared/renderer/src/components/StructuredMessageParts.tsx`

将当前的单行 subtask 渲染替换为可展开容器：

```tsx
// 新增 SubtaskContainer 组件
const SubtaskContainer = memo(function SubtaskContainer({
  part,
  language,
  onOpenLink,
}: {
  part: SubtaskPart;
  language: "en" | "zh";
  onOpenLink: (href: string | undefined) => void;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const SubtaskIcon = part.status === "completed" ? CheckCircle2
    : part.status === "error" ? AlertCircle
    : part.status === "cancelled" ? XCircle
    : part.status === "running" ? Loader2
    : CircleEllipsis;
  const iconClass = part.status === "running" ? "structured-subtask-icon spinning" : "structured-subtask-icon";
  const hasInternals = (part.reasoningSegments?.length ?? 0) > 0
    || (part.activities?.length ?? 0) > 0
    || Boolean(part.markdownSummary);

  return (
    <div className={`structured-subtask-container ${part.status}`}
         data-agent={part.agentName || undefined}
         data-depth={part.depth ?? 0}>
      {/* 标题行（始终可见） */}
      <div className="structured-subtask-header"
           onClick={() => hasInternals && setExpanded(!expanded)}>
        <SubtaskIcon size={14} className={iconClass} aria-hidden="true" />
        <span className="structured-subtask-text">
          <strong>{part.title}</strong>
          {part.summary ? ` · ${part.summary}` : ""}
        </span>
        {part.agentName ? <span className="structured-subtask-agent">{part.agentName}</span> : null}
        {hasInternals ? (
          <button className="structured-subtask-toggle" type="button">
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : null}
      </div>

      {/* 内部过程（展开时可见） */}
      {expanded && hasInternals ? (
        <div className="structured-subtask-internals">
          {/* 子代理 reasoning */}
          {part.reasoningSegments?.length ? (
            <details className="structured-subtask-reasoning" open>
              <summary><Info size={12} /> {language === "zh" ? "推理过程" : "Reasoning"}</summary>
              {part.reasoningSegments.map((seg) => (
                <div key={seg.id} className="structured-subtask-reasoning-segment">
                  <ChatMessageContent content={seg.text} language={language} onOpenLink={onOpenLink} plainMarkdown />
                </div>
              ))}
            </details>
          ) : null}

          {/* 子代理 tool activities（翻页） */}
          {part.activities?.length ? (
            <AggregatedActivityDetails activities={part.activities} language={language} />
          ) : null}

          {/* 子代理中间 markdown */}
          {part.markdownSummary ? (
            <div className="structured-subtask-markdown">
              <ChatMessageContent content={part.markdownSummary} language={language} onOpenLink={onOpenLink} plainMarkdown />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
```

在 `renderPart` 函数中替换 subtask 分支：

```tsx
// 替换原有的 subtask 单行渲染
if (part.kind === "subtask") {
  return <SubtaskContainer key={part.id} part={part} language={language} onOpenLink={onOpenLink} />;
}
```

### 4.4 CSS 层级缩进样式

```css
/* 子代理容器层级缩进 */
.structured-subtask-container[data-depth="0"] .structured-subtask-internals {
  margin-left: 16px;
  border-left: 2px solid var(--structured-subtask-border, #e2e8f0);
  padding-left: 12px;
}
.structured-subtask-container[data-depth="1"] .structured-subtask-internals {
  margin-left: 32px;
  border-left: 2px solid var(--structured-subtask-border-nested, #cbd5e1);
  padding-left: 12px;
}
.structured-subtask-container[data-depth="2"] .structured-subtask-internals {
  margin-left: 48px;
  border-left: 2px solid var(--structured-subtask-border-deep, #94a3b8);
  padding-left: 12px;
}

/* 标题行交互 */
.structured-subtask-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: default;
}
.structured-subtask-header:has(.structured-subtask-toggle) { cursor: pointer; }
.structured-subtask-header:hover {
  background: var(--structured-subtask-hover, rgba(0,0,0,0.03));
}
.structured-subtask-toggle {
  margin-left: auto;
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px;
  display: flex;
  align-items: center;
  color: var(--structured-subtask-toggle-color, #64748b);
}

/* 内部过程 */
.structured-subtask-internals {
  margin-top: 4px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.structured-subtask-reasoning summary {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 0.85em;
  color: var(--text-secondary, #64748b);
}
.structured-subtask-markdown {
  font-size: 0.9em;
  color: var(--text-secondary, #475569);
}
```

---

## 5. Markdown 增量/延迟解析 (P3)

### 5.1 现有优化分析

当前已有两层优化：
1. **`streamingDisplayBuffer.ts`**: 按 64ms tick 逐步释放文本，grapheme 级精确步进（小文本）或字符级快速步进（大文本 >512 chars）
2. **`streamingMarkdown.ts`**: 将 markdown 分为 stable（已完成块）和 tail（活跃块），stable 只渲染一次，tail 高频更新

**仍存在的瓶颈**：
- stable 和 tail 都使用 `ReactMarkdown` 全量解析各自内容
- 当 stable 累积到很大时（如 50KB+），每次 tail 更新导致 `MarkdownContent` re-render，stable 的 `ReactMarkdown` 虽然内容不变但可能被重新解析
- `splitStreamingMarkdownIncremental` 是 O(n) 扫描，大文本时开销不可忽略

### 5.2 Stable Part 记忆化

**关键优化**：确保 stable 部分在 tail 更新时**完全不重新渲染**。

```tsx
// ChatMessageContent.tsx — 新增 StableMarkdown 组件
const StableMarkdown = memo(function StableMarkdown(props: MarkdownRendererProps): React.JSX.Element {
  // stable 部分不传 streaming={true}，不会触发 streamingDisplayBuffer
  // 且 memo 确保只有 content 真正变化时才 re-render
  return <MarkdownRenderer {...props} streaming={false} />;
}, (prev, next) => {
  // 自定义比较：只有 content 真正变化时才 re-render
  return prev.content === next.content
    && prev.language === next.language
    && prev.citations === next.citations
    && prev.artifactLinks === next.artifactLinks;
});
```

在 `MarkdownContent` 中使用 `StableMarkdown` 替代直接渲染 stable 部分：

```tsx
function MarkdownContent({ content, ...props }: MarkdownRendererProps): React.JSX.Element {
  const displayedContent = useStreamingDisplayBuffer(content, props.streaming);
  const prevSplitRef = useRef<StreamingMarkdownSplit | null>(null);
  const split = useMemo(() => {
    if (!props.streaming) return { stable: "", tail: displayedContent };
    const result = splitStreamingMarkdownIncremental(displayedContent, prevSplitRef.current);
    prevSplitRef.current = result;
    return result;
  }, [displayedContent, props.streaming]);

  return (
    <Profiler id="streaming-markdown" onRender={(_id, _phase, actualDuration) => {
      if (props.streaming) observeStreamingRenderMetric("markdown-render", actualDuration);
    }}>
      {split.stable ? <StableMarkdown content={split.stable} {...props} /> : null}
      {split.tail ? <MarkdownRenderer content={split.tail} {...props} streaming={props.streaming} /> : null}
    </Profiler>
  );
}
```

### 5.3 大文本块级虚拟化

当单个 markdown part 超过阈值时，按段落分割为多个块，仅渲染视口内的块：

```typescript
// 新增 streamingMarkdownVirtualization.ts
const BLOCK_VIRTUALIZATION_THRESHOLD = 32_768; // 32KB — 超过后启用块级虚拟化

export interface MarkdownBlock {
  content: string;
  offset: number;
}

export function splitMarkdownIntoBlocks(markdown: string): MarkdownBlock[] {
  // 按双换行分割为块（段落/代码块/列表等）
  const blocks: MarkdownBlock[] = [];
  let offset = 0;
  let inFence = false;
  let currentBlock = "";

  for (const line of markdown.split(/(?<=\n)/)) {
    const trimmed = line.replace(/\r?\n$/, "");
    if (/^\s*(`{3,}|~{3,})/.test(trimmed)) inFence = !inFence;
    currentBlock += line;
    if (!inFence && trimmed === "" && line.endsWith("\n")) {
      if (currentBlock.trim()) blocks.push({ content: currentBlock, offset });
      offset += currentBlock.length;
      currentBlock = "";
    }
  }
  if (currentBlock.trim()) blocks.push({ content: currentBlock, offset });
  return blocks;
}

// React 组件：仅渲染可见块
const VirtualizedMarkdown = memo(function VirtualizedMarkdown({
  blocks,
  visibleRange,
  ...props
}: {
  blocks: MarkdownBlock[];
  visibleRange: { start: number; end: number };
} & MarkdownRendererProps): React.JSX.Element {
  const visible = blocks.slice(visibleRange.start, visibleRange.end);
  return (
    <>
      {visible.map((block, i) => (
        <MarkdownRenderer key={`${block.offset}-${i}`} content={block.content} {...props} />
      ))}
    </>
  );
});
```

使用 `IntersectionObserver` 跟踪可见块：

```tsx
const BLOCK_OBSERVER_THRESHOLD = 5; // 预渲染上下文各 5 块

function useVisibleBlockRange(
  blockCount: number,
  containerRef: RefObject<HTMLDivElement>
): { start: number; end: number } {
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: Math.min(blockCount, 20) });

  useEffect(() => {
    if (blockCount <= 20) return; // 小文本不需要虚拟化
    const observer = new IntersectionObserver((entries) => {
      const visibleIndices = entries
        .filter(e => e.isIntersecting)
        .map(e => Number((e.target as HTMLElement).dataset.blockIndex));
      if (visibleIndices.length === 0) return;
      const minIdx = Math.min(...visibleIndices);
      const maxIdx = Math.max(...visibleIndices);
      setVisibleRange({
        start: Math.max(0, minIdx - BLOCK_OBSERVER_THRESHOLD),
        end: Math.min(blockCount, maxIdx + BLOCK_OBSERVER_THRESHOLD + 1),
      });
    }, { rootMargin: "200px" });

    const blocks = containerRef.current?.querySelectorAll("[data-block-index]");
    blocks?.forEach(b => observer.observe(b));
    return () => observer.disconnect();
  }, [blockCount, containerRef]);

  return visibleRange;
}
```

### 5.4 流式期间降级渲染

在流式过程中，当文本体积超过阈值时，暂时降级为纯文本渲染，避免 ReactMarkdown 解析开销：

```tsx
const STREAMING_PLAINTEXT_THRESHOLD = 16_384; // 16KB — 超过后降级

function MarkdownContent({ content, streaming, ...props }: MarkdownRendererProps): React.JSX.Element {
  const displayedContent = useStreamingDisplayBuffer(content, streaming);
  const usePlaintext = streaming && displayedContent.length > STREAMING_PLAINTEXT_THRESHOLD;

  if (usePlaintext) {
    // 降级：用 <pre> 纯文本渲染，避免 markdown 解析
    return (
      <pre className="chat-streaming-plaintext">
        {displayedContent}
        <span className="chat-streaming-cursor" />
      </pre>
    );
  }

  // 正常 markdown 渲染
  // ... stable/tail 分割逻辑
}
```

---

## 6. 背压机制 (P1)

### 6.1 问题：主进程发送速度远超渲染进程处理速度

当前 IPC 链路无背压：主进程 `webContents.send` 不阻塞，事件在渲染进程 MessagePort 队列累积，渲染进程处理不及时导致：
- MessagePort 队列膨胀 → 内存增长
- 高频 React re-render → 主线程阻塞 → 白屏
- 渲染帧被 dispose 时 send 抛异常 → 崩溃

### 6.2 渲染进程健康反馈通道

在渲染进程建立轻量级健康指标采集，通过 `ipcRenderer.send` 向主进程反馈：

```typescript
// 新增 renderer/src/renderHealthMonitor.ts
const HEALTH_REPORT_INTERVAL_MS = 500;
const MAX_PENDING_EVENTS = 256;  // 待处理事件超过此值触发降速
const MAX_FRAME_TIME_MS = 50;   // 帧时间超过此值触发降速

class RenderHealthMonitor {
  private pendingEvents = 0;
  private lastFrameTime = 0;
  private reportTimer: number | null = null;

  start(canvas: HTMLElement): void {
    // 使用 PerformanceObserver 监控 long task
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        this.lastFrameTime = Math.max(this.lastFrameTime, entry.duration);
      }
    });
    observer.observe({ entryTypes: ["longtask"] });

    // 定期上报
    this.reportTimer = window.setInterval(() => {
      this.report();
      this.lastFrameTime = 0; // 重置
    }, HEALTH_REPORT_INTERVAL_MS);
  }

  onEventProcessed(): void {
    this.pendingEvents = Math.max(0, this.pendingEvents - 1);
  }

  onEventReceived(): void {
    this.pendingEvents++;
  }

  private report(): void {
    const health = {
      pendingEvents: this.pendingEvents,
      lastFrameTime: this.lastFrameTime,
      healthy: this.pendingEvents < MAX_PENDING_EVENTS && this.lastFrameTime < MAX_FRAME_TIME_MS,
    };
    desktopApi.send("desktop:render-health", health);
  }

  stop(): void {
    if (this.reportTimer !== null) window.clearInterval(this.reportTimer);
  }
}

export const renderHealthMonitor = new RenderHealthMonitor();
```

### 6.3 主进程背压控制器

主进程接收健康反馈，在 BoundedEventDispatcher 中实现自适应降速：

```typescript
// 新增 shared/main/backpressureController.ts
export interface RenderHealthState {
  pendingEvents: number;
  lastFrameTime: number;
  healthy: boolean;
}

export class BackpressureController {
  #health: RenderHealthState = { pendingEvents: 0, lastFrameTime: 0, healthy: true };
  #flushDelayMs = 0; // 自适应延迟

  updateHealth(health: RenderHealthState): void {
    this.#health = health;
    // 根据负载动态调整 flush 延迟
    if (!health.healthy) {
      if (health.pendingEvents > MAX_PENDING_EVENTS * 2) {
        this.#flushDelayMs = 200; // 重度延迟
      } else {
        this.#flushDelayMs = 100; // 中度延迟
      }
    } else {
      this.#flushDelayMs = 0; // 正常
    }
  }

  get flushDelayMs(): number { return this.#flushDelayMs; }
  get isThrottled(): boolean { return this.#flushDelayMs > 0; }
}
```

### 6.4 集成到 BoundedEventDispatcher

在 `agentRuns.ts` 的 BoundedEventDispatcher flush 中加入背压延迟：

```typescript
// agentRuns.ts — 改造 BoundedEventDispatcher 使用
const backpressure = new BackpressureController();

// IPC 接收渲染进程健康反馈
ipcMain.on("desktop:render-health", (_event, health: RenderHealthState) => {
  backpressure.updateHealth(health);
});

// BoundedEventDispatcher flush 改造
function getAgentEventDispatcher(target: WebContents): BoundedEventDispatcher {
  // ... existing creation logic
  const dispatcher = new BoundedEventDispatcher({
    maxQueueSize: 512,
    flushDelayMs: () => backpressure.flushDelayMs, // 自适应延迟
    deliver: (event) => {
      try {
        if (!target.isDestroyed()) target.send("desktop:agent-run-event", event);
      } catch (err) {
        if (!/destroyed/i.test(String(err))) console.error("[agentRuns] deliver error:", err);
      }
    },
  });
  return dispatcher;
}
```

### 6.5 体积控制时间线

```
正常状态 (healthy=true, flushDelay=0ms):
  主进程: 事件 → BoundedEventDispatcher → 立即 flush → webContents.send
  渲染进程: 接收 → rAF batcher → React render (顺畅)

中度负载 (pendingEvents > 256 或 frameTime > 50ms):
  主进程: 事件 → BoundedEventDispatcher → 延迟 100ms flush → webContents.send
  渲染进程: 接收 → rAF batcher → React render (有轻微延迟但无白屏)

重度负载 (pendingEvents > 512 或 frameTime > 100ms):
  主进程: 事件 → BoundedEventDispatcher → 延迟 200ms flush + 丢弃非 urgent 事件
  渲染进程: 接收 → rAF batcher → React render (降速但不崩溃)

渲染帧 disposed:
  主进程: webContents.send 抛异常 → try/catch 吞掉 → dispatcher.close()
  → 不影响主进程，不传播到 setImmediate
```

---

## 7. P0 崩溃修复集成

### 7.1 三层 try/catch 防护

| 层 | 文件 | 修复 |
|---|---|---|
| L1 泛型 flush | `boundedEventDispatcher.ts` | flush() 加 try/catch + close on error |
| L2 deliver 回调 | `agentRuns.ts` L49-56 | deliver 加 try/catch + /destroyed/i 测试 |
| L3 网关 flush | `desktopGateway/eventDispatcher.ts` | send 加 try/catch |

**L1 — 泛型 BoundedEventDispatcher.flush()**：

```typescript
// boundedEventDispatcher.ts
flush(): void {
  if (this.#closed) return;
  this.#scheduled = false;
  const batch = this.#queue;
  this.#queue = [];
  try {
    for (const event of batch) this.#deliver(event);
  } catch (err) {
    // 渲染帧 dispose 等 error 不应传播到 setImmediate
    if (!/destroyed/i.test(String(err))) {
      console.error("[BoundedEventDispatcher] flush error:", err);
    }
    this.close(); // 关闭 dispatcher，停止后续事件投递
  }
}
```

**L2 — agentRuns.ts deliver 回调**：

```typescript
// agentRuns.ts L49-56 — 对齐 chat.ts 模式
deliver: (event) => {
  try {
    if (!webContents.isDestroyed()) {
      webContents.send("desktop:agent-run-event", event);
    }
  } catch (err) {
    if (!/destroyed/i.test(String(err))) {
      console.error("[agentRuns] deliver error:", err);
    }
  }
}
```

**L3 — 网关 eventDispatcher.ts send**：

```typescript
// desktopGateway/eventDispatcher.ts — send 加 try/catch
private send(event: StructuredConversationEvent): void {
  if (this.target.isDestroyed()) { this.close(); return; }
  try {
    this.target.send("desktop:structured-conversation-event", event);
  } catch (err) {
    if (!/destroyed/i.test(String(err))) {
      console.error("[desktopGateway] send error:", err);
    }
    this.close();
  }
}
```

### 7.2 threadPatchFrameBatcher 合并上限下调

```typescript
// threadPatchFrameBatcher.ts
// 原: const MAX_MERGE_SIZE = 1_048_576; // 1MB
const MAX_MERGE_SIZE = 262_144; // 256KB — 降低单帧 DOM 负担
```

### 7.3 threadSnapshotPatch 兜底阈值下调

```typescript
// threadSnapshotPatch.ts
// 原: const MAX_MESSAGE_SIZE = 8_388_608; // 8MB
const MAX_MESSAGE_SIZE = 2_097_152; // 2MB — 配合投影层截断，降低兜底阈值
// 原: const MAX_TOTAL_ENCODING_SIZE = 16_777_216; // 16MB
const MAX_TOTAL_ENCODING_SIZE = 4_194_304; // 4MB — 总编码上限下调
```

---

## 8. 实施路线图

### 阶段划分

| 阶段 | 优先级 | 内容 | 预估工时 | 风险 |
|---|---|---|---|---|
| **P0** | 紧急 | 三层 try/catch + 合并上限下调 + 兜底阈值下调 | 2h | 低 — 纯防御性修改 |
| **P1** | 高 | 投影层体积控制（delta 截断 + part spill） + 背压机制 | 6h | 中 — 需要测试背压交互 |
| **P2** | 中 | 子智能体容器化（SubtaskPart 扩展 + 投影改造 + SubtaskContainer 组件） | 8h | 中 — 类型变更影响面广 |
| **P3** | 中 | Markdown 增量解析（StableMarkdown 记忆化 + 块级虚拟化 + 流式降级） | 6h | 低 — 渐进增强 |
| **P4** | 低 | CSS 样式完善 + 交互细节 + 测试 | 4h | 低 |

### 依赖关系

```
P0 (崩溃修复) ── 无依赖，立即开始
     │
     ▼
P1 (体积控制 + 背压) ── 依赖 P0（flush 改造后才能加背压延迟）
     │
     ├──────────────┐
     ▼              ▼
P2 (子代理容器)   P3 (Markdown 优化) ── 两者可并行
     │              │
     └──────┬───────┘
            ▼
     P4 (CSS + 测试)
```

### 验收标准

| 指标 | 目标 |
|---|---|
| 白屏 | 连续输出 100KB markdown 无白屏 |
| 崩溃 | 渲染帧 dispose 不影响主进程 |
| 子代理 | 子代理 reasoning/tool/markdown 可展开查看 |
| 背压 | 渲染进程 pending > 256 时主进程自动降速 |
| 内存 | 单 Turn 流式渲染峰值 < 50MB |
| 延迟 | 正常状态 P95 commit-layout < 16ms |

---

## 9. 总结

本方案覆盖了从 Python `on_messages_stream` 到前端渲染的完整链路：

1. **投影层截断**（P1）：在 `oaepPresentationProjector.ts` 增加 `clampDeltaText` + per-part byte budget，从源头控制体积
2. **子代理容器化**（P2）：扩展 `SubtaskPart` 类型 + 投影层提取子代理内部过程 + `SubtaskContainer` 可展开组件
3. **Markdown 增量解析**（P3）：`StableMarkdown` 记忆化 + 块级虚拟化 + 流式期间降级渲染
4. **背压机制**（P1）：渲染进程健康反馈 → 主进程自适应降速
5. **崩溃修复**（P0）：三层 try/catch 防护 + 合并/兜底阈值下调

核心原则：**从源头控制体积（投影层）→ 中转层自适应降速（背压）→ 渲染层增量解析**，三层协同避免白屏和崩溃。
