const feature = (requirement, testIds, requiredAspects = ["positive", "negative"], implementationStatus = "implemented") => ({ requirement, testIds, requiredAspects, implementationStatus });

export const macosFeatureModules = [
  {
    title: "工程基线与契约", owner: "desktop-core", capability: "desktop", requiredLevels: ["L0", "L4"], features: [
      feature("修复干净 checkout 验证顺序", ["suite:macos-dev-setup", "suite:architecture-boundaries", "suite:release-contract"], ["positive", "negative", "architecture"]),
      feature("跟踪 Apple 构建资源", ["suite:release-contract"], ["positive", "release-contract"]),
      feature("生成 Desktop IPC inventory", ["suite:inventory"], ["positive", "inventory"]),
      feature("登记 API 状态/owner/testId", ["suite:inventory", "suite:secure-ipc"], ["positive", "inventory"]),
      feature("执行共享模块依赖边界", ["suite:architecture-boundaries"], ["positive", "architecture"]),
      feature("统一版本与构建元数据", ["suite:build-output", "suite:build-metadata", "suite:release-contract", "suite:platform-feature-evidence"], ["positive", "negative", "artifact-integrity", "reproducibility"]),
    ],
  },
  {
    title: "IPC 安全与能力治理", owner: "desktop-core", capability: "desktop", requiredLevels: ["L1", "L2", "L3"], features: [
      feature("统一 secureHandle", ["suite:secure-ipc"], ["positive", "negative", "authorization"]),
      feature("校验 IPC 输入输出和错误码", ["suite:secure-ipc", "suite:security-policy"]),
      feature("支持超时取消幂等", ["suite:secure-ipc"], ["positive", "cancel-timeout", "idempotency"]),
      feature("审计日志与秘密脱敏", ["suite:secret-redaction", "suite:diagnostics"], ["positive", "negative", "privacy"]),
      feature("细粒度 capability registry", ["suite:shell-contract", "suite:inventory"], ["positive", "platform-contract"]),
      feature("路径与 URL 安全策略", ["suite:security-policy", "suite:file-mutations"], ["positive", "negative", "authorization"]),
    ],
  },
  {
    title: "macOS 生命周期与系统集成", owner: "desktop-core", capability: "desktop", requiredLevels: ["L2", "L4", "L5"], features: [
      feature("单实例与第二实例聚焦", ["suite:macos-lifecycle"], ["positive", "negative", "recovery"]),
      feature("deep link 与 Finder 路由", ["suite:macos-lifecycle"], ["positive", "negative"]),
      feature("原生菜单和 Dock 菜单", ["suite:shell-contract"], ["positive", "platform-contract"]),
      feature("末窗与显式退出语义", ["suite:macos-lifecycle", "suite:process-lifecycle"], ["positive", "recovery"]),
      feature("崩溃预算和安全恢复", ["suite:macos-recovery"], ["positive", "negative", "idempotency", "recovery"]),
      feature("睡眠网络显示器与关机恢复", ["suite:macos-recovery", "suite:process-lifecycle"], ["positive", "recovery"]),
    ],
  },
  {
    title: "Runtime、Gateway 与本地基础设施", owner: "desktop-core", capability: "desktop", requiredLevels: ["L1", "L2", "L4", "L5"], features: [
      feature("可复现 arm64 Runtime", ["suite:runtime-contract", "suite:release-contract"], ["positive", "reproducibility"]),
      feature("Runtime 安装修复与原子切换", ["suite:runtime-contract"], ["positive", "negative", "cancel-timeout", "recovery"]),
      feature("Runtime 内容架构与导入校验", ["suite:runtime-contract", "suite:release-contract"], ["positive", "negative", "artifact-integrity"]),
      feature("Gateway 并发启动与健康检查", ["suite:process-lifecycle"], ["positive", "negative", "idempotency"]),
      feature("唤醒网络恢复与状态同步", ["suite:macos-recovery", "suite:process-lifecycle"], ["positive", "recovery"]),
      feature("退出清理全部辅助进程", ["suite:process-lifecycle", "suite:terminal-lifecycle"], ["positive", "cancel-timeout", "recovery"]),
    ],
  },
  {
    title: "身份、凭据与权限", owner: "desktop-core", capability: "desktop", requiredLevels: ["L2", "L4", "L6"], features: [
      feature("OIDC/SSO/微信会话生命周期", ["suite:auth-lifecycle"], ["positive", "negative", "recovery"]),
      feature("Codex backend 登录生命周期", ["suite:codex-backend"], ["positive", "negative", "cancel-timeout", "recovery"]),
      feature("Keychain 凭据生命周期", ["suite:credentials"], ["positive", "negative", "authorization"]),
      feature("Keychain 故障恢复", ["suite:credentials"], ["positive", "negative", "recovery"]),
      feature("TCC 权限状态与引导", ["suite:system-permissions"], ["positive", "negative", "authorization"]),
      feature("秘密与普通配置隔离", ["suite:secret-redaction", "suite:credentials"], ["positive", "negative", "privacy"]),
    ],
  },
  {
    title: "Chat、Agent、Thread 与审批", owner: "desktop-core", capability: "desktop", requiredLevels: ["L1", "L2", "L5"], features: [
      feature("Chat 流与背压", ["suite:stream-backpressure", "suite:chat-recovery"], ["positive", "negative", "cancel-timeout"]),
      feature("Chat 恢复与事件去重", ["suite:chat-recovery", "suite:stream-backpressure"], ["positive", "idempotency", "recovery"]),
      feature("Agent 生命周期与恢复", ["suite:agent-recovery"], ["positive", "negative", "cancel-timeout", "recovery"]),
      feature("Thread CRUD 快照与绑定", ["suite:thread-lifecycle"], ["positive", "negative", "persistence", "recovery"]),
      feature("统一高风险动作审批", ["suite:approval-state", "suite:mcp-tool-approval", "suite:git-approval"], ["positive", "negative", "authorization", "idempotency"]),
      feature("执行策略异常与重启一致性", ["suite:approval-state", "suite:agent-recovery"], ["positive", "negative", "idempotency", "recovery"]),
    ],
  },
  {
    title: "Workspace、文件、Git 与终端", owner: "desktop-core", capability: "desktop", requiredLevels: ["L2", "L4", "L5"], features: [
      feature("Workspace 文件与受控写入", ["suite:file-mutations"], ["positive", "negative", "authorization", "idempotency"]),
      feature("Git diff/stage/revert", ["suite:workspace-git-actions", "suite:git-approval"], ["positive", "negative", "authorization", "idempotency"]),
      feature("Workspace checkpoint 生命周期", ["suite:workspace-checkpoints"], ["positive", "negative", "persistence", "recovery"]),
      feature("fork/worktree 生命周期", ["suite:worktree-lifecycle", "suite:fork-queue", "suite:fork-approval"], ["positive", "negative", "recovery"]),
      feature("IDE/PDF/编辑器交接", ["suite:desktop-handoff"], ["positive", "negative", "authorization"]),
      feature("PTY 生命周期与进程树清理", ["suite:terminal-lifecycle", "suite:process-lifecycle"], ["positive", "negative", "cancel-timeout", "recovery"]),
    ],
  },
  {
    title: "Browser、Debugger、MCP 与诊断", owner: "desktop-platform", capability: "developer-tools", requiredLevels: ["L1", "L2", "L5"], features: [
      feature("Browser 任务生命周期", ["suite:browser-tasks"], ["positive", "negative", "cancel-timeout", "recovery"]),
      feature("Browser 审批隔离与恢复", ["suite:browser-tasks", "suite:approval-state"], ["positive", "negative", "authorization", "recovery"]),
      feature("Debugger DAP/CDP 生命周期", ["suite:interactive-debugger"], ["positive", "negative", "authorization", "cancel-timeout", "recovery"]),
      feature("MCP session/tool/audit", ["suite:mcp-sessions", "suite:mcp-tool-approval"], ["positive", "negative", "authorization", "cancel-timeout"]),
      feature("诊断与源码导航", ["suite:diagnostics", "suite:diagnostic-package"], ["positive", "negative", "privacy"]),
      feature("诊断包隐私与可复现性", ["suite:diagnostic-package"], ["positive", "negative", "privacy", "reproducibility"]),
    ],
  },
  {
    title: "SSH、远程工作区与端口转发", owner: "desktop-platform", capability: "remote-development", requiredLevels: ["L2", "L4", "L5"], features: [
      feature("SSH inventory 与 known_hosts", ["suite:ssh-hosts"], ["positive", "negative", "persistence"]),
      feature("host key 信任与连接恢复", ["suite:ssh-hosts"], ["positive", "negative", "authorization", "recovery"]),
      feature("远程 Gateway 安装恢复", ["suite:remote-gateway"], ["positive", "negative", "authorization", "cancel-timeout", "recovery"]),
      feature("远程 worker/thread 路由", ["suite:remote-workspace"], ["positive", "negative", "authorization"]),
      feature("远程 Workspace 核心旅程", ["suite:remote-workspace", "suite:mobile-pairing-controller", "suite:mobile-pairing-security"], ["positive", "negative", "recovery"]),
      feature("端口转发生命周期", ["suite:port-forwards"], ["positive", "negative", "idempotency", "recovery"]),
    ],
  },
  {
    title: "自动化、配置、记忆与技能", owner: "desktop-platform", capability: "desktop", requiredLevels: ["L1", "L2", "L5"], features: [
      feature("偏好配置与自定义命令", ["suite:customization"], ["positive", "negative", "persistence", "recovery"]),
      feature("项目和团队记忆", ["suite:memory"], ["positive", "negative", "authorization", "persistence", "recovery"]),
      feature("项目技能生命周期", ["suite:project-skills"], ["positive", "negative", "authorization", "persistence", "recovery"]),
      feature("Workflow marketplace 生命周期", ["suite:workflows"], ["positive", "negative", "authorization", "cancel-timeout", "recovery"]),
      feature("计划与可复用任务", ["suite:scheduled-tasks", "suite:reusable-tasks"], ["positive", "negative", "idempotency", "persistence", "recovery"]),
      feature("后台任务并发与恢复", ["suite:background-tasks"], ["positive", "negative", "cancel-timeout", "idempotency", "recovery"]),
    ],
  },
  {
    title: "协作、渠道、展示、语音与通知", owner: "desktop-platform", capability: "desktop", requiredLevels: ["L2", "L4", "L6"], features: [
      feature("分享与版本协作", ["suite:shares"], ["positive", "negative", "authorization", "persistence", "recovery"]),
      feature("敏感信息和撤销审计", ["suite:shares", "suite:secret-redaction"], ["positive", "negative", "authorization", "privacy"]),
      feature("Channel adapter 生命周期", ["suite:channels", "suite:channel-provider-auth"], ["positive", "negative", "authorization", "cancel-timeout", "persistence", "recovery", "privacy"]),
      feature("Manager presentation 生命周期", ["suite:manager-presentation", "suite:anomaly-decision"], ["positive", "negative", "cancel-timeout", "recovery"]),
      feature("串行与流式语音", ["suite:voice-contract", "suite:voice-main"], ["positive", "negative", "cancel-timeout", "recovery"]),
      feature("通知授权聚合与回跳", ["suite:completion-notifications", "suite:system-permissions"], ["positive", "negative", "authorization", "recovery"]),
    ],
  },
  {
    title: "打包、签名、更新与发布", owner: "desktop-release", capability: "release", requiredLevels: ["L4", "L5", "L6"], features: [
      feature("arm64 App/DMG/ZIP 打包", ["suite:release-contract", "suite:build-output", "suite:build-metadata"], ["positive", "artifact-integrity", "release-contract"]),
      feature("hardened runtime 与 codesign", ["suite:release-contract"], ["positive", "negative", "release-contract"]),
      feature("notarization/stapling/Gatekeeper", ["suite:release-contract"], ["positive", "release-contract"]),
      feature("干净用户安装卸载", ["suite:release-contract", "suite:runtime-contract"], ["positive", "negative", "recovery"]),
      feature("签名更新与兼容性", ["suite:release-contract"], ["positive", "negative", "release-contract"]),
      feature("更新健康标记与自动回滚", ["suite:release-contract", "suite:macos-recovery"], ["positive", "negative", "recovery"]),
    ],
  },
];
