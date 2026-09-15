# Desktop 流式渲染优化实施记录

日期：2026-09-07

## 已实施

- `structuredConversation` 增加 `channel`、`final`、`sealed`：Answer 只接受 completed turn 的 answer markdown；终态后忽略迟到事件。
- `useDesktopChatAdapter`：首个 structured 事件立即取得渲染权并清空 legacy 内容；terminal 先取出 pending structured delta、取消 RAF、批量提交，再执行终态收敛；transport `done/aborted` 才释放请求映射。
- `oaepPresentationProjector` / runtime projection：part 首次 delta 前发送 `part.started`，reasoning、tool、progress 使用本地 sequence 交错；普通最终消息标记 answer，子代理输出保留在 SubtaskPart。
- `StructuredMessageParts`：顶部仅保留一个“过程”折叠入口；reasoning、progress、activity 统一时间线；reasoning 使用 `plainMarkdown`，避免 `<think>` 二次解析；移除未使用的旧分组过程组件。
- CSS 保持过程固定 viewport、内部滚动和内容隔离，限制长输出对 DOM 的影响。
- 新增 reducer 验证脚本：子任务 activity 关联、activity-before-part 恢复、终态幂等/重复事件忽略。

## 验证

- `git diff --check`：通过。
- `python -m compileall -q cores/python/packages/drsai/src/drsai`：通过。
- `node --experimental-strip-types apps/desktop/shared/test-kit/verify-structured-conversation-reducer.mts`：通过。
- `npm run typecheck:web`：已执行；`StructuredMessageParts.tsx` 已无新增 TypeScript 错误。剩余错误集中在工程已有缺失生成文件/既有类型问题：`wire`、`oaep.generated`、`InlineCitationLink.id`、`ChatWorkspace` 状态类型、`ModelCatalogEntry` 导出及 `BridgeFailure` 类型。
- 真实 Desktop 流式测试：尚未完成。

## 白屏修复：`Render frame was disposed` 错误刷屏

### 根因分析

渲染进程被 disposed 后，主进程的 `BoundedEventDispatcher` 仍持续向其发送事件，导致：
1. `webContents.send()` 抛出 `Render frame was disposed` 异常
2. `chat.ts` 的 `deliver` 回调用 try/catch 吞掉该异常
3. `flush()` 的外try/catch 永远不触发 → `close()` 永不调用
4. dispatcher 保持打开 → 无限循环发送到已销毁的渲染进程 → 错误刷屏

### 修复（4 项）

1. **`boundedEventDispatcher.ts`** — 新增 `shouldClose` 回调：
   - `enqueue()` 入队前检查 `shouldClose()`，若 true 则立即 `close()` 并丢弃
   - `flush()` 每次 deliver 前检查，若 true 则立即 `close()` 并停止
   - 主动检测渲染进程销毁，不依赖异常传播

2. **`chat.ts`** — dispatcher 全面加固：
   - 集成 `BackpressureController`，用 `controller.createAdaptiveScheduler()` 替代 `setImmediate`，实现自适应 flush 延迟（healthy: 0ms / degraded: 100ms / critical: 200ms）
   - 移除 `deliver` 中的 try/catch，让 `webContents.send` 异常传播到 `flush()` 的 catch → `close()` 被调用
   - 新增 `shouldClose: () => target.isDestroyed?.() ?? false`
   - 新增 `handleChatRenderHealthReport()` 导出函数，更新对应 target 的 BackpressureController
   - `ChatEventTarget` 接口新增可选 `isDestroyed?()` 方法

3. **`agentRuns.ts`** — dispatcher 新增 `shouldClose: () => webContents.isDestroyed()`

4. **`index.ts`** — `desktop:render-health` handler 中同时调用 `handleChatRenderHealthReport`，确保 chat dispatcher 也能接收 FPS 健康报告

### 验证

- TypeScript `tsc --noEmit`（windows project）：**0 errors**
- Python `py_compile`（6 个改动文件）：**通过**
- 真实 Desktop 白屏测试：**待验证**

## 仍需验证

1. reasoning → tool → reasoning → 子代理 final 的真实 OAEP 顺序。
2. cancel/error/断连时 reasoning 不进入 Answer，且 final markdown 不丢失。
3. 子代理最终文本只显示在 SubtaskPart，不污染 parent Answer。
4. 大输出在固定 viewport 内滚动，不造成页面白屏。
5. **白屏修复后**：渲染进程 dispose 后不再出现 `Render frame was disposed` 错误刷屏。
