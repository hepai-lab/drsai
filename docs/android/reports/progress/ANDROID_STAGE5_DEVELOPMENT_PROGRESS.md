# OpenDrSai Android 第 5 阶段开发与验收结果

> 对应计划：[ANDROID_UNIFIED_WORKBENCH_RUNTIME_V2_DEVELOPMENT_PLAN.md](../../plans/runtime/ANDROID_UNIFIED_WORKBENCH_RUNTIME_V2_DEVELOPMENT_PLAN.md)  
> 完成日期：2026-07-21  
> 验收口径：12 个模块、96 个功能点；代码、自动化测试、模拟器矩阵和发布证据全部通过后才计为完成。

## 1. 最终进度

| 状态 | 功能点 | 占比 |
|---|---:|---:|
| 已实现并验收 | 96 | 100% |
| 待验收 | 0 | 0% |
| 缺口 | 0 | 0% |

第五阶段已经完成。统一工作台、Workspace/Session/Run 数据模型、Lite Runtime V2、Full Runtime 连接契约、上下文工程、工具与 Skill、审批审计、后台恢复、安全可靠性和发布升级均已纳入同一套验收门禁。

本阶段按此前确定的范围，不要求真机测试，也暂不测试 Codex 后端。OpenDrSai Full Runtime 的连接契约和兼容性以本仓库 `apps/desktop/windows` 实现及相应契约测试为基准。

## 2. 模块完成情况

| 模块 | 范围 | 状态 |
|---|---|---|
| M01 | 统一领域模型与 Room 迁移 | 完成 |
| M02 | 统一工作台、侧栏、会话与响应式布局 | 完成 |
| M03 | Workspace 能力与动作策略 | 完成 |
| M04 | 本地/远程统一执行端口 | 完成 |
| M05 | Lite Runtime V2 状态机、Journal 与恢复 | 完成 |
| M06 | 上下文、项目指令、附件与预算 | 完成 |
| M07 | 工具注册、能力过滤与 Artifact | 完成 |
| M08 | Skill、审批与授权策略 | 完成 |
| M09 | 前台服务、通知、深链与后台恢复 | 完成 |
| M10 | 缓存、附件、结果聚合与清理 | 完成 |
| M11 | 安全、审计、错误诊断与边界约束 | 完成 |
| M12 | 测试矩阵、升级、自动更新与发布门禁 | 完成 |

逐功能点的代码与测试映射见 [feature-evidence.json](../../testing/acceptance/stage5/feature-evidence.json)。该文件由验收脚本从计划、测试结果和发布报告生成，最终为 **96/96 passed**。

## 3. 最终测试矩阵

| 验收项 | 结果 |
|---|---|
| JVM 单元/集成测试 | 166/166 通过，0 失败、0 跳过 |
| API 30 Instrumentation | 67/67 通过，0 失败、0 跳过 |
| API 35 Instrumentation | 67/67 通过，0 失败、0 跳过 |
| Android Lint | Debug 与 MVP 均通过 |
| 手机竖屏/横屏 | 通过，截图已归档 |
| Pixel Tablet API 35 宽屏 | 常驻侧栏、聊天区和输入栏断言通过 |
| 冷启动与内存 | 2143 ms；PSS 41,976 KB；均低于验收阈值 |
| 原位升级 | 官方 v1.4.6（10406）升级到 v1.5.0（10500）通过；登录密文与首次安装时间保持 |
| 应用内自动更新 | 验收旧版 v1.4.9 读取与生产契约相同的本机临时清单，经 `adb reverse` 下载并调用系统安装器升级到 v1.5.0；通过 |
| Release/R8/签名/清单 | 通过 |

Instrumentation 使用分片脚本执行，以规避单次长套件导致模拟器 `system_server` 不稳定；最终结果仍覆盖完整的 67 个设备测试，而不是跳过失败用例。

## 4. 发布候选包

- 文件：`apps/android/app/build/outputs/apk/mvp/OpenDrSai-Android-v1.5.0.apk`
- 版本：`1.5.0`（versionCode `10500`，从系统版本源读取）
- 大小：3,026,723 bytes
- SHA-256：`dec834e7ec9b8e9ebb9edadd9c5ec94f748ab4212cf002b18c132cc5da336b22`
- 签名证书 SHA-256：`984f0f4b3c786e2801c48b0c2a6f57b9c0464b33309b71202d21b3b01f871960`

本轮只生成本地发布候选包，没有执行 Git 提交、GitHub 推送或 Release 发布。

## 5. 验收产物

- 总功能证据：`docs/android/testing/acceptance/stage5/feature-evidence.json`
- API 30/35 XML：`docs/android/testing/acceptance/stage5/emulator-results/`
- 升级报告：`docs/android/testing/acceptance/stage5/upgrade/upgrade-1.4.6-to-1.5.0.json`
- 自动更新报告：`docs/android/testing/acceptance/stage5/update/auto-update-1.4.9-to-1.5.0.json`
- 设备性能报告：`docs/android/testing/acceptance/stage5/device/device-performance-report.json`
- 平板布局报告：`docs/android/testing/acceptance/stage5/device/tablet-layout-report.json`
- 发布与总验收报告：`apps/android/app/build/stage5-release/`

## 6. 最终结论

第五阶段 **12 个模块、96 个功能点全部完成并通过自主验收**。最终 APK 已可安装；后续若要公开交付，只需在确认发布范围后执行提交、推送并上传 GitHub Release。
