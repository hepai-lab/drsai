# Desktop 设置-频道微信接入开发方案

状态：代码与自动验收完成，等待真实微信账号扫码/收发验收  
适用范围：Windows Desktop、macOS Desktop、共享 Renderer、Python Runtime  
目标入口：`设置 > 频道 > 微信`

## 1. 总体目标

在 Desktop 的“设置-频道”中提供可实际使用的微信个人号 ilink Bot 接入，使用户可以在桌面界面完成扫码登录、查看连接状态、启停接入、重新登录和退出登录，并让微信文字消息进入与 Desktop 相同的 OpenDrSai Agent Runtime、按微信用户隔离会话、把最终回复发回微信。

本阶段以仓库已经实现的 TUI/Python 微信能力为基础，不在 Electron/TypeScript 中重新实现 ilink 协议客户端。最终应达到以下结果：

1. Windows 和 macOS 共用同一套 Renderer、API 契约和主进程业务服务，仅保留各平台 IPC 注册差异。
2. Renderer 不接触 `bot_token`、`user_id` 等微信凭据；二维码轮询、凭据落盘、长轮询和消息发送均在受信任的 Python Runtime 内完成。
3. “已登录”和“接入运行中”是两个独立状态：登录成功不自动代表 Bot 已开始接收消息，用户可以显式启用或停用频道。
4. 微信消息使用现有 AgentSession/OAEP Runtime，不形成第二套聊天核心；每个微信用户有独立、可恢复的会话映射。
5. 登录、启停、失效、网络异常和应用退出均有明确状态、恢复操作和可诊断信息。
6. 自动测试不访问真实微信；正式验收再使用测试微信账号完成扫码和真实收发闭环。

## 2. 现状与差距

### 2.1 已有能力

TUI 已实现以下控制面：

- `apps/ui-tui/src/components/wechatPanel.tsx`：展示配置状态、有效期、账号、活动 daemon，发起二维码登录、轮询结果和退出登录。
- `cores/python/packages/drsai/src/drsai/backend/tui_gateway/handlers/wechat.py`：提供 `wechat.status`、`wechat.sessions`、`wechat.login`、`wechat.login_status`、`wechat.logout`。
- `cores/python/packages/drsai/src/drsai/backend/wechat/`：实现 ilink 二维码登录、异步 API、长轮询 Bot、消息分片、去重和用户会话映射。
- `cores/python/packages/drsai/src/drsai/backend/daemon/wechat_adapter.py`：把 WeChatBot 适配到 `AgentSession.run_turn()`。
- daemon 已支持 `wechat_enabled`，会话映射保存在 daemon 数据目录。

Desktop 已具备以下承载能力：

- `apps/desktop/shared/renderer/src/components/ChannelsView.tsx` 已是“设置-频道”的共享页面。
- `apps/desktop/shared/api/desktopApi.ts`、`apps/desktop/shared/main/preload.ts`、Windows/macOS IPC 注册已形成类型化安全调用链。
- Desktop 已有受控本机 Gateway、实例令牌、跨平台 credential service、频道适配器目录和连接就绪度模型。
- Renderer 已依赖 `qrcode`，可复用 `MobilePairingDialog` 的 Data URL 生成方式，不需要新增二维码依赖。

### 2.2 关键差距

1. Desktop 频道目录中没有微信 provider 类型、卡片、状态和操作契约。
2. Desktop HTTP Gateway 没有面向微信的受控管理端点；现有能力只注册在 TUI JSON-RPC handler 中，不能由 Desktop 稳定复用。
3. 现有 TUI handler 同时负责协议调用、文件读取和响应组装，且通过同步 handler 驱动异步调用，不适合直接复制到异步 HTTP Gateway。
4. 当前凭据保存在 `~/.drsai/workspace/wechat/credentials.json` 明文文件中。Desktop 不能把该文件或其中 token 透传给 Renderer，并应在本阶段完成安全存储迁移或至少建立严格的 Runtime-only 兼容边界。
5. TUI 页面只有登录管理，没有完整的“启用/停用当前 Desktop 接入”生命周期；已有 daemon 启动能力也不等同于 Desktop Gateway 自身的频道生命周期。
6. 状态有效性的判断目前主要依赖“登录后 7 天”的本地时间，不等同于服务端凭据一定有效。需要区分 `valid`、`expired`、`revoked`、`unknown/offline`。
7. 现有 TUI 会显示掩码 token；Desktop 产品界面不应显示 token，即使已掩码。
8. Bot 的部分命令仍依赖旧模型内部结构，文字编码也需回归检查；不能仅凭扫码成功判定 Desktop 接入完成。

## 3. 范围和非目标

### 3.1 本阶段范围

- 微信个人号 ilink Bot。
- 单个本机 OpenDrSai 用户绑定一个微信 Bot 账号。
- 二维码展示、扫码状态轮询、取消/过期/重试、退出登录。
- 启用、停用、自动恢复和运行状态展示。
- 微信文字消息、基本 `/help`、`/newsession`、`/session` 命令和文字回复。
- 每个微信用户独立会话、重启后恢复映射。
- Windows/macOS Desktop 共享实现。
- 诊断、日志脱敏、自动测试和真实账号验收。

### 3.2 非目标

- 企业微信 Webhook。
- 图片、语音、文件、小程序和群管理。
- 多微信 Bot 账号、多工作区分别绑定不同微信账号。
- 在 Desktop Renderer 中直接访问 `ilinkai.weixin.qq.com`。
- 让微信消息自动控制当前可见 Desktop 会话；微信会话属于后台 Runtime，会在既有会话列表/历史能力支持后自然可见。
- 绕过现有工具审批、安全策略或用户身份边界。

## 4. 总体解决方案

采用“Python Runtime 是微信能力唯一所有者，Desktop 是管理和展示客户端”的架构：

```text
Settings / Channels / WeChat
        │ typed desktopApi
        ▼
preload allowlist ── platform IPC registration
        │
        ▼
shared main WeChatChannelService
        │ authenticated loopback HTTP
        ▼
Python Gateway /v1/channels/wechat/*
        ├── WeChatAuthService（二维码、状态、凭据）
        ├── WeChatChannelController（start/stop/health）
        └── WeChatBot + AgentSession adapter
                       │
                       ▼
              ilinkai.weixin.qq.com
```

### 4.1 统一 Python 服务层

从 TUI handler 中抽出不依赖 TUI JSON-RPC 的 `WeChatAuthService` 和 `WeChatChannelController`：

- `status()`：返回脱敏账号状态、运行状态、有效期和稳定错误码。
- `start_login()`：创建短期登录 operation，返回 `operation_id`、二维码内容、过期时间和建议轮询间隔。
- `poll_login(operation_id)`：返回 `waiting`、`scanned`、`confirmed`、`expired`、`cancelled` 或 `failed`。
- `cancel_login(operation_id)`：结束本次轮询并清除内存中的临时状态。
- `logout()`：先停止 Bot，再删除/撤销本地凭据和同步游标；保留会话历史，除非未来提供单独的“清除数据”。
- `start()` / `stop()`：幂等启停 Bot；同一账号同一 Runtime 只允许一个长轮询实例。
- `sessions()`：提供数量和脱敏摘要用于诊断，首版 UI 不必展示微信用户原始 ID。

TUI handler 改为调用这两个服务，保持原有 RPC 方法兼容。Desktop Gateway 新增 REST 适配层，不复制业务规则。

### 4.2 Desktop Gateway API

建议新增以下 loopback API，继续使用现有 Gateway instance token 认证：

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/v1/channels/wechat/status` | 查询登录、运行和错误状态 |
| POST | `/v1/channels/wechat/login` | 获取二维码并创建 operation |
| POST | `/v1/channels/wechat/login/{operation_id}/poll` | 单次轮询扫码状态 |
| DELETE | `/v1/channels/wechat/login/{operation_id}` | 取消登录 |
| POST | `/v1/channels/wechat/start` | 启用长轮询接入 |
| POST | `/v1/channels/wechat/stop` | 停止长轮询接入 |
| DELETE | `/v1/channels/wechat/credentials` | 退出登录并清除凭据 |
| GET | `/v1/channels/wechat/sessions` | 获取脱敏会话摘要/诊断信息 |

所有响应设大小上限；`operation_id` 使用不可猜测随机值并设置 TTL；二维码和 operation 不写日志。接口不得返回 `bot_token`、`ilink_user_id`、完整微信用户 ID 或凭据文件路径。

### 4.3 凭据策略

目标态使用 Desktop 已有 `DesktopCredentialService` 对敏感值进行系统安全存储，Python 侧只通过受控 bridge/opaque reference 获取运行时所需 token。若首个 PR 无法安全打通跨语言 credential bridge，则采用两阶段迁移：

1. P0 兼容期：仍由 Python Runtime 独占旧凭据文件，限制权限、原子写入、禁止 Renderer/IPC 返回敏感字段、日志 secret scan；明确标记为过渡方案。
2. P1 目标态：把 `bot_token` 移入 Windows Credential Manager/macOS Keychain，元数据文件只保留 schema、账号展示 ID、时间和 credential reference；成功迁移后原子删除旧 token 字段。

不能把微信 token 直接塞入现有 channel provider token 表，因为该表目前按 workspace 管理 GitHub/Slack/Docs/Calendar，而微信 Bot 是本机 Runtime 级单例。应新增独立命名空间并记录 schema version。

### 4.4 运行时生命周期

- “连接账号”只完成授权；“启用频道”才启动长轮询。
- 用户启用后保存非敏感配置 `enabled=true`。Desktop Gateway 就绪时自动恢复；凭据无效时保持 `needs_login`，不弹出阻塞窗口。
- stop、logout、Gateway shutdown 必须取消 Bot task、等待有限时间并关闭 HTTP client；不得留下第二个轮询进程。
- start 是幂等的；并发 start 共享同一个 task；logout 与 start 串行化。
- ilink 返回凭据失效时切换到 `needs_login` 并停止高频重试。
- 网络错误采用有上限的退避并显示 `reconnecting`；不把瞬时离线误报为退出登录。
- Desktop 不再为 ilink 模式展示或分配“微信端口”，因为长轮询不监听本地端口。

### 4.5 会话和 Agent 路由

首版继续复用 `SessionManager` 和 `AgentSessionAdapter`，但需要做以下收敛：

- 会话键为规范化的 provider + 微信用户稳定 ID，避免与 Desktop session ID 碰撞。
- 映射持久化采用 schema、原子替换和损坏文件恢复；日志和 UI 只展示散列/截断 ID。
- 每个微信用户串行处理，同一 Bot 可并行处理不同用户。
- 回复仅发送最终用户可见文本；reasoning、工具参数、审批内部事件和 secret 不得进入微信。
- 保留微信 2048 字符分片、消息 ID 去重和同步游标恢复，并为边界条件补测试。
- 检查并移除 WeChatBot 对旧 `agent_instance` 内部字段的直接依赖；模型/Agent 命令通过稳定 Runtime API 实现，不可实现的命令先明确禁用。
- 微信触发工具时必须复用 Desktop/Runtime 现有审批策略。没有可用审批通道的高风险动作 fail closed，而不是在微信端自动同意。

### 4.6 Desktop UI 状态机

`ChannelsView` 增加微信卡片并把复杂交互拆到 `WeChatChannelCard`/`WeChatLoginDialog`，避免继续扩大单文件组件。UI 至少支持：

- 未连接：说明能力和数据边界，显示“连接微信”。
- 获取二维码：loading、失败和重试。
- 等待扫码：直接渲染二维码、倒计时、`等待扫码/已扫码待确认`、取消和刷新二维码。
- 已连接未启用：账号脱敏信息、登录时间/预计到期、“启用频道”。
- 运行中：绿色状态、最近一次成功轮询、会话数量、“停用频道”。
- 重连中：显示网络恢复状态，不要求重新扫码。
- 登录失效：显示“重新连接”，不得继续显示运行中。
- 退出登录：二次确认，说明会停止接入但默认保留历史会话。

二维码使用现有 `qrcode` 包在 Renderer 内从二维码内容生成 Data URL。二维码内容只存在组件内存，关闭/取消/终态后清除；不得持久化到 localStorage、截图证据或遥测。

## 5. 需要实现、更新或移除的模块

### 5.1 新增模块

| 建议模块 | 职责 |
|---|---|
| `drsai/backend/wechat/auth_service.py` | 登录 operation、状态机、凭据读写与脱敏状态 |
| `drsai/backend/wechat/channel_controller.py` | Bot task 的幂等启停、健康状态、关闭与恢复 |
| Python Gateway 的微信 routes 模块 | `/v1/channels/wechat/*` HTTP 契约和输入校验 |
| `apps/desktop/shared/main/wechatChannel.ts` | 认证 loopback 请求、超时、响应大小限制和 Desktop 类型映射 |
| `WeChatChannelCard.tsx` | 微信卡片状态和操作 |
| `WeChatLoginDialog.tsx` | 二维码、倒计时、轮询和取消生命周期 |
| `verify-wechat-channel.mts` | Desktop 主进程/API 契约测试 |
| Python 微信 service/controller tests | 登录、生命周期、会话和故障测试 |

实际 Python route 路径应遵循 `drsai.backend.gateway` 当前拆分方式，不应把实现继续堆入薄启动器 `apps/desktop/drsai_gateway_server.py`。

### 5.2 更新模块

| 模块 | 更新内容 |
|---|---|
| `cores/python/.../backend/tui_gateway/handlers/wechat.py` | 改为共享 service 的兼容适配器，移除重复协议和文件逻辑 |
| `cores/python/.../backend/wechat/wechat_login.py` | 原子凭据写入、可取消操作、稳定错误分类、安全存储迁移接口 |
| `wechat_bot.py`、`wechat_adapter.py`、`session_manager.py` | 生命周期、稳定 Agent API、审批边界、编码、去重和持久化 |
| `apps/desktop/shared/api/desktopApi.ts` | 新增微信状态、登录、poll、cancel、start、stop、logout 类型与方法 |
| `apps/desktop/shared/main/preload.ts` | 仅暴露上述类型化方法，不提供任意 Gateway URL/方法 |
| Windows `src/main/index.ts` | 注册微信 IPC，并复用 workspace/受信窗口校验模式 |
| macOS `registerConnectionsIpc.ts` | 注册与 Windows 同契约的微信 IPC |
| `apps/desktop/shared/renderer/src/desktopApi.ts`、`mockDesktopApi.ts` | 接入真实 API 和完整 mock 状态机 |
| `ChannelsView.tsx` | 增加 `wechat` provider/card，接入子组件；刷新时合并微信状态 |
| `channelAdapters.ts` | 新增 `wechat-chat` adapter，方向为双向，配置状态来自 Runtime 而非本地快照猜测 |
| `externalConnectionReadiness.ts` | 增加微信 readiness、能力来源、缺口和验收说明 |
| `package.json`/验证清单 | 增加微信专项 verifier；复用已有二维码依赖 |
| 中英文用户手册 | 说明连接、启停、重新登录、数据与审批边界 |

### 5.3 移除或废弃

本阶段不删除 TUI 的 `/wechat` 和现有 daemon 兼容入口。完成共享服务迁移并验证 TUI 回归后：

- 移除 TUI handler 中直接请求 ilink、直接解析/删除凭据文件的重复逻辑。
- 废弃 ilink 模式下无实际监听用途的 `wechat_port` UI 和新配置入口；CLI 参数先保留兼容并给出 deprecation 提示，再按版本策略移除。
- Desktop 永不实现、因此也无需后续保留：Renderer token 字段、掩码 token 展示、任意 URL IPC、Renderer 直连微信。
- 旧明文凭据格式只在迁移窗口内可读；安全存储迁移验证完成后停止写旧格式。

## 6. 具体功能点、测试与验收

| ID | 功能点 | 自动测试 | 联调/人工验收 | 通过标准 |
|---|---|---|---|---|
| W01 | 微信卡片与状态 | mock 覆盖未连接、已连接、运行中、失效、重连、错误；中英快照/a11y | 打开设置-频道并切换状态 | 状态、按钮和帮助文案匹配；键盘可操作；无 token 展示 |
| W02 | 获取二维码 | fake ilink 校验正常、超时、4xx/5xx、畸形/超大响应 | 点击“连接微信” | 规定时间内显示可扫描二维码；失败可重试；无外部二维码生成服务 |
| W03 | 扫码状态机 | fake timer 覆盖 waiting、scanned、confirmed、expired、cancelled、unknown、网络抖动 | 扫码、手机确认、取消、等待过期 | 不早于服务端建议间隔轮询；每个终态停止 timer；无重复 operation |
| W04 | 登录成功与持久化 | 重启 fixture、凭据迁移、原子写失败、损坏存储 | 登录后重启 Desktop | 状态仍正确；Renderer/日志/普通元数据无 secret；损坏时 fail closed |
| W05 | 启用频道 | 并发/重复 start、无凭据 start、失效凭据 start | 启用后从微信发消息 | 仅一个 Bot task；无凭据明确提示；首条消息被 Agent 接收 |
| W06 | 停用与退出 | stop 幂等、logout 顺序、shutdown cancellation、超时清理 | 停用后发消息；再退出登录 | 停用后不再消费；退出后凭据不可恢复；应用退出无孤儿轮询 |
| W07 | 自动恢复与重连 | Gateway restart、断网、超时、退避、服务端失效 fixture | 启用后重启应用；断网再恢复 | `enabled=true` 自动恢复；退避有上限；瞬时断网不要求扫码；失效后停止高频重试 |
| W08 | 入站文字消息 | 空文本、非文字、重复 message_id、多用户并发、同用户并发 | 两个微信用户分别发消息 | 仅支持类型有明确回复；重复不执行；同用户有序、不同用户可并行 |
| W09 | Agent 会话映射 | 创建/切换/恢复、损坏文件、ID 脱敏测试 | `/newsession`、`/session`，重启后继续 | 用户会话互不串线；映射重启可恢复；日志无原始用户 ID |
| W10 | 出站回复 | 0/1/2048/2049/长文本、换行分片、Unicode/中文、发送失败重试 | 触发短回复和长回复 | 每片不超限制、顺序正确、不丢中文、不泄露 reasoning/tool secret |
| W11 | 模型与命令 | `/help`、`/newsession`、`/session`；旧内部 API 静态检查 | 逐一执行首版承诺命令 | 承诺命令可用；未承诺命令返回明确说明而不崩溃 |
| W12 | 审批安全 | 高风险工具无审批通道、拒绝、超时、批准 fixture | 从微信触发需审批操作 | 无审批/拒绝/超时均不执行；批准才执行；不把内部审批载荷发到微信 |
| W13 | REST/IPC 边界 | instance token、来源窗口、schema、长度、operation 归属、错误脱敏 | DevTools 尝试非法参数 | 未认证/越权/畸形请求拒绝；preload 无任意调用；错误不含 secret |
| W14 | 跨平台一致性 | shared typecheck、Windows/macOS IPC contract verifier | Windows/macOS 各完成一次连接和收发 | 两平台 API、UI、状态和关闭语义一致 |
| W15 | TUI 回归 | 原 `wechat.*` RPC 合同测试、`/wechat` smoke | TUI 登录/状态/退出 | 共享服务迁移后行为兼容，Desktop 变更不破坏 TUI |
| W16 | 安装包能力 | packaged smoke 检查 Python 模块和依赖 | 干净 Windows/macOS 安装包扫码 | 不依赖源码目录或系统 Python；缺依赖时给出可诊断错误 |
| W17 | Secret 与隐私 | canary 扫描日志、状态文件、IPC fixture、崩溃报告 | 检查运行日志和诊断导出 | token、二维码、operation、原始用户 ID 零泄漏；诊断仅含脱敏状态 |

## 7. 测试分层和建议命令

### 7.1 Python 单元与集成测试

- 使用 `httpx.MockTransport` 或等价 fake server，不访问真实 ilink。
- 覆盖二维码响应校验、poll 状态转换、超时/取消、凭据迁移、controller 并发和 Bot 消息处理。
- 使用临时目录和 fake credential backend，不读写开发者真实 `~/.drsai`。
- 给 `SessionManager`、`split_text`、消息去重和 sync buffer 单独做边界测试。

建议纳入现有 Python pytest 套件，并提供可单独运行的微信 marker；最终命令以仓库测试收敛时实际脚本为准。

### 7.2 Desktop contract/component 测试

- 新增 `apps/desktop/shared/test-kit/verify-wechat-channel.mts`，验证 API 类型、preload allowlist、双平台 IPC、Gateway 请求认证、超时和脱敏。
- 为 Renderer 使用 mock Desktop API + fake timer，验证二维码 dialog 的 timer/listener 清理和全部状态。
- 扩展 `verify-channel-adapters.mts`、`verify-external-connections.mjs`、`verify-renderer-ui.mjs` 和视觉 smoke。
- 运行 Desktop Windows/macOS typecheck 与 architecture boundary verifier。

### 7.3 E2E 与真实验收

自动 E2E 启动本地 fake ilink server 和真实 Desktop Gateway/Renderer，完成：获取二维码、模拟确认、启用、注入消息、Agent fake response、分片发回、停用、重启恢复和退出登录。测试证据不得保存真实二维码或 token。

真实账号验收不进入普通 CI，由人工使用专用测试微信账号执行：

1. 干净安装 Desktop，打开设置-频道-微信。
2. 获取二维码并扫码确认，检查账号脱敏状态。
3. 启用频道，从微信发送“只回复 WECHAT_DESKTOP_OK”。
4. 验证微信先收到处理提示（若保留）并最终收到指定回复，Desktop/Runtime 有对应会话且无串线。
5. 发送超过 2048 字符的回复请求，验证顺序分片和中文完整性。
6. 重启 Desktop 后再次发消息，验证自动恢复和原会话映射。
7. 断网后恢复，验证 `reconnecting -> running`，无重复回复。
8. 停用后发消息，验证不再消费；重新启用后恢复。
9. 退出登录，验证 Bot 停止且重新启用要求扫码。
10. 扫描日志、诊断包和应用数据，确认没有 token、二维码、operation ID 和原始微信用户 ID。

## 8. 发布验收门槛

以下条件全部满足才可把微信卡片从实验状态改为可用：

1. W01-W17 自动测试通过，现有 TUI、频道、Gateway、审批和跨平台回归通过。
2. Windows 和 macOS 至少各一次 packaged-app 真实扫码、消息收发、重启恢复、停用和退出闭环通过。
3. Runtime 只存在一个长轮询 owner；重复启动、应用关闭和异常退出均无孤儿进程/task。
4. Renderer、IPC、日志、诊断、崩溃报告和非敏感元数据通过 secret canary 扫描。
5. 高风险工具在微信入口遵循现有审批策略并 fail closed。
6. 明文凭据若仍处于 P0 兼容期，功能只能标记为实验性，不能进入 stable；stable 必须完成系统安全存储迁移和旧格式清理验证。
7. 用户手册明确说明支持的消息类型、账号范围、凭据生命周期、停用/退出区别和数据边界。

## 9. 建议实施顺序

### 阶段 A：Runtime 服务收敛

抽取 auth service/controller，建立状态和错误码，补 fake ilink 测试；TUI 改为兼容适配器。此阶段不改 Desktop UI。

### 阶段 B：Desktop 管理通道

新增 Gateway REST、shared main client、desktopApi/preload、双平台 IPC 和 mock；完成 contract/security 测试。

### 阶段 C：设置-频道 UI

新增微信 adapter/readiness、卡片和二维码 dialog，完成状态机、可访问性、中英文和视觉测试。

### 阶段 D：真实消息闭环

把 controller 接到稳定 AgentSession/OAEP Runtime，修复命令内部依赖，完成入站、出站、会话、审批和恢复测试。

### 阶段 E：安全存储与发布

完成明文凭据迁移、packaged smoke、Windows/macOS 真实账号验收、诊断脱敏和发布文档。按发布门槛决定是否移除实验标签。

## 10. 开发前需要准备

- 一个仅用于验收的微信测试账号和可创建/使用 ilink Bot 的资格，避免使用个人生产账号。
- 明确 ilink API 的可用性、使用条款、频率限制、二维码 TTL、凭据真实失效语义和生产发布许可；当前代码中的“7 天”只能作为本地缓存策略，不能替代官方合同。
- Windows Credential Manager、macOS Keychain 与 Python Runtime 的 credential bridge 设计评审。
- fake ilink 响应 fixture，覆盖正常、扫码、确认、过期、撤销、限流、超时、断网和 token 失效。
- Desktop packaged Runtime 必须包含 `httpx` 及微信模块，并确认不依赖系统 Python。
- 审批产品决策：微信无交互式 Approval Center 时，高风险动作默认拒绝；如未来增加跨端批准，应单独立项。
- 隐私文案和诊断脱敏规则评审，尤其是微信账号 ID、联系人 ID、消息正文和二维码。

## 11. 待确认的产品决策

以下决策不阻塞 Runtime/API 基础建设，但应在阶段 C 前确认：

1. 首版是“连接后默认启用”还是显式点击启用。本方案建议显式启用，以便用户理解后台长轮询和消息进入 Agent 的行为。
2. 微信会话是否立即出现在 Desktop 会话列表。本方案首版不强制新增列表联动，只要求 Runtime 历史可恢复；列表统一可另行迭代。
3. 已确认不发送“正在处理”普通文本占位消息；使用 ilink `getconfig` + `sendtyping` 原生输入状态，并在回复完成或失败后取消。输入状态为 best-effort，失败不得影响回复。
4. 退出登录是否删除会话映射。本方案建议默认保留历史，仅删除凭据和同步游标；“清除微信数据”应是独立危险操作。
5. 微信卡片是否随 stable 发布。若安全存储迁移未完成，只能隐藏在实验功能开关后。

## 12. 结论

Desktop 微信接入的最短可靠路径不是把 TUI 面板移植成 React 页面，而是先把现有 TUI 微信能力收敛为 Runtime 级共享服务，再通过受认证的 Gateway REST 和类型化 Desktop IPC 暴露管理操作。Desktop 侧主要实现频道卡片、二维码交互、状态机、跨平台 IPC 和测试；Python 侧主要实现共享登录服务、Bot 生命周期、稳定 Agent 路由和凭据安全迁移。这样可以复用已有 ilink/AgentSession 能力，同时避免 Electron Renderer 持有凭据、双重长轮询和 TUI/Desktop 行为分叉。

## 13. 实施与验收记录（2026-08-14）

已实现：

- Runtime 共享登录服务、受控 operation、限频、取消、过期和 provider 错误分类；
- DPAPI/macOS Keychain 平台凭据存储及旧明文文件自动迁移；
- Runtime-owned Bot 幂等启停、退出清理、启用偏好和重启恢复；
- `/v1/channels/wechat/*` Gateway API、Desktop shared client、preload 和 Windows/macOS IPC；
- 微信 adapter/readiness、设置卡片、内存二维码、扫码状态、启停、刷新和退出确认；
- TUI handler 复用共享服务且保持原 RPC 兼容；
- 用户 ID 散列持久化、会话原子写入、跨用户隔离、回复分片、内部错误脱敏和 provider origin 白名单；
- ilink 返回 `-14` 时终止轮询并向 Desktop 映射为凭据过期，要求重新扫码，不再以一小时休眠伪装为运行中；
- 二维码轮询遇到临时超时或 provider 5xx 时保留登录 operation，并在二维码 TTL 内按 3–15 秒退避重试；恢复后自动清除 Desktop 错误提示；
- 微信管理请求携带当前 Desktop OIDC 上下文，Gateway 只在进程内缓存并刷新该上下文；AgentSession 在线程池初始化和执行时显式恢复认证作用域，微信 provider ID 仍不能成为平台身份；
- 普通“正在处理”占位消息已移除，改用 Tencent iLink `getconfig`/`sendtyping` 原生输入状态；ticket 只在进程内缓存，提示失败不阻断回复；
- Windows/macOS typecheck、架构、频道、外部连接、Renderer UI、secret redaction、生产构建和 bundled source 检查。

自动验收结果：

- 微信、TUI 与平台凭据相关 Python 测试：`77 passed`；
- Channel adapter 全量合同：416 种格式及安全 fixture 通过；
- Desktop 专项 API/IPC/QR 生命周期验证通过；
- Windows 与 macOS TypeScript typecheck 通过；
- Windows production build 通过，微信新增 Python 模块已进入 `drsai-backend-source.zip`；
- 真实 `ilinkai.weixin.qq.com` 二维码申请请求通过，响应内容未写日志或验收证据。

尚未完成的外部人工验收：需要测试微信账号持有人扫描一次短期二维码并在手机确认，随后执行 W05-W10 的真实消息收发、长回复、重启、断网、停用和退出步骤。该步骤不能由自动测试代替，也不能绕过手机端用户确认。在完成前，功能发布状态应保持“实验性/待真实账号验收”。

真实验收进展（2026-08-15）：Windows 开发版已完成扫码确认，并从微信发送固定验证消息，真实 Agent 回复为 `WECHAT_DESKTOP_OK`。扫码、入站文本、Desktop OIDC Agent 执行和出站文本闭环通过。长回复、重启恢复、断网重连、停用/退出以及 macOS packaged-app 闭环仍待验收。
