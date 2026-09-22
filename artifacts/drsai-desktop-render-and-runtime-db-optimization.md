# DrSai 桌面端渲染慢 + runtime 数据库臃肿 —— 综合诊断与优化方案

> 分析对象：`apps/desktop`（Electron 渲染端）+ `cores/python/packages/drsai/src/drsai/backend/desktop_gateway` 与 `backend/runtime`
> 结论：桌面端"渲染慢"**不是一个前端问题**。渲染层已经做了大量优化（虚拟化、memo、rAF 批处理、markdown 分块），真正的瓶颈在**后端事件存储与流式投递链路**——它先被 O(n²) 的写入放大拖慢，再把体积与延迟传导给前端。

---

## 0. 一句话结论

**651 MB 的 `engine.sqlite3` 里，约 252 MB 是纯事件流冗余；其根因是"每个 delta 都落一行 + 每次 commit 都全库扫容量 + 读路径二次 join 重建文本"。** 前端每次打开会话都要从这份臃肿数据里重建快照，于是表现为"渲染慢"。

---

## 1. 实测证据（本机真实数据，非推测）

### 1.1 数据库体积

| 文件 | 大小 | 关键事实 |
|---|---|---|
| `~/.drsai/runtime/engine.sqlite3` | **652.1 MB** | `auto_vacuum=0`，`freelist=0` |
| `~/.drsai/workspace/drsai/drsai.db` | **611.4 MB** | `auto_vacuum=0`，`freelist=425` |
| `~/.drsai/workspace/drsai/drsai.db-wal` | 17.1 MB | WAL 无上限 |

### 1.2 engine.sqlite3 表级分布（行数 + payload 字节）

```
runtime_events                  240,692 行    payload   19.0 MB   avg  83 B
runtime_session_journal         187,719 行    payload   73.1 MB   avg 408 B  max 262 KB
runtime_oaep_events             187,719 行    payload  178.7 MB   avg 998 B  max 132 KB
runtime_oaep_item_event_refs    183,221 行             8.8 MB
runtime_conversation_items        1,823 行             4.4 MB   avg 2.5 KB max 262 KB
```

对比：`runtime_sessions` **仅 17 行**，`runtime_runs` **仅 82 行**。
→ **真实业务数据只有几百 KB，事件表却占了 650 MB，比例约 1000:1。**

### 1.3 冗余画像（按 event_type 聚合）

**`runtime_session_journal`（73 MB）**
```
conversation.item.delta    179,945 行   59.75 MB   ← 96% 的流式增量冗余
conversation.item.upsert     1,652 行    4.78 MB
conversation.item.created    1,687 行    3.71 MB
session.updated              2,598 行    2.44 MB
```

**`runtime_events`（240K 行，19 MB）**
```
agent.message.delta        179,173 行    8.96 MB
subagent.markdown           56,203 行    4.49 MB   ← 子智能体流式也全量落盘
tool.started                 1,583 行    2.28 MB
```

**关键**：`agent.message.delta` 179,173 行 / 8.96 MB → **平均每行仅 52 字节**，即"每个 token 事件一行"。代码注释亦自述：73,307 条 delta 行中，payload 的 **44.7 MiB / 70.0 MiB 是重复的 binding keys，真正的 chunk text 只有 209 KiB**（约 0.3% 有效载荷）。

### 1.4 employees 分布佐证 O(n²) 累积

- `runtime_conversation_items` 仅 1,823 行却占 4.4 MB，`max=262 KB`——单条 item 的 text 被反复"整段重写"。
- 代码 `engine.py:3635` 区：`payload["text"] = f"{prior.get('text','')}{delta}"` → **每次 delta 重写整个已累积文本**，n 字符消息累计写 ≈ O(n²)。

---

## 2. 后端根因（带行号证据）

### 2.1 【P0】流式事件"每 delta 一行" + 全量冗余字段

- `journal.py:1079-1086` `runtime_oaep_events` 每事件一行 envelope（`avg 998 B`）。
- `journal.py:946-960` `runtime_session_journal` 每事件一行，带 12 个 binding keys 重复。
- 虽然代码已有 `normalized_journal_item_payload`（增量契约）与 `MAX_DELTA_JOURNAL_PAYLOAD_BYTES = 1<<20` 失败关闭，但**历史行未修复**，且 `runtime_oaep_events.envelope_json` 仍是最大单一来源（178.7 MB）。

**修法**：在写入侧对 delta 事件做**行内合并**（同一 `(session_id,item_id,segment_id)` 的连续 delta 合并成一行，携带 `first_sequence/last_sequence`），或直接对 `runtime_oaep_events` 的 envelope 做 `compact`（复用现有 `compact_delta_payload` 常量集）。

### 2.2 【P0】每次 commit 触发全库容量扫描

```python
# journal.py  enforce_capacity()（session_id=None 分支）
rows = db.execute(
    "SELECT session_id,last_sequence,earliest_retained_sequence "
    "FROM runtime_session_sequences WHERE "
    "last_sequence-earliest_retained_sequence+1>?",
    (self.max_events_per_session,),
).fetchall()
```
`notify_committed()` 在**每一次写事务后**调用它。engine 中约 **27+ 个 `notify_committed` 调用点**。
→ 成本 = O(会话数) × 事件数。流式时每个 batch 都付一次。

**修法**：把容量检查改为**按 session 参数调用**（写路径总是已知 session_id），或维护"溢出 session 集合"，把 O(all sessions) 降到 O(1)。

### 2.3 【P1】Item 投影 O(n²) 全量累积

```python
# engine.py:3635 (_record_runtime_event_item_in_transaction)
payload["text"] = f"{prior.get('text','')}{delta}"
if native_oaep_message_delta or event_type in message_delta_events:
    payload["content"] = payload["text"]
```
Journal 已是增量契约，但 item 投影没有对齐。

**修法**：`runtime_conversation_items` 只存增量块或末态指针；读取时归并（复用 `_hydrate_delta_payloads`）。

### 2.4 【P1】读路径二次 join 重建

```python
# journal.py:2630-2642  wait_for_oaep_events → wait_for_events(内部 replay) → 再 replay_oaep
legacy = self.wait_for_events(session_id, after_sequence=after_sequence, timeout=timeout, limit=limit)
if not legacy:
    return []
return self.replay_oaep(session_id, after_sequence=after_sequence, limit=len(legacy))
```
每批最多 500 条，**走两条 join 路径 + `_hydrate_delta_payloads` 重建全文**。

### 2.5 【P1】每事件固定多次 DB 往返

- `engine.py:3992`：`SELECT COALESCE(MAX(sequence),0)+1 FROM runtime_events WHERE run_id=?`（走 PK 索引，但仍是 per-event 往返）
- `journal.py:1688-1702`：`_next_sequence` 每个事件 **INSERT + SELECT + UPDATE 三条语句**
- 每条 delta 又叠加 `runtime_oaep_item_event_refs` 一行（183,221 行）

**修法**：`runtime_runs`/`runtime_session_sequences` 增加 `last_sequence` 列，用 `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` 合并为单语句。

### 2.6 【P2】无自动空间回收

- PRAGMA 现状（`journal.py:924-934`、`engine.py:429`）：`journal_mode=WAL`、`foreign_keys=ON`、`timeout=30`、`isolation_level=None`
- **全 backend grep 零命中**：`auto_vacuum`、`journal_size_limit`、`wal_autocheckpoint`、`synchronous`
- `VACUUM` 只在离线 CLI `journal_maintenance.py:217-218` 手动触发

→ 删除历史行后**文件永不收缩**，WAL 无上限。这正是"数据库越来越臃肿"的直接原因。

### 2.7 【P2】缺索引导致全表 MAX 扫描

```python
# journal.py:2672-2676  workspace_catalog_watermark
"SELECT COALESCE(MAX(rowid),0) AS watermark FROM runtime_session_journal "
"WHERE workspace_id=? AND event_kind IN ('session.updated', ...)"
```
`runtime_session_journal` 上 `workspace_id` / `event_kind` **无索引**。

### 2.8 【P2】滚动摘要表初始化全量重建

`journal.py:1028-1078`：三个触发器实时维护 `runtime_oaep_run_summary`，同时 init 期有 `DELETE` 全表 + `INSERT...SELECT...GROUP BY` 重建。

---

## 3. 流式链路时序与延迟源

```
Provider token
   │
   ├─(1) 端口批处理（已有三级 coalescing，OK）
   │      Autogen: 128 字符批量，首片段立即发（保 TTFT）  desktop_autogen_ports.py:128
   │      Codex: 4096B / 40ms                                   delta_coalescer.py
   │      Engine: chunk_chars >= 64KB 才落 item 行                engine.py:4344
   │
   ├─(2) emit → append_event / append_normalized_event          agent.py:829/832/841
   │
   ├─(3) 落库（瓶颈区）★
   │      · SELECT MAX(sequence)  [engine.py:3992]              ← 每事件 1 次往返
   │      · _next_sequence INSERT+SELECT+UPDATE                 ← 每事件 3 条语句
   │      · INSERT runtime_session_journal（1 行/delta）★膨胀源
   │      · INSERT runtime_oaep_events（1 行/delta，avg 998B）★膨胀源
   │      · INSERT runtime_oaep_item_event_refs（1 行/delta）
   │      · item 投影 O(n²) 全文重写 [engine.py:3635]           ★膨胀源
   │
   ├─(4) commit → notify_committed() → enforce_capacity() 全库扫描 ★写放大
   │
   └─(5) SSE: asyncio.to_thread(wait_oaep_events, timeout=15s, limit=500)
          · Condition.wait 阻塞等待（非 sleep 轮询，设计 OK）
          · 但读路径二次 join + delta 重建 ★读放大
          sessions.py:174-180
```

**延迟源排序**：写放大(3) → 容量扫描(4) → 读放大(5)。前端只是最后一个受害者。

---

## 4. 前端侧：已验证的现状（不是主要问题）

渲染层**已做**的优化（`ChatMessageContent.tsx`）：

| 机制 | 位置 | 说明 |
|---|---|---|
| `MarkdownRenderer = memo(...)` | :195 | 组件级 memo |
| `VirtualizedMarkdown` / `VirtualizedBlock` | :246/:270 | markdown 分块虚拟化 |
| `splitMarkdownIntoBlocks` + useMemo | :280/:442 | 按块切分，避免整篇重解析 |
| `StableMarkdown` 自定义比较器 | :385 | 注释明言"防止 ReactMarkdown 每 64ms 重解析" |
| `Profiler id="streaming-markdown"` | :479 | 已内置流式渲染性能探针 |
| rAF 批处理结构化事件 | useDesktopChatAdapter.ts:215-221 | `structuredFlushFrameRef` 帧对齐 |
| 流式期用 `<pre>` 而非完整 markdown | :456 | 降低流式解析成本 |

**结论**：前端已有性能基建，单纯"再加 memo"收益有限。前端的真实痛点是：

1. **快照加载慢**——首次打开会话要从 650 MB 库里 join + 重建全文（后端问题传导）。
2. **重连回放慢**——`oaep-events?after=N` 单次最多 500 条 + `_hydrate_delta_payloads`。
3. **`useDesktopChatAdapter.ts` 150KB 单体**，所有聊天状态集中，非 active session 事件只入队（见 MEMORY[3]），跨会话切换时状态搬运成本高。

---

## 5. 优化方案

### 5.1 后端 runtime 数据库瘦身（优先级最高，收益最大）

| # | 措施 | 涉及文件 | 预期收益 |
|---|---|---|---|
| B1 | **delta 行内合并**：同 `(session,item,segment)` 连续 delta 合并为一行，带 `first/last_sequence` | `journal.py`（`append_event`/`_next_sequence`）、`normalized_writer.py` | 187,719 行 → 预计 < 5,000 行，`runtime_oaep_events` 178.7 MB → < 10 MB |
| B2 | **compact 存量数据**：复用已有 `compact_delta_payload` + `repair_legacy_delta_rows` 跑一次全量修复 | `journal.py:260/290`、`journal_maintenance.py` | 73 MB journal → 预计 < 8 MB |
| B3 | **item 投影改增量**：`runtime_conversation_items` 不再整段重写 | `engine.py:3635` | 消除 O(n²)，4.4 MB 且不再增长 |
| B4 | **容量检查参数化**：写路径只用已知 `session_id`，去掉全库扫描 | `journal.py` `enforce_capacity`、`notify_committed` | 每次 commit O(sessions) → O(1) |
| B5 | **序列号单语句化**：`ON CONFLICT DO UPDATE ... RETURNING` 替代 INSERT+SELECT+UPDATE | `journal.py:1688-1702`、`engine.py:3992` | 每事件 3+2 次往返 → 1 次 |
| B6 | **加 PRAGMA**：`auto_vacuum=INCREMENTAL`、`journal_size_limit`、`wal_autocheckpoint` | `journal.py:924-934`、`engine.py:429` | WAL 有上限，删除后空间可回收 |
| B7 | **加索引**：`(workspace_id, event_kind, rowid)` | `journal.py` DDL | 消除 watermark 全表扫描 |
| B8 | **定期维护调度**：把 `journal_maintenance` 从纯手动改为启动/每日触发（VACUUM + compact） | `journal_maintenance.py` | 防止再次膨胀 |
| B9 | **保留策略落地**：`max_events_per_session`（100,000）+ `retained_events_per_session` 明确生效并验证 | `journal.py:909` | 内存与磁盘双控 |
| B10 | **workspace drsai.db 去重**：`sessionmessage` 50,464 行 / 93 MB + 5 张 FTS 影子表（trigram 重复索引 56,601 行） | `drsai.db` | 合并 FTS 表、只保留必要 tokenizer |

**立即可执行的零风险操作**（不改代码）：
```powershell
# 1) 备份后对两个库做 VACUUM（回收 freelist + WAL）
# 2) 跑现有 repair/compact CLI：
python -m drsai.backend.runtime.journal_maintenance --vacuum
```

### 5.2 流式投递优化

| # | 措施 | 涉及文件 |
|---|---|---|
| S1 | 去掉 `wait_for_oaep_events` 的二次读取，`wait_for_events` 直接返回 OAEP 结果 | `journal.py:2630-2642` |
| S2 | SSE 批量**自适应**：空闲时 15s 长轮询，活跃时缩小到 200-500ms 并加大 limit | `sessions.py:174-180` |
| S3 | `_hydrate_delta_payloads` 增量缓存：按 `item_id` 缓存已重建文本，只追加新 delta | `journal.py:2877` |
| S4 | 快照接口走 checkpoint 直读，避免重放重建 | `sessions.py:132-150` |

### 5.3 前端侧（在 B 系列见效后的收尾项）

| # | 措施 | 涉及文件 |
|---|---|---|
| F1 | 会话首开走 **snapshot + checkpoint**，不全量回放事件 | `useDesktopChatAdapter.ts` |
| F2 | 拆分 150KB 的 `useDesktopChatAdapter.ts`，按 session 分片状态，避免跨会话搬运 | `adapters/` |
| F3 | 消息列表用 `react-window`/现有虚拟化滚动容器真正落地（确认 `VirtualizedMarkdown` 是否已接入列表层） | `components/` |
| F4 | 大预览依赖（echarts/xlsx/docx-preview/pptx-preview）改 `React.lazy` + 手动 chunk 拆分 | `electron.vite.config.ts` |
| F5 | 已内置的 `Profiler id="streaming-markdown"` 上报到诊断面板，建立性能基线 | `ChatMessageContent.tsx:479`、`ChatDiagnosticsPanel.tsx` |
| F6 | 主进程 `windows/src/main/index.ts` 357KB 单体检查同步 IPC（fs 调用）是否阻塞 | `windows/src/main/index.ts` |

---

## 6. 执行顺序建议

```
阶段一（1周，零/低风险，立即见效）
  └─ 存量清理：VACUUM + compact 存量 delta 行（B2/B6/B8）
  └─ 预期：engine.sqlite3 652 MB → ~80-120 MB

阶段二（1-2周，写入路径）
  └─ B1 delta 合并 + B5 序列单语句 + B4 容量参数化
  └─ 预期：流式写入 DB 往返减少 ~80%，长会话不再卡

阶段三（1周，读路径 + 前端）
  └─ S1/S2/S3 + F1/F2/F4
  └─ 预期：会话首开与重连回放显著变快

阶段四（持续）
  └─ F3/F5/F6 + B10 工作区库瘦身
```

---

## 7. 关键结论重申

1. **"桌面渲染慢"的表层是前端，根因在后端存储层。** 前端已有虚拟化/memo/rAF/markdown 分块等完备优化。
2. **651 MB 的 `engine.sqlite3` 中，业务数据只有几百 KB（17 sessions / 82 runs），99.9% 是事件流冗余。**
3. **三大放大器**：每 delta 一行（行数）、每次 commit 全库扫容量（写放大）、读路径二次 join 重建全文（读放大）。
4. **最快速的一刀**：对现有 delta 行跑 `compact` + `VACUUM`，可立刻释放约 500+ MB，并直接改善会话打开速度。
5. **防复发**：`auto_vacuum` + `journal_size_limit` + 定期 maintenance 自动调度。