# engine.sqlite3 膨胀地图（2026-09-16 基线 + 2026-09-17 方案 A/B 实施）

> 2026-09-17 更新：本文件 §1–§5 是 09-16 的现状实测；**§6 = 方案 B（latency 容量）已实施**，
> **§7 = 方案 A（流式事件 payload 压缩）已实施并验证**。两轮合计把 live 库从 474.42 MiB 降到 356.57 MiB。
> §2/§4/§5 中与方案 A 相关的措辞已就地更正。

样本：`tmp/engine_work.sqlite3`（工作副本，已执行过 journal mirror purge + VACUUM）
文件大小 **474.4 MiB**，`freelist_count=0`（无空洞页），`auto_vacuum=0`。
→ 说明当前 474 MiB **全是活数据**，不是碎片；要继续瘦身只能减少写入量或改保留策略。

## 1. 按表实测（payload JSON 字节数）

| 表 | 行数 | payload | 性质 |
|---|---:|---:|---|
| `runtime_oaep_events` | 78,970 | 83.65 MiB | journal 每一行的 OAEP 信封副本 |
| `runtime_session_journal` | 78,970 | 76.73 MiB | 权威 Item/Session 日志 |
| `runtime_events` | 100,401 | 65.67 MiB | 运行事件日志（见 §2） |
| `conversation_latency_stages` | **99,793** | **39.97 MiB** | 每 journal 行一条 identity 遥测（见 §3） |
| `runtime_conversation_items` | 1,271 | 3.02 MiB | 权威 Conversation Item |
| `runtime_oaep_items` | 1,271 | 1.64 MiB | Item 信封副本 |
| `runtime_oaep_item_event_refs` | 75,668 | — | Item↔Event 引用 |
| `runtime_session_journal_compacted_runtime_events` | 96,491 | — | purge 台账（幂等标记） |

`journal` 与 `oaep_events` 行数**严格 1:1**：78,970 / 78,970，且「无信封的 journal 行 = 0」。
即每个 journal 行都又写了一份 JSON 信封 → 同一内容 2 份，合计 160 MiB。

## 2. `runtime_events` 的 99.99% 是流式 delta

| event_type | 行数 | 大小 |
|---|---:|---:|
| `agent.message.delta` | 72,961 | 45 MiB |
| `subagent.markdown` | 23,781 | 15 MiB |
| 其余全部类型合计 | ~3,659 | ~5 MiB |

- 这两类**全部** `backend_event_key IS NULL`，即走的是无 key 的 `append_event` 路径。
- `agent.message.delta` 的内容**已经**存在两份（Item 的 `text` 累积 + journal 的 `conversation.item.delta`），此行为第三份。
- `run-cd550549-…`（用户报「思考流式重复」的那次运行，已 cancelled）单跑产生 26,080 行 / 17 MiB，其中 `subagent.markdown` 23,736 行。

### 根因：契约已写、开关没接

`backend/runtime/journal.py`:

- L126 `ITEM_PROJECTED_EVENT_TYPES` / L137 `is_item_projected_event()` → **已接线**，作用：跳过 journal 镜像。
- L158 `ITEM_PROJECTED_RUNTIME_EVENT_TYPES` / L173 `runtime_event_is_item_projected()` → **全仓 0 个调用点（含测试）**。
  （2026-09-17 更新：已由方案 A 接上——`runtime_event_payload_is_item_owned()` 调用它来决定哪些行做 payload 压缩，
  见 §7；「停写任务行」这条路线未采用。）
  配套注释（L148-153）声称「``RuntimeEngine`` never inserts these types into ``runtime_events``」，
  但 `append_event`（engine.py:3973）与 `append_backend_events`（engine.py:4260）都**没有**调用它。
  → 文档写好的「不要写 runtime_events」从未生效，所以每个 token 仍被写第三遍。

需要同步处理的下游读者（决定能否真的停写）：
1. `engine.py:810-832` `_reconcile_conversation_journal` 回填：用 `runtime_events` 的
   `agent.message.delta` 行重建缺失的 `assistant:<run>` Item；
2. `desktop_gateway/routes/runs.py:406`、`gateway_legacy.py:7306/7325` → `engine.list_events()`；
3. `relay/gateway_control.py:931` → `_read_local_run_events()`（直接读 `runtime_events`）；
4. `engine.py:5230`。

注意：带 `backend_event_key` 的批量路径（`append_backend_event` 4020 行去重、`append_backend_events`
4287 的 all-delta 快路径）里，行本身**就是幂等台账**，不能简单删除，否则重试会重复投影 delta。

## 3. `conversation_latency_stages`：每个 journal 行一条 420 字节身份遥测

- 99,793 行，`stage` 全部是 `journal_append`；(correlation_id, operation_id, stage) 全部唯一。
- `operation_id` 形如 `se-<uuid>`（session event），与 journal 行一一对应。
- 每行 `dimensions_json` 419~420 字节，内容是 `runtime_id/host_id/session_id/run_id/protocol/correlation_id`
  ——这些身份信息在 journal 行里已经有了。
- 上限机制（`observability.py`）：`CONVERSATION_LATENCY_RETENTION_SECONDS = 30*86400`、
  `DEFAULT_CONVERSATION_LATENCY_CAPACITY = 100_000`、trim interval 256。
  当前 99,793 行 ≈ **已顶到默认 100,000 容量上限** → 40 MiB 是"设计内的上限开销"，不是泄漏。
  → **已按方案 B 修掉：默认容量下调为 20,000**（`user_slo_stages` 另拆 `DEFAULT_USER_SLO_CAPACITY = 100_000`
  保持原语义），见 §6 实施记录。

## 4. 可回收量估算（在 474 MiB 之上）

| 手段 | 预计回收 | 风险 |
|---|---:|---|
| 停写 `runtime_events` 的 projected delta（接上 L173 开关）+ purge 历史行 + VACUUM | ~60 MiB | 未采用：事件行是 Run 游标/`list_events` 回放/Relay SSE 的载体，删行会动读契约 |
| **方案A（已实施）**：保留事件行，原地压缩流式 payload 里重复的 binding | **实测 payload 65.10 MB→5.91 MB；文件 440.94→373.90 MB（−63.99 MiB）** | 低：UPDATE 只在维护标记内发生，行/`sequence`/`created_at`/chunk 文本不变 |
| **方案B（已实施）**：latency capacity 100,000→20,000 → 自动 trim | **实测 474.42→420.51 MiB（−53.9 MiB）** | 无（纯配置） |
| journal ↔ oaep_events 合并（信封改为按需投影） | ~80 MiB | 高，涉及 wire 格式与快照接口 |
| journal `conversation.item.delta` payload 压缩（binding 已在列里，payload 仍重抄一遍） | ~55 MiB | 中，需审计 journal 回放/去重读法 |
| `subagent.markdown` 合并写（按 chunk 聚合，仿 64 KB 合并逻辑） | ~15 MiB/长跑 | 低-中，无 Item 投影故不能删 |

## 5. 结论

- 已完成的 purge 是**正确的**且已生效（台账 96,491 条、journal 镜像行 0、无空洞页）。
- **纠正**：「`runtime_event_is_item_projected` 是死代码，所以 delta 第三份副本仍在产生」曾是事实，
  但结论走偏了：真正膨胀的不是**行数**而是**每行的重复 binding**（97,150 行流式事件里 56.55 MiB 是 binding）。
  方案 A 已把写入侧接上（新行不再重抄 binding）并原地压缩历史行，见 §7。
- 剩余大头按可修性排序：**① latency 容量（方案 B 已完成，§6）**；**② 流式事件 payload（方案 A 已完成，§7）**；
  ③ journal `conversation.item.delta` payload（~66.75 MiB，与方案 A 同构，需审计回放/去重读法）；
  ④ journal ↔ oaep 双写（~80 MiB，涉及 wire 格式，风险最高）。

## 6. 方案B实施记录（2026-09-16 21:25–21:29）

唯一代码改动 —— `backend/runtime/observability.py`：

- `DEFAULT_CONVERSATION_LATENCY_CAPACITY` 100_000 → **20_000**（附实测算出的每行 ~420 B 依据）；
- 新增 `DEFAULT_USER_SLO_CAPACITY = 100_000` 与构造参数 `user_slo_capacity`，
  `record_user_slo_stage` 的 trim 改用该上限。原因：`user_slo_stages` 原先与 latency 共用同一个容量参数，
  直接下调会连带把 relay 侧（`relay/api.py:334` → `conversation-latency.sqlite3`）的用户 SLO 样本也截断。
- 新增回归测试 `tests/test_runtime_observability_latency_capacity.py`（8 例：默认容量、trim 只留最新样本、
  两个容量互不影响、同 correlation+stage 幂等、越界拒绝）。沙箱执行 `8 passed`。

live 库实测（`C:\Users\26364\.drsai-prod\runtime\engine.sqlite3`，`auto_vacuum=0`、无 WAL）：

| | 文件 | pages | page_size | freelist | latency 行数 | 时间跨度 |
|---|---:|---:|---:|---:|---:|---|
| 前 | 474.42 MiB | 121,452 | 4096 | 0 | 99,793 | 09-15 18:58:24 .. 09-16 20:30:17 |
| 后 | **420.51 MiB** | 107,651 | 4096 | 0 | 20,000 | 09-16 16:19:19 .. 09-16 20:30:17 |

执行脚本 `tmp/plan_b_apply.py`（默认 dry-run，`--apply` 才写）：
`DELETE FROM conversation_latency_stages WHERE rowid IN (SELECT rowid FROM conversation_latency_stages
ORDER BY observed_at DESC,rowid DESC LIMIT -1 OFFSET 20000)` 删 **79,793 行**，30 天过期删 0 行，
再 `VACUUM`（3.8 s）。**净回收 53.91 MiB**，比 §4 估算的 32 MiB 更多 —— 估算只算了 payload 字节，
实际还释放了 `conversation_latency_time` 索引页和碎片。

要点：`auto_vacuum=0` 时 trim 只把页退回 freelist，**必须 VACUUM 才会真正释放文件**；
新代码上线后该表自动恒定在 20,000～20,255 行（trim interval 256），无需人工干预。

## 7. 方案A实施记录（2026-09-17 09:00–09:35）

### 7.1 设计修正：为什么不是「删行」

`runtime_events` 是 **append-only**：建表时即注册 `runtime_events_no_update` / `runtime_events_no_delete`
两个触发器（`engine.py:520-521`），任何 UPDATE/DELETE 都 `RAISE(ABORT,'runtime events are append-only')`。
所以 §4 里「purge 历史行」那条路走不通 —— 行不能删也不能改。
方案 A 因此改成 **原地压缩 payload**：行、`sequence`、`created_at`、`event_type`、chunk 文本全部保留，
只去掉每行重抄的 Run/Session binding（§2 实测：97,150 行流式事件里 56.55 MiB 是 binding）。

### 7.2 压缩契约（`backend/runtime/journal.py`）

- `RUNTIME_EVENT_BINDING_KEYS`（12 键）：`run_id`、`session_id`、`workspace_id`、`runtime_id`、`instance_id`、
  `workspace_runtime_id`、`agent_backend_runtime_id`、`correlation_id`、`agent_definition_id`、
  `agent_definition_version`、`input_resource_count`、`parent_run_id`。
- `runtime_event_payload_is_item_owned(type)` = `runtime_event_is_item_projected(type)`
  ∪ `SUBAGENT_STREAM_EVENT_TYPES`（`subagent.markdown` / `subagent.thinking`）。
  这是 L173 那个「死开关」的**唯一**新调用点：现在它决定谁被压缩。
- `compact_runtime_event_payload(type, payload)`：只对上面的类型生效，删除 payload 里的 binding 键；
  其它类型**原样返回**（非流式 payload 逐字节不变）。
- 特别地：`subagent.markdown` / `subagent.thinking` 的 Event 行是该文本的**唯一副本**（没有 Item 投影），
  所以只缩信封、绝不删行；`agent.message.delta` 才是「Item 文本 + journal + events」三份里的第三份。

### 7.3 维护逃生门（本次最关键的安全设计）

- `CREATE TRIGGER IF NOT EXISTS` **无法**替换已存在的无条件触发器，因此
  `ensure_runtime_event_guards(db)` 会 DROP 再 CREATE 四个触发器，并带上
  `WHEN NOT EXISTS (SELECT 1 FROM runtime_events_maintenance WHERE singleton=1)`；
  返回「是否真的改写」以便只做一次、可重复调用。
- `_runtime_event_maintenance_marker(db, armed=...)` 是那个 singleton 行：每批写入前 arm，
  `finally` 里 disarm 再 commit —— **进程被杀也不会留下一个可写的 append-only 日志**。
- journal 侧同构：`runtime_session_journal_maintenance` + `ensure_journal_update_guard` / `ensure_journal_delete_guard`。
- 实测：维护窗口内 UPDATE/DELETE 可写；窗口外仍被拒绝（`runtime events are append-only`）。

### 7.4 写入侧接线（治本，不只是事后擦屁股）

`engine.py:171`：

```python
def _runtime_event_data_json(event_type, data):
    return json.dumps(compact_runtime_event_payload(event_type, data), separators=(",", ":"), sort_keys=True)
```

三个写入者（`append_event` ~3983 / `append_backend_event` ~4025 / `append_backend_events` ~4270）
落库的都是压缩形态 —— **新增长跑不再产生 binding 副本**。
`append_backend_event` 另修了一处：返回值 `event["data"]` 还原为调用方传入的原始 payload
（否则上层立刻取不到 `run_id`），与 `append_event`、批量写入者的语义对齐。

### 7.5 离线工具

```
python -m drsai.backend.runtime.journal_maintenance --database <db> --compact-runtime-events [--dry-run] [--vacuum]
```

`--dry-run` 只读；实跑默认在同目录先落一份事务一致的备份，跑完 `PRAGMA integrity_check`，
确有回收才 `VACUUM`。扫描按 `rowid` 顺序分批（可断点续跑），并且**只在重新编码更短时才写**。

### 7.6 实测（live `~/.drsai-prod/runtime/engine.sqlite3`）

| 阶段 | 文件大小 | 说明 |
|---|---:|---|
| 09-16 原始 | 474.42 MiB | §1 基线 |
| 方案 B 后 | 420.51 MiB | latency 表 trim + VACUUM（−53.91 MiB） |
| 方案 A dry-run | 440.94 MB | 只统计：97,150/97,150 行可压，payload 65,109,960 B |
| **方案 A 实跑 + VACUUM** | **373.90 MB（356.57 MiB）** | payload → 5,907,538 B；`integrity_check: ok`；17.1 s |

累计 **474.42 → 356.57 MiB（−117.85 MiB，−24.8%）**；备份
`engine.sqlite3.pre-delta-repair-20260917-093155.sqlite3`（420.51 MiB）保留作恢复点。

### 7.7 验证清单

- 新增回归 `tests/test_runtime_event_payload_compaction.py`（20 例）：落库形态被压缩 / 非流式 payload 逐字节不变 /
  回放仍带 `run_id`+`sequence`+`created_at` / V1 feed 用 `json_set` 重新挂回 `run_id` / 压缩就地、幂等、分批、可限量、可 dry-run /
  压缩前后日志都保持 append-only / subagent 文本存活 / CLI 认这个开关。**全量 555 passed**。
- live 副本读路径 smoke（`VACUUM INTO` 副本，不动 prod）：`list_events` 取 500 窗口 → 68 条 `agent.message.delta`
  拼回 200 字符原文（`I'll investigate how the Desktop app renders the backend age…`）、每行仍带 `run_id`/`sequence`/`created_at`；
  `conversation_snapshot` 401 items；`list_conversation` 500 行；`json_set` 重挂 `run_id` = True。
- **与压缩前备份逐字节比对 chunk 文本**（`json_extract(data_json,'$.text'/'$.delta')` 求和）：4 类流式事件
  行数与文本字节**完全一致** —— `agent.message.delta` 72,961 行 / 209,213 B、`subagent.markdown` 23,781 行 / 93,811 B、
  `subagent.thinking` 62 行 / 65,245 B、`thinking.delta` 346 行 / 77,747 B。即：**只瘦信封，一个字符没丢**。
- 结构复检：marker 0 行、freelist 0、四个守卫都带 `WHEN` 子句、per-run 计数与 sequence 连续（26,080 / 8,345 / 3,964）。
- `--purge-legacy-mirrors` 复查：`scanned 0 / purged 0` —— 台账已有 96,491 条，历史镜像早前已清完（§1 结论仍成立）。

### 7.8 压缩后的剩余分布（356.57 MiB）

| 表 / 列 | 行数 | 文本字节 | 下一步 |
|---|---:|---:|---|
| `runtime_oaep_events.envelope_json` | 78,970 | 79.71 MiB | 平均 1,058 B/信封（最大 30,685 B），内嵌完整 run/session 对象 = **协议 wire 格式**，需先审客户端契约 |
| `runtime_session_journal.payload_json` | 78,970 | 76.37 MiB | 其中 `conversation.item.delta` 73,307 行 / 66.75 MiB —— 与方案 A **同构**（binding 已在列里，payload 又抄一遍），优先候选  → 已在 §8 完成 |
| `runtime_events.data_json` | 100,401 | 9.21 MiB | 已从 62.09 MiB 降下来（本方案成果） |
| `conversation_latency_stages.dimensions_json` | 20,000 | 8.01 MiB | 方案 B 已封顶 |

### 7.9 上线注意

压缩只在**加载了新代码的进程**里生效：
- 桌面 dev（`apps/desktop/windows-desktop-dev.cmd`）走 `~/.drsai-dev/drsai-agent`，它是指向本仓库的链接 → 重启即可生效；
- 打包/生产侧读 `~/.drsai/packages`（当前是 2026-08-27 的副本，**不含**新代码）→ 需要重新安装/同步才会带上。
历史数据已在本机压缩完毕；其它机器的老库可用 §7.5 的命令补做一次（幂等）。


## 8. 方案A′实施记录（2026-09-17 09:45–10:05）：journal delta 行去掉重复 binding

### 8.1 问题

`runtime_session_journal` 的 73,307 行 `conversation.item.delta` 与 `runtime_conversation_items` 的同一 `item_id` 行
**互为冗余**：delta 行把该 Item 的 12 个身份 key（`runtime_id / workspace_id / agent_definition_version /
correlation_id / parent_run_id / agent_definition_id / input_resource_count / instance_id /
agent_backend_runtime_id / session_id / workspace_runtime_id / run_id`）又抄了一遍，
而 Item 行才是权威副本。

### 8.2 契约（`backend/runtime/journal.py`）

- 写侧 `compact_journal_item_payload(event_kind, payload, *, canonical=None)`：先按 `DELTA_ACCUMULATED_KEYS`
  丢累计键，再**逐 key 判断 —— 只有 `canonical[key] == payload[key]` 时才丢**（可被 Item 逐字节重放 ⇒ 无损）；
  非 delta kind 原样通过。
- 读侧 `hydrate_delta_binding(envelope, canonical)`：只补齐**缺失**的 binding key，返回副本、绝不改原行。
- 批量读 `canonical_item_payloads(db, item_ids)`：400 个 id 一批，供 `_hydrate_delta_payloads` 与 relay 共用。
- 兜底 `MAX_DELTA_JOURNAL_PAYLOAD_BYTES = 1 MiB`：超限 fail closed。
- `created_at / updated_at / revision` **不在**可丢集合内（早前实测 146,508 处不一致）。

### 8.3 最后一个未补水的读路径（本次抓到并修掉）

`relay/gateway_control.py::_read_local_session_events` 是 `GET /v1/sessions/{id}/events` 的 loopback 快路径，
它原先直接 `json.loads(row["payload_json"])` 返回 —— 压缩后会把「没有 text / 没有 session_id」的 delta 交给客户端。
现已与 `ConversationJournal.list_session_events` 对齐：只对 delta 行查 canonical Item 并替换内层 payload；
游标、2000 行上限、`cursor_expired` 行为均不变。

### 8.4 新增回归

- `tests/test_runtime_journal_delta_storage.py` 扩到 **25 例**：只丢 Item 能重放的 key / 读侧只补缺的 binding /
  Item 无法重放的 binding 必须保留 / 离线修复幂等 / OAEP delta 投影与是否存 binding 无关 / CLI 能回收。
- `tests/test_relay_session_event_delta_hydration.py`（新，**6 例**）：锁死 **loopback 页 == gateway 路由页**、
  非 delta 行原样返回、游标、未知 Session、无 journal、游标过期。
- **全量 568 passed**。

### 8.5 存量清理实测（live `~/.drsai-prod/runtime/engine.sqlite3`）

- dry-run：`scanned 73,307 / repaired 73,307 / unchanged 0`，payload 69,997,193 → 25,315,158 B（1.27 s）
- 实跑 `--vacuum`：文件 373,895,168 → **333,627,392 B（356.57 → 318.17 MiB）**，7.8 s，`integrity_check = ok`
- 备份：`engine.sqlite3.pre-delta-repair-20260917-095843.sqlite3`（356.57 MiB）
- `verify_journal_repair.py`：envelope 78,970 行逐字节同 / canonical items 1,271 同 / 73,307 个 chunk 文本
  **0 处不同** / 24 个 Session 投影页 78,970 事件 0 处不同 / 落库 delta 行 chunk-only / 四个守卫原样 /
  marker 表 0 行 / marker 外的 UPDATE 仍被拒（append-only 未被削弱）
- 真读路径 smoke（DB 副本上跑真 `RuntimeEngine` + 真 relay handler）：3 个最大 Session 的
  `list_session_events` 都补回了 `text` / `session_id` / `run_id` / `delta`，snapshot 消息文本非空，
  OAEP delta 带 text，**loopback 页 == gateway 路由页 == True**

### 8.6 累计与清理

474.42 MiB（A′ 前）→ **318.17 MiB**；相对 822.64 MiB 起点的总降幅 **−504.47 MiB（−61.3%）**。

已删除的存量：822.64 MiB 历史备份、`tmp/engine_snapshot.sqlite3`、`tmp/engine_work.sqlite3`、
`tmp/smoke/`、`tmp/live_smoke/` —— C 盘释放 **3.25 GiB**（72.10 → 75.35 GiB 可用）。

第二轮（用户确认「全部清除」）另删除两个回滚点：
`engine.sqlite3.pre-delta-repair-20260917-093155.sqlite3`（420.51 MiB）与
`engine.sqlite3.pre-delta-repair-20260917-095843.sqlite3`（356.57 MiB）—— **已无备份留存**，
live `engine.sqlite3`（318.17 MiB）即唯一权威副本；删除前再次复核 `integrity_check = ok`、
`runtime_events_maintenance` / `runtime_session_journal_maintenance` 均为 0 行。
C 盘两轮合计释放 **4.01 GiB**（72.10 → 76.11 GiB 可用）。

> 恢复路径不再是「回滚 DB」，而是「回滚代码 + 重跑维护工具」：压缩是幂等的，
> 任何旧库都能用 `journal_maintenance` 原地重做；但**新库 + 旧代码不成立**
> （旧读路径不会补水 binding），所以源码改动必须随之提交，不可只回退代码不回退数据。

### 8.7 仍待决策的后续候选

| 表 / 列 | 行数 | 文本字节 | 下一步 |
|---|---:|---:|---|
| `runtime_oaep_events.envelope_json` | 78,970 | 79.71 MiB | 内嵌完整 run/session 对象 = **协议 wire 格式**，需先审客户端契约；与 journal 行再合并收益约 80 MiB |
| `runtime_session_journal.payload_json` | 78,970 | 35.40 MiB | A′ 已完成（66.75 → 35.40 MiB 的 payload 口径） |
| `runtime_events.data_json` | 100,401 | 9.21 MiB | 方案 A 成果，已稳定 |
| `subagent.markdown` 行 | 23,781 | 93,811 B（文本） | 长 run 内可合并 chunk（约 15 MiB/长 run），但破坏「一 chunk 一行」的 append-only 粒度 |
