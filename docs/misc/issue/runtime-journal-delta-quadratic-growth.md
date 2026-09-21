# Runtime Journal delta 行重复存全量导致的平方级膨胀

## 状态

- 严重级别：S2（不阻塞功能，但单个 Session 可占用 GB 级磁盘，并放大备份、校验与启动扫描成本）
- 影响平台：所有使用本地 Runtime Journal 的写入路径（Windows Desktop、本地持久 Runtime、TUI）
- 首次确认：2026-09-15
- 相关历史治理：WRRO-001 处理的是 **行数膨胀**（重复追加的 Session/OAEP 投影行，离线压缩治理）。本文记录的是**另一个独立的放大源**：行数不异常，但每个 delta 行都重复存储累计内容。

## 一句话定义

`conversation.item.delta` 的 Journal 行写入的是“截至当前的完整 Item payload”（`text`/`content`/`output`/`summary`/`result`），而不是“本次增量 chunk”。第 n 个 chunk 所在行的长度是 O(n)，整段回答的 Journal 占用因此是 O(n²)。

## 现场证据（`C:\Users\26364\.drsai-prod\runtime\engine.sqlite3`）

| 项目 | 观察值 |
| --- | ---: |
| `engine.sqlite3` | 2,401,882,112 bytes（2.24 GiB） |
| Journal 行数 | 75,651 |
| 其中 `conversation.item.delta` 行 | 75,074 |
| delta 行内层累计键合计 | 约 1,881 MB |
| delta 行内层真实 chunk 合计 | < 1 MB |
| dry-run 可收紧行数 | 37,537 |
| dry-run payload bytes | 2,017,275,950 → 35,937,963 |

单会话实测（`session-ea5e74e3-…`）：41,069 行 / 1,664.7 MB，其中 1,606.9 MB 是累计键的重复拷贝，真实 delta chunk 仅 0.14 MB。

同一库中 75,074 条 delta 行里约一半是 `runtime_events` 镜像行（内层 payload 形如 `{runtime_event_id,type,data,migrated}`），它们不带累计键，不受本问题影响。

## 根因

`RuntimeEngine._record_runtime_event_item_in_transaction` 同时向两个消费者提交**同一个累计 payload**：

- `runtime_conversation_items`：Item 权威累计投影，必须写全量；
- `runtime_session_journal`：事件流，只需要“这一步发生了什么”。

调用方把累计 `payload` 原样传下去，delta 行因此携带了累计字段。每个流式 chunk 都会重写一遍整段回答，形成 O(n²)。

## 兼容性约束（为什么不能只改写路径）

legacy `conversation/1` 消费方把 `event.payload.payload` 直接当作该 Item 的**完整 payload** 使用：

- Desktop：`apps/desktop/shared/main/legacyConversationAdapter.ts`、`apps/desktop/shared/main/threadRuntimeProjection.ts`；
- Runtime：`drsai/compatibility/runtime_legacy_conversation.py`、`drsai/compatibility/relay_legacy_conversation.py`、`drsai/relay/gateway_control.py`、`/v1/sessions/{id}/events`。

因此投影语义必须保持不变：**写时只存增量，读时回填累计值**。

## 修复

1. 写路径 delta-only 契约：`compact_delta_payload` + `DELTA_ACCUMULATED_KEYS`（`text`/`content`/`output`/`summary`/`result`）。`delta` 非字符串时显式置为 `""`，绝不回退到累计键。
2. 上限 fail-closed：单个 delta 行投影超过 `MAX_DELTA_JOURNAL_PAYLOAD_BYTES`（1 MiB）直接抛错，防止调用方再次传入累计 payload。
3. 读路径统一回填：`_hydrate_delta_payloads` 按 `item_id` 批量读取 `runtime_conversation_items`，`replay()` 逐行构造 `_event(canonical_payload=…)`。`list_session_events`、`wait_session_events`、`conversation_snapshot` 全部经由该路径。
4. OAEP 不受影响：OAEP delta envelope 本就只带 `delta`，`_store_oaep_event` 对 delta 行显式跳过 Item 嵌入，读取用 `_delta_text(payload)`。
5. 存量修复：`repair_legacy_delta_rows`（按 `rowid` 分批、可中断重跑、`--session`/`--limit`/`--batch-size`）与 CLI `python -m drsai.backend.runtime.journal_maintenance`。
6. append-only 守卫扩展：`runtime_session_journal_no_update` 触发器增加与 `no_delete` 相同的 maintenance 逃生口；旧库由 `ensure_journal_update_guard` 就地升级（`CREATE TRIGGER IF NOT EXISTS` 无法替换已存在定义）。

CLI 行为：

- `--dry-run` 严格只读，不写行、不改 schema；
- 默认在首次写入前用 SQLite online backup API 生成一致性备份（`<db>.pre-delta-repair-<时间戳>.sqlite3`），可用 `--no-backup` 关闭、`--backup PATH` 指定位置；
- 写后执行 `PRAGMA integrity_check`，非 `ok` 时以退出码 3 报告并保留备份，可用 `--skip-integrity-check` 关闭；
- `--vacuum` 在成功写入后回收文件页。

## 数据安全不变量

- 不删除任何 Journal 行、Item、Session、Run；
- Item 累计值只以 `runtime_conversation_items` 为准，delta 行不再冗余保存；
- 普通写入方仍然不能 UPDATE/DELETE Journal 行；
- 修复前后 `PRAGMA integrity_check` 必须为 `ok`，失败不得继续；
- 修复幂等（第二次运行 `repaired=0`），可中断后重跑。

## 测试

`cores/python/packages/drsai/tests/test_runtime_journal_delta_storage.py`（18 例）：delta-only 不变量、字节线性增长、读路径回填契约、OAEP delta 不变、1 MiB fail-closed、大 chunk 完整保存、维修 dry-run/幂等/session 限定/可续跑/跳过无 chunk 行/非法入参、CLI dry-run 只读、备份与 integrity_check、守卫升级与 append-only 保持。

## 真实库结论

真实用户库只读 dry-run：扫描 75,074 行耗时 5.48s，可收紧 37,537 行，payload 2,017,275,950 → 35,937,963 bytes（约 1.88 GB）。真实库 `--apply` 必须先停止桌面 Runtime，并在执行前保留备份。
