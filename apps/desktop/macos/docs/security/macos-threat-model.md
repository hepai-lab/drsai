# OpenDrSai macOS Desktop 威胁模型

状态：Active
适用版本：第二阶段 Electron + Swift Helper 架构
最近复核：2026-07-24
下次强制复核：2026-10-01，或任一信任边界/签名图变化时（取较早者）

## 资产与信任边界

- 长期令牌、Keychain 引用、用户工作区文件、Git/SSH 操作、审批记录、诊断与更新工件属于受保护资产。
- 不受信任输入包括 Renderer 内容、外部 URL、协议/文件打开事件、远程服务响应、工作区内容、Helper JSON Lines 请求以及恢复后的持久状态。
- Renderer 只能通过 context-isolated preload API 进入 Electron main；它不能直接访问 Node、Swift Helper、Keychain 或任意 shell。
- Electron main 是策略执行点。所有 renderer 可达 invoke handler 必须使用 secure IPC sender、schema、超时、取消、去重策略和脱敏审计。
- Swift Helper 是窄原生边界，只接受版本化 operation/parameter allowlist；不存在 shell、任意路径、任意 URL、Git、SSH、MCP 或 Runtime 执行操作。
- 文件系统、Gateway/PTY 子进程、macOS TCC/Keychain、LaunchServices 与更新服务是 main/Helper 之外的独立边界。

## 威胁、控制和证据

| 威胁 | 主要控制 | 失败策略 | 自动化证据 |
|---|---|---|---|
| XSS → IPC 提权 | context isolation、关闭 Node integration、可信 sender/frame、序列化 schema、owner 绑定 | caller/schema 不可信即拒绝 | secure IPC、IPC inventory、main composition |
| 开发 URL/导航注入 | packaged 构建忽略 `ELECTRON_RENDERER_URL`；开发服务器仅允许 loopback 同源；popup 永远 deny；`will-navigate` 仅允许当前文件或已批准开发源 | 导航和 popup 默认阻止 | renderer navigation、release contract |
| Helper 协议/命令注入 | protocolVersion、requestId、operation 和逐操作参数 allowlist；64 KiB 上限；未知字段/操作拒绝 | 返回结构化错误，不执行副作用 | Native negative fixtures、Swift/TS golden contract |
| 路径穿越和符号链接逃逸 | canonical allowed roots、文件类型检查、一次授权、Runtime symlink lexical+realpath 双边界 | 工作区外、dangling/absolute/escaping link 拒绝 | security policy、file mutations、Runtime contract、fault injection |
| Secret 泄漏 | Renderer 不接收长期 token；错误、IPC audit、诊断、crash/package receipt 统一脱敏；敏感文件 0600 | 输出最少稳定错误码 | secret redaction、credentials、diagnostics、venv permissions |
| 恶意持久状态/审批重放 | schema、owner/workspace 绑定、幂等键、审批执行记录、乐观并发 | stale/重复请求拒绝或返回已执行结果 | approval、checkpoint、worktree、restart recovery |
| 子进程逃逸或残留 | 统一 registry、进程组、owner、逆序 shutdown、超时 SIGKILL、真机残留扫描 | 停止接收新任务后有界清理 | process lifecycle、packaged L5、sleep/wake receipt |
| 工件或更新替换 | Runtime manifest 大小/SHA-256/清单/provenance、ASAR-only、签名图、notarization | 不匹配即拒绝安装/发布 | Runtime/release contract；signed RC 待 Developer ID |

## `sandbox: false` 剩余风险

Renderer 当前仍为 `sandbox: false`，因此 Chromium renderer 被利用后，preload/Electron 边界的重要性高于 sandbox-enabled 架构。现有缓解包括 `contextIsolation: true`、`nodeIntegration: false`、最小 preload API、secure IPC、导航限制、Helper allowlist、路径授权和无长期 token 暴露。

不得以“已有 context isolation”为由永久接受该风险。以下任一条件发生时必须立即复评，而不等待日期：

1. preload、Electron、node-pty、文件选择或更新依赖发生重大版本变化；
2. Helper 新增操作、XPC/Extension 或更高权限；
3. 出现 Renderer/XSS、IPC caller、导航或 preload 相关 P0/P1 缺陷；
4. packaged sandbox 试验能够通过 PTY、文件、更新和核心旅程。

复评结论只能是：启用 sandbox；记录具体不兼容并给出有期限的迁移计划；或撤回导致风险扩大的能力。下一次计划复评日为 2026-10-01。

## 发布边界

本威胁模型可以支持 unsigned L1～L4 安全验收，但不能证明 Developer ID、Team ID、Gatekeeper、TCC 身份持久性、公证或更新链安全。缺少 signed L5/L6 回执时，发布判定必须保持 blocked，不得使用 ad-hoc/self-signed 或关闭 Gatekeeper 替代。
