# Desktop 智能体流式渲染优化方案与实施记录

日期：2026-09-07

## 1. 范围约束

本方案的 Desktop 后端范围**仅限**：

`cores/python/packages/drsai/src/drsai/backend/desktop_gateway`

以及该目录实际调用的 `backend/runtime` 适配代码。旧兼容网关不属于本方案，不引用、不修改。

## 2. 当前实际链路

```text
DrSaiAssistant.run_stream()
  -> desktop_gateway/_agent_manager.py
  -> desktop_gateway/_agent_backend.py
  -> tui_gateway/adapter/event_translator.py（Desktop Gateway 当前实际复用）
  -> runtime AgentExecutionServices.emit()
  -> desktop_gateway routes/runs.py（后台执行，事件写入 Runtime journal）
  -> Desktop OAEP stream
  -> oaepPresentationProjector.ts
  -> main/chat.ts
  -> useDesktopChatAdapter
  -> structuredConversation reducer
  -> StructuredMessageParts
```

`DesktopAgentBackend.execute()` 收集 `message.delta` 作为最终 content，并在流结束后发出 `agent.completed`；异常由 Runtime AgentService 发出 `agent.failed` 并收敛 Run 状态。取消由 `routes/runs.py` 调用 Runtime AgentService，Runtime 先请求 backend.cancel、停止 dispatcher、持久化 cancelled，再取消执行任务。

## 3. 问题与根因

1. structured 事件与 legacy `message.content` 同时存在，没有明确 render authority；首个 structured delta 进入 RAF 前，legacy 内容可能先显示。
2. Answer 依据“turn 非 running”推断，取消/失败时 reasoning 或中间 markdown 可能泄漏到正文。
3. reasoning 通过普通 Markdown parser 时会再次识别 `<think>`，产生内部 reasoning 框并与过程区重复。
4. Process 曾按类型分区，无法保持 reasoning → tool → reasoning 的事件顺序。
5. 终态到达时 request map 可能先清理，迟到 delta/RAF 无法完成 reconcile。
6. 子智能体最终文本若被翻译成 parent `message.delta`，会污染父回答；必须只进入 SubtaskPart。
7. 全量过程 DOM 没有稳定 viewport，长 reasoning/tool output 会造成页面过长和渲染压力。

## 4. 目标协议

### 4.1 一次 turn 只有一个渲染权

- `legacy`：尚未收到有效 structured 事件时的兼容路径。
- `structured`：收到首个有效 structured 事件即永久接管当前 turn。
- takeover 后 legacy content、legacy reasoning、legacy tool timeline 不再作为主助手渲染源。

### 4.2 Markdown 分层

- `channel=process`：计划、进度、中间输出，只能进入顶部“过程”。
- `channel=answer`：最终回答候选。
- 只有 `turn.completed` 后的 answer markdown 才能进入 Answer；取消、失败、断连恢复时不把 reasoning/process markdown 转成 Answer。
- 子智能体 markdown 只能写入 `SubtaskPart.markdownSummary`。

### 4.3 终态收敛

```text
active -> sealing -> sealed
```

收到 terminal 事件后：先合并 pending structured events、补齐 canonical OAEP item、关闭运行中的 parts，再清理 request maps。terminal 后的迟到非 terminal 事件丢弃；重复 terminal 幂等。

### 4.4 过程展示

一个顶部“过程”折叠入口，一个 viewport：

```css
max-height: min(60vh, 640px);
overflow-y: auto;
contain: content;
scrollbar-gutter: stable;
```

timeline 按事件 `sequence` 排序，不按 part 类型分组。子任务在过程内部独立折叠，父回答永不吸收子任务最终文本。

## 5. 本次实施

- structuredConversation：为 Markdown 增加 channel/final 语义，为 turn 增加 sealed 标记；terminal 后禁止继续改变已收敛 turn。
- useDesktopChatAdapter：首个 structured 事件立即清空 legacy content，structured 永久接管；terminal 先 flush/reconcile，再延迟清理；忽略 sealed turn 的迟到 delta。
- StructuredMessageParts：Answer 仅选择 completed turn 的 answer markdown；reasoning 只在 ProcessTimeline 使用 `plainMarkdown`。
- oaepPresentationProjector：普通 assistant final message 标记为 answer，commentary/plan 保持 process；首个 delta 前发送 part.started。
- Desktop Gateway：仅依据 `_agent_backend.py`、`_agent_manager.py`、`routes/runs.py` 和实际 runtime 调用链核验取消/失败顺序；保留 `drsai_assistant.py` 子智能体最终输出的隔离映射。
- CSS/组件：保持单 viewport，删除或不再调用旧的重复 Process section 实现。

## 6. 验证矩阵

| 场景 | 预期 |
|---|---|
| reasoning 首段 | 首个 reasoning delta 直接进入过程，不进入 Answer |
| reasoning → tool → reasoning | 按 sequence 交错显示 |
| 正常 final | 仅 final answer markdown 进入 Answer，完整不重复 |
| 取消/失败 | reasoning/intermediate 不泄漏为正文；过程保留并可滚动 |
| legacy takeover | structured 到达后 legacy 不再更新主消息 |
| 子智能体 | reasoning/tool/summary 保留在 SubtaskPart，final 不追加 parent |
| 大输出 | 过程 viewport 固定高度，内部滚动，不无限撑高 DOM |
| 断线恢复 | recovery 重新接管或明确 settle，不产生重复回答 |

## 7. 执行命令

```powershell
Push-Location apps/desktop/windows
npm run typecheck:web
Pop-Location
git diff --check
python -m compileall -q cores/python/packages/drsai/src/drsai
```

若 typecheck 仍出现既有缺失生成文件或既有类型错误，将与本次修改新增错误分开报告。
