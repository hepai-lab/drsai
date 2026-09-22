# 流式链路优化：本轮修复与验证

日期：2026-09-21。状态：阶段性修复完成，不代表整体性能验收完成。

## 基线说明

当前工作区已有未提交的增量文本投影、分页历史、streaming clock、定时刷盘、turn quarantine 等修改。本轮保留这些工作，不进行 merge/commit/reset，不维护真实数据库。此前文档关于“批量入口已完整覆盖”“严格30秒释放锁”“闪退根除”“性能提升两个数量级”的表述不能作为已验证结论。

## 本轮实际修复

### Runtime 高频入口与并发顺序

文件：`cores/python/packages/drsai/src/drsai/backend/runtime/engine.py`。

确认桌面生产链路 services.emit → append_event 没有完整接入已有 delta 缓冲。本轮将 message.delta / agent.message.delta 接入已有 timer、失败重试与批量路径，为无 backend key 的事件生成独立 key，避免相同文本 chunk 被误去重。

将8个写入口的 flush 移入后续事务外层的同一把锁，防止 flush 与 marker 提交之间并发追加造成顺序倒置。未重写现有 timer 或 quarantine 实现。

新增测试：`cores/python/packages/drsai/tests/test_backend_delta_ingress.py`，覆盖真实 services 入口、重复 chunk、flush失败保留与事务回滚重试、close尾刷、并发写入口、禁用缓冲的同步 identity。

### 主进程与渲染进程缓存淘汰

文件：
- `apps/desktop/shared/main/threadSnapshotEnvelopeCache.ts`
- `apps/desktop/shared/renderer/src/threadSnapshotStore.ts`

更新已有 key 时刷新 Map 的 LRU 顺序；扫描过期项时跳过 pinned/subscribed 项继续向后扫描，不再因头项活跃而阻止后续 inactive 项清理。

新增测试：`apps/desktop/shared/test-kit/verify-snapshot-cache-eviction.mts`。修复前6项断言失败，修复后通过。本轮不增加历史正文截断。

## 验证结果

后端使用仓库 src 的 PYTHONPATH 和 stdlib unittest discover：
- test_backend_delta_ingress.py：6通过（包含8个并发入口子场景）
- test_backend_delta_timer.py：1通过
- test_turn_wait.py：4通过
- test_gateway_turn_recovery.py：2通过
- test_gateway_snapshot_checkpoint.py：10通过

合计23个测试通过。既有 buffering smoke 在显式关闭engine并清理临时目录的包装运行下通过；timer延长以避免同步断言竞态，不作为生产延迟测试。

前端9个 verify 脚本通过：structured-text-projection、oaep-history-pagination、thread-history-request、hydration-request-policy、snapshot-cache-eviction、thread-snapshot-storage、stream-backpressure、streaming-persistence、runtime-client-leases。

Windows typecheck（node + web）exit_code=0。生产修改 diff --check 通过。未执行全仓测试、Electron长时压测或真实性能测量。

## 当前架构结论

1. 历史加载确实每次loadEarlier只取一页（limit=100），不是点击后循环拉全量。
2. 分页不等于驻留有界：加载后的items/runs持续累计；事件replay仍循环至has_more=false。
3. 两层快照缓存active pins/subscribers可突破128项/64MiB默认预算，释放后才回收；这不是总堆内存硬上限。
4. 关键item/run事件的listener Promise backlog仍有无界风险；SSE未闭合frame缺少大小上限。
5. renderer后台会话/draft/live-view的总字节缺少统一预算；现有4096事件上限停止追加的路径需要可靠游标恢复，而不是静默丢内容。

## 剩余风险和下一阶段

P1：工作集窗口及字节预算。已加载历史须支持卸载与再次按游标读取；活跃单轮巨型输出需要分块/按需取回。模型上下文、完整持久历史和显示窗口分离，不能通过删除正文省内存。

P2：端到端背压。统一事件数与字节预算，合并同item delta；控制/终态事件严格保序。超限用快照水位与游标恢复，禁止静默丢失。SSE frame设置协议错误边界。

P3：生命周期验证。进程内quarantine不是强制终止provider；需验证save-state期间外层取消、terminal后晚到delta、旧任务写入隔离。无订阅不能直接视为孤儿，后台任务策略须独立确认。

P4：存储治理。按表统计行数、payload字节、DB/WAL体积，区分写放大与保留体积。备份后再设计日志保留与空间回收；本轮未运行存量清理。

兼容性：开启缓冲的append_event delta返回buffered占位结果，不立即提供真实sequence。已检查生产streaming调用不消费identity，外部调用方仍需审计，禁用缓冲保持原同步行为。

## 完成标准

实时、断线恢复、重启恢复结果一致；长输出CPU与队列积压可控；固定窗口内存趋稳；真实生产入口事务数和写字节有实测改善；取消/审批/后台执行不会误终止或串写。达到这些标准前，不宣称整体优化完成或闪退根除。


## 追加验证：OAEP listener / SSE 有界背压（2026-09-21）

本节仅更新上文“critical item/run Promise backlog、未闭合 SSE frame”两项结论，不表示端到端优化完成。保留原工作区 dirty；未 merge/commit/reset，未新增依赖、未清理或修改用户持久历史。

### 本轮文件与设计

- `apps/desktop/shared/main/oaepSessionStream.ts`：每 listener 的 executing + queued 通知最多 **256** 个，Event 按 JSON UTF-8 payload 计费，预算 **8 MiB**；snapshot/connection/state 等非 Event 通知按每个 256 bytes 计费。所有内部通知生产者等待 admission，满时不继续延长 listener Promise chain，SSE/replay 等待消费者释放预算。item/run/control/terminal 使用同一 FIFO，不因背压丢弃事件，不用快照替代被丢的事件。新增 peak pending/bytes 和 waits metrics。
- SSE 逐 byte 扫描、4 KiB 起始几何扩容、单 frame 上限 **8 MiB**，完整 frame 才 decode，跨 chunk UTF-8、CRLF/CR/LF 均覆盖。超限 `oaep_sse_frame_too_large`；单 Event 超预算 `oaep_listener_event_too_large`，均走现有 fatal 分类而非 checkpoint 重建。EOF 未闭合 frame 不派发。
- stop 幂等、唤醒 admission；分页 drain 可由 listener removal 解除。AsyncLocalStorage 检测同 controller callback 内 history 加载和非 connected 阶段重订阅，明确拒绝自等待。新增可选 `subscribeOaepSession(..., { signal })`，允许初始 replay/ready 返回前取消。初始 ready 失败会移除没有返回 stop handle 的 listener，释放其 ownership。
- `apps/desktop/shared/test-kit/verify-oaep-stream-backpressure.mts`：新增可运行测试，使用真实 shared controller + fake RuntimeClient/ReadableStream。覆盖900小事件 count 上限、25个700KB事件 byte 上限、多 listener FIFO 与终态、慢 listener 移除、最后 stop 不等待卡住 callback、重入拒绝、700事件初始 replay 背压/取消、gap replay 连续 cursor 恢复、live 超大 frame fatal、超大 replay Event 及失败 ownership 释放、跨 chunk SSE 与 parser consumer 等待。
- `apps/desktop/shared/test-kit/verify-runtime-client-leases.mts`：仅调整初始 ready 失败后的 ownership 断言：应释放而非保留无 stop handle 的 degraded controller。generation rebind 上限、错误类型及 outbox 验证保留。
- 本文仅追加，不改写前轮内容。目标实现/lease 测试修改前副本保存在本次 repo 外 workspace，局部 diff 与已有 dirty 分开审查。

### 实际验证命令与结果

cwd：`D:\work\projects\drsai`。最终实现版本执行以下命令，7项均 exit=0：

```powershell
$tests = @('verify-oaep-stream-backpressure', 'verify-oaep-history-pagination',
  'verify-stream-backpressure', 'verify-streaming-persistence',
  'verify-runtime-client-leases', 'verify-runtime-protocol-selection',
  'verify-agent-run-recovery')
foreach ($test in $tests) {
  node apps/desktop/shared/test-kit/run-bundled-test.mjs "apps/desktop/shared/test-kit/$test.mts"
  if ($LASTEXITCODE -ne 0) { throw "$test failed" }
}
Push-Location apps/desktop/windows
npm run typecheck
Pop-Location
```

Windows typecheck: node + web 均通过，exit=0。历史分页测试保留 journal 2048 events / 4 MiB 超限 checkpoint 恢复验证；新 gap 测试验证 replay cursors [0,1]、delivery [1,2,3]、恢复 connected 在 terminal 前、无 resnapshot。未运行 legacy shared 实现的协议脚本，不能将其视为本实现覆盖。

过程中的非通过结果也保留：
- 增加 ready-failure 释放后，lease 测试旧断言期望 registry 仍为 degraded，实际 undefined；已将该断言改为 ownership 必须释放，最终重跑通过。
- 额外执行 `node apps/desktop/shared/test-kit/run-bundled-test.mjs apps/desktop/shared/test-kit/verify-chat-run-recovery.mts` 失败：`reasoning.length` 期望2、实际0。当前 `chatRunJournal.ts` 已过滤 reasoning/chunk/status，而该测试仍期待 reasoning 持久化；失败发生在使用 OAEP 订阅之前。本轮未修改 journal 或该测试，也未宣称重启恢复全部通过。

### 明确限制 / 未验证范围

1. 预算是每 listener 回调队列，不是总 JS heap 或端到端上限。canonical items/runs、共享可变 state、历史页/replay response、transport 自己的 read chunk、解码/JSON 临时分配及任意下游队列不在其中；非 Event payload 仅固定计费。慢 listener 会暂停共享 producer，影响其他 listener 的进度；移除它后才继续。
2. 回调必须返回其异步工作 Promise 才能背压。fire-and-forget persistence/IPC 等不会被自动等待。state 仍是回调执行时共享 maps，不是逐事件快照；Event 自身 FIFO 并非原子跨 listener 同步快照保证。
3. 回调不得等待自身 subscribe ready、未 stop 的 done 或未来 Event，否则形成用户依赖环。已验证最后 listener stop 后 await done；未保证剩余 listener 任意互等、跨 controller 环或无限 callback 都能自动解开。callback 内 history/非 connected 重订阅以明确错误拒绝；`done` 仍是 producer completion，不是 listener drain。
4. 分页 signal 在已进入 callback admission/drain 后并非强制中断保证；移除 listener 可解除等待。未新增并发分页全局序列化。已有 callback 异常后的 resnapshot fallback、presentation noise 过滤，以及 cursor expired/历史 delta journal 超限的 checkpoint 恢复契约保留；不把它们作为背压丢事件的补偿。
5. 8 MiB 是新的 fail-closed 兼容性边界，合法但更大 payload 也明确 fatal；SSE buffer 计入规范化后的行分隔符，不按整个连接累计。未做 Electron 长时压测、真实网络/服务端内存预算、全仓测试或性能收益测量，不宣称 OOM/闪退已根除。

## 历史工作集卸载：本阶段只读评估结论

本轮未实施活动会话历史卸载，原因是当前契约不足以保证无损：renderer存在未进入Runtime的本地消息；Desktop整份快照写入缺少用于卸载的持久化成功确认；窗口回写可能覆盖完整历史；OAEP分页仅支持继续向早读取，没有已加载页的双向回读；未完成分页的checkpoint baseline仍参与全量digest验证，不能直接删除。

下一步须先建立：本地消息独立持久记录与成功确认、已加载页冷存储及稳定page handle、checkpoint baseline与working state分离保存、完整Run级卸载、晚到事件恢复底座后再应用、跨层generation/sequence原子窗口切换。显示窗口不能改变模型上下文、导出或用户历史。禁止用slice截断替代卸载。

本阶段交付是listener队列与SSE frame背压治理，不是总堆内存硬封顶。真实Electron长时压力测试、跨listener依赖环、下游fire-and-forget积压仍待验证。


## 2026-09-21 follow-up: slow-listener event-time projection and publication ordering

### Scope / preserved workspace

This pass changes only `apps/desktop/shared/main/oaepSessionStream.ts`, a stale backpressure comment in `apps/desktop/shared/main/chat.ts`, `apps/desktop/shared/test-kit/verify-oaep-stream-backpressure.mts`, and this appended section. Existing staged/unstaged/untracked work was preserved; no merge, commit, reset, dependency installation, or real DB cleanup was performed. Tests use stubs or their own temporary directories. The actual Desktop source root is `apps/desktop/shared`.

### Confirmed issue and fix

- The old `onEvent(event, this.state)` closure read the producer's state when a queued callback eventually executed. Capturing only the outer object would not fix it: `items`, `runs`, and `deltaShadows` were shared mutable Maps. A slow callback could observe a later cursor, completed tool/Run or future approval, including after an `await`. This also affected SessionViewStore's whole-Run projection and the cursor persisted by threadRuntimeSubscription.
- Each listener now has its own FIFO materialized projection. Initial/snapshot/history publication captures a Map baseline once; each listener copies those Map indexes on delivery, then reduces only incoming Events into its local projection. Reducers replace affected values rather than mutating shared Item content. There is **no per-Event copy of the entire history**, and maps keep their identity between snapshots. State-bearing presentation-noise events update the projection without invoking `onEvent`; empty heartbeats remain filtered as before.
- Callback state is stable until the Promise returned by that callback settles. It is not an immutable historical object after the callback returns, and listeners must not mutate it. `subscription.state`/`subscription.cursor` remain the live producer view and can be ahead. Listener-error snapshot recovery uses that listener's FIFO position, not the producer's future state. Run summaries from history pages remain provisional; canonical stream validation is still performed before listener reduction.
- Event mutation/admission, snapshot replacement/admission and history merge/admission share a publication chain. Network reads and callback drain are outside the critical section. A history response cannot overtake an Event blocked on a different listener. Snapshot closures capture the publication baseline, and connection callbacks capture their retry attempt rather than reading a later reset value.
- Stop removes the attached queue from current gauges immediately and wakes admission/drain. Event/control/terminal ordering remains FIFO. Terminal is not allowed to overtake earlier work: a callback that never settles can still delay terminal delivery indefinitely. `done` remains producer completion, not a listener-drain guarantee.

### Payload-free metrics (shared controller scope)

All metrics remain numeric and contain no event bodies, IDs, prompts, tool arguments or results:

- `listenerPending`, `listenerBytes`: aggregate **attached listeners' executing + queued notifications** (Events plus control callbacks); removed queues stop contributing immediately, even if user code is still pending.
- Existing `listenerPeakPending`, `listenerPeakBytes`: maximum on any **single** listener, preserving the 256 notification / 8 MiB admission-budget interpretation.
- `listenerTotalPeakPending`, `listenerTotalPeakBytes`: aggregate high-water marks corresponding to the current gauges. Multiple listeners may exceed one listener's budget in aggregate.
- `listenerBackpressureWaits`: blocked admission episodes. `listenerWaitMs` / `listenerMaxWaitMs`: total/max settled admission waits, using a monotonic clock, including waits ended by removal. An ongoing wait is not added until it settles.
- `listenerMaxQueueDelayMs`: maximum observed enqueue-to-callback-start delay. `listenerMaxTerminalDelayMs`: same for completed/failed/cancelled Run Events. These exclude admission wait and callback execution time; they do not claim end-to-end terminal/UI latency, and removed callbacks do not produce a start sample.
- Byte accounting is serialized UTF-8 Event size and a fixed 256-byte control charge, **not retained heap**. Sampling is O(1) per notification/wait, without logging payloads.

### Oversized frame: actual protocol review, no invented recovery

Reviewed `cores/python/packages/drsai/src/drsai/backend/desktop_gateway/routes/sessions.py`:

- `/oaep-events` reads exclusive `after_sequence`, default 500/max 2000 Events, and returns migrated durable Events. SSE validates the starting cursor before response, reads batches of 500, and emits one migrated JSON Event as `id: ...\nevent: oaep.event\ndata: ...\n\n`, with `ensure_ascii=False` and compact separators. Neither route offers Event fragmentation/reassembly or an alternate bounded large-Event retrieval protocol.
- Replaying a genuinely over-budget Event still hits the listener's 8 MiB Event limit; blindly resnapshotting could skip required tool/approval/terminal transitions and is not equivalent to successful Event delivery. Reopening the stream at the same cursor can encounter the same frame again.
- SSE framing overhead means an over-limit *frame* does not prove its JSON Event also exceeds the Event budget. Existing replay could theoretically retrieve a near-boundary Event that fits, but this pass does not implement or claim that fallback: current JSON replay decoding is not a byte-bounded recovery path, and no generic guaranteed recovery follows from the protocol.
- Therefore `oaep_sse_frame_too_large` and `oaep_listener_event_too_large` remain explicit fatal, fail-closed outcomes. The rejected Event does not advance the contiguous cursor; tests assert no fake reconnect/resnapshot success. Fatal callbacks still obey FIFO and may themselves be delayed behind a slow listener. No API extension, limit bypass or silent Event skip was added. A future recovery design needs explicit bounded response/admission semantics and transition-preservation tests.

### Runnable validation executed in this pass

From repository root, use the existing bundled runner (no new dependencies):

```powershell
node apps/desktop/shared/test-kit/run-bundled-test.mjs apps/desktop/shared/test-kit/verify-oaep-stream-backpressure.mts
node apps/desktop/shared/test-kit/run-bundled-test.mjs apps/desktop/shared/test-kit/verify-oaep-history-pagination.mts
node apps/desktop/shared/test-kit/run-bundled-test.mjs apps/desktop/shared/test-kit/verify-runtime-client-leases.mts
node apps/desktop/shared/test-kit/run-bundled-test.mjs apps/desktop/shared/test-kit/verify-stream-backpressure.mts
node apps/desktop/shared/test-kit/run-bundled-test.mjs apps/desktop/shared/test-kit/verify-streaming-persistence.mts
node apps/desktop/shared/test-kit/run-bundled-test.mjs apps/desktop/shared/test-kit/verify-chat-run-recovery.mts
npm --prefix apps/desktop/windows run typecheck
```

Results:

- **PASS** OAEP stream backpressure: existing count/byte limits, split UTF-8/CRLF/EOF and oversized SSE, FIFO, multi-listener, stop, callback reentrancy, 700-Event initial replay, gap replay and terminal cases. New deterministic blocked-callback cases check state/cursor after `await`, snapshot stability, tool running/completed, approval via the existing interaction Item, waiting/completed Run, actual SessionViewStore patches (no future approval in an earlier whole-Run projection), listener failure recovery at sequence 4, and stable Map identity across Events. New history cases publish while admission is full, compare both listeners' publication order, and stop while history is blocked. Reconnect callbacks assert captured retry attempt and Event-time cursor; current gauges return to zero after drain/removal, timing samples become positive, and all metric values are numeric. Test transport producers may enqueue synthetic data eagerly; this is not a total-heap stress benchmark.
- **PASS** OAEP history pagination: live/shadow rebase, checkpoint atomicity/digest, shared history broadcast, provisional Run summaries, cursor expiry and bounded journal recovery.
- **PASS** Runtime client leases: generation rebind, ownership, degraded outbox release and lifecycle diagnostics.
- **PASS** generic stream backpressure and streaming persistence/coalescing/frame-aligned display regressions.
- **PASS** Windows `typecheck:node` and `typecheck:web`. The first development run found a new un-narrowed `event.data.run.id` access; it was corrected with the existing OaepRun type, then the full node+web command passed twice.
- **FAIL, existing mismatch re-observed** `verify-chat-run-recovery.mts`: `reasoning.length` expected 2, actual 0, before OAEP subscription/recovery. `chatRunJournal.ts` currently filters `chunk`/`reasoning`/`status` at line 36, while this test expects them persisted. This pass does not modify that separate journal policy or weaken the assertion. The overall validation suite is therefore not reported as all green.

### Remaining limits / GUI evidence

No Electron GUI pressure run, FPS measurement, real renderer IPC saturation test, or production heap profile was performed in this API/tool session. Headless regression and typechecking are not substitutes for them.

The queue budget does not bound canonical/history Maps, checkpoint indexes, listener-local projection indexes, queued snapshot baselines, decoded HTTP pages/transport chunks, renderer/IPC queues, or user-retained callbacks. Each listener adds O(loaded history) Map indexes and its own evolving changed values; repeated delta reduction adds per-listener CPU. A snapshot/history publication can still copy/scan the loaded history, but ordinary Events do not. One slow listener can block the shared producer; no scheduling priority, callback timeout, arbitrary cross-listener dependency-cycle handling or fire-and-forget downstream backpressure was added. Long-history heap/GC and terminal end-to-end latency need a real Electron follow-up.
