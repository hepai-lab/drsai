# Windows Sandbox 调用、验收与关闭规范

本文记录 OpenDrSai Windows 干净环境验收中已经复现并确认的 Windows Sandbox 行为，避免再次把启动器、进程或网络问题误判成应用安装失败。

## 结论

Windows 11 24H2 及更新版本可能同时存在两代 Sandbox：

- 旧版入口：`WindowsSandbox.exe`、`WindowsSandboxClient.exe`、`.wsb` 配置文件。
- 新版 Store AppX：`MicrosoftWindows.WindowsSandbox`、`wsb.exe` CLI、`WindowsSandboxRemoteSession.exe` 和 `WindowsSandboxServer.exe`。

在新版中，是否存在活动 Sandbox 必须以 `wsb list` 返回的会话 ID 为准。`WindowsSandbox.exe` 只是兼容入口，成功转交后也可能很快以 0 退出；`WindowsSandboxServer` 是服务宿主，Sandbox 已关闭后仍可能存在。两者都不能单独作为成功或失败判据。

## 本机故障复盘（2026-07-16）

本机当时的状态：

- 主机版本：Windows 11 25H2 Insider，build `26200.8655`。
- 旧兼容二进制版本：`26100.8457`。
- 可选功能 `Containers-DisposableClientVM`：`Enabled`。
- `hypervisorlaunchtype`：`Auto`。
- 新版 AppX `MicrosoftWindows.WindowsSandbox 0.5.3.0` 已为系统安装，但未注册到当前用户。
- 当前用户查不到 AppX，`wsb.exe` 执行别名也不存在。

故障链路是：旧入口启动后尝试转交新版 AppX，但当前用户缺少注册，于是入口以 0 退出，没有创建 Sandbox 会话；旧监控逻辑又只检查 `WindowsSandboxClient`，没有识别新版的 `WindowsSandboxRemoteSession`，进一步造成误判。

实际修复命令（管理员 PowerShell）：

```powershell
$package = Get-AppxPackage -AllUsers -Name MicrosoftWindows.WindowsSandbox | Select-Object -First 1
Add-AppxPackage -DisableDevelopmentMode -Register (Join-Path $package.InstallLocation "AppxManifest.xml")
```

如果注册后 `Get-AppxPackage -Name MicrosoftWindows.WindowsSandbox` 已有结果，但 `wsb.exe` 仍不在 PATH，需要注销并重新登录一次，让 App Execution Alias 完成刷新。

## 统一控制脚本

使用 `scripts/windows-sandbox-session.ps1`：

```powershell
# 诊断
powershell -File scripts/windows-sandbox-session.ps1 -Action Diagnose

# 管理员 PowerShell 中修复当前用户 AppX 注册
powershell -File scripts/windows-sandbox-session.ps1 -Action RepairRegistration

# 启动 .wsb，并返回会话 ID
powershell -File scripts/windows-sandbox-session.ps1 `
  -Action Start -ConfigPath C:\path\acceptance.wsb -AsJson

# 查看官方会话列表
powershell -File scripts/windows-sandbox-session.ps1 -Action List -AsJson

# 按 ID 正常关闭
powershell -File scripts/windows-sandbox-session.ps1 `
  -Action Stop -Id 00000000-0000-0000-0000-000000000000 -AsJson

# 只有正常关闭超时后才允许 Force
powershell -File scripts/windows-sandbox-session.ps1 `
  -Action Stop -Id 00000000-0000-0000-0000-000000000000 -Force -AsJson
```

## 正确启动流程

1. 调用 `Diagnose`，确认当前用户 AppX 注册状态。
2. 调用 `List`；Windows Sandbox 只允许一个实例，列表非空时先关闭旧会话。
3. 校验 `.wsb` 是合法 XML，所有 `HostFolder` 必须是存在的绝对路径。
4. 用 `Start` 启动并等待新的 `wsb` 会话 ID，不以 `WindowsSandbox.exe` 是否退出判断成功。
5. LogonCommand 只执行一个脚本；复杂步骤全部放进映射目录中的脚本文件。
6. 映射输入包设为只读，证据目录单独映射为可写。
7. 离线验收应禁用网络，并把 MSI 与 `OpenDrSaiRuntime-win-x64.zip` 放在同一目录，以证明安装不依赖 GitHub。

## 正确关闭流程

1. 优先在客体脚本结束时执行 `shutdown.exe /s /t 0`。
2. 主机侧仍必须用 `wsb list` 轮询，确认对应 ID 消失。
3. 超时后调用 `wsb stop --id <id>`。
4. 再次轮询列表，只有 ID 消失才算关闭完成。
5. `WindowsSandboxServer` 可以在列表为空时继续存在，不能因此判定 Sandbox 未关闭。
6. 仅在 CLI 不可用或正常 stop 超时后，才使用 `-Force` 终止 Client/RemoteSession；不要终止 `vmcompute`、HNS 或所有 SandboxServer 来代替正常会话关闭。

## 退出时出现 WindowsSandboxServer.exe 0xe0434352

2026-07-16 曾在退出时出现：

```text
WindowsSandboxServer.exe - 应用程序错误
未知的软件异常 (0xe0434352)
```

对应的 Application 事件为 `.NET Runtime 1026` 和 `Application Error 1000`。内层异常是 `COMException 0x800706BF`（远程过程调用失败），调用栈位于：

```text
SandboxVM.Shutdown
ManagedWindowsVM.Terminate
```

这次故障发生在 HNS/`vmcompute` 被重启之后：SandboxServer 收到退出事件时，负责 VM 终止的 RPC 服务已被重启，形成关闭竞态。它不是 OpenDrSai 进程崩溃，也不代表已经销毁的 Sandbox 数据可以恢复。

处理方法：

1. 点击错误框“确定”。
2. 执行 `windows-sandbox-session.ps1 -Action List -AsJson`。
3. 如果 `sessions` 为空，关闭已经完成，不要再结束 SandboxServer。
4. 如果仍有 ID，执行 `-Action Stop -Id <id>`。
5. 不要为了关闭 Sandbox 重启 HNS 或 `vmcompute`；这些仅用于系统级故障维修，并且必须在确认没有任何 Sandbox 会话后进行。
6. 如果没有重启服务、只使用 `wsb stop` 仍反复出现该异常，再检查 Microsoft Store/Windows Update 中的 Sandbox 更新或重新注册 AppX。

## 常见误判

| 现象 | 错误判断 | 正确判断 |
|---|---|---|
| `WindowsSandbox.exe` 很快退出且退出码为 0 | Sandbox 启动失败 | 新版入口可能已完成转交，检查 `wsb list` |
| 没有 `WindowsSandboxClient` | Sandbox 没启动 | 新版使用 `WindowsSandboxRemoteSession` |
| 存在 `WindowsSandboxServer` | Sandbox 仍未关闭 | Server 是服务宿主，检查会话 ID |
| 退出时报 `WindowsSandboxServer 0xe0434352` | OpenDrSai 崩溃 | 检查 `.NET Runtime 1026`；常见原因是关闭期间 VM RPC/服务被重启 |
| MSI 卡在 Preparing | 一定是 Sandbox 故障 | 检查 MSI 日志、下载连接状态和同目录 Runtime |
| Sandbox `localhost:1080` 无法代理 | 主机代理失效 | Sandbox 的 localhost 指向客体自身 |
| 直接反复启动 | 能自动覆盖旧实例 | Sandbox 只允许一个实例，必须先 list/stop/wait |

## 官方依据

- [Windows Sandbox command line](https://learn.microsoft.com/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-cli)
- [Windows Sandbox versions](https://learn.microsoft.com/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-versions)
- [Use and configure Windows Sandbox](https://learn.microsoft.com/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-configure-using-wsb-file)
- [Troubleshoot Windows Sandbox](https://learn.microsoft.com/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-troubleshoot)
- [Windows Sandbox FAQ](https://learn.microsoft.com/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-faq)
