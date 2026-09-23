# DrSai 桌面端流式渲染 / Runtime 数据库 / 会话内存 综合修复方案

- **日期**：2026-09-21
- **范围**：`apps/desktop`（渲染进程 + 主进程）与 `cores/python/packages/drsai/src/drsai/backend`（desktop_gateway / runtime）
- **状态标记**：✅ 已实施并验证 ｜ ⚠️ 已实施待确认 ｜ 📋 规划中（未动代码）
- **涉及症状**：
  1. 前端流式渲染速度过慢（越写越卡）
  2. runtime 数据库臃肿（写放大）
  3. 长会话输出过多 / 进入大会话时前端直接闪退（OOM）
  4. 进入 session 报 "This session is already running a turn. Wait for it to finish or stop it."（session_busy）

---

## 1. 系统数据流全景（问题定位基准）

一条 token 从模型到屏幕、再到磁盘的完整路径：

```
┌─ 后端 gateway（独立进程，生命周期 ≠ 桌面进程）────────────────┐
│ ① 模型流式 chunk（每几 ms 一个）                              │
│ ② agent.py emit_backend()          ← 每事件调用一次            │
│ ③ engine.append_backend_event()    ← 每事件 = 1 个 SQLite 事务 │
│     INSERT runtime_events                                     │
│     INSERT runtime_session_journal（delta 行）                 │
│     UPSERT runtime_conversation_items（累计全文 payload）      │
│     _store_oaep_item / _store_oaep_event（OAEP 投影）         │
│     COMMIT → WAL fsync                                        │
│ ④ journal.notify_committed() → per-session SSE 推送           │
└───────────────────────────────────────────────────────────────┘
        ↓ SSE（跨进程）
┌─ 桌面主进程 ──────────────────────────────────────────────────┐
│ ⑤ SharedOaepSessionController.appendDelta()                   │
│     每事件：O(全文) 字符串拼接 + 新对象 + 跨 IPC 序列化        │
└───────────────────────────────────────────────────────────────┘
        ↓ IPC
┌─ 渲染进程（React）────────────────────────────────────────────┐
│ ⑥ useDesktopChatAdapter：rAF 攒批 → 每帧 N 次全量投影         │
│     readStructuredMarkdown/Reasoning = O(turn 全文) join      │
│     setMessages([...]) → messages 数组无界增长                │
│ ⑦ ChatWorkspaceImpl（~4500 行）每帧整树 render                │
│     StructuredMessageParts：未 memo 全文正则/扫描             │
│     setNow 每秒 → 所有可见消息每秒重渲染                      │
└───────────────────────────────────────────────────────────────┘
```

**核心判断：这条链上没有任何一环是为“长输出”设计的。** 三个症状是同一条链在三个位置的崩溃表现，且互为因果（见 §6）。

---

## 2. 症状成因链

### 2.1 渲染速度过慢 —— “每 token 全量重算”，成本 O(全文 × 事件数)

| 层 | 位置 | 问题 |
|---|---|---|
| (a) 渲染进程 | `useDesktopChatAdapter.ts` `applyStructuredEventToMessage` | rAF 帧内 N 个 delta 事件，**每个**触发一次 `readStructuredMarkdown` / `readStructuredReasoning`（均为 turn 全文 `filter+map+join`）。200KB 回答 × 每帧 5 事件 = 每帧 5 次 200KB 级字符串重建。成本取决于**已积累总量**而非本 delta 长度 → 越写越卡 |
| (b) 渲染层组件 | `StructuredMessageParts.tsx` | render body 中未 memo 全文扫描：`extractPublicSources` 全文正则（useMemo 依赖 `[turn]` 流式期每帧失效）、`inlineArtifactsByMarkdown` 全文 `includes`、`buildProcessTimeline` useMemo 依赖每次 render 新建数组（**memo 恒失效**） |
| (c) 整树重渲染 | `ChatWorkspace.tsx` | `chatWorkspacePropsEqual` 流式期必然不等 → ~4500 行 `ChatWorkspaceImpl` 每帧整树 render；`setNow` 1s 定时器使**所有可见消息每秒重渲染**，与 (b) 叠加 |

**架构本质**：数据流是“聚合→派生→渲染”的单向一次性设计，**没有增量语义**。DOM 层有虚拟化（没问题），但 JS 计算层与组件层无对应增量机制。

### 2.2 runtime 数据库臃肿 —— 逐 token 事务 + 累计全文 UPSERT 的物理写放大

一个 token 落盘的真实代价：

1. **每 token 一个完整事务**（`BEGIN IMMEDIATE` + COMMIT + WAL fsync）。长回答几千 token = 几千个事务，事务/锁/刷盘开销远大于数据本身。
2. **多表冗余写**：同一段文本以 3~4 种形态写入（runtime_events / journal 行 / conversation_items / OAEP 投影）。
3. **`runtime_conversation_items` UPSERT 是放大器**：每 delta 重写该 item 的**累计全文** payload。100KB 回答写 1000 次 ≈ 磁盘写总量 100MB 级。
4. **解药存在但未接线**：`engine.append_backend_events`（复数：单事务、64KiB delta 合并、增量行）**全仓库零调用者**；生产路径一直走逐条单数 API。
5. journal 压缩契约（delta-only、剥离重复 binding keys、100k/90k 自动 compact、1MiB 上限）本身健全——臃肿是**物理写放大 + 存量从未跑维护**，不是语义问题。
6. 伴生：`journal.py` `_redact_credentials` 被显式 `[DISABLED]`，直连 journal 的写入方绕过脱敏（数据治理缺口，需确认是否有意）。

**架构本质**：事件溯源的语义 + 逐 token 的物理提交。数据库被当成“每 token 必须立即持久化”的消息队列，而下游（SSE）完全可容忍 100ms 级聚合。

### 2.3 输出过多闪退 —— DOM 有界、JS 堆无界，三个进程各驻留一份全量镜像

内存账本：

| 进程 | 驻留 |
|---|---|
| 渲染 | ① `messages` 数组无窗口化：每条含 content 全文 + `structuredTurn`（parts 全文、reasoning segments 无字符上限、activities 条数无上限）② **快照整批序列化持久化 + 重新进入时整批水合**（大会话重开即闪退的触发点）③ `liveThreadViewsRef` 缓存整个 messages 数组 ④ 图片 dataUrl 每张 ≤8MB 常驻 |
| 主进程 | `SharedOaepSessionController.items` 订阅期驻留 session 全部 item 全文 |
| gateway | `DesktopAgentManager` 按 (user, session) **无限期**缓存完整 Agent state |

**架构本质**：系统把会话历史当作必须整体驻留内存的对象图，没有任何一层实现“工作集窗口”。SQLite 里本有完整持久副本，内存却再造一份永不淘汰的全量镜像——纯架构性冗余。

### 2.4 "already running a turn" —— 双进程生命周期不一致 + 锁无界

- 唯一抛出点 `_agent_manager.py run_stream`：锁跨整个 turn 持有、**无超时**；`RunStatus.ACTIVE` 置位后 finally **不复位**。
- `runs.py` 202 + detached `asyncio.create_task`：**执行生命周期绑在 gateway 进程，消费生命周期绑在桌面进程**。桌面重启 / 渲染进程 OOM 闪退（2.3 的直接后果）后，gateway 孤儿 turn 继续持锁；重进重发 → `session_busy`。
- 错误以 `agent.failed` 进 journal → 快照记录 → 重进 session 随历史回放（所以每次进入都看到该报错）。

### 2.5 三症状的因果闭环（自我强化循环）

```
渲染慢(2.1) + 内存无界(2.3) → 渲染进程 OOM 闪退
        → gateway 孤儿 turn 持锁 → session_busy(2.4)
        → 用户重进大会话 → 整批水合(2.3) → 更易再闪退 → 循环
```

---

## 3. 修复方案总览

设计原则：**每个组件只承担与其“工作集”相称的成本——写路径按聚合事务、推路径按订阅生命周期、渲染路径按增量、内存按窗口。**

| 阶段 | 目标 | 条目 | 状态 |
|---|---|---|---|
| D | 生命周期一致性（session_busy） | D1 锁有界 + 状态复位 / D2 孤儿 run 治理 / D3 前端恢复体验 | D1 D2 ✅，D3 📋 |
| A | 渲染增量管道 | A1 帧内单次投影 ✅ / A2 追加式派生 📋 / A3 渲染层 memo 收口 📋 / A4 消息级订阅拆分 📋 | 一半完成 |
| C | 写路径聚合 | C1 批量写入接线 ⚠️ / C2 items UPSERT 增量化 📋 / C3 存量维护 📋 / C4 脱敏确认 📋 / C5 分库评估 📋 | 一半完成 |
| B | 内存窗口化 | B1 快照压缩 ✅ / B2 messages 窗口化 📋 / B3 结构上限 📋 / B4 图片 LRU 📋 / B5 三进程驻留治理 📋 / B6 大会话进入路径 📋 | 廉价项完成 |

---

## 4. 已实施修复明细（✅/⚠️）

### D1 ✅ turn 锁有界 + 状态复位（`desktop_gateway/_agent_manager.py`）

- turn 循环改为：`async for` → `anext()` + `asyncio.wait_for` 逐事件限时。
  - **空闲超时**：正常运行中无任何事件超过 `OPENDRSAI_AGENT_TURN_IDLE_TIMEOUT_SECONDS`（默认 600s）→ 放弃该 turn、释放锁。
  - **cancel 宽限**：Stop 请求后 token 未被观测，仅等待 `OPENDRSAI_AGENT_TURN_CANCEL_GRACE_SECONDS`（默认 30s）即强制弃锁。**不再出现“Stop 之后永远 session_busy”。**
- `finally` 无条件复位 `Thread.status`（token 已取消 → `STOPPED`，否则 `COMPLETE`），消除 DB 残留 active。
- 新增 `reset_stale_active_threads()`：gateway 启动时复位上个进程遗留的 ACTIVE thread（启动时必有残留 = 上一进程崩溃/强杀的证据）。

### D2 ✅ 孤儿 run 治理（新 `_stream_watchers.py`、`routes/sessions.py`、`routes/runs.py`、`app.py`）

- `_stream_watchers.py`：per-session SSE 订阅计数（enter/leave，记录“最后订阅者离开时间”）。
- `routes/runs.py`：`_EXECUTION_META` 登记 detached 任务（run_id → session_id/started）；**reaper** 每 `OPENDRSAI_ORPHAN_REAPER_INTERVAL_SECONDS`（60s）扫描——session **曾有**订阅者但断开超 `OPENDRSAI_ORPHAN_RUN_GRACE_SECONDS`（300s）→ 自动 `agent_service.cancel(run_id)`。
  - 安全边界：只针对 `run_execute` 注册的任务；从未被订阅的 session 不动（脚本/测试 API 调用）；WeChat 通道走 `base.execute` 不经 `_EXECUTIONS`，不受影响。
- `app.py` lifespan：启动时（1）复位残留 ACTIVE thread（2）启动 reaper。

**效果**：把“消费生命周期”反向传导给“执行生命周期”——桌面关闭 / 渲染进程崩溃后，孤儿 turn 最长 300+30s 内被终止并释放锁，session_busy 循环被打断。

### A1 ✅ 帧内单次投影（`shared/renderer/src/adapters/useDesktopChatAdapter.ts`）

- 新增 `applyStructuredEventsToMessage(message, events)`：rAF 批次内事件**先全部折叠进 turn state**，只做**一次** `readStructuredMarkdown/Reasoning` join + sanitize + interaction 扫描。原 `events.reduce(applyStructuredEventToMessage)` 的“每事件一次全量投影”被替换（原函数保留为单事件包装）。
- 效果：每帧成本 O(全文×N) → O(全文×1)。

### C1 ⚠️ 批量写入接线（`backend/runtime/engine.py`）

> ⚠️ 触及核心模块（xiongdb 负责），行为可用环境变量关闭，待确认保留或回退。

- `append_backend_event` 对 `message.delta` / `agent.message.delta` 进入**内存缓冲**（per-run），触发 flush 的条件（任一）：
  - 距上次 flush ≥ `OPENDRSAI_BACKEND_DELTA_BUFFER_SECONDS`（默认 150ms，随 delta 流 piggyback 检查——流式活跃期每 150ms 一批，用户无感）；
  - 缓冲 ≥ 512 条 或 ≥ 4MiB；
  - **顺序保护**：同一 run 的任何**非 delta 写入**（append_event / append_normalized_event / transition_run / cancel_run / mark_cancel_requested / request_approval / append_backend_events）先 flush 再写，杜绝“delta 落在 tool.started 之后”的序列倒置；
  - **可见性保护**：`list_events` / `list_oaep_events` / `wait_oaep_events` / `list/wait_session_events` / `save_checkpoint` 读前 flush，SSE 消费者不会长期看不到已产出的 delta。
- flush 走既有的 `append_backend_events` 快路径（单事务、executemany、64KiB chunk 合并、backend-key 幂等）。
- 一键回退：`OPENDRSAI_BACKEND_DELTA_BUFFERING=0`。
- 冒烟测试：`tests/test_backend_delta_buffering_smoke.py`（顺序 / 幂等 / 读可见性 / transition flush，SMOKE_OK）。

**效果**：写事务数从“每 token 一个”降到“每 150ms 一个”（约 2 个数量级），WAL fsync 与锁竞争同步下降。

### B1 ✅ 持久化快照压缩（`useDesktopChatAdapter.ts`）

- `createThreadSnapshot` 持久化前 `compactCompletedTurnsForSnapshot`：
  - 近 `SNAPSHOT_RECENT_ASSISTANT_TURNS`（10）个 assistant turn **原文保留**；
  - 更早的**已完成** turn：清空 `processTimeline`；activities 裁至 16 条、工具 input/output 截断 2KB；reasoning segments 保留末 4 段；subtask timeline/segments 有界。
  - live reducer 不动（渲染不变量 `timeline === aggregate` 不受影响），只压**持久化**形态。
- 效果：快照体积与再水合内存从 O(全部历史明细) 收敛到 O(可见回答 + 近期明细)。

### 已实施验证记录

| 项 | 验证 |
|---|---|
| Python 编译/导入 | `py_compile` 全部通过；`engine + desktop_gateway` 全模块 import OK |
| 缓冲行为 | 冒烟测试 SMOKE_OK（顺序/幂等/可见性/transition） |
| 前端类型 | `npm run typecheck:windows`（node + web）零错误 |
| 未跑 | pytest 全量套件（当前 venv 无 pytest，需 dev 环境补跑 `python -m pytest tests/ --cov=src/drsai`） |

---

## 5. 规划中条目（📋 未动代码，待批准后实施）

### A2 追加式派生（渲染根治第二步）
为每个 turn 维护“已投影 markdown/reasoning 累计串”，delta 到达仅 append 对应 part → 投影 O(delta)。需在保持 reducer 纯函数性的前提下引入 turn 级派生缓存（message 上的派生字段 + 版本号）。

### A3 渲染层 memo 收口
- `extractPublicSources` / `selectInlineArtifactLinks` / `RetrievalStageSummary`：memo 依赖改“长度+指纹”或只扫尾部 4KB；
- `buildProcessTimeline` useMemo 依赖改稳定引用；
- `now` 不进列表 props，下沉为只包裹时长 label 的独立 memo 组件；
- `activeInputMessage` 去掉 `[...messages].reverse()` 每帧拷贝。

### A4 消息级订阅拆分
补齐 A1/A3 后，整树 render 收敛为尾部消息单点更新；进一步用 messages context 解耦 `ChatWorkspaceImpl` 的 props 链。

### B2 messages 窗口化（内存根治核心）
内存只保留最近 N turn 全文 + 更早 turn 摘要行；上滚时经主进程从 gateway（journal/OAEP 表）**分页懒加载**。渲染虚拟化已就位，只补 state 层同构窗口。内存上界从 O(会话历史) → O(当前窗口)。

### B3 结构上限
reasoning segments 总字符截尾、activities 条数封顶、单消息 content 超阈值只驻尾部（完整版在 DB）。

### B4 图片内存
dataUrl → blob object URL + 统一 LRU（如 64MB 上界）。

### B5 三进程驻留治理
主进程：非活跃 session controller 只留游标；gateway：Agent state 缓存加空闲 TTL/LRU。

### B6 大会话进入路径
进 session 改“最近 N turn + 其余分页”，与 B2 同机制——直接消除“重开大会话即闪退”。

### C2 items UPSERT 增量化
delta 只追加增量行；累计 payload 仅在 checkpoint 边界（turn 终止 / 64KiB 聚合）写一次，消除“每 token 重写全文”。

### C3 存量治理
`journal_maintenance.py` 跑一次 repair_legacy_delta_rows / purge_legacy_event_mirrors / compact_runtime_event_payloads + 定期任务。

### C4 脱敏确认
确认/恢复 `journal.py` `_redact_credentials`，或 engine 层统一兜底。

### C5 分库/分区（长期）
journal（高频 append-only）与元数据（低频）分文件或按 session 分区，缩小 WAL 竞争域。待前期收益量化后再评估。

### D3 前端恢复体验
进 session 发现 active run 先 reattach；`session_busy` 类可重试错误不再作为普通失败消息持久化回放，改为“停止/等待”可操作提示。

---

## 6. 实施顺序与依赖

```
第一阶段（止血，低风险）  D1 D2  C1  B1 A1      ← 已实施（C1 待确认）
第二阶段（渲染根治）      A2 A3 A4              ← 纯 renderer 层，可独立灰度
第三阶段（内存根治）      B2 B6 → B3 B4 B5      ← 依赖主进程分页读取 API 设计
第四阶段（存量与长期）    C3 C4 → C5            ← 一次性收敛 + 长期演进
```

量化预期：
- A 组落地：流式期每帧 CPU 从 O(全文×N) → 近 O(delta)；
- B2/B6 落地：渲染进程内存封顶 O(窗口)，闪退根除（同时切断 §2.5 循环）；
- C1+C2 落地：写事务数下降 ~2 个数量级，DB 增速回到与输出文本量线性同级。

---

## 7. 运维参数汇总（新增环境变量）

| 变量 | 默认 | 作用 |
|---|---|---|
| `OPENDRSAI_AGENT_TURN_IDLE_TIMEOUT_SECONDS` | 600 | turn 空闲超时（超时弃锁） |
| `OPENDRSAI_AGENT_TURN_CANCEL_GRACE_SECONDS` | 30 | Stop 后强制弃锁宽限 |
| `OPENDRSAI_ORPHAN_RUN_GRACE_SECONDS` | 300 | 订阅断开后孤儿 run 取消宽限 |
| `OPENDRSAI_ORPHAN_REAPER_INTERVAL_SECONDS` | 60 | reaper 扫描周期 |
| `OPENDRSAI_BACKEND_DELTA_BUFFERING` | 1 | 批量写缓冲开关（0 = 回退逐条） |
| `OPENDRSAI_BACKEND_DELTA_BUFFER_SECONDS` | 0.15 | 批量聚合时间片 |
| `OPENDRSAI_BACKEND_DELTA_BUFFER_MAX_CHARS` | 4MiB | 批量缓冲字节上限 |

---

## 8. 变更文件清单（已实施部分）

```
cores/python/packages/drsai/src/drsai/backend/desktop_gateway/
  _agent_manager.py                  D1（锁有界/状态复位/启动清理）
  _stream_watchers.py            [新] D2（订阅计数）
  routes/sessions.py                 D2（SSE enter/leave）
  routes/runs.py                     D2（_EXECUTION_META + reaper）
  app.py                             D2（lifespan 启动接线）
cores/python/packages/drsai/src/drsai/backend/runtime/
  engine.py                          C1（delta 缓冲批量写入）
cores/python/packages/drsai/tests/
  test_backend_delta_buffering_smoke.py [新] C1 冒烟
apps/desktop/shared/renderer/src/adapters/
  useDesktopChatAdapter.ts           A1 + B1
```

> 回退说明：D 组各条目互相独立可单独回退；C1 设 `OPENDRSAI_BACKEND_DELTA_BUFFERING=0`� 关闭行为，或整体 revert engine.py 改动；A1/B1 集中在单文件两处函数，revert 干净。


## 9. 本轮流式性能优化实施记录（2026-09-21）

本轮只推进渲染与实时写路径，不代表全文计划全部完成。保留已有未提交修改；未提交 Git、未打包发布。

### 已落地

- **A2 部分快路径**：新增 `structuredTextProjection.ts`，WeakMap 按不可变 turn 缓存派生文本。同 turn 最后一个选中段追加时复用前次文本并追加后缀；相同段列表复用结果。替换、前部编辑、段数量变化、final/channel 选择变化、切换 turn 均走规范 join。adapter 帧内批量投影已接线。仍遍历段列表，`startsWith` 也有前缀比较成本，不能称为严格 O(delta)。
- **A3 计时隔离**：移除 ChatWorkspace 顶层一秒刷新；新增 `useStreamingClock`，仅 `TurnDuration` / 空消息 `StreamingStatus` 自行计时，结束后清理 interval。已完成消息无需接收每秒变化的 now。
- **A3 memo**：稳定 citation/progress/reasoning/subtask/artifact/markdown/notice 派生数组；缓存 inline artifact 映射；来源提取以 part 为 WeakMap key，未变 part 不重复正则扫描，不截尾丢来源。变化中的 markdown 仍完整扫描。activeInputMessage 改倒序索引查找，不再复制并 reverse 全列表。
- **C1 会话隔离**：session/OAEP 读取只 flush 目标 session 的 buffered runs，不再冲刷所有会话，避免后台会话读取破坏其他流的聚合。
- **C1 正确性**：flush 内部持有 RLock；事务写失败恢复缓冲供幂等重试，成功释放时间记录；conversation/OAEP snapshot 读取补 flush 保证可见性。
- **C2 核查**：既有批量路径已按 64KiB 合并投影，本轮增加写次数回归，验证 200 条短 delta 在同批次只有 1 次 item 投影调用。此项是既有能力验证，不是新实现跨事务增量化。

### 验证

- `npm --prefix apps/desktop run typecheck:windows`：node/web 全通过。
- `verify-structured-text-projection.mts`：追加、替换、插入、final 隐藏、跨 turn、1000 次连续增长与规范投影比对通过。
- `verify-structured-process-timeline.mts`：通过。
- `verify-streaming-persistence.mts`：通过。
- `verify-terminal-rendering-performance.mts`：通过（终端 parser 测试不是聊天端到端性能指标）。
- `test_backend_delta_buffering_smoke.py`：顺序、幂等、OAEP 可见性、终态 flush，以及新增会话隔离、失败重试、快照读取和批量投影计数全部通过。
- `python -m py_compile .../runtime/engine.py`、`git diff --check`：通过。
- 当前 Python 环境无 pytest / ruff，未执行全量 pytest 和 ruff。尚未进行真实 Electron 长回答端到端 CPU、帧率和内存压测。

### 剩余边界

- A4 context/消息级订阅重构未实施；继续使用现有 VirtualMessage 的消息引用级隔离，不将其标记为 A4 完成。
- C2 跨事务 checkpoint 增量落盘未实施，累计 item payload 仍会在聚合边界重写。
- 同会话实时读取仍会提前 flush，150ms 是聚合目标而非固定提交间隔；没有定时后台 flush，空闲尾部依赖后续写入/读取触发。不能保证生产写事务降低两个数量级。
- A3 RetrievalStageSummary 专项缓存、B2/B6 分页窗口、其他内存治理与存量维护仍待实施。


## 10. 第二轮实施与更正（2026-09-21）

本轮已实现并回归验证：

1. Gateway 等待循环改为 `asyncio.wait` + 100ms 取消观测，取消宽限 deadline 跨事件保持，不因持续迟到输出被重置。超时抛 `agent_turn_idle_timeout` / `agent_cancel_timeout`，不再按正常完成处理。
2. 不合作的 provider / save_state 被保留引用、观察异常并从 Agent cache 隔离；锁释放，但同 session 在旧协程结束前返回 `session_recovering`，不冒险并发写同一 SQLite context。此方案是保守隔离，不是进程级 fencing，不能强杀旧工具副作用。
3. Agent close / save_state capture 使用不等待取消确认的 deadline。迟到 save_state 返回值不会继续写入持久化。同步数据库写入、压缩仍可能阻塞 event loop，尚无硬超时；不能宣称整个 finally 已完全有界。
4. Runtime 增加每 engine 至多一个待触发 Timer，尾部 delta 无后续写/读也能提交；失败保留缓冲并定时重试。增加 close 停止调度并 flush，gateway 正常关闭流程已接线。该定时器每批重建而非永久线程；调度受 SQLite 锁和操作系统影响，不是硬实时保证。
5. Renderer 连续 item.delta 批次只建立一次消息索引和一次 messages 副本；结构性 patch 保留规范路径并重建索引。part/activities 仍有扫描，非完整 normalized store。
6. UI 为恢复隔离/取消超时/空闲超时提供明确提示，避免引导连续重发。

验证：`test_turn_wait.py` 4项、`test_gateway_turn_recovery.py` 2项、`test_backend_delta_timer.py`、既有 delta buffering smoke、5000 messages/300 deltas 的 batch 对照测试、streaming persistence、model provider errors、Windows node/web typecheck、py_compile、diff --check 通过。无真实 Electron OOM/长输出/故障注入压测。环境无 ruff；使用 unittest，未跑全量 pytest。

### 历史路径更正（必须先于后续窗口化）

之前“桌面无参数请求意味着后端返回全部历史”的判断不准确：`routes/sessions.py` 的 HTTP OAEP snapshot 默认 limit=100，调用 engine 时显式传 limit，已有 item 分页。但是为 P1 migration 的 checkpoint hash，gateway 仍读全量 checkpoint_items。main controller 未保存并对接此 OAEP window 游标，历史按钮目前使用的是 backend-history sync 游标，两者不能混为一谈。

本轮未贸然切换默认 snapshot / 截断 messages，避免将不完整窗口覆盖现有权威快照。后续需分别实现 OAEP history cursor 透传与合并、跨页 revision/waterline 校验、完整 run 边界、卸载/回取、迁移后 checkpoint 摘要的增量维护。

### 未完成清单

- 单 session 正文工作集窗口与历史完整回取；单超长消息分块、图片解码预算。
- 前500条本地快照策略的无损迁移（不能只改为后500条而丢早期唯一副本）。
- 进程级 run fencing / renderer 消费租约 / 全面 reattach。
- Runtime append-only正文 chunks + checkpoint格式迁移；累计 item UPSERT 写放大仍在。
- 存量数据库清理、VACUUM、分库、真实性能采样均未执行。
- 本轮仓库改动未打包/发布，正在运行后端未自动更新；general Delegate 仍报旧能力错误，故本轮实际修改直接完成。


## 11. 第三轮：OAEP 历史分页接通与 checkpoint 摘要优化（2026-09-21）

### 本轮已落地

- RuntimeClient 支持 OAEP snapshot cursor/limit；共享 controller 保存 continuation，每次加载一页并 singleflight。
- 新增 `oaepHistoryCursor` 请求字段与 `oaepNextCursor` / `oaepHasMore` 历史状态，明确区别 backend-import `historyCursor` / `nextCursor`。Renderer 按 OAEP 优先顺序加载，Windows IPC 校验字段与互斥关系。
- 历史合并不回退 live cursor、不覆盖更晚事件，缺 baseline 的 delta 待历史抵达重放；待重放队列上限2048条/4MiB，超过预算执行resnapshot而非静默裁剪。
- 分页末页验证整体count/hash，失败原子拒绝；完整加载后释放checkpoint正文副本。resnapshot清空旧窗口并重置continuation，不能把漏journal gap的旧内容当作权威。
- Windows分页错误不再被persisted fallback吞掉；OAEP窗口不再被“较大但陈旧”的本地快照替代。过期游标展示提示并仅刷新一次当前窗口，不重试旧游标。
- Gateway迁移摘要使用按digest顺序的逐条迭代和canonical字节哈希；新增最多128项的摘要元数据缓存（无正文），按journal实例、session、水位、authority、迁移版本等隔离。续页水位不变时复用，保留raw hash/count校验。

### 验证

- Windows node/web typecheck通过。
- `verify-oaep-history-pagination.mts`：单页、共享请求、live/shadow重放、广播、count/hash、游标域隔离、过期checkpoint恢复、队列预算等通过。
- `verify-thread-history-request.mts`：OAEP优先与backend游标互斥选择通过。
- `test_gateway_snapshot_checkpoint.py`：10项unittest通过；包括冷/热摘要、更新失效、authority/journal隔离和canonical等价。
- 既有5000 messages/300 deltas批更新、streaming persistence回归通过；子代理另验证runtime leases、backpressure/protocol选择。
- Python编译与diff check通过。macOS composition测试因缺少对应controller文件未能bundle，未声称macOS端到端验证。

### 剩余边界

- 历史分页不是正文窗口淘汰：持续加载仍累积；分页完成前为整份digest保留checkpoint items，live更新可能造成额外正文驻留。
- controller卸载后不持久化pagination状态；旧游标失配时从新窗口重新加载。没有实现跨卸载从旧checkpoint无缝续页。
- 冷快照仍有原始checkpoint扫描和迁移摘要扫描，未实测峰值内存；仅避免逐页重复全量迁移与副本。
- 数据库仍为current projection，旧revision被覆盖后旧cursor可能不可恢复，需要刷新checkpoint；尚未MVCC历史重建。
- 单run可能跨item页，需加载更早页才完整；尚未run级分页和单超长消息分块。
- 未改存量库、未修改全文chunk存储格式、未实施正文LRU，不能宣称OOM或数据库写放大已经根治。
- 本轮改动未commit/打包。前端需重新构建/加载；本轮新增后端修改也需再次加载后端才能用于实际界面。
