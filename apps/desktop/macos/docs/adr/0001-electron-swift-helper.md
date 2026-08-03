# ADR-0001：Electron 主框架与 Swift 原生辅助层

状态：Accepted
日期：2026-07-23
适用范围：OpenDrSai macOS Desktop 第二阶段

## 决策

保留 Electron、React、shared preload 和 shared main 作为产品主体。只把 Electron/Node 难以稳定表达、且原生收益明确的 macOS 能力放入受限 Swift Helper：Keychain、TCC 状态与设置引导、UserNotifications、睡眠/唤醒事件和必要的 LaunchServices 交接。

Helper 使用版本化、固定操作白名单的协议。协议不提供任意 shell、任意文件访问、Git、SSH、MCP、网络代理或 Python Runtime 执行能力。核心 Chat、Workspace 和 Agent 功能在 Helper 缺失、崩溃或版本不兼容时必须安全降级，而不是阻止应用启动。

## 原因

- 共享 React renderer 是 Windows/macOS 功能一致性的主要资产，完整 SwiftUI 重写会产生第二套产品实现。
- Keychain、TCC、通知和系统生命周期具有明确的原生 API 与错误语义，继续依赖命令行桥接会增加解析、签名身份和恢复风险。
- 小型 Helper 能把高权限系统能力收敛到更窄的进程和协议边界。

## 信任边界

- Renderer 只能调用 preload 暴露的 Desktop API。
- Electron main 必须通过 secure IPC 校验 sender、payload、超时和审计。
- 只有 Electron main 可以调用 Helper；Renderer 不得直接连接 Helper。
- Helper 必须拒绝未知 protocolVersion、operation、超限 payload、非法路径和畸形输入。
- 凭据明文不得进入 Renderer、通用日志、crash report 或验收证据。
- 正式签名阶段必须校验主 App、Helper、XPC/Extension（如有）的签名图和 Team ID。

## `sandbox: false` 决策

第二阶段初期保持 Electron renderer `sandbox: false`，因为当前 preload、PTY、文件交接和现有 Electron 依赖尚未完成 sandbox 兼容审计。这不是永久豁免：MOD-07 必须持续使用 context isolation、关闭 node integration、限制导航、保护 IPC，并在 Helper 承接原生高权限能力后重新进行 sandbox 试验。

重新评估触发条件：

1. Helper 协议和生命周期稳定；
2. preload 不再依赖 sandbox 不支持的能力；
3. PTY、文件选择、更新与 packaged journeys 在试验构建中全绿；
4. 威胁模型确认切换不会引入更危险的旁路。

强制复评日期：2026-10-01，或上述条件、信任边界、签名图任一发生变化时（取较早者）。详细威胁、控制、剩余风险和证据见 `../security/macos-threat-model.md`。

## 替代方案

- 全量 SwiftUI/AppKit：当前不采用，成本高且破坏共享 UI 单一事实来源。
- 全部保留 Node/CLI：当前不采用，无法充分改善 TCC、通知和签名身份语义。
- 大而全的特权 Helper：禁止，攻击面和协议维护成本不可接受。

## 回滚与退出条件

每个原生能力必须保留 capability gate 和 Electron/不可用降级路径。若 Helper 导致启动可靠性、安全性或发布复杂度恶化，允许逐能力撤回，不影响共享 API。只有 50/50 P2 功能和受影响的原 72 点产品证据全部通过，才能宣称第二阶段完成。
