# OpenDrSai 移动远程工作区开发进度 V3

> 对应方案：[OpenDrSai 移动远程工作区开发方案 V3](./OpenDrSai移动远程工作区开发方案V3.md)
> 机器账本：`release/product-evidence/mobile-remote-workspace-v3/acceptance.json`

## 进度口径

| 状态 | 数量 | 说明 |
| --- | ---: | --- |
| `local_pass` | 96 | V2 继承/升级 72 项 + M11～M16 各 4 项 |
| `unverified` | 8 | 仅剩 V2 继承的真实公网、真机、两设备和一小时联合验收 |
| `full_pass` | 0 | 尚未完成真实三端和 1 小时发布验收 |
| 总计 | 104 | M01～M16 |

V3 新增项只有满足对应功能点的完整自动验收才升级。合同、fixture 或局部测试通过可以
记录为阶段证据，但不能替代 Runtime 持久化、真实 Session SSE 和双端 E2E。

## 第 1 轮：M11 Session Conversation 合同首批实现

更新时间：2026-07-27

### 已实现

- 在 Relay Schema 中新增 `session-events/1` 能力配置：
  - `conversation.snapshot`
  - `session.event.resume`
  - `session.event.stream`
  - `session.event.cursor_expired`
- 新能力没有加入当前 Runtime 主动上报的基础 `CAPABILITIES`；在 Runtime Journal
  和 Session 流尚未实现前保持 fail-closed，避免错误宣称支持。
- 定义 `session_conversation_item`：
  - 稳定 `item_id`
  - `revision`
  - `session_sequence`
  - `source_client`
  - `source_message_id`
  - 可空 `run_id` 和结构化 payload
- 定义带 `snapshot_sequence` 的 `conversation_snapshot`。
- 定义 12 种首批 `session_event` 和独立的 `runtime_session_event_frame`。
- 保留旧 `runtime_event_frame`，新 Session frame 使用
  `type=event + scope=session`，没有破坏 V1/V2 Run Event。
- 增加 Session Event list/stream 的共享 endpoint 合同。
- Python 与 Kotlin 生成器已经生成：
  - Session Conversation Item
  - Conversation Snapshot
  - Session Event
  - Runtime Session Event Frame
  - capability profile、最低版本和事件类型集合
- Python 运行时模型增加数值边界、事件类型和 frame/event 作用域一致性校验。
- 新增三端共享 fixture：
  `cores/protocol/relay/session-conversation-fixtures.json`。
- Android Gradle 自身的 Relay binding renderer 已同步更新，继续执行生成零漂移门禁。

### 自动测试证据

| 测试 | 结果 |
| --- | --- |
| `pytest -q test_relay_contract_codegen.py` | 10 passed |
| Android `SessionConversationContractTest` | 2 passed，Gradle BUILD SUCCESSFUL |
| `mobile_remote_workspace_acceptance_v3.py` 生成与 `--check` | 通过，104 个唯一 ID |

Android 首次执行时当前 shell 缺少 `JAVA_HOME`，改用已安装的
`C:\Program Files\Android\Android Studio\jbr` 后完成测试。该问题未修改系统环境。

### 机器账本

- 新建 V3 账本和独立生成/校验脚本；
- 从 V2 原样继承 80 项状态和证据，并修正已迁移源码的旧 artifact 路径；
- 加入 M11～M16 共 24 个新功能点；
- 当前校验结果：

```json
{
  "local_pass": 71,
  "unverified": 33,
  "full_pass": 0,
  "blocked": 0
}
```

M11 当前仍保持 `unverified`。原因：

- M11-F01 的 sequence 并发唯一性依赖 M12 Journal；
- M11-F02 的重复 revision/source_message_id 归并尚未进入真实投影；
- M11-F03 的公开 Session SSE、gap 和 cursor 过期尚未实现；
- M11-F04 的 Runtime/Android/Desktop 实际能力门禁尚未接通。

### 下一轮

进入 M12 Runtime Conversation Journal：

1. 建立 SQLite Journal migration、Session sequence allocator 和索引；
2. 实现原子 append、replay、Snapshot 同事务水位；
3. 对并发写入、崩溃恢复、幂等和投影 hash 编写自动测试；
4. 接入 Runtime Engine 的 Session/Run/Message 首批事实，不提前接入 Relay；
5. M12 本地验收通过后，再让 Runtime 上报 `session-events/1` capability。

## 第 2 轮：M12 Runtime Conversation Journal

更新时间：2026-07-27

### 已实现

- 新增与 Runtime Engine 共库的 SQLite Session Journal：
  - 每个 Session 独立、严格递增的 `session_sequence`；
  - Journal append-only trigger；
  - `event_id`、sequence、dedupe key、item/revision 唯一索引；
  - Conversation Item 当前投影；
  - checkpoint、retention waterline 和受控压缩。
- 新增原子 Journal API：
  - `append_event` / caller-owned transaction append；
  - `upsert_item` / caller-owned transaction upsert；
  - Snapshot + `snapshot_sequence`；
  - `after_sequence` replay；
  - 本地 condition wait；
  - `cursor_expired/history_truncated`；
  - 从 Event 确定性重建 Item Projection 及 SHA-256。
- Runtime Engine 首批权威写路径已经与 Journal 使用同一个 SQLite 事务：
  - Session 创建、导入、归档和移除；
  - Run 创建、状态转换、取消；
  - Windows/Android 用户输入及 source_message_id；
  - 模型 delta/complete 和 reasoning；
  - Tool、Artifact；
  - Approval 创建、单决策和终态；
  - 普通 Runtime Event 与 Backend Event 批量写入。
- 任一 Journal/Projection 写入失败时，原 Session/Run/Event/Input/Approval 状态同步回滚，
  不会出现“UI 已看到但 Runtime 没有”或“Runtime 已执行但 Journal 没有”的半提交。
- Runtime 启动时幂等迁移 pre-Journal 数据：
  - 补 Session/Run/Event；
  - 将已有用户输入迁移成 Conversation Item；
  - 多次重启不重复追加；
  - 现有 Desktop Session import 继续保留稳定 identity 和元数据。
- Journal 使用专用递归凭据脱敏：
  - 保留权威会话正文；
  - 清除 token、password、Authorization 等凭据；
  - 已脱敏内容不会二次产生多余 `]`。

### 自动测试证据

| 验收 | 证据 |
| --- | --- |
| 100 个并发 writer | sequence 连续唯一；重启后从下一 sequence 继续 |
| source_message_id / revision | 同语义重试不追加；旧 revision、同 revision 异义和跨 item 重放拒绝 |
| 事务故障注入 | Run 创建与用户输入在 Journal trigger 失败时整体回滚 |
| Snapshot 建流竞态 | Snapshot S 后产生的事件从 S+1 完整回放 |
| 本地实时等待 | waiter 被新事件唤醒，无轮询丢失 |
| checkpoint/压缩 | 压缩前后 Snapshot hash 一致；旧游标结构化过期 |
| 旧 Runtime 升级 | 删除 Journal 后重启自动重建；再次重启无重复 |
| 完整投影 | 用户、模型、Tool、Artifact、Approval 进入同一 Session Snapshot |
| Projection 确定性 | 全量 Journal replay 的 Item 列表与 Snapshot 完全相同且 hash 相同 |
| 凭据安全 | 正常正文保留，固定 token canary 不出现在 SQLite |

定向回归：

```text
test_runtime_conversation_journal.py
test_runtime_engine.py
30 passed
```

相邻功能回归（Journal、Engine、旧迁移、合同、V3 账本、Relay Gateway、
Desktop Thread Projection）为 `56 passed`。

Python 包全量回归尚不能作为本轮全绿证据：

- 7 个既存测试仍直接加载已经迁移走的旧文件路径，在 collection 阶段
  `FileNotFoundError`；
- 排除这 7 项后，前 235 项通过、1 项跳过，随后既存 V2
  `mobile_remote_workspace_acceptance_v2.py --check` 因 V2 文档/账本漂移失败；
- 这些问题不在 M12 定向和相邻回归中，但必须在 V3 最终 M16 全量发布门禁前清理。

### 状态升级

- M12-F01：`local_pass`
- M12-F02：`local_pass`
- M12-F03：`local_pass`
- M12-F04：`local_pass`

累计账本：

```json
{
  "local_pass": 75,
  "unverified": 29,
  "full_pass": 0,
  "blocked": 0
}
```

M11 仍保持未验证：Runtime 尚未通过 Gateway 暴露 Session SSE，也尚未形成
TypeScript 生成模型和三端最低版本/capability 门禁。

### 下一轮

进入 M13 Windows Desktop 共同订阅的 Runtime/Gateway 前置：

1. 在 Windows Runtime loopback Gateway 暴露 Snapshot、Event replay 与 Session SSE；
2. 冻结 cursor expired 和 SSE heartbeat/error 结构；
3. 让 Desktop Runtime Client 建立按 Session 的本地订阅；
4. Windows 输入统一通过 Runtime `create_run` 语义链路；
5. 完成 Desktop 重启、cursor/outbox 与 Android-originated Event 的 UI 自动测试。

## 第 3 轮：Runtime Session 通道与 Windows Desktop 共同订阅

更新时间：2026-07-27

### 已实现

- Full Runtime loopback Gateway 新增权威接口：
  - `GET /v1/sessions/{session_id}/conversation-snapshot`
  - `GET /v1/sessions/{session_id}/events?after_sequence=`
  - `GET /v1/sessions/{session_id}/events/stream?after_sequence=`
- Snapshot 在同一读事务返回 `snapshot_sequence`；SSE 在发送 HTTP 200 前校验
  retention waterline，旧 cursor 返回结构化 `409 cursor_expired/history_truncated`。
- SSE 使用 Session sequence 作为 `id`，15 秒 heartbeat；Snapshot 与建流间新增事件可从
  `S+1` 回放，不存在订阅竞态窗口。
- Runtime Gateway 只在完整四项能力存在时声明：
  `conversation.snapshot`、`session.event.resume`、`session.event.stream`、
  `session.event.cursor_expired`。
- Windows 出站 Runtime WSS 新增 Session 帧：
  `type=event + scope=session + session_id + session_sequence + event`；
  旧 Run Event 帧保持兼容。
- Gateway Control 增加 Session Snapshot/replay 授权语义，并从 Runtime Journal 增量读取
  Session Event；Runtime 重启或 cursor 过期时回到最新 Snapshot 水位。
- Desktop Runtime Client 增加 Snapshot、replay、Session SSE 接口。
- Desktop 订阅器实现：
  - Snapshot 后按水位建流；
  - 重复 Event 丢弃；
  - gap/cursor expired 自动重取 Snapshot；
  - 网络断流从最后已提交 cursor 重连；
  - 跨 Session Event fail closed。
- Windows Renderer 打开绑定 `runtimeSessionId` 的会话时启动订阅；Main 进程把 Runtime
  Item 投影成消息、reasoning、Tool、Approval、Artifact 和 error，并通过 IPC 实时更新
  当前会话。一次性 `thread-snapshots.json` 只作为无 Runtime 能力时的兼容缓存。
- 已把 M14 输入同步给正确的 ai-dev 任务
  `019f5208-0f19-7883-b3e2-4dcc8ffa4b61`，把 M15 输入同步给 Android 任务
  `019f4fa6-b70a-7a53-a9a9-018a11e0a836`。

### 自动测试证据

| 测试 | 结果 |
| --- | --- |
| Gateway + Journal + Runtime connector/control 定向回归 | 41 passed |
| Journal + Engine 扩展回归 | 33 passed |
| Desktop Node TypeScript | `typecheck:node` 通过 |
| Desktop Renderer TypeScript | `typecheck:web` 通过 |
| Desktop Session subscription fixture | 重复、gap、重取 Snapshot、投影顺序通过 |

### 状态升级

- M11-F01：`local_pass`
- M11-F02：`local_pass`
- M11-F03：`local_pass`
- M11-F04：仍为 `unverified`，Android 与 Relay 的实际 capability/最低版本门禁尚未闭环。
- M13-F01～F04：保留 `unverified`。本轮完成核心代码和确定性测试，但方案要求的
  Windows UI 自动化 P95、Android-originated fixture、Desktop outbox/未读同步与重启验收
  尚未全部完成，不能提前标记。
- M14：Windows 发送侧已实现，但 Relay 接收、多 worker replay、授权、撤销和指标尚待
  ai-dev 正确任务完成。

累计账本：

```json
{
  "local_pass": 78,
  "unverified": 26,
  "full_pass": 0,
  "blocked": 0
}
```

### 当前阻塞与下一轮

1. HAI Relay 必须接收并分流 `scope=session` 帧，提供公开 Snapshot/Session SSE；当前
   Windows 发送未知帧不会替代 Relay 实现。
2. Android 必须从 active Run SSE 切换为 Session Sync Engine，才能发现 Windows 后续 Run。
3. Windows 还需完成 M13-F01 的所有发送路径统一、M13-F04 cursor/outbox 持久化和
   Session 列表未读/更新时间同步。
4. 完成 Relay/Android 合同后执行真实双向 E2E、故障矩阵和 1 小时稳定性验收。

## 第 4 轮：双端共同写入、持久恢复与 Android Session Sync

更新时间：2026-07-27

### Windows Desktop / Full Runtime

- My DrSai 与 Codex 两条本地发送路径已统一进入 Runtime
  `Session -> create_run -> execute`，不再调用 Desktop 私有
  `/v1/chat/completions` 路径。
- Windows 写入携带稳定 `source_message_id=desktop:<request_id>` 与
  `source_client=windows`；Android Relay 执行携带
  `source_message_id=android:<idempotency_key>` 与 `source_client=android`。
- Desktop 新增持久化 `session-sync-state.json`：
  - Session cursor 只允许单调前进；
  - outbox 只保存 source ID、幂等键、payload hash 和 Run ID，不保存消息正文；
  - Electron 重启后可以恢复未确认发送；
  - Snapshot 已确认 source ID 后才清除 outbox。
- 打开的会话使用 Snapshot -> replay -> Session SSE，并在重复、gap、
  `cursor_expired` 或网络 EOF 时从已提交 cursor 恢复。
- 未打开的 Runtime 会话由后台 catalog 同步更新时间、消息数和未读状态，通过
  `desktop:thread-catalog` IPC 更新 Renderer。
- Windows 投影 fixture 已覆盖 Android 来源消息以及模型 reasoning、Tool 生命周期。

### Android M15

- Android 已切换为 Session Snapshot -> `after_sequence` replay -> Session SSE，
  不再只订阅进入页面时的 active Run；后续多个 Run 可持续进入同一页面。
- Room v8 新增 Conversation Item / Session Event 表，Snapshot+items+cursor 与
  event+cursor 均为同事务提交；gap、碰撞、失败事务和旧 Snapshot 均不得推进或回退 cursor。
- Android 发送使用同一 `source_message_id` 与 idempotency key，optimistic item
  由 Runtime 权威 Snapshot/Event 归并。
- JVM 为 `224/224`；`RemoteSessionSyncStoreTest` 在三星 SM-X936C `4/4`、
  API 35 emulator `4/4`，共 `8/8`；最新 debug APK 已覆盖安装。
- 真机驱动已加入 Windows/Android 时钟偏差校正；仅重建并覆盖安装 Test APK，
  未重装主应用、未运行测试、未清数据。Test APK SHA-256：
  `CA9CE7B3F2DA5EF48646BCD205532FD8C09F1F164518D5EA738D44801820B7B5`。
- 真机 debug OIDC 因 AndroidTest 安装被清除，公网 Session SSE E2E 仍需重新登录后执行。

### HAI M14 阶段状态

- 正确的 ai-dev 任务 `019f5208-0f19-7883-b3e2-4dcc8ffa4b61` 已在
  `ai-dev.ihep.ac.cn` 实现并热加载：
  - `scope=session` WSS frame 校验和分流；
  - Session Snapshot、events 与 SSE；
  - Redis replay、generation fencing、sequence 去重、`cursor_expired`；
  - association 撤销断流和公开 DTO 归一化。
- 定向 Relay `13 passed`、OIDC `18 passed`，公网 health/OpenAPI 为 200，
  新端点匿名访问为 401。
- M14 已形成 ai-dev 独立提交
  `173bb1abc6be3099d8f641a8897c7861e62bbb8a`，仅包含三份 Relay 文件；
  尚未使用真实 Android association 完成 Snapshot/SSE 公网链路。

### 合同归一

- `conversation_read` 已从旧 `/conversation` 统一为
  `/conversation-snapshot`，并重新生成 Python/Kotlin 合同。
- `session-events/1` 的 Runtime/Android/Desktop 最低版本已按当前三端实际版本统一为
  `1.5.3`；旧 schema 的 `1.6.0` 与 Android 实际门禁不一致问题已消除。
- 合同、Gateway Session 流和 Runtime Client 定向回归 `30 passed`。

### 本轮自动测试

| 测试 | 结果 |
| --- | --- |
| Desktop Node / Web TypeScript | 全部通过 |
| Desktop cursor/outbox 重启 verifier | 通过 |
| Desktop Session subscription / Android-originated projection | 通过 |
| Python Journal/Gateway/Relay/Projection 定向集合 | `80 passed, 1 skipped` |
| provenance + contract 追加回归 | `19 passed` |
| Android JVM | `224 passed` |
| Android 真机 + emulator Room 原子性 | `8 passed` |
| V3 finalizer 正负门禁 | `7 passed` |
| V3 finalizer + 真机 convergence 驱动 | `12 passed` |
| Desktop JUnit 生成器 | 单元测试 `2 passed`；实际四项 `4/4` |
| ai-dev 匿名 V3 smoke | 9 项通过；authenticated gate 按预期跳过 |
| 三端 transcript digest | Python `2 passed`；Android 通过；Desktop verifier 通过 |
| V3 真机 convergence 驱动 | 驱动/三端 digest `7 passed`；AndroidTest 编译通过 |

### V3 发布证据包

- 新增 `scripts/finalize_mobile_remote_workspace_release_v3.py`。
- 发布器只有在以下证据全部存在且通过时才生成 104/104 `full_pass`：
  - Python、Android、Desktop 三套 JUnit；
  - Android APK digest；
  - 目录、Windows -> Android、Android -> Windows 三张真机截图和 digest；
  - 双向各两个 Run、P95 < 2 秒、sequence 无缺失/重复；
  - Runtime、Windows、Android 三份 transcript SHA-256 完全一致；
  - 两设备独立 association、撤销断流和 Approval 单决策；
  - Android 后台/杀进程、换网、Runtime/Relay 重启五类故障；
  - 3600 秒观测、内存/句柄阈值；
  - Android APK/log/Room、Windows DB/log/dump、Relay log/Redis/PostgreSQL、
    diagnostics 十类 secret source 零命中。
- 所有输入证据、截图、APK 和 JUnit 进入 `manifest.json`，逐文件记录 SHA-256
  和字节数；弱证据、缺项、路径越界、坏截图、失败 JUnit 或 hash 漂移均 fail closed。
- 新增 `run_mobile_remote_workspace_desktop_tests_v3.py`，实际运行 Node/Web
  typecheck、cursor/outbox 和 Session subscription 四项，并生成不含 stdout/stderr
  的 Desktop JUnit。
- 已对 `ai-dev.ihep.ac.cn` 执行只读匿名 V3 smoke：health、OpenAPI、metrics、
  v1/v2 401、Session Snapshot/SSE 401 与 WSS 非法 token 拒绝全部通过；认证分页
  和真实 Session 仍等待 Android OIDC 登录。
- Runtime/Python、Windows/TypeScript 与 Android/Kotlin 已实现完全相同的
  Session Conversation 规范化 SHA-256：按 `session_sequence,item_id` 排序，
  排除 transport timestamp/cursor，递归排序 payload key。三端固定 fixture
  digest 均为 `ea44f0e9…af3c9`，最终 E2E 可直接比较而不依赖人工解释。
- 新增 `accept_mobile_remote_workspace_real_device_v3.py`：
  - Windows -> Android：先在 Android 建立 Session SSE monitor，再由 Windows
    loopback Runtime 并发创建/执行两个带 `source_client=windows` 的 Run；
    按 Android 实际收到对应 Run Event 的墙钟时间计算 P95；
  - Android -> Windows：Android 在 Session SSE 已建立后创建两个稳定
    source message/幂等 Run，要求两个 Run 都经 Session 流抵达并在 UI 可见；
  - 从 Windows loopback Runtime 读取权威 Session Snapshot；
  - 通过真正的 Windows TypeScript digest helper 计算 Windows hash；
  - 调用 Android `session-proof` instrumentation，通过公开 Relay
    `/conversation-snapshot` 与 `/events` 采集 Android hash/sequence；
  - 两个方向都要求 Run=2、P95<2 秒、无重复/缺序；三份 hash、水位、
    source message 任一不一致即失败；
  - 只输出计数、sequence、hash 和截图 digest，不输出消息正文或 token。
- V3 finalizer 已支持独立合并 `session-convergence.json`，无需人工复制 proof。

登录后的双向验收命令已收敛为：

```powershell
.\.venv\Scripts\python.exe scripts\accept_mobile_remote_workspace_real_device_v3.py `
  --runtime-id <PUBLIC_RUNTIME_ID> `
  --workspace-id <WORKSPACE_ID> `
  --session-id <SESSION_ID> `
  --windows-two-runs --android-two-runs `
  --interaction-id <本次唯一ID>
```

该命令会自动生成四个稳定 source message ID，完成两个方向各两个 Run，并写出
`release/product-evidence/mobile-remote-workspace-v3/session-convergence.json`。

## 第 6 轮：真实一小时稳定性与故障注入驱动

更新时间：2026-07-27

- 新增 `scripts/monitor_mobile_remote_workspace_stability_v3.py`，不再沿用
  “Runtime generation 或 Android PID 变化即失败”的 V2 判定。V3 在 3600 秒窗口内
  依次注入 Android 后台、Android 进程终止、网络切换、Windows Runtime 重启和
  Relay owner 重启，并逐项等待恢复。
- 每个故障前后均由 Android Debug Receiver 使用设备内 OIDC 登录态读取同一
  Conversation Snapshot；自动断言 `snapshot_sequence` 和三端统一的
  `sessionConversationDigest` 不变、无重复 Run、无缺失 sequence。
- Debug Receiver 已改为 `AccessTokenCoordinator` 自动刷新 OIDC，不再把启动时
  bearer 固定使用一小时；Snapshot 使用 500 条分页、固定水位、item ID 碰撞和
  10 万条上限 fail-closed。
- 稳定性报告新增 finalizer 所需的 `memory_within_threshold`、
  `handle_count_within_threshold` 和五项 `faults` 证据；发布模式拒绝
  `duration<3600`。
- 通用 canary scanner 已补齐 V3 finalizer 直接消费的 `matches`、`sources` 和
  `bytes_scanned`；V3 profile 缺少上述十类任一来源、来源为空或标签重复均
  fail-closed。
- 新增 `assemble_mobile_remote_workspace_real_evidence_v3.py`，只接受经过验证的
  目录/Approval、双设备隔离/撤销断流和五类稳定性故障报告，生成 finalizer 所需的
  十项真实检查；再由 convergence report 合并双向两 Run 与三端 hash。Approval
  真机 proof 已补充“成功决策恰好一次、Tool 完成恰好一次”计数。
- V2 真机驱动新增 `--catalog-approval-only`，并将安装版 Gateway 默认端口改为
  `18642`；目录/Approval 取证后立即返回，不再误停安装版 Runtime 或启动会抢占
  enrollment 的 18643 开发 Gateway。
- Python 稳定性、V2 回归和 V3 finalizer 聚焦测试 `18 passed`；稳定性、
  canary scanner 与 finalizer 联合回归 `23 passed`；真实证据汇编器与
  稳定性/finalizer 联合回归 `16 passed`。
  Android `compileDebugKotlin`、`assembleDebug` 均通过。主 App 已保留数据覆盖安装，
  SHA-256 为
  `435C55FD64BD116232D99BEF5B53AD1B0F68FD8B6538E2F161469DC088184194`；
  Test APK SHA-256 为
  `CA9CE7B3F2DA5EF48646BCD205532FD8C09F1F164518D5EA738D44801820B7B5`。

登录并完成双向 E2E 后，以同一个 Session 执行正式一小时门禁：

```powershell
.\.venv\Scripts\python.exe scripts\monitor_mobile_remote_workspace_stability_v3.py `
  --runtime-id <PUBLIC_RUNTIME_ID> `
  --workspace-id <WORKSPACE_ID> `
  --session-id <SESSION_ID>
```

## 第 7 轮：设备级 Association 完成性审计

更新时间：2026-07-27

- 对 M01-F07/M05-F04 的完成性复核确认：当前已部署模型只按
  `issuer + subject + runtime_id` 建立 association，Android consume 请求也只有
  `request_id + correlation_id + code`。因此同账号第二台设备会复用第一台设备的
  association，撤销任一设备会影响另一台；单独复制 bearer 也没有设备私钥门禁。
- 这两项继续保持 `unverified`，不能用“单真机扫码成功”升级；平台端已交由正确的
  `ai-dev.ihep.ac.cn` 任务实施独立 `device_id`、设备公钥、逐请求签名、nonce 防重放、
  单设备撤销和既有 SSE 定向断流。旧无设备 association 必须 fail-closed 并重新配对。
- 合同冻结后 Android 将生成不可导出的稳定设备密钥，并为目录、代理、SSE 与 control
  请求统一签名；最终使用三星真机和 API 35 emulator 作为 A/B 两设备完成真实隔离矩阵。

### 状态升级

- M11-F04：`local_pass`
- M13-F01～F04：`local_pass`
- M15-F01～F04：`local_pass`
- M16-F01：`local_pass`；100 次双来源并发写入顺序和 Approval 单赢家通过。
- M16-F02：`local_pass`；合同生成、最低版本和 fail-closed 矩阵已通过。
- M16-F03：`local_pass`；双向两个 Run、P95、sequence、UI 与三端 hash 驱动已完成。
- M10-F08：`local_pass`；V3 104 项发布阻断器和 digest manifest 已完成。
- M16-F04：`local_pass`；一小时/故障/脱敏/证据包门禁已完成，等待实际执行。
- M14-F01～F04：`local_pass`；真实公网链路与发布规模压力留待联合验收。

累计账本：

```json
{
  "local_pass": 96,
  "unverified": 8,
  "full_pass": 0,
  "blocked": 0
}
```

### 下一轮

1. 用户在三星 debug APK 重新登录后，执行 Windows -> Android 和
   Android -> Windows 各两个 Run 的真实 Session SSE E2E。
2. 使用 V3 finalizer 收集双向 P95、故障、脱敏、JUnit、截图与 digest。
3. 执行一小时稳定性并将剩余 8 项由 `unverified` 升级为 `full_pass`。

## 第 8 轮：Android 稳定设备身份与逐请求证明

更新时间：2026-07-27

- 已冻结并实现 `device-association/1`：
  - 生成 Ed25519 稳定设备密钥；私钥只以 PKCS#8 明文短暂存在于应用进程内，落盘由
    Android Keystore 中不可导出的 AES-256-GCM 主密钥加密；
  - `device_id` 从 raw 32-byte 公钥 SHA-256 派生，不使用 Android ID、序列号或账号；
  - 扫码关联提交 `device_id / device_name / device_public_key`；
  - 关联后的目录、代理、SSE、OWOP 与控制请求统一携带设备 ID、时间戳、单次 nonce 和
    raw Ed25519 签名。
- Canonical request 已用固定测试向量锁定：完整 `/api/runtime-relay/v1` path、重复 query key、
  空值、空格、Unicode、原始 body SHA-256 与 access-token SHA-256 均与 HAI 冻结规则一致。
- Release 构建在缺少设备证明时 fail-closed；旧 JVM/debug fixture 的无签名兼容分支仅在
  `BuildConfig.DEBUG` 下存在，所有主应用与 Stability Probe 生产调用点均显式传入
  Android Keystore proof。
- 共享 Relay schema、Python model、Kotlin/Python 生成合同和本地参考 Relay 已同步设备字段；
  同一主体的两台设备现在以独立 association 表示，本地撤销只命中指定设备。
- 自动测试：
  - Android JVM `228/228`；
  - AndroidTest 源码编译通过；
  - 本地 Relay、合同漂移与 V3 账本 `41/41`；
  - V3 账本仍为 `96 local_pass + 8 unverified`，未用实现证据冒充真实双设备验收。
- 新构建物：
  - 主 APK SHA-256：
    `F36CDA455572CFD083D31FBDAF734908FE982172785344A81644C95A519956B7`
  - Test APK SHA-256：
    `944BAFD04C9AA9E0A8310B119314A245C75933D6F0645AA6BF02FB90B3C51128`
  - 已通过 `adb install -r` 覆盖安装到三星真机与 API 35 emulator，未清应用数据。
- 三星与 emulator 的系统 Provider 均不能稳定直接生成 AndroidKeyStore Ed25519：前者错误返回
  DER ECDSA，后者要求不适用的 KeyGenParameterSpec。已改用固定 EdDSA Provider 生成标准 raw
  Ed25519，并以 Keystore 主密钥加密保存；两端均完成“身份二次读取不变 + raw 公钥重建 +
  实际签名反向验证”，各 `1/1` 通过。
- 新增 32 路并发初始化门禁，确保多个 ViewModel/Client 首次同时启动时只形成一个持久设备身份，
  且 32 个请求签名均唯一；三星和 emulator 各 `2/2` 通过。Debug JVM 全量 `229/229`，
  Release 单测确认缺少设备 proof 必须 fail-closed。
- 正确的 ai-dev 管理任务 `019f5208-0f19-7883-b3e2-4dcc8ffa4b61` 已完成加法迁移和部署；
  commit `ceeb5338b49f5aef8e7d47be966f5226cc138429`，Alembic head
  `4b28de4b905c`，Relay `10 passed`、OIDC `18 passed`。未关联目录保持
  `200 empty` 且不访问 Runtime/cache，关联后的所有资源必须验证设备证明。

### 下一步

1. 等待 ai-dev 返回实际提交、migration head、聚焦测试和公网只读 smoke。
2. 只使用 `adb install -r` 覆盖主 APK/Test APK，不清数据；用户重新登录并重新扫码。
3. 三星真机与 API 35 emulator 完成 A/B 设备隔离、单设备撤销、既有 SSE 定向断流。
4. 完成双向各两个 Run、Approval、五类故障、一小时稳定性和十类 secret source 扫描，
   再由 finalizer 将 104 项一次性升级为 `full_pass`。

## 第 9 轮：真实设备配对与目录闭环

更新时间：2026-07-27

- 三星真机完成 OIDC 登录后，未配对基线验证通过：设备证明有效，
  `GET runtimes` 为 `200 empty`，目标 Runtime 不可见。
- Windows 通过本机 Gateway 生成一次性 device-bound Grant，三星消费成功；Runtime
  registration token 始终只存在于 Windows DPAPI/Gateway 内，没有传给测试驱动或 Android。
- ai-dev 修复目录入口的设备证明门禁后，真实 post 验收通过：
  - Runtime 在线，2 个 active Workspace；
  - 23 个 active Session、53 个 Conversation item；
  - opaque cursor 正常，篡改 cursor 返回 `400 invalid_cursor`；
  - 跨 Runtime/Workspace IDOR 分别返回 403/404；
  - Android 主机目录和 Workspace Session 页面均通过真实 Accessibility UI 断言。
- 修复了两个 Android 真实 UI 问题：
  - Workspace Session 页不再把默认空搜索串发送成 `query=`，而是省略 query；
  - 真机断言会跨 LazyColumn 滚动累积 semantics，不再要求全部条目同时出现在一个视口。
- Windows 已接入设备级授权 DTO，授权列表显示 `device_name`、
  `device_summary` 和 `subject_summary`，并保留按 association 撤销；Python 14 项、
  Desktop node/web 类型检查、配对 controller/UI 验证全部通过。
- Android JVM `229/229`，主 APK/Test APK 均只用 `adb install -r` 覆盖，未清数据：
  - 主 APK SHA-256：
    `7C0C3A5F29D162F46523F9B0757EF902F7672CED8650916AF16AB95D3C9D19E3`
  - Test APK SHA-256：
    `63EB97ADAD2ADD44BD5CCDAF4BC634E7F4D8D887654CD88CCC81FFFE7B3BF31F`
- Windows Gateway 重载时补齐 instance-token 环境并恢复 Relay 出站桥；真实 post
  在新 generation 上再次通过。Runtime WebSocket 正常关闭后增加 1 秒退避，避免异常 peer
  快速 close 时形成无等待重连循环；Runtime client 与配对回归合计 `32 passed`。

### 当前联合验收边界

- ai-dev 已提交并热加载 `conversation-snapshot` 修复：
  - `68c84d8332194bdbfabb22c0d662f76e257d334e` 转发受限 `limit`；
  - `910c8b9e7de0351aa9b1bade6f60644d87f7f3f7` 对齐
    `snapshot_sequence / next_cursor`。
- ai-dev 已对齐 association 的 `created_at` 及 list/两类 revoke DTO，并以
  `a7c4e5e518702bba1be75892f819ea7e544017df` 将设备摘要统一为冻结的
  `dev_<12 hex>`；等待公网恢复后由 Windows 做真实 DTO smoke。
- 当前真正的外部阻塞在 TLS 入口：Caddy 只声明
  `https://aitest.ihep.ac.cn`，没有 `https://ai-dev.ihep.ac.cn` 的 SNI site。
  服务器本机 health 可为 200，但三星 Conscrypt 收到
  `TLSV1_ALERT_INTERNAL_ERROR`，Windows 外网 443 也不可达。平台任务无 root/sudo
  凭据，尚不能修改 `/etc/caddy/Caddyfile`；需管理员补同证书、同
  `proxy_routes` 的 ai-dev site，执行 `caddy validate` 后 reload。
- Windows 在 Android Session 监视器未就绪时不会创建测试 Run；验收驱动现在会把
  `relay_http_* / SSLHandshakeException / real_*` 收敛成脱敏错误码，而不是只报告
  ready timeout，并在启动监视器前对受信 host 执行 HTTPS、无重定向、HTTP 200 的
  `/v2/health` 预检。对应回归 `10 passed`。
- API 35 emulator 已安装同一构建，但仍需用户手动完成同账号 OIDC 登录，之后才能执行
  A/B 独立 association、单设备撤销和 SSE 定向断流。
- 累计账本暂不虚增，仍为 `96 local_pass + 8 unverified`。

### 下一步

1. 管理员补齐 ai-dev Caddy TLS site 并恢复真实外网 443 后立即复跑 Snapshot。
2. emulator 登录后完成 A/B 配对、复制证明拒绝、撤销 A 而 B 继续 200。
3. 完成双向各两个 Run、Approval、五类故障、一小时稳定性与端侧 secret canary 扫描。

## 第 10 轮：ai-dev 恢复与 Session Snapshot 合同闭环

更新时间：2026-07-27

- ai-dev 公网 TLS 已恢复；三星真实 post 验收重新通过，Windows Gateway 的设备授权列表也已
  恢复为 1 条有效 device-bound association。历史无设备 association 仍保留用于审计，但不再
  暴露给“已授权设备”列表。
- Windows 本机 Journal 与语义控制链路均验证正常：
  - loopback `conversation-snapshot` 返回 200；
  - 当前 association subject 与 Relay Session binding 匹配；
  - `conversation_snapshot_for_subject` 返回合法 Snapshot；
  - Runtime client、Gateway control 和 Journal 聚焦回归 `40 passed`。
- 真实三星 monitor 将剩余问题定位为 ai-dev Snapshot 投影合同漂移，而非 Runtime 离线：
  - 首次 502 来自 Relay 将 V3 Journal Item 按旧 `sequence/timestamp` DTO 投影；
  - 修复后继续 fail-closed，准确暴露顶层 `snapshot_sequence` 被错误输出为
    `session_sequence`；
  - ai-dev 正将 Snapshot 与旧 `/conversation` DTO 分离，顶层严格输出
    `session_id/snapshot_sequence/items/next_cursor`，每项严格输出共享 schema 的 12 个字段，
    且 `additionalProperties=false`。
- 真机验收驱动新增 `snapshot_sequence_missing` 脱敏诊断，不输出正文、token 或完整异常；
  随后继续为 post-ready instrumentation 增加有界失败阶段。Windows/驱动聚焦回归通过，
  Android JVM 全量为 `232 passed`。
- ai-dev commit `be00133` 已热加载最终 Snapshot 合同：顶层严格 4 字段、Item 严格
  12 字段；三星 Snapshot→Session SSE monitor 已能成功就绪。
- 首轮真实 Windows→Android 验收进一步暴露 Android SSE 继承普通 HTTP 30 秒 read timeout：
  已改为保留调用方 TLS/interceptor/连接池但强制流式客户端 `readTimeout=0`，并以
  50ms 普通 HTTP timeout + 150ms 延迟 SSE fixture 证明不会误超时。
- 受控无凭据验收模式下，Windows 已有多组各两条 Run 成功完成，权威 Snapshot 含对应
  `source_message_id`；ai-dev replay store 也确认每组事件连续、字段为冻结 9 项。
  当前未闭环点收敛到 Session SSE replay/live 帧是否真正送达 Android collector；
  ai-dev 正补 `after_sequence/replay_count/close_reason` 脱敏观测。
- 最新主 APK 仅用 `adb install -r` 覆盖三星、未清数据，SHA-256 为
  `0AB33FFA0988F3B5FCA4113825D7453AE1D3E66B4863FB74F6E8815E3567FD0A`；
  Test APK SHA-256 保持
  `63EB97ADAD2ADD44BD5CCDAF4BC634E7F4D8D887654CD88CCC81FFFE7B3BF31F`。
- Windows Gateway 仅在创建受控 canary 时临时启用验收模型；取证结束后已恢复生产模式，
  未读取 Desktop OIDC bearer 或模型密钥。
- 验收脚本继续保持副作用门禁：只有 Android Snapshot→Session SSE monitor 就绪后才创建
  Windows canary Run；本轮两次合同失败均未创建 Run。
- API 35 emulator 仍停在 OIDC 登录入口，因此双设备隔离与定向撤销尚未开始。
- 累计账本保持 `96 local_pass + 8 unverified`，不以合同修复或单设备证据冒充最终真机验收。

### 下一步

1. ai-dev Snapshot 12 字段投影热加载后，完成 Windows→Android 两个 Run 与
   Android→Windows 两个 Run 的实时 Session SSE/三端 transcript hash 验收。
2. emulator 完成同账号 OIDC 登录后，建立独立 association；验证复制证明拒绝、撤销 A 后
   A 的目录/Snapshot/SSE 失效而 B 继续 200。
3. 完成 Approval 单执行、五类故障、一小时稳定性、端侧 canary 扫描和 V3 finalizer。

## 第 11 轮：Windows→Android 实时会话闭环

更新时间：2026-07-27

- ai-dev 恢复后，使用当前权威 Workspace/Session 标识完成真实公网、Windows Runtime、
  三星真机三段联合验收。最终证据：
  - Windows 连续创建 2 个 Run；
  - Android 在创建 Run 前已打开目标会话并建立 Session SSE；
  - `run_count=2`、`duplicate_run_count=0`、`missing_sequence_count=0`；
  - Windows 发起到 Android 收到事件的 P95 为 `1.590s`，满足 `<2s`；
  - 同一页面的 Accessibility 断言能看到最新测试消息。
- 证据文件：
  `release/product-evidence/mobile-remote-workspace-v3/session-convergence-windows.json`。
- Runtime 修复：
  - Session Relay 游标持久化到 SQLite，Gateway 重启不再重放约 8.5 万条历史事件；
  - 首次发现的历史 Session 以当前 Snapshot 水位建立游标，重启后从持久游标恢复；
  - Session 轮询由全目录串行等待改为有界并发、热 Session + 冷 Session 轮转；
  - 直接读取 Runtime Journal 水位，只优先轮询已真实产生新 sequence 的发布 Session；
  - 单 Session 操作只同步目标 Desktop Thread，不再重复导入整个工作区目录；
  - `import_session` 对完全相同的 Desktop 元数据真正幂等，修复
    “读取 Snapshot → 写 session.updated → Android 重载 Snapshot”的反馈环。
- 反馈环修复后实测：目标 Session 空闲 5 秒 Journal 增长为 `0`，Relay cursor 与
  Runtime `last_sequence` 差值为 `0`。Runtime/Gateway/Journal 聚焦回归
  `60 passed`；Session 轮询与恢复组合回归 `42 passed`。
- Android 修复：
  - 普通 HTTP 客户端的有限 read timeout 不再作用于长连接 SSE；
  - HTTP/2 stream reset/EOF 后从最后已提交 `session_sequence` 自动续订；
  - 幂等 GET 在瞬时连接失败时清理旧连接并仅重试一次，写请求不进入通用重试；
  - Snapshot、Runs、Approvals 并发读取，Snapshot 先于非关键元数据呈现；
  - 长会话打开及新增消息时自动定位最新消息；
  - 真机驱动先打开真实会话页，再由 Windows 发消息，不再用测试专用 collector
    代替产品 ViewModel；平板自动化滚动明确选择右侧会话列表。
- Android JVM 全量 `233/233`；主 APK/Test APK 均仅通过 `adb install -r`
  覆盖三星，未清登录和配对数据：
  - 主 APK SHA-256：
    `A141F31063A45F4FD038E3FA476A6AFCB6068C138792ED61015638ABDFDBDF3D`
  - Test APK SHA-256：
    `22E063C16DF8E358180C31B7B6AC80287A12ED22E663BE82A9B1D34538F1AD25`
- 真实验收结束后，Windows Gateway 已关闭临时
  `DRSAI_RUNTIME_CONTROLLED_MODEL` 并恢复生产模式，本地认证 health 为 200。
- ai-dev 偶发 TLS `internal_error` 时，验收只对只读 health 预检做 3 次有界重试；
  证书身份错误仍立即 fail-closed。对应驱动回归 `13 passed`。

### 状态口径

- Windows→Android 两轮实时 Session 同步已经取得真实公网/真机证据。
- M10-F06 还要求 Android→Windows 与真实 Approval 单执行，因此仍保持
  `unverified`，不拆分或提前升级。
- 累计账本保持 `96 local_pass + 8 unverified`。

### 下一步

1. 执行 Android→Windows 两个 Run，并比较 Runtime、Windows、Android 三份
   transcript SHA-256。
2. 执行真实 Approval：Android 批准后 Windows Tool 只执行一次。
3. emulator 完成同账号 OIDC 登录后执行 A/B association 隔离与单设备撤销。
4. 完成五类故障、一小时稳定性、端侧 canary 扫描和 V3 finalizer。

## 第 12 轮：Android→Windows 实时会话闭环

更新时间：2026-07-27

- 完成真实公网、三星真机、ai-dev Relay 与 Windows Runtime 的反向两轮验收：
  - Android 连续创建 2 个 Run；
  - `run_count=2`、`duplicate_run_count=0`、`missing_sequence_count=0`；
  - Android 发起至 Session 事件到达的 P95 为 `1.020s`，满足 `<2s`；
  - Runtime、Windows、Android 三份规范化 transcript SHA-256 完全一致：
    `14c1dd742e17275dfb02178f7dfa3c1b81c797e7975416c5b9cd7f2d4fd56e41`；
  - Snapshot 水位为 `11237`，43 个会话项、500 个回放事件，无重复或缺失 sequence；
  - 证据文件：
    `release/product-evidence/mobile-remote-workspace-v3/session-convergence-android.json`。
- 修复 Android 消息身份在跨端链路中的合同漂移：
  - ai-dev 之前未把 `source_message_id` 写入 `runtime.request.arguments.kwargs`；
    已由 revision `df3ddf5` 原样透传、限制长度并保持日志脱敏；
  - Windows `GatewayRuntimeControlHandler` 新增兼容数据库列，幂等重试仍返回同一 Run，
    并把原始 `source_message_id` 写入 Runtime Conversation Journal；
  - Windows 聚焦回归 `29 passed`。
- 为达到实时门禁，Session Journal 新增变化会话快速路径：先以发布 Workspace 集合校验
  可见范围，再直接轮询确有新 Journal sequence 的 Session，不等待历史 Workspace 与冷
  Session 扫描完成；Gateway control 回归 `11 passed`。优化前 P95 为 `3.094s`，
  优化后为 `1.020s`。
- 本轮安装构建物未清除 Android 登录、配对或 Room 数据：
  - 主 APK SHA-256：
    `F5FFC99036C63626A2ED2208951AF79CF4EE155276C6081469252E025AD4EDBB`
  - Test APK SHA-256：
    `F1FDEB928D811D76C050F88EEA97F766F17739FA3CBE6C3BCFB2EE0BD115209E`
- 验收结束后 Windows Gateway 已退出临时受控模型并恢复生产模式，认证 health 为 200。

### 状态口径

- Windows→Android 与 Android→Windows 的双向两轮实时同步、Session sequence 连续性、
  UI 可见性和三端 transcript 收敛均已有真实证据。
- M10-F06 仍包含真实 Approval 单执行验收，因此完整功能点暂不升级；累计账本继续保持
  `96 local_pass + 8 unverified`。

### 下一步

1. 执行真实 Approval：Android 批准后 Windows Tool 只执行一次。
2. emulator 完成同账号 OIDC 登录后执行 A/B association 隔离与单设备撤销。
3. 完成五类故障、一小时稳定性、Windows/Android canary 扫描和 V3 finalizer。
## 第 13 轮：真实 Approval 单次执行闭环

更新时间：2026-07-27

- 完成三星真机、ai-dev Relay 与 Windows Runtime 的真实 Approval 联合验收：
  - Android 创建 Session 和 Run；
  - Windows Runtime 产生待审请求；
  - Android 批准恰好一次；
  - Run 终态为 `completed`；
  - Tool 终态事件恰好一条；
  - Run SSE 共收到 14 条事件；
  - Conversation Snapshot 增长且产品会话页可见；
  - 全程未把 Runtime registration token、OIDC bearer、消息正文或工作区路径写入证据。
- 机器证据：
  `release/product-evidence/mobile-remote-workspace-v3/approval-single-execution.json`；
  截图：
  `release/product-evidence/mobile-remote-workspace-v3/real-device-approval-single-execution.png`。
- V3 验收脚本新增 `--approval-only`：
  只有 `successful_decisions=1`、`tool_execution_count=1`、
  `terminal_status=completed`、SSE 非空、Conversation 增长和真机 UI 可见全部成立时才写入通过证据；
  对错误终态、重复决策、零/重复 Tool、空 SSE、无 Conversation 增长和非法 digest 全部 fail-closed。
- Windows Runtime 合同补齐：
  `conversation_snapshot_for_subject` 接收并限制 `limit`，与 Relay 冻结 Snapshot 分页参数一致；
  聚焦 Python 回归 `64 passed`。
- ai-dev 完成语义通道与 DTO 漂移修复：
  - `73417e5`：Session detail 改为 `get_session`；
  - `ad0b552`：Snapshot 和 Session events list 改为 Runtime control；
  - `68c21b3`：`role`、`source_message_id` 按共享合同保留 nullable，禁止伪造；
  - `91c495d`：Run events list 改为 `list_events`，由 Windows 统一投影
    `tool.completed -> tool.finished`。
- Android JVM 全量回归 `233/233`，V3 驱动聚焦回归 `21 passed`；
  `git diff --check` 与验收脚本编译通过。
- Approval 验收结束后已移除 `DRSAI_RUNTIME_CONTROLLED_MODEL`，Windows Gateway
  恢复生产模式，认证 health 为 200。

### 状态口径

- M10-F06 所需的双向两轮 Session 同步和真实 Approval 单次 Tool 执行均已有真机证据。
- 最终账本仍保持 `96 local_pass + 8 unverified`：在五类故障、A/B 设备隔离、
  一小时稳定性、端侧 canary 和 V3 finalizer 完成前，不提前把单项证据升级为
  `full_pass`。

### 下一步

1. 完成五类故障注入与恢复验收。
2. emulator 登录后完成 A/B association 隔离和单设备撤销。
3. 执行一小时稳定性、Windows/Android canary 扫描和 V3 104 项 finalizer。
