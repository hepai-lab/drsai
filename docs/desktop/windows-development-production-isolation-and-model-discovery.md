# Windows 开发版/生产版隔离与账号模型发现方案

## 背景

Windows Desktop 登录完成后会启动本机 Gateway，并通过 `/v1/models` 判断输入框是否可用。旧实现存在两个问题：

1. Desktop 将超时、401、403、5xx、无效响应和真正的空模型目录全部折叠为 `[]`，随后统一显示“账号没有可用模型”。
2. 开发启动脚本和生产安装默认共同使用 `%USERPROFILE%\.drsai` 与端口 `18642`，可能共享认证、配置、数据库、实例令牌和 Gateway 进程。

这会造成瞬时启动失败被粘滞为权限错误，也会让开发版与生产版互相污染或连接到对方的 Runtime。

## 目标

- 只有明确的上游 403，或成功返回的空账号模型目录，才显示账号无模型权限。
- Token 过期时刷新一次；网络、JWKS、429、5xx 和超时使用有限退避重试。
- OIDC 模式下的 `/v1/models` 返回当前账号从 HepAI `/apiv2/v1/models` 获得的真实模型目录；非 OIDC 本地调用仍可读取本机配置目录。
- 开发版默认使用独立的 Home、Gateway 端口和 Electron `userData`，可以与生产版同时运行。
- 不复制或共享生产版 OIDC 凭据；开发版首次运行单独登录。

## 模型发现状态

模型发现必须保留错误语义，而不是使用空数组表示所有失败：

| 结果 | Bootstrap 状态 | 行为 |
| --- | --- | --- |
| 200，模型非空 | ready | 启用输入框 |
| 200，模型为空 | permission_denied | 提示账号没有模型服务 |
| 401/token_expired | auth_required | 刷新 Token 后重试一次 |
| 401/其他 | auth_required | 要求重新登录 |
| 403 | permission_denied | 不做无限自动重试 |
| 429、5xx、超时、网络错误、无效响应 | service_unavailable | 有限退避并允许 UI 自动恢复 |

启动阶段使用 `250ms → 750ms → 1500ms` 的有限退避。`service_unavailable` 保持现有 UI 定时恢复机制；`permission_denied` 只用于确定性权限结果。

## `/v1/models` 职责

- 携带 `X-OpenDrSai-Auth-Mode: oidc` 时，Gateway 中间件建立请求级 OIDC Context，接口使用该 Context 的 issuer-derived model base URL 请求上游 `/models`，不持久化或记录 Bearer Token。
- 不携带 OIDC Context 时，接口保留本地配置目录行为，供 Gateway 健康检查、CLI 和本地诊断使用。
- 上游状态码和结构化错误必须传播为本机接口的对应状态，Desktop 才能正确分类。

## 开发版和生产版隔离

默认布局：

| 资源 | 生产版 | 开发版 |
| --- | --- | --- |
| `DRSAI_HOME` | `%USERPROFILE%\.drsai` | `%USERPROFILE%\.drsai-dev` |
| Gateway | `127.0.0.1:18642` | `127.0.0.1:28642` |
| Electron `userData` | Electron/安装版默认目录 | `%USERPROFILE%\.drsai-dev\electron-user-data` |
| Runtime | 安装包 Runtime | `.drsai-dev\drsai-agent` 开发 Runtime |
| OIDC 会话 | 生产独立 | 开发独立，首次运行重新登录 |

`windows-desktop-dev.cmd` 仍允许使用 `-DrsaiHome` 和 `-GatewayPort` 覆盖默认值，以便多 checkout 或特殊测试进一步隔离。

开发启动不得读取、移动、备份或删除生产版 `%USERPROFILE%\.drsai` 中的 Runtime。停止开发版只允许停止开发端口与开发实例令牌绑定的 Gateway。

## 验收

至少覆盖：

1. 第一次模型请求超时、下一次成功后输入框恢复。
2. Token 过期后只刷新一次并成功恢复。
3. 明确 403 显示权限不足；5xx 不得显示权限不足。
4. OIDC `/v1/models` 实际转发到 issuer 对应的 `/apiv2/v1/models`。
5. 开发版和生产版 Home、端口、实例令牌、数据库及 Electron `userData` 不同。
6. 两个版本可并行运行，退出或注销任一版本不影响另一版本。

## 深链隔离

OIDC 提供方仍只接收标准的随机端口 loopback redirect：`http://127.0.0.1:<port>/callback`。授权完成页由 Desktop 本地生成，因此不需要服务端注册 Windows custom scheme。开发版的本地完成页使用 `opendrsai-dev://auth-complete`，生产版继续使用 `opendrsai://auth-complete`。

协议启动不会继承 `windows-desktop-dev.cmd` 的进程环境。Windows 主入口必须在加载任何路径、认证或 Gateway 模块之前，根据 `process.defaultApp` 恢复开发版 Home、端口、Runtime、Electron `userData` 和协议身份。这样协议启动的第二进程会命中同一个开发版单实例锁，把 URL 转交给已有窗口后退出。
