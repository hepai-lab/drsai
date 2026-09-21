# Continue 中断恢复：已修好的、还要修的

> **状态**: 主路径已验证；recap 兜底待修  
> **验证环境**: 本机 pm2 `drsai-prod-backend`（8081）+ https://opendrsai.ihep.ac.cn/  
> **验证对象**: NRS Agent（`mode=ddf`，HepAI worker）  
> **相关代码**:
> - persist close: `apps/webui/backend/src/drsai_ui/agent_factory/remote_agent/persistent_worker.py`
> - 组队入口: `apps/webui/backend/src/drsai_ui/agent_factory/magentic_one/task_team.py`
> - recap: `apps/webui/backend/src/drsai_ui/ui_backend/backend/web/interrupted_run_history.py`
> - 挂 recap: `apps/webui/backend/src/drsai_ui/ui_backend/backend/web/managers/connection.py`
> - 消息模型: `apps/webui/backend/src/drsai_ui/ui_backend/backend/datamodel/types.py`（`MessageConfig`）
> - 单测: `apps/webui/backend/tests/test_interrupted_run_history.py`、`test_persistent_worker_close.py`

下一步修代码请在 **`drsai-dev`**（本文件所在仓库）。`drsai` 生产工作区先保持不动。

---

## 1. 已经成立的（不要回退）

WebUI 每轮 stream 结束都会 `team.close()`。旧 `HepAIWorkerAgent.close()` 会 RPC 远端 `close(chat_id)`，worker 默认 `close_agent_on_finish=True`，内存里的会话被丢掉。下一句用户只发 `continue` 时，模型会诚实地说「没有之前的对话」。

现在 `besiii` / `remote` / `ddf` 走 `SessionPersistentHepAIWorkerAgent`：本地 close **不**打远程 close，只关本地 client。

2026-09-18 在 NRS 上验证过：

| 步骤 | 结果 |
|---|---|
| 发 CONUSS kctl（`B5_data_1.txt`） | 远程 worker 跑工具，缺 Bhf 等参数失败 |
| 同一条 WS 发 `continue`（`input_response`） | 记得 CONUSS / Fe57 |
| 等输入超时 600s → `STOP_RUN` | 日志：`Closing RemoteAgent locally; keeping remote session chat_id=5420c094-...` |
| 新 WS，`type=start task_len=22`（只有 `continue`） | 模型回复 *I'm continuing the same task.*，带上 write_mif 37 错、`A1_kctl.sif`、Fe57 参数缺口 |

**主路径功能是好的。** persist close 不要改回去。

---

## 2. 还要修的 bug

### 2.1 recap 兜底很可能根本没挂上（P0）

超时后再 `start` 时，后端应把该 run 的历史拼成一条 **hidden recap**（`internal=yes`，`type=interrupted_run_recap`）prepend 到 task 上。这是远端 session 丢了之后的后备（worker 重启、别人 RPC close、非 HepAI worker）。

验证当天 **全程没有** `attaching interrupted-run recap`。模型能接上，是因为 `chat_id` 还在，不是 recap。

读历史只收纯 dict：

```python
config = getattr(row, "config", None)
if isinstance(config, dict):
    configs.append(config)
```

`Message.config` 类型是 `Union[MessageConfig, dict]`。`db.get(..., return_json=False)` 很可能返回 `MessageConfig` 对象。同文件别处已经用 `dict(row.config)`，这里没有。

后果：

- `isinstance(config, dict)` 为假 → 历史全丢 → `build_interrupted_run_recap` 返回 `None`
- `if not recap: return task` 静默跳过
- `MessageConfig` 只有 `source` / `content` / `message_type`，没有 `metadata`。即便 `dict(config)`，`turn_plane` / `internal` 也可能被 Pydantic extra-ignore 丢掉，过滤会失真

**不修的影响：** 远端 session 还在时用户无感。worker 一重启、或 close 仍打到远端，continue 会再次失忆。

### 2.2 recap 成功/失败都看不见（P1）

`connection.py` 用的是 `logging.getLogger`，不是 loguru。成功才 `logger.info(...)`。

同一段 `start_stream` 里的 `received no skills`（也是 INFO）在 run 5703 的 pm2 日志里也没有；能看到的是 `STOP_RUN` 这种 WARNING。所以「没搜到 recap 日志」不能单独当证据，但跳过时完全没行，排障不行。

### 2.3 单测没覆盖 ORM 路径（P1）

`test_interrupted_run_history.py` 只喂手写 dict，测不到 `MessageConfig` / SQLModel row。persist close 的单测是够的。

---

## 3. 改法

不要动 persist close，不要把 `HepAIWorkerAgent.close()` 的远程 RPC 加回来。

### 3.1 规范化消息 config（必改）

文件：`connection.py` → `_load_run_message_configs`

把每一行变成带 `metadata` 的 dict，例如：

- `dict` → 原样（或 shallow copy）
- Pydantic / SQLModel → `model_dump(mode="json")`，不要只 `dict(obj)` 以致丢掉 extra
- 若 `message_meta` 里还有元数据，合并进 `metadata`，不要只看 `config.metadata`

空列表和「有行但过滤光」要能区分。

### 3.2 无论挂没挂都打日志（必改）

用和 `ws.py` 一样的 loguru（或至少 WARNING），例如：

```
[CHAT_TURN] run=5703 interrupted recap: status=STOPPED configs=12 kept=4 chars=1800 attached=yes
[CHAT_TURN] run=5703 interrupted recap: status=STOPPED configs=0 kept=0 attached=no reason=no_configs
```

成功、跳过都要有。方便对照 pm2。

### 3.3 补测试（必改）

在 `test_interrupted_run_history.py` 或新的 connection 单测里：

1. `MessageConfig` 对象（不是 dict）也能拼出 recap
2. `config` 是完整 autogen dump（含 `metadata.turn_plane`）时，process 行仍被丢掉、用户任务和最终回复保留
3. `_attach_interrupted_run_history`：有历史就 prepend hidden 消息；没历史就原样返回 task
4. 现有 dict 用例保持绿

### 3.4 回归怎么验

1. 单测先绿。
2. 正常 continue（远端还在）：NRS / 其它 ddf，超时后再发 `continue`，行为不能比现在差。
3. 兜底（有条件再做）：同一 run 超时后，若能重启或清掉 worker 上的 `chat_id`，再 `continue`。修好后模型仍应靠 recap 记得上一轮任务，而不是「没有之前的对话」。日志里要有 `attached=yes`。

---

## 4. 不要在这次里做的

- 不要改 persist close 语义。
- 不要把 recap 扩到 `COMPLETE` 后再 start（现在只挂在 `STOPPED` / `ERROR`）。正常说完再发消息走 `input_response`，不需要 recap。
- 不要和 DDF list 超时、`upsert_user_remote_agent`、`authSession.ts` 去重搅在一个 PR 里。那些已经在工作区，分开提。
- planner hop loading 空窗见 [`stream-v2-planner-hop-loading-gap.md`](./stream-v2-planner-hop-loading-gap.md)，不是 continue 的事。

---

## 5. 建议顺序

1. 修 `_load_run_message_configs` + 可观测日志  
2. 补 ORM / MessageConfig 单测并跑绿  
3. 在 drsaiv2 或本机 pm2 再走一遍「超时 → continue」看 recap 日志  
4. 有环境再验 worker 重启后的兜底
