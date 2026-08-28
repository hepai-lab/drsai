# OAEP 第三阶段 Windows Desktop + Runtime 范围说明

## 目标

本范围只覆盖当前线程负责的 Windows Desktop 桌面 UI 与后端 Runtime。Android 远程工作区、Android Room/UI、Android 真机 E2E、双设备隔离与撤销后的移动端验证由 Android 线程完成。

这样拆分后，第三阶段存在两个验收口径：

- 总体验收：`verify:oaep-stage3-complete`，包含 Android 真机证据。
- Windows Desktop + Runtime 验收：`verify:oaep-stage3-desktop-runtime`，不依赖 Android 物理设备。

## 本线程负责的功能点

共 26 个功能点，全部要求本地自动化可验证。

### M01 Desktop OAEP 真实消费闭环

- M01-F01：开发版 Runtime 启动核验。
- M01-F02：OAEP 能力探测。
- M01-F03：文本 streaming。
- M01-F04：工具和命令投影。
- M01-F05：失败和取消提示。
- M01-F06：刷新后通过 OAEP snapshot 恢复。
- M01-F07：调试入口展示 OAEP 摘要和安全错误码。

### M03 chat_completion 兼容收敛

- M03-F01：旧接口只承载文本投影。
- M03-F02：可绑定 session/run 的旧请求写入 Runtime Journal。
- M03-F03：无 Runtime 上下文时保留兼容路径。
- M03-F04：工具、审批、文件和错误语义不下沉到 chat_completion。
- M03-F05：旧客户端文本流回归兼容。

### M04 Agent 原始事件规范化

- M04-F01：事件字段清单。
- M04-F02：稳定 item_id。
- M04-F03：统一 phase/status。
- M04-F04：command stream。
- M04-F05：artifact metadata。
- M04-F06：error envelope。
- M04-F07：adapter fixture。

### M05 Runtime/Relay 公共投影与安全

- M05-F01：OAEP public DTO 校验。
- M05-F03：cursor expired。
- M05-F04：stream timeout。
- M05-F05：敏感字段扫描。

M05-F02 subject 授权依赖真实 Android association，由 Android 线程和 Platform/Relay 真实链路验收。

### M07 自动化与开发体验

- M07-F01：Runtime scoped tests。
- M07-F02：Desktop verifier。
- M07-F05：dev owner guard。

M07-F03 Android unit tests 和 M07-F04 真机 E2E smoke script 由 Android 线程验收。

## 明确排除项

以下项目不作为 Windows Desktop + Runtime 完成门禁：

- M02 全部 Android 远程 OAEP 消费闭环。
- M05-F02 subject 授权真机链路。
- M06-F01 到 M06-F05 跨端一致性真机链路。
- M07-F03 Android unit tests。
- M07-F04 Android 真机 E2E smoke。
- M06-F06 与 M08-F05 属于 TUI 后续迁移讨论，不作为当前 Windows 门禁。

## 验收命令

Windows Desktop + Runtime 范围的聚合门禁：

```powershell
npm --prefix apps\desktop\windows run verify:oaep-stage3-desktop-runtime
```

支撑证据命令：

```powershell
npm --prefix apps\desktop\windows run typecheck
npm --prefix apps\desktop\windows run verify:oaep-runtime-contract
npm --prefix apps\desktop\windows run verify:session-conversation-subscription
npm --prefix apps\desktop\windows run verify:chat-output
npm --prefix apps\desktop\windows run verify:gateway-smoke
npm --prefix apps\desktop\windows run verify:oaep-release
.\.venv\Scripts\python.exe -m pytest cores\python\packages\drsai\tests\test_oaep_protocol.py cores\python\packages\drsai\tests\test_gateway_session_events.py cores\python\packages\drsai\tests\test_codex_event_mapper.py cores\python\packages\drsai\tests\test_normalized_agent_events.py cores\python\packages\drsai\tests\test_runtime_conversation_journal.py cores\python\packages\drsai\tests\test_relay_oaep_replay.py cores\python\packages\drsai\tests\test_relay_api.py -q
```

## 当前结论

Windows Desktop + Runtime 范围可以独立完成并报告 100%。Android 真机相关项目继续保留在总体验收门禁中，避免用本地源码断言替代真实移动端 E2E。
