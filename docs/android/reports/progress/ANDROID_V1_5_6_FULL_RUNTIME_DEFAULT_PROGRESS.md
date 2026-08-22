# Android v1.5.6 Full Runtime 默认绑定进度

> 当前轮次：第 20 轮（智增增真实 Tool Calling 与最终候选闭环）  
> 已验收：60 / 60（100%）  
> 当前结论：`OpenDrSai.Dev` v1.5.6 最终候选已在模拟器和 Samsung SM-X936C 真机完成全部门禁，最终机器账本 `decision=GO`

| 轮次 | 范围 | 状态 | 验收进度 |
|---|---|---|---:|
| 1 | M01 版本与 Debug 构建基线 | 通过 | 6/6 |
| 2 | M02 删除 Lite；M03 默认绑定 Full | 通过 | 12/12 |
| 3 | M04 Full/OAEP；M07 迁移 | 通过 | 12/12 |
| 4 | M05 Tool/Skill | 仅余真实模型兼容门禁 | 5/6 |
| 5 | M06 UI/诊断 | 通过 | 6/6 |
| 6-12 | M08-M10 可靠性、安全、真机最终验收 | 进行中 | 3/18 |
| 13 | 最终候选统一、M08 性能/资源、M09 安全、M10 构建身份与跨端 OAEP | 部分通过 | 13/18 |
| 14 | 当前候选复验、M08-F02 生命周期、跨端证据哈希绑定 | 部分通过 | 14/18 |
| 15 | 清理 Lite 文案；建立 fail-closed ledger；完成当前候选真机性能、默认绑定与四类故障恢复 | NO-GO | 16/18 |
| 16 | 移除 `RuntimeResourcePolicy` 残余 `kotlin_lite` 路由；补强大小写静态门禁；新哈希全量模拟器/真机复验 | NO-GO | 16/18 |
| 17 | Samsung 真机复跑真实模型探针；确认 Debug 加密配置中仍无 `deepseek-v4-flash` | BLOCKED | 16/18 |
| 18 | 新增智增增 OpenAI Compatible 预设、两款默认模型及默认 Tool 能力；拆分 Android Debug 1.5.6 与正式版 1.5.5 版本身份 | 功能通过，候选待全量复验 | 16/18 |
| 19 | Debug 显示名改为 `OpenDrSai.Dev`；重建 1.5.6/10506；安装 Samsung 真机并核对主进程与 Full Runtime 进程 | 推送与启动通过，候选待全量复验 | 16/18 |
| 20 | 智增增真实 `deepseek-v4-flash` Tool Calling；修复健康超时误判取消；最终哈希全量 JVM/模拟器/真机/OAEP/安全/性能复验 | GO | 18/18 |

## 已通过证据

- M01：v1.5.6/10506、`.debug`、Full=true、Lite=false、双 ABI、`:runtime` Service 与共享 Python Core 均已通过自动门禁。
- M02/M03：生产 APK 不含 Kotlin Lite Agent Loop；本地路由唯一绑定 `PythonSharedCoreChatEngine`；资源不足时显式 `full_runtime_blocked`，高温时仅 `remote_full_offer`，不再返回残余 `kotlin_lite`；绑定状态机、Binder death、账户隔离与 READY 门禁通过。
- M04/M07：完整 Host Ports、Normalized→OAEP 单一出口、checkpoint/receipt/reconciliation、v1.5.5→v1.5.6 数据迁移与兼容回滚通过。
- M05-F01～F06：Tool schema 单一来源、四个基础工具真实执行、SAF capability/fail-closed、Skill capability pinning、Approval 与单次副作用通过；Samsung 真机智增增 `deepseek-v4-flash` 返回 HTTP 200，并完成 5 次不同工具的真实 Tool Calling。
- M06：移除“轻量智能 Agent”；聊天页显示 `Full Local`/`Remote Platform`；个人中心显示 build、binding、health、policy、process、starts/binds/fallbacks、工具/Skill 权限分类；支持重试绑定与导出脱敏诊断；固定 `kotlin_fallback_available=false`。
- M08-F01：最终候选完成 100 次 bind/kill/rebind，0 永久挂起、0 重复 Runtime 进程；emulator bind P95 1310 ms，首事件 P95 37 ms。
- M08-F02：同一持久 Run/checkpoint 依次经历 ROTATION_90/270/0、multi-window、锁屏、后台和系统回收；恢复后 Run ID、幂等键、checkpoint sequence 7 及 `RESUME_RUN` 语义保持一致。
- M08-F03～F06：最终候选在 API 36 arm64 真机完成 500 Run、50 Tool、20 Recovery；0 重复副作用、0 数据损坏、0 永久 running，数据库 4,149,248 bytes；冷启动 P95 370 ms、恢复 P95 7.83 ms、前台 PSS 107.219 MB，全部低于门禁。
- M09-F01～F06：Runtime Service 外部绑定拒绝、Host Port 最小权限、Tool fail-closed、动态 Canary、跨账户隔离、审批单副作用、SBOM/许可证/159 个 Maven 依赖 OSV 扫描全部通过，漏洞发现 0。
- M10-F01：最终 `OpenDrSai.Dev` 候选包名 `ai.drsai.remote.debug`、version 1.5.6/10506、Full Runtime enabled；APK SHA-256 为 `6787c01c6f8122bc37608594b10f558cc2cd0c00cefc73aa9cbb88b2fadd5ce6`。从 Samsung 真机回读的已安装 base.apk 哈希与构建产物完全一致。
- M10-F02/F04：Samsung SM-X936C/API 36 真机冷启动绑定独立 `:runtime` 并进入 READY，starts/binds 增量为正；Binder death、Python/Runtime 进程死亡、受控网络中断和目标进程回收后同 Run checkpoint 恢复均未进入 Kotlin fallback。
- M10-F05：真实本地 Relay + Desktop verifier 双端 E2E 通过；Android→Desktop 与 Desktop→Android 各 9 个 OAEP event，SSE 从 cursor 4 续传 5 个实时事件，跨端审批 4 次竞争请求只产生 1 次状态转换和 1 次副作用。
- JVM：411 tests，0 failures，0 errors，2 skipped；新增智增增预设与 Runtime 健康超时重试策略契约通过。
- API 35 智增增专项 UI：1 test，0 failures；已验证预设选择、完整 chat endpoint 与两个默认模型填充。
- Python shared Core：42 passed，1 skipped。
- API 35 完整 instrumentation：173 tests，0 failures，0 errors；专用恢复门禁另完成 100/100 次循环。
- API 26/30/35 x86_64 设备矩阵历史门禁通过；API 36 arm64 最终 APK 哈希的性能、默认绑定、四类故障恢复、基础 Tool 与真实模型 Tool Calling 已全部补证。

## 尚未验收（0 项）

- 无。

最终机器 ledger：`docs/android/reports/evidence/v1.5.6/final-debug-go-no-go.json`。当前结果为 `60/60`、`completion_percent=100.0`、`decision=GO`、`missing=[]`。

所有机器可读证据位于 `docs/android/reports/evidence/v1.5.6/`。只有满足方案自动化与设备门禁的功能才计入正式百分比。
