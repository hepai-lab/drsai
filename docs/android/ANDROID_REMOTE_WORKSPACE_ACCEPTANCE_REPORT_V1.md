# OpenDrSai Android 远程工作区验收报告 V1

日期：2026-07-17  
范围：不包含真机；不执行 Codex Backend E2E；OpenDrSai Full Runtime/Backend 固定为本仓库 `apps/desktop/windows`。

## 结论

当前范围 95 个功能点全部完成。代码、协议、两个 Android 模拟器、生产配置测试签名 APK 及 GitHub Release 资产均已验收。

## 关键端到端结果

- Android HTTP 契约经 Relay 调用 `apps/desktop/windows` 实际 Full Runtime。
- 完成 Runtime 注册、出站 WSS、Workspace 自动发布、精确 Agent Definition、Session、Run、流式消息、Tool、Approval、Artifact、Files/Git OWOP 和重启恢复。
- Windows 事件 `agent.message.delta`、`tool.completed` 在 Runtime 投影层规范化为 Android 统一事件 `message.delta`、`tool.finished`。
- OIDC Principal 仅从验证后的 Bearer Token 构建；客户端 `X-Subject` 不具有权威性。
- 同一 Runtime/Workspace 下按 subject 隔离 Session、Run、Event、Approval 和 Audit。

## 自动化证据

| 测试组 | 结果 |
| --- | ---: |
| Relay、OIDC、WSS、OpenDrSai Windows E2E | 47 passed |
| Runtime、OWOP、Artifact | 74 passed，58 subtests passed，1 platform skip |
| Windows Workspace、Git、Terminal、结构化消息 | 36 passed |
| Android JVM | 99/99 passed |
| Android API 30 模拟器 | 37/37 passed |
| Android API 35 模拟器 | 37/37 passed |
| Android Lint、Lint Vital、OWOP/Relay binding | passed |

API 30 与 API 35 使用两个独立 AVD；网络切换、后台恢复、多客户端隔离、Event 缺口及 10,000 Event 有界性由可重复自动化测试覆盖，不设置真机发布门禁。

## APK 验收

- 文件：`apps/android/app/build/outputs/apk/mvp/OpenDrSai-Android-v1.4.6.apk`
- 包名：`ai.drsai.remote`
- 应用名：`OpenDrSai`
- 版本：`1.4.6`（versionCode `10406`）
- minSdk / targetSdk：26 / 35
- 构建：`DEBUG=false`、R8 与资源压缩启用、明文流量关闭
- 生产服务：`https://ai.ihep.ac.cn`、`https://ai.ihep.ac.cn/api/runtime-relay`
- 签名：当前约定的 Android Debug 测试证书，APK Signature Scheme v2 验证通过
- SHA-256：`ACE7B01C48DE3F1BF393B3D54F06A364AA93A87058F6FB21CAB7B9018E5DDF81`
- 覆盖安装与启动：API 30/API 35 模拟器通过，无 crash。

## 未完成门禁

发布时清除了失效的临时 `GH_TOKEN`，通过本机代理和系统凭据完成推送及 Release 上传。公开 GitHub API 核验结果如下：

- `android-v1.4.6` 已创建为预发布 Release；
- `OpenDrSai-Android-v1.4.6.apk` 已上传，大小 `2,811,463` bytes，SHA-256 为 `ACE7B01C48DE3F1BF393B3D54F06A364AA93A87058F6FB21CAB7B9018E5DDF81`；
- 旧资产与本报告验收的 `ACE7B01C...E5DDF81` 不一致，不能作为本阶段完成证据。

M12-F08 已完成，发布资产可从 `android-v1.4.6` Release 下载。
