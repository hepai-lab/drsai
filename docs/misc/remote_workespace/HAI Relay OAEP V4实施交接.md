# HAI Runtime Relay：OAEP V4 实施交接

本文是移动远程工作区 V4 的生产 Relay 实施边界。目标环境只能是 `ai-dev.ihep.ac.cn`，管理线程为 `019f5208-0f19-7883-b3e2-4dcc8ffa4b61`。本地 `OAEPReplayHub` 是语义参考，不可作为生产完成证据。

## 1. 当前生产差距

2026-08-02 无凭据只读探测：health 与 OpenAPI 均为 HTTP 200，OpenAPI 版本为 2.0.0，共 35 条路径；仅存在 V3 `conversation-snapshot`、`events`、`events/stream`，不存在 OAEP endpoint 或 OAEP schema。因此 V4 M07 尚未实现。OAEP component 名称固定为 `OaepSnapshot`、`OaepEventPage`、`OaepEvent`。

## 2. 必须新增的公网接口

在 v1 实现并生成 v2 alias，响应直接引用 `cores/protocol/oaep/oaep.schema.json`：

- `GET /runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/oaep-snapshot`
- `GET /runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/oaep-events?after_sequence=N&limit=L`
- `GET /runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/oaep-events/stream?after_sequence=N`

Relay 不把 OAEP 转换成 Conversation 或 V3 SessionEvent，也不从旧事件推断 OAEP。Snapshot 由 Runtime 权威返回；Event 只做严格验证、有限回放和分发。

## 3. Runtime WSS OAEP 帧

Runtime 主动帧固定为：

```json
{
  "type": "event",
  "protocol": "oaep/1",
  "runtime_id": "runtime-id",
  "workspace_id": "workspace-id",
  "session_id": "session-id",
  "generation": 1,
  "event": {}
}
```

`event` 必须通过 OAEP `Event` schema。外层和内层 runtime/workspace/session 身份必须一致；generation 必须与 Redis presence 当前 owner 一致；`Event.sequence` 是 Session 级严格递增游标。malformed、跨身份、旧 generation、同 sequence 不同 event 均在写 Redis 前拒绝。

Control request/response 继续使用相关请求帧，不能与主动 OAEP Event 混用；OWOP 资源操作继续走 OWOP，OAEP 只携带安全的 operation/resource 引用。

## 4. Redis 与多 worker

- replay key 至少绑定 runtime、workspace、session、generation；
- sequence 去重，同 sequence 同 event 可幂等忽略，不同 event 必须 collision fail closed；
- 每 Session 有界保留，截断后的旧游标在发送 SSE header 前返回 409 `cursor_expired`；
- owner/caller 不同 worker 时仍可 Snapshot、page、SSE；
- association 撤销广播到全部 worker，清理队列并立即终止匹配 SSE，后续请求 403；
- 队列溢出不得静默丢失，记录 content-free gap 指标并让客户端从已提交游标恢复。

## 5. 授权矩阵

所有检查必须发生在读取副作用请求、访问 Redis 业务缓存或调用 Runtime 之前：OIDC issuer、subject、device proof、runtime association、workspace/session 归属和最小 scope。Snapshot/page/SSE 使用 `event.read`；Control 和 OWOP 继续使用各自最小 scope，不能因拥有 `event.read` 获得文件、终端或审批权限。

## 6. 生产验收输出

输出脱敏 `ai-dev-oaep-relay.json`，不得包含 token、正文、路径、命令参数或完整 subject。必须包含：

- `environment=ai-dev.ihep.ac.cn`、`protocol=oaep/1` 和 OAEP schema SHA-256；
- `oaep_frame_schema_identity`；
- `cross_worker_replay_10k`，事件数不少于 10000、P95 小于 100 ms；
- `public_snapshot_hash`，Runtime 与公网规范化 hash 一致；
- `cursor_expired_409`；
- `scope_before_side_effect` 且拒绝路径 `runtime_call_count=0`；
- `revocation_closes_sse` 且后续状态 403；
- `backpressure_metrics`；
- HTTP→Relay→WSS→Runtime→OWOP→OAEP 的 `correlation_trace`。

公开合同可运行：

```powershell
python scripts/smoke_runtime_relay_public_v4.py
```

完整发布由 `scripts/finalize_mobile_remote_workspace_release_v4.py` 验证；缺任一生产、双设备、故障、稳定性或敏感信息扫描证据都会失败。
