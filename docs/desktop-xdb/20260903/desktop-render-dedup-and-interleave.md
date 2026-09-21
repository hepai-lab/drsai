# 桌面版渲染输出优化方案：消除分析说明重复 + 时间线交错 + 白屏修复

> 日期：2026-09-03
> 范围：`apps/desktop/shared/renderer/src/components/StructuredMessageParts.tsx`、`ChatMessageContent.tsx`、`ChatWorkspace.tsx`
> 数据层：`apps/desktop/shared/main/threadRuntimeProjection.ts`、`apps/desktop/shared/api/structuredConversation.ts`
> 渲染辅助：`apps/desktop/shared/renderer/src/chatOutputModel.ts`、`structuredProcessPresentation.ts`

---

## 一、现状描述

用户当前看到智能体回复气泡从上到下：

```
┌─────────────────────────────────────────────────┐
│ ▶ 过程  (折叠的 details)                          │
│   ├─ 分析说明  (折叠的 details)                   │
│   │    = 智能体内部处理循环的思考 + 文本输出       │
│   └─ 操作与文件                                   │
│        = 简要说明执行的工具名称                    │
├─────────────────────────────────────────────────┤
│ ▶ 分析说明  (折叠的 details)  ← 重复！            │
│    = 完整的分析说明（与上面相同的内容）             │
│ 最后的完整文本输出                                │
│    = 智能体的最终 markdown 回答                   │
└─────────────────────────────────────────────────┘
```

**三个问题：**

1. **分析说明重复**：第 1 部分（过程内）和第 2 部分（过程外）的分析说明内容相同
2. **白屏**：第 2 部分的分析说明渲染过多，导致页面白屏
3. **逻辑断裂**：第 1 部分中的思考和文本输出应与工具执行按时间顺序交错展示，而非分成独立区块

---

## 二、根因分析

### 2.1 当前渲染架构

核心组件 `StructuredMessageParts` 接收 `turn: StructuredTurnState`，将 `turn.parts` 按类型过滤后分两区渲染：

```
turn.parts
  ├─ reasoningParts  = parts.filter(kind === "reasoning")                    → 过程区：ReasoningDisclosure
  ├─ resultParts     = parts.filter(kind === "markdown" | "citation" | ...) → 结果区：resultParts.map(renderPart)
  ├─ progressParts   = parts.filter(kind === "progress")
  ├─ subtaskParts    = parts.filter(kind === "subtask")
  └─ noticeParts     = parts.filter(kind === "notice")
```

**关键代码位置（StructuredMessageParts.tsx）：**

| 行号 | 代码 | 说明 |
|------|------|------|
| L124 | `reasoningParts = turn.parts.filter(p => p.kind === "reasoning")` | 过程区分析说明数据源 |
| L148 | `resultParts = turn.parts.filter(p => p.kind === "markdown" \|\| ...)` | 结果区数据源 |
| L281 | `<details className="structured-process">` | 过程折叠区 |
| L296 | `<ReasoningDisclosure parts={reasoningParts} renderPart={renderPart} />` | 过程内"分析说明" |
| L302 | `<AggregatedActivityDetails groups={...} />` | 过程内"操作与文件" |
| L326 | `resultParts.map(renderPart)` | 结果区（"回答"） |
| L226 | `renderPart` 中 markdown 分支 → `<ChatMessageContent content=... />` | ⚠️ 未传 `plainMarkdown` |

### 2.2 重复根因：renderPart 未传 plainMarkdown

`renderPart` 函数处理 `kind === "markdown"` 的 part 时，调用 `ChatMessageContent` **没有传 `plainMarkdown` 属性**：

```tsx
// StructuredMessageParts.tsx ~L226 — 当前代码
<ChatMessageContent
  content={displayedMarkdown}
  streaming={part.status === "running"}
  language={language}
  onOpenLink={onOpenLink}
  citations={inlineCitations}
  // ⚠️ 没有 plainMarkdown！
/>
```

对比 `StructuredReasoning` 组件（L703-707），它**明确传了 `plainMarkdown`**，代码注释写道：

```tsx
// StructuredReasoning — 正确写法
{/* plainMarkdown avoids nesting a second "Thinking" block via think-tag parsing. */}
<ChatMessageContent
  content={content}
  plainMarkdown       // ← 防止 think-tag 二次提取
  streaming={false}
  ...
/>
```

**plainMarkdown 的作用**（ChatMessageContent.tsx）：

```tsx
if (plainMarkdown) {
  // 直接渲染 markdown，不调用 parseChatOutput()
  return <MarkdownContent content={content} ... />;
}
// ⚠️ 未传 plainMarkdown 时，调用 parseChatOutput() 扫描 think 标签
const parts = parseChatOutput(content, { streaming });
return parts.map(part => part.type === "reasoning"
  ? <ReasoningPart ... />   // ← 生成嵌套 "Thinking" 折叠块 = 第二个"分析说明"
  : <MarkdownContent ... />);
```

`parseChatOutput()`（chatOutputModel.ts L17）扫描文本中的 think 开闭标签，将其拆分为 `reasoning` 和 `text` 两类 part。

### 2.3 think 标签如何进入 markdown part

数据层有两个路径创建 parts：

**路径 A：实时投影**（threadRuntimeProjection.ts L366-375）

```typescript
if (item.type === "message") {
  const markdown = oaepText(item.content);  // ← 原始 assistant 文本，未剥离 think 标签
  return {
    parts: [{ id: item.id, kind: "markdown", status, markdown, ... }],
    activities: [],
  };
}
if (item.type === "reasoning") {
  // reasoning item → 创建 kind: "reasoning" part
  return { parts: [{ id: item.id, kind: "reasoning", ... }], ... };
}
```

当模型在 assistant message 文本中输出 think 标签时，这些标签原样进入 markdown part。同时后端也会发送独立的 reasoning item 创建 reasoning part。结果：同一份思考内容在 reasoning part 和 markdown part 中各存在一份。

**路径 B：遗留消息迁移**（structuredConversation.ts L288-303）

```typescript
const split = splitLegacyThinkContent(message.content ?? "");
// split.reasoning → 创建 kind: "reasoning" part
// split.text     → 创建 kind: "markdown" part（已剥离 think 标签）
```

遗留路径正确地剥离了 think 标签，但实时路径没有。

### 2.4 白屏性能根因

| 因素 | 影响 | 代码位置 |
|------|------|----------|
| ReasoningDisclosure 无分页 | 一次性 `parts.map(renderPart)` 渲染全部 reasoning，50+ 条时展开瞬间挂载所有组件 | L615 |
| parseChatOutput() 每 token 重跑 | streaming 时每 ~64ms 重渲染，O(n) 扫描全文 think 标签，O(n²) 总开销 | ChatMessageContent.tsx |
| 双重 Markdown 解析 | 同一 reasoning 内容被 ReactMarkdown 解析两次（过程区一次 + 结果区二次提取一次） | 两处 ChatMessageContent |
| MarkdownContent 实例开销大 | 每个实例携带 useStreamingDisplayBuffer + useMemo + useLayoutEffect + Profiler 全套 hooks | ChatMessageContent.tsx |
| 分页不一致 | AggregatedActivityDetails 有 WINDOW_SIZE=16 分页，BoundedProcessSection 有 WINDOW_SIZE=8，但 ReasoningDisclosure 无任何限制 | L511 vs L615 |

### 2.5 交错缺失根因

当前结构是**两个独立分区**，不按时间交错：

- `ReasoningDisclosure`（L296-300）：所有 reasoning parts 集中渲染
- `AggregatedActivityDetails`（L302-309）：所有 activities 集中渲染（且按工具名聚合，非时间序）

`turn.parts` 和 `turn.activities` 是两个独立数组，无合并/排序机制。用户看到的顺序是：先看完全部思考，再看完全部工具操作——逻辑断裂。
---

## 三、优化方案（分 3 层，由轻到重）

### 方案 A：消除重复（最小改动，立即修复白屏主因）

#### A-1. renderPart markdown 分支添加 plainMarkdown

**文件**：`StructuredMessageParts.tsx` ~L226

```tsx
// 修改前：
<ChatMessageContent
  content={displayedMarkdown}
  streaming={part.status === "running"}
  language={language}
  onOpenLink={onOpenLink}
  citations={inlineCitations}
  ...
/>

// 修改后：
<ChatMessageContent
  content={displayedMarkdown}
  plainMarkdown                    // ← 新增：阻止 parseChatOutput 二次提取 think 标签
  streaming={part.status === "running"}
  language={language}
  onOpenLink={onOpenLink}
  citations={inlineCitations}
  ...
/>
```

这阻止 `parseChatOutput()` 从 markdown part 中二次提取 think 标签，消除第二个"分析说明"。

#### A-2. 剥离 markdown part 中残留的 think 标签

即使加了 `plainMarkdown`，如果 markdown 内容中仍有 think 标签，它们会被当作普通文本渲染出来（显示标签字样）。需要在 `displayedMarkdown` 计算时剥离：

**文件**：`StructuredMessageParts.tsx` ~L222

```tsx
// 修改前：
const displayedMarkdown = stripAgentToolDebugText(
  publicSources.length ? stripTrailingSourceList(part.markdown) : part.markdown,
);

// 修改后：在 stripAgentToolDebugText 之后追加 think 标签剥离
const thinkOpenTag = /<think>/gi;
const thinkCloseTag = /<\/think>/gi;
const displayedMarkdown = stripAgentToolDebugText(
  publicSources.length ? stripTrailingSourceList(part.markdown) : part.markdown,
)
// 剥离已闭合的 think 块
.replace(/<think>[\s\S]*?<\/think>/gi, "")
// 剥离未闭合的 think 块（streaming 中只有开标签）
.replace(/<think>[\s\S]*$/gi, "")
.trim();
```

> 注意：think 标签的剥离逻辑已在 `structuredConversation.ts` 的 `splitLegacyThinkContent()` 函数中实现（L772-790），可以考虑提取为公共函数复用，避免正则重复。

#### A-3. 数据层投影时也应在源头剥离

**文件**：`threadRuntimeProjection.ts` ~L366

```typescript
// 修改前：
const markdown = oaepText(item.content);

// 修改后：
const rawMarkdown = oaepText(item.content);
const markdown = rawMarkdown
  .replace(/<think>[\s\S]*?<\/think>/gi, "")  // 已闭合
  .replace(/<think>[\s\S]*$/gi, "")            // 未闭合（streaming）
  .trim();
```

这样从数据源头就保证了 markdown part 不含 think 标签，渲染层只是兜底。

**预期效果**：消除重复的分析说明，减少约 50% 的 Markdown 解析量，立即缓解白屏。

---

### 方案 B：ReasoningDisclosure 分页 + 性能优化

#### B-1. 为 ReasoningDisclosure 添加分页窗口

**文件**：`StructuredMessageParts.tsx` L592-620

当前 `ReasoningDisclosure` 一次性渲染所有 reasoning parts：

```tsx
// 当前代码 L615 — 无分页
{open ? <div className="structured-analysis-content">
  {parts.map(renderPart)}   // ← 全部渲染，无限制
</div> : null}
```

对比 `BoundedProcessSection`（L511-514）已有分页机制：

```tsx
// BoundedProcessSection — 有分页
const window = boundedProcessWindow(items.length, page, 8);
{items.slice(window.start, window.end).map(part => <div key={part.id}>{renderPart(part)}</div>)}
```

修改 `ReasoningDisclosure` 增加分页：

```tsx
const REASONING_WINDOW_SIZE = 8;  // 与 BoundedProcessSection 一致

function ReasoningDisclosure({
  parts, language, running, renderPart,
}: { ... }): React.JSX.Element | null {
  const [open, setOpen] = useState(running);
  const [page, setPage] = useState(0);                          // ← 新增分页状态
  const previousRunningRef = useRef(running);

  useEffect(() => {
    const wasRunning = previousRunningRef.current;
    if (running && !wasRunning) setOpen(true);
    else if (!running && wasRunning) setOpen(false);
    previousRunningRef.current = running;
  }, [running]);

  // parts 数量变化时修正页码（复用已有函数）
  useEffect(() => setPage(current =>
    boundedProcessWindow(parts.length, current, REASONING_WINDOW_SIZE).page
  ), [parts.length]);

  if (!parts.length) return null;
  const window = boundedProcessWindow(parts.length, page, REASONING_WINDOW_SIZE);
  const latestSummary = [...parts].reverse().map(p => p.summary?.trim()).find(Boolean);

  return <details className="structured-analysis-disclosure" open={open} onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>
      <span><strong>{language === "zh" ? "分析说明" : "Analysis notes"}</strong>
      {latestSummary ? <small>{latestSummary}</small>
        : <small>{language === "zh" ? `${parts.length} 条记录` : `${parts.length} records`}</small>}
      </span>
      <ChevronDown size={14} aria-hidden="true" />
    </summary>
    {open ? (
      <div className="structured-analysis-content">
        {/* 只渲染当前窗口的 parts */}
        {parts.slice(window.start, window.end).map(renderPart)}
        {/* 添加分页导航（复用已有组件） */}
        <ProcessWindowNavigation window={window} total={parts.length} language={language} onPage={setPage} />
      </div>
    ) : null}
  </details>;
}
```

#### B-2. streaming 时自动跳到最后一页

```tsx
useEffect(() => {
  if (running && parts.length > 0) {
    const lastPage = Math.max(0, Math.ceil(parts.length / REASONING_WINDOW_SIZE) - 1);
    setPage(lastPage);
  }
}, [running, parts.length]);
```

**预期效果**：展开"分析说明"时最多挂载 8 个 ChatMessageContent 实例而非全部，消除大展开时的白屏。

---

### 方案 C：统一时间线交错展示（架构改进建议）

目标：将"分析说明"、"操作与文件"从两个独立区块合并为一个*按执行顺序交错的过程时间线*。

期望展示：

```text
过程
  1. 思考：我需要先检查消息渲染入口
  2. 工具：搜索 StructuredMessageParts.tsx
  3. 思考：发现 markdown 分支没有 plainMarkdown
  4. 工具：读取 ChatMessageContent.tsx
  5. 思考：确认 parseChatOutput 会二次提取 think 标签
  6. 工具：写入修复
```

而不是当前：

```text
过程
  分析说明
    - 所有思考全部堆在一起
  操作与文件
    - 所有工具全部堆在一起
```

#### C-1. 不建议继续用 AggregatedActivityDetails 做主时间线

`AggregatedActivityDetails` 当前会对工具活动做聚合：

```typescript
activityGroups: aggregateActivities(turn.activities, language)
```

聚合逻辑会把连续相同工具/同类操作合并为 group。这适合做"操作摘要"，但不适合做"过程时间线"，因为它会丢失细粒度顺序。

因此建议：

- `AggregatedActivityDetails` 保留为可选摘要，或者降级为 footer 中的"操作摘要"
- 新增 `StructuredProcessTimeline` 作为过程区主展示
- 时间线使用原始 `turn.activities`，而不是 `processPresentation.activityGroups`

#### C-2. 新增 TimelineEntry 类型

**文件**：`StructuredMessageParts.tsx`

```tsx
type ProcessTimelineEntry =
  | {
      type: "reasoning";
      id: string;
      timestamp: number;
      part: Extract<StructuredAssistantPart, { kind: "reasoning" }>;
    }
  | {
      type: "activity";
      id: string;
      timestamp: number;
      activity: StructuredActivityEvent;
    };
```

#### C-3. 构建统一时间线

```tsx
function buildProcessTimeline(
  reasoningParts: Array<Extract<StructuredAssistantPart, { kind: "reasoning" }>>,
  activities: StructuredActivityEvent[],
): ProcessTimelineEntry[] {
  const entries: ProcessTimelineEntry[] = [];

  for (const [index, part] of reasoningParts.entries()) {
    const firstStartedAt = part.segments.map(segment => segment.startedAt).find(Boolean);
    const firstCompletedAt = part.segments.map(segment => segment.completedAt).find(Boolean);
    const timestamp = firstStartedAt
      ? Date.parse(firstStartedAt)
      : firstCompletedAt
        ? Date.parse(firstCompletedAt)
        : index;

    entries.push({
      type: "reasoning",
      id: `reasoning:${part.id}`,
      timestamp: Number.isFinite(timestamp) ? timestamp : index,
      part,
    });
  }

  for (const [index, activity] of activities.entries()) {
    const rawTimestamp =
      (activity as any).startedAt ??
      (activity as any).completedAt ??
      (activity as any).createdAt ??
      (activity as any).updatedAt;
    const parsed = typeof rawTimestamp === "string" ? Date.parse(rawTimestamp) : NaN;

    entries.push({
      type: "activity",
      id: `activity:${activity.oaepItemId ?? activity.title ?? index}:${index}`,
      timestamp: Number.isFinite(parsed) ? parsed : 1_000_000 + index,
      activity,
    });
  }

  return entries.sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    if (a.type === b.type) return 0;
    return a.type === "reasoning" ? -1 : 1;
  });
}
```

> 注意：如果 `StructuredActivityEvent` 当前没有 startedAt/completedAt 字段，第一阶段可用数组顺序兜底；第二阶段建议在类型层补充时间戳字段，避免 timeline 顺序不稳定。

#### C-4. 新增 StructuredProcessTimeline 组件

```tsx
const PROCESS_TIMELINE_WINDOW_SIZE = 16;

function StructuredProcessTimeline({
  reasoningParts,
  activities,
  language,
  resourceStates,
  onOpenResource,
  renderPart,
}: {
  reasoningParts: Array<Extract<StructuredAssistantPart, { kind: "reasoning" }>>;
  activities: StructuredActivityEvent[];
  language: "en" | "zh";
  resourceStates?: Readonly<Record<string, "available" | "moved" | "changed" | "deleted" | "offline" | "unsupported">>;
  onOpenResource?: (resourceRef: OaepResourceRef) => void;
  renderPart: (part: StructuredAssistantPart) => React.JSX.Element | null;
}): React.JSX.Element | null {
  const [page, setPage] = useState(0);
  const timeline = useMemo(
    () => buildProcessTimeline(reasoningParts, activities),
    [reasoningParts, activities],
  );

  useEffect(() => setPage(current =>
    boundedProcessWindow(timeline.length, current, PROCESS_TIMELINE_WINDOW_SIZE).page
  ), [timeline.length]);

  if (!timeline.length) return null;

  const window = boundedProcessWindow(timeline.length, page, PROCESS_TIMELINE_WINDOW_SIZE);
  const visibleEntries = timeline.slice(window.start, window.end);

  return <section className="structured-process-section structured-process-timeline" data-timeline-total={timeline.length}>
    <h4>{language === "zh" ? "执行过程" : "Execution timeline"}</h4>
    <div className="structured-timeline-window">
      {visibleEntries.map(entry => {
        if (entry.type === "reasoning") {
          return <div key={entry.id} className="structured-timeline-item reasoning">
            <div className="structured-timeline-marker">💭</div>
            <div className="structured-timeline-content">
              {renderPart(entry.part)}
            </div>
          </div>;
        }

        return <div key={entry.id} className={`structured-timeline-item activity ${entry.activity.status}`}>
          <div className="structured-timeline-marker">
            <ActivityStatusIcon status={entry.activity.status} />
          </div>
          <div className="structured-timeline-content">
            <ActivityTimelineItem
              activity={entry.activity}
              language={language}
              resourceStates={resourceStates}
              onOpenResource={onOpenResource}
            />
          </div>
        </div>;
      })}
    </div>
    <ProcessWindowNavigation window={window} total={timeline.length} language={language} onPage={setPage} />
  </section>;
}
```

#### C-5. 新增 ActivityTimelineItem 组件

`AggregatedActivityDetails` 里的 group 渲染逻辑可以抽成单项组件，也可以新增轻量组件：

```tsx
function ActivityTimelineItem({
  activity,
  language,
  resourceStates,
  onOpenResource,
}: {
  activity: StructuredActivityEvent;
  language: "en" | "zh";
  resourceStates?: Readonly<Record<string, "available" | "moved" | "changed" | "deleted" | "offline" | "unsupported">>;
  onOpenResource?: (resourceRef: OaepResourceRef) => void;
}): React.JSX.Element {
  const label = formatActivitySummary(activity, language);

  if (activity.kind === "file_change") {
    const name = activity.path.split(/[\\/]/).filter(Boolean).pop() || activity.path;
    const state = activity.resourceRef ? resourceState(activity.resourceRef, resourceStates) : undefined;

    return <div className="structured-activity-row">
      <span>{label}</span>
      {activity.resourceRef && onOpenResource ? (
        <button
          type="button"
          disabled={state === "deleted"}
          data-resource-state={state || "unknown"}
          onClick={() => onOpenResource(activity.resourceRef!)}
        >{name}{state && state !== "available" ? ` · ${resourceStateLabel(state, language)}` : ""}</button> : ""}
      ) : <small>{name}</small>}
    </div>;
  }

  if (activity.kind === "tool") {
    return <div className="structured-activity-row">
      <span>{label}</span>
      {activity.durationMs !== undefined && activity.durationMs >= 1000 ? (
        <time>{formatRunDuration(activity.durationMs, language)}</time>
      ) : null}
    </div>;
  }

  return <div className="structured-activity-row"><span>{label}</span></div>;
}
```

#### C-6. 替换过程区主结构

**文件**：`StructuredMessageParts.tsx` ~L292-309

```tsx
// 修改前：
<ReasoningDisclosure
  parts={reasoningParts}
  language={language}
  running={turn.status === "running"}
  renderPart={renderPart}
/>
<AggregatedActivityDetails
  groups={processPresentation.activityGroups}
  language={language}
  resourceStates={resourceStates}
  onOpenResource={onOpenResource}
/>

// 修改后：
<StructuredProcessTimeline
  reasoningParts={reasoningParts}
  activities={turn.activities}
  language={language}
  resourceStates={resourceStates}
  onOpenResource={onOpenResource}
  renderPart={renderPart}
/>

// 可选：保留摘要，但默认折叠或只在 debug 模式展示
<AggregatedActivityDetails
  groups={processPresentation.activityGroups}
  language={language}
  resourceStates={resourceStates}
  onOpenResource={onOpenResource}
/>
```

建议第一版：直接替换掉 `ReasoningDisclosure + AggregatedActivityDetails`，否则用户仍会感到重复；如果需要摘要，可改名为"操作摘要"并默认折叠到 footer。

#### C-7. CSS 样式建议

```css
.structured-process-timeline {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.structured-timeline-window {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.structured-timeline-item {
  display: flex;
  gap: 10px;
  padding: 8px 0 8px 18px;
  margin-left: 8px;
  border-left: 2px solid var(--border-subtle, rgba(148, 163, 184, 0.35));
  position: relative;
}

.structured-timeline-marker {
  position: absolute;
  left: -9px;
  top: 9px;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: var(--surface, #fff);
  color: var(--text-muted, #64748b);
}

.structured-timeline-item.reasoning .structured-timeline-marker {
  color: var(--accent-purple, #8b5cf6);
}

.structured-timeline-item.activity .structured-timeline-marker {
  color: var(--accent-blue, #3b82f6);
}

.structured-timeline-content {
  flex: 1;
  min-width: 0;
}

.structured-activity-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 13px;
}
```

---

## 四、实施优先级

| 优先级 | 方案 | 改动量 | 风险 | 效果 |
|--------|------|--------|------|------|
| P0 | A-1 + A-2 + A-3 | 3 处小改 | 极低 | 消除重复分析说明，减少 Markdown 重复解析 |
| P1 | B-1 + B-2 | 1 个组件重写 | 低 | 消除展开大量分析说明导致的白屏 |
| P2 | C-1 ~ C-7 | 新增组件 + 过程区结构调整 | 中 | 思考与工具按时间线交错展示，逻辑连贯 |

建议顺序：

1. 先做 P0：最快验证重复问题是否解决
2. 再做 P1：即使仍有大量 reasoning，也不会一次性挂载造成白屏
3. 最后做 P2：把展示体验从"分区块"升级为"按执行过程讲故事"

---

## 五、优化后的目标气泡结构

```text
┌─────────────────────────────────────────────────┐
│ ▶ 过程  (折叠)                                    │
│   ├─ 检索阶段摘要（如有）                          │
│   ├─ 进度概览                                     │
│   ├─ 执行过程（统一时间线，分页，最多 16 条/页）      │
│   │   ├─ 思考片段 1                                │
│   │   ├─ 工具操作 A                                │
│   │   ├─ 思考片段 2                                │
│   │   ├─ 工具操作 B                                │
│   │   ├─ 思考片段 3                                │
│   │   └─ 工具操作 C                                │
│   ├─ 子任务（分页）                                │
│   └─ 运行信息（分页）                              │
├─────────────────────────────────────────────────┤
│ 回答                                              │
│   = 最终 markdown 回答（无重复分析说明）            │
└─────────────────────────────────────────────────┘
```

---

## 六、验收标准

### 6.1 重复分析说明验收

- [ ] 同一个 assistant bubble 中，只出现一处"分析说明"入口
- [ ] 过程区外的最终回答不再出现嵌套的 Thinking/分析说明折叠块
- [ ] 最终回答中不显示任何 think 标签原文
- [ ] 历史消息与实时 streaming 消息均正常渲染

### 6.2 白屏验收

- [ ] reasoning parts 数量超过 50 时，展开过程区不白屏
- [ ] reasoning 单段内容很长时，页面仍可滚动
- [ ] streaming 中持续输出时，CPU 不出现长时间 100% 卡死
- [ ] React profiler 中单帧渲染时间明显下降

### 6.3 时间线验收

- [ ] 过程区中思考与工具按执行顺序交错展示
- [ ] 工具操作仍能展示文件链接、资源状态和耗时
- [ ] 时间线超过窗口大小后分页展示
- [ ] streaming 期间默认展示最新过程项

---

## 七、关键文件索引

| 文件 | 作用 | 关键点 |
|------|------|--------|
| `apps/desktop/shared/renderer/src/components/StructuredMessageParts.tsx` | 主渲染组件 | `renderPart`、`ReasoningDisclosure`、`AggregatedActivityDetails`、结果区 |
| `apps/desktop/shared/renderer/src/components/ChatMessageContent.tsx` | Markdown/think 标签渲染 | `plainMarkdown` 控制是否调用 `parseChatOutput()` |
| `apps/desktop/shared/renderer/src/chatOutputModel.ts` | 文本解析工具 | `parseChatOutput()`、`getVisibleChatText()`、`stripAgentToolDebugText()` |
| `apps/desktop/shared/main/threadRuntimeProjection.ts` | 实时数据投影 | message → markdown part；reasoning → reasoning part |
| `apps/desktop/shared/api/structuredConversation.ts` | 类型定义 + 遗留迁移 | `MarkdownPart`、`ReasoningPart`、`splitLegacyThinkContent()` |
| `apps/desktop/shared/renderer/src/structuredProcessPresentation.ts` | 过程展示聚合 | `buildStructuredProcessPresentation()`、`aggregateActivities()` |

---

## 八、最终建议

如果目标是快速止血：

> 先实现 A-1 + A-2 + A-3。

如果目标是彻底解决白屏：

> 在 A 的基础上实现 B-1 + B-2。

如果目标是产品体验升级：

> 在 A/B 稳定后实现 C：统一时间线交错展示。

我建议本次迭代按这个顺序落地：

```text
第一步：数据层 + 渲染层双保险剥离 think 标签
第二步：markdown 渲染强制 plainMarkdown，停止二次 parseChatOutput
第三步：ReasoningDisclosure 增加分页窗口
第四步：过程区改为 StructuredProcessTimeline，替换独立的分析说明 + 操作与文件区块
```
