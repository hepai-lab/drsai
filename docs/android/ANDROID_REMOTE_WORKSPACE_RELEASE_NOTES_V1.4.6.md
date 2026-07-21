# OpenDrSai Android v1.4.6 远程工作区 Release Notes

此构建新增 Android 远程工作区 MVP，可通过 Relay 连接本仓库 Windows 桌面端 Full Runtime，并使用 OpenDrSai Agent Backend 创建会话和执行任务。

主要能力：

- HAI OIDC 登录与按账户隔离的 Runtime/Workspace 发现；
- 远程 Session、Run、流式回复、Tool 进度、停止与 Approval；
- 只读 Files、搜索、Git status/diff、文件预览与系统打开；
- Artifact 认证分块下载、SHA-256 校验与 FileProvider 打开；
- Runtime 断线、重启、网络切换、后台与进程恢复；
- API 30 和 API 35 双模拟器自动化验收。

本版本不执行 Codex Backend E2E，也不设置真机测试门禁。当前 APK 使用约定的测试签名，仅用于内部/Beta 分发；公开商店发布前仍需替换组织 Release Keystore。
