# OpenDrSai Windows MVP 1.4.1 候选版说明

## 支持范围

- 产品主线：`apps/desktop/windows`。
- 架构：Windows x64，自包含 Electron 与 Python/DrSai 运行时。
- 身份与模型服务：HepAI OIDC 是正式构建的唯一入口；不要求也不提供 API Key、Base URL 或模型参数配置。
- 已实机验收：Windows 11 Sandbox（Windows build 26100），普通用户、无 Node.js/Python/Git 的干净环境。
- Windows 10 22H2 仍需独立实机或可恢复 VM 验收，不能由 Windows 11 Sandbox 结果替代。

## 已验证的核心流程

- 安装、桌面/开始菜单快捷方式、首次启动与应用保留。
- OIDC 登录、Bearer 模型请求、普通聊天、关闭重启后的登录/项目/会话恢复。
- Agent 任务入口、运行前变更集、变更审阅、接受、审批式拒绝和运行前内容恢复。
- Agent 运行前基线无法完整保存时 fail-closed，不执行 Agent。
- 20 次连续 packaged Electron 核心闭环无崩溃或回滚失败。

主要证据：

- `release/sandbox-evidence-1.4.1-mvp3/windows-11-sandbox-20260713-015111.json`
- `release/sandbox-evidence-1.4.1-mvp3/manual-agent-change-review-20260713.json`
- `npm run verify:release-ready`
- `npm run verify:e2e-agent-run`
- `npm run verify:packaged`

候选运行时 SHA-256：

`0bb8a47b224640db7948ad8ac26d6efc5a98f8c6d4048232892859556773e712`

## 已知问题与发布限制

1. MSI 当前为 `NotSigned`。它仅用于内部 MVP 验收，不得公开分发；公开发布必须使用公有信任代码签名并以 `REQUIRE_SIGNED_WINDOWS_ARTIFACTS=1` 重新通过签名门槛。
2. GitHub Release 尚未发布，因此 public release assets 检查会跳过。
3. Windows 10 22H2、企业代理/DNS/防火墙异常、中文用户名和非 ASCII/空格路径矩阵尚未全部完成实机验证。
4. 自动升级、降级保护和从上一公开版本升级仍需使用正式发布 URL 与已签名包验收。
5. Agent 运行前若存在超过 200 个变更文件、超过 2 MB 或无法保存的既有变更文件，任务会被安全阻止；用户应先提交、备份或缩小变更范围。

## 日志与诊断

- 安装日志：`%USERPROFILE%\.drsai\logs\bootstrapper\install-*.log`，沙盒验收时由脚本写入映射证据目录。
- 应用日志与诊断入口：设置/诊断页面中的日志目录、复制诊断信息和运行时状态。
- 诊断材料不得包含 OIDC access/refresh token、API Key、完整提示词或项目源码。
- 沙盒证据目录：`apps/desktop/windows/release/sandbox-evidence-1.4.1-mvp3`。

## 回滚与卸载

- 拒绝 Agent 变更：在“变更审阅”选择“拒绝并恢复运行前”，随后在 Approval Center 明确批准恢复。
- 单文件 Git 操作与 Agent 变更集审阅是不同语义；MVP 的拒绝操作使用运行前变更集，避免把用户原有未提交修改回滚到 Git HEAD。
- 卸载应用：Windows“已安装的应用”中卸载 OpenDrSai Setup。默认保留 `%USERPROFILE%\.drsai` 用户数据。
- 彻底清理前应先备份需要保留的会话与项目状态；清除本地数据是独立且需要确认的操作。
- 若新版本异常，卸载应用后安装上一个已签名候选；不得用未签名或哈希不匹配的包执行降级。

## 发布前剩余门槛

- 公有信任签名及强制签名验证。
- Windows 10 22H2 干净环境与升级/修复/卸载矩阵。
- 正式 Release URL、自动更新和降级保护验证。
- 对上述实机矩阵补充证据后，才能宣布公开发布完成。
