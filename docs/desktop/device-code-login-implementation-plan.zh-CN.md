# OpenDrSai 设备码登录完整开发与验收方案

状态：开发完成，等待真实 Windows Sandbox 发布验收  
适用范围：Windows Desktop、Windows Sandbox 自动验收、后续 macOS/无本机回调环境  
客户端仓库：`drsai`  
服务端协作任务：`019f5208-0f19-7883-b3e2-4dcc8ffa4b61`

## 1. 背景与当前状态

OpenDrSai 桌面端原有登录方式的标准名称是 **OIDC Authorization Code Flow with PKCE**，本文简称“OIDC 授权码登录（PKCE）”：桌面端启动本机 loopback HTTP 回调，打开系统浏览器，浏览器完成授权后回到本机端口。它在普通 Windows/macOS 桌面上步骤最少、体验最好，应继续作为正式产品的默认登录方式。但 Windows Sandbox、SSH/无桌面环境以及浏览器与应用不在同一会话的远程环境，不能稳定完成本机回调，因此需要设备码登录。

截至 2026-08-13，`https://ai-dev.ihep.ac.cn/api/.well-known/openid-configuration` 已声明：

- `authorization_code`
- `refresh_token`
- `urn:ietf:params:oauth:grant-type:device_code`
- RFC 8628 `device_authorization_endpoint`

仓库中原有 `/api/desktop-auth/*` 自定义轮询桥由旧 WebUI 签发自有 JWT，不属于 ai-dev OIDC Provider。客户端侧启动、轮询和取消入口现已移除，只保留读取、加密迁移及刷新既有 SSO 会话的兼容路径。

## 2. 总体目标

实现符合 OAuth 2.0 Device Authorization Grant（RFC 8628）的 HepAI OIDC 登录，使不能稳定接收浏览器回调的 OpenDrSai 客户端也能安全登录。

具体目标：

1. Sandbox 内的应用只负责申请设备码和轮询，用户在宿主机或另一台可信设备上登录并批准。
2. 设备码流签发的 access token、ID token 和 refresh token 与现有授权码流具有相同 issuer、audience、scope、subject、roles、groups 和 RS256 信任链。
3. 客户端复用现有 token 校验、安全存储、刷新、注销、Runtime 身份传递和本地数据归属逻辑。
4. 正式桌面产品默认使用 Authorization Code + PKCE；设备码用于 Sandbox 自动验收、受限环境和用户明确选择“在其他设备上登录”的场景。
5. Windows Sandbox 登录后的聊天、智能体、Tavily 搜索和重启保持可以自动验收。
6. 不复制密码、浏览器 Cookie、宿主机 token、`auth.json` 或 refresh token；不增加测试后门。
7. 协议、状态、审计和测试覆盖足以支持未来在生产环境启用。

## 3. 非目标和安全边界

- 不实现账号密码自动填写。
- 不允许使用宿主机 access token 换取沙盒会话。
- 不复制 Electron safeStorage/DPAPI 加密后的凭据。
- 不把客户端密钥嵌入桌面应用；`opendrsai-desktop` 必须是 public client。
- 不把“已登录浏览器”解释为自动同意。用户仍需明确批准设备请求。
- 不为 E2E 用户提供绕过登录、MFA 或授权确认的服务端开关。
- `run_id` 仅用于关联验收与审计，不得参与身份、角色、scope 或授权决策。
- 不移除现有授权码流，也不因 discovery 声明设备端点而把普通桌面用户自动切换到设备码。

## 4. 总体解决方案

### 4.1 登录方式选择策略

两种方式属于同一个 ai-dev OIDC Provider，共用 client、scope、claims、JWKS 信任链、Token 校验、安全存储、刷新、撤销和注销。差异只在获得 Token 前的授权交互。

| 产品文案 | 标准名称 | 内部/协议标识 | 使用场景 |
|---|---|---|---|
| 使用 HepAI 登录 | OIDC Authorization Code Flow with PKCE | `authorization_code` | 普通 Windows/macOS 默认方式 |
| 在其他设备上登录 | OAuth 2.0 Device Authorization Grant | `urn:ietf:params:oauth:grant-type:device_code` | Sandbox、无桌面、远程受限或用户显式选择 |

1. 普通 Windows/macOS 正式产品：默认使用 OIDC Authorization Code Flow with PKCE。
2. Windows Sandbox 自动验收：由受控验收标志强制使用 Device Authorization Grant。
3. SSH、无桌面、远程会话或 loopback 回调受限：使用设备码。
4. 用户明确选择“在其他设备上登录”：使用设备码。
5. 授权码流程无法启动或回调失败：向用户说明原因并提供切换设备码的操作，不静默改变登录方式。
6. discovery 未声明 `device_authorization_endpoint`：隐藏或禁用设备码入口；授权码登录不受影响。

### 4.2 设备码标准流程

1. OpenDrSai 获取 OIDC discovery，并确认存在 `device_authorization_endpoint`。
2. 客户端向该端点提交 public client ID 和所需 scope。
3. 服务端返回高熵 `device_code`、短 `user_code`、验证地址、过期时间和最小轮询间隔。
4. OpenDrSai 显示代码，并在系统浏览器打开 `verification_uri_complete`。
5. 浏览器要求用户登录；确认页展示客户端、请求 scope、设备信息和可选 run ID。
6. 用户批准或拒绝。
7. OpenDrSai 按 RFC 8628 轮询现有 token endpoint。
8. 成功后客户端使用现有 JWKS/claims 校验创建 OIDC session，并通过 safeStorage 持久化。
9. discovery 不支持设备码、设备端点返回 `unsupported_grant_type` 或管理员显式关闭时，设备码入口明确提示不可用；普通桌面仍使用 Authorization Code + PKCE。

### 4.3 协议契约

Discovery 新增：

```json
{
  "device_authorization_endpoint": "https://ai-dev.ihep.ac.cn/api/oauth2/device_authorization",
  "grant_types_supported": [
    "authorization_code",
    "refresh_token",
    "urn:ietf:params:oauth:grant-type:device_code"
  ]
}
```

申请设备码：

```http
POST /api/oauth2/device_authorization
Content-Type: application/x-www-form-urlencoded

client_id=opendrsai-desktop&scope=openid%20email%20profile%20roles%20groups%20hai_api%20offline_access
```

可选参数：

- `run_id`：客户端生成的 opaque UUID，只用于审计和 Sandbox 证据关联。
- `device_name`：长度受限、转义后展示，不作为可信设备标识。

成功响应：

```json
{
  "device_code": "<opaque-high-entropy-secret>",
  "user_code": "ABCD-EFGH",
  "verification_uri": "https://ai-dev.ihep.ac.cn/device",
  "verification_uri_complete": "https://ai-dev.ihep.ac.cn/device?user_code=ABCD-EFGH",
  "expires_in": 600,
  "interval": 5
}
```

轮询 token：

```http
POST /api/oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:device_code&device_code=<device-code>&client_id=opendrsai-desktop
```

轮询错误必须使用标准 OAuth JSON 和 HTTP 状态，支持：

- `authorization_pending`
- `slow_down`
- `access_denied`
- `expired_token`
- `invalid_client`
- `invalid_grant`
- `unsupported_grant_type`

成功响应继续使用现有 token response，不建立专用 Sandbox token 类型。

## 5. 需要实现或更新的模块

### 5.1 ai-dev OIDC Provider：新增

#### A. Device authorization 数据模型

字段至少包括：

- `device_code_hash`
- `user_code_hash` 或可安全查询的规范化表示
- `client_id`
- 已规范化 scopes
- `status`: pending/approved/denied/consumed/expired
- `subject_id`
- `created_at`、`expires_at`、`approved_at`、`consumed_at`
- `last_polled_at`、`poll_violation_count`
- `run_id`、`device_name`
- 审计 correlation ID

约束：device code 只存 SHA-256/HMAC 哈希；成功兑换必须在数据库事务内原子地从 approved 变为 consumed。

#### B. Device authorization endpoint

负责校验 client、scope、限速和参数长度，生成 256 bit 以上随机 device code、易输入 user code、10 分钟 TTL 和建议 5 秒轮询间隔。

#### C. 浏览器验证与确认页

包括 user code 输入页、登录跳转、批准/拒绝确认页和结果页。确认页必须显示：

- OpenDrSai Desktop 客户端名称
- 请求权限
- 设备名称和 run ID（若存在）
- 过期状态
- 明确的批准、拒绝操作

#### D. Token endpoint device grant 分支

接入现有 token service，执行 RFC 状态机、轮询限速、一次性兑换，并签发现有 RS256 token。不得复制一套 claims 构建逻辑。

#### E. Discovery、审计、清理任务与配置

增加 discovery 元数据、设备授权 feature flag、TTL/interval/限速配置、过期记录清理及审计事件。

### 5.2 OpenDrSai shared main auth：更新

目标文件：`apps/desktop/shared/main/auth.ts`

需要：

- 扩展 `OidcProviderMetadata.device_authorization_endpoint`。
- 新增 `startOidcDeviceLogin()` 和内部申请、轮询函数。
- 正确实现 interval、`slow_down` 每次至少增加 5 秒、过期截止时间和网络退避。
- 使用 AbortController 支持取消、应用退出和新登录覆盖旧登录。
- 成功后复用 `createOidcSession()`，不得降低 RS256、issuer、audience、scope、subject、expiry 校验。
- 设备登录通常没有 authorization-code nonce；验证逻辑允许缺省 nonce，但其余校验不变。
- 日志和错误信息不得包含 device code、token 或带 user code 的完整 URL。
- 默认 `startOidcLogin()` 继续使用授权码 + PKCE loopback 流程。
- 自动验收标志或用户显式选择设备码时才进入设备授权流程。
- 设备能力不可用时返回明确的可恢复状态；不得在用户批准、拒绝或过期后静默切换另一种授权流程。

### 5.3 API 类型、IPC 和 preload：更新

目标文件：

- `apps/desktop/shared/api/desktopApi.ts`
- `apps/desktop/shared/main/preload.ts`
- Windows/macOS IPC 注册模块
- mock desktop API

新增 device-login start/progress/cancel 契约。进度状态至少包括：requesting、waiting_for_user、polling、slow_down、authorized、denied、expired、cancelled、failed。

建议 start 调用快速返回设备信息，后台进度通过受控 IPC event 推送；不要让一个五至十分钟的 IPC request 长时间悬挂且无法可靠取消。

### 5.4 登录界面：更新

目标文件：

- `apps/desktop/shared/renderer/src/auth/LoginScreen.tsx`
- `apps/desktop/shared/renderer/src/auth/AuthProvider.tsx`
- 对应 CSS 和本地化文案

功能：

- 主按钮“使用 HepAI 登录”默认启动授权码 + PKCE。
- 次要入口“在其他设备上登录”启动设备码；discovery 不支持时隐藏或禁用。
- 显示格式化 user code、剩余有效时间和当前状态。
- 提供复制代码、打开浏览器、重试和取消。
- `verification_uri_complete` 不可用时打开 verification URI，并提示手工输入代码。
- 浏览器打开失败不取消登录，允许复制地址后继续。
- `slow_down` 显示“仍在等待授权”，不能显示为失败。
- 过期、拒绝、网络错误给出不同恢复动作。
- 支持键盘操作、屏幕阅读器状态播报和中英文。

### 5.5 Windows Sandbox 验收控制器：更新

目标文件：`apps/desktop/windows/scripts/invoke-windows-sandbox-oidc-acceptance.ps1` 及其证据验证脚本。

需要：

- 为每次验收生成 run ID。
- 在沙盒内启动设备码登录。
- 通过只含验证 URL/状态的受控证据通道通知宿主机；不得传 token。
- 宿主机打开验证页面，由用户批准。
- 沙盒检测 session 创建后自动执行首次聊天、Tavily 搜索、重启保持和注销验证。
- 封存证据前执行 secret scan。
- 超时或失败时保留可诊断状态，但取消服务端设备授权轮询。

### 5.6 旧自定义 desktop-auth：评估后移除

目标模块：

- `apps/webui/backend/.../routes/desktop_auth.py`
- `DesktopAuthTicket` 数据模型
- shared auth 中 `startDesktopSsoLogin`、`pollDesktopSsoLogin` 等调用
- 对应 IPC、mock、UI 和测试

先用代码搜索、运行时遥测和发布版本兼容性确认是否仍有调用者。若无调用者，分独立变更删除，避免两套“device code”被误用。若仍需支持旧 IHEP SSO/微信登录，则重命名为 `legacy_desktop_sso_bridge`，文档明确其不是 OIDC Device Grant，并禁止它为 HepAI provider 请求提供 token。

## 6. 功能点、测试与验收矩阵

| ID | 功能点 | 自动测试 | 联调/人工验收 | 通过标准 |
|---|---|---|---|---|
| D01 | Discovery 宣告设备授权 | discovery schema 单测；开关关闭测试 | 请求 ai-dev discovery | endpoint 为 HTTPS；grant 列表正确；关闭开关不宣告 |
| D02 | public client 申请设备码 | 合法/未知 client、合法/越权 scope、参数长度测试 | 用 `opendrsai-desktop` 请求 | 无需 client secret；返回字段完整；越权 scope 被拒绝 |
| D03 | device/user code 安全生成 | 熵、唯一性、格式、碰撞测试 | 检查数据库和日志 | 原始 device code 不落库、不入日志；TTL/interval 正确 |
| D04 | 用户验证页 | 未登录跳转、错误/过期 code、XSS、CSRF 测试 | 桌面和手机浏览器输入/完整链接两种路径 | 正确绑定请求；展示 client/scope；不能枚举有效 code |
| D05 | 批准和拒绝 | 身份绑定、重复操作、并发批准/拒绝测试 | 同一 code 分别执行批准和拒绝 | 仅已认证用户操作；状态转换原子且不可逆 |
| D06 | pending 轮询 | token endpoint 单测 | 批准前持续轮询 | 返回 `authorization_pending`，不签发任何 token |
| D07 | slow_down | 模拟低于 interval 的轮询 | 客户端超频一次 | 服务端返回 `slow_down`；客户端增加间隔且不失败 |
| D08 | 过期和取消 | 时间推进、取消、清理任务测试 | 等待过期后再轮询 | 返回 `expired_token`；不能恢复或兑换 |
| D09 | 一次性兑换 | 并发双兑换和重放测试 | 授权后并行发两次 token 请求 | 仅一个成功；其余 `invalid_grant`；有审计记录 |
| D10 | token 等价性 | 比较两种 grant 的 claims 契约 | 用真实账号完成两种登录 | issuer/audience/sub/scope/roles/groups/typ 一致，均为 RS256 |
| D11 | refresh/logout/revoke | refresh rotation、撤销、过期测试 | 登录、重启、刷新、注销 | 保持登录可用；注销后 refresh/access 不再可用 |
| C01 | 登录方式选择 | 有/无 device endpoint、普通桌面、验收标志和用户显式选择 fixture | 分别连接新旧 discovery | 普通桌面始终默认授权码；验收/显式选择才走设备码；旧服务仍可授权码登录 |
| C02 | 设备信息展示 | renderer 组件和快照测试 | 中英文、缩放、键盘、读屏 | code 清晰；倒计时正确；操作可访问 |
| C03 | 打开/复制验证地址 | shell open mock、clipboard mock | 禁止系统浏览器后手工复制 | 打开失败不丢失 pending session；复制内容正确 |
| C04 | 客户端轮询状态机 | fake timer 覆盖全部 RFC 错误、网络抖动、取消 | 断网后恢复、用户拒绝、等待过期 | 不超频；可取消；终态不继续发请求；错误分类正确 |
| C05 | token 验证与存储 | 伪造签名、错误 issuer/aud/scope/sub/exp 测试 | 检查重启后的 session | 非法 token 全部 fail closed；凭据只以加密形式持久化 |
| C06 | 并发登录生命周期 | 两次 start、cancel、退出测试 | 登录中重试和关闭应用 | 新登录取消旧登录；无孤儿 timer/IPC listener |
| C07 | 日志脱敏 | canary secret scan | 检查 app、安装、Sandbox 和服务端日志 | device code、token、Cookie、完整 user-code URL 零泄露 |
| S01 | Sandbox 首次登录 | fake OIDC 自动 E2E | ai-dev 真实账号批准 | 沙盒无需打开登录浏览器即可收到 session |
| S02 | 首次聊天 | gateway/provider E2E | 发送固定低风险消息 | 有 start/chunk/done；无 401/403；请求使用 OIDC bearer |
| S03 | Tavily 搜索 | mock 和真实配置 smoke | 发起固定搜索 | 搜索结果返回；证据不包含凭据 |
| S04 | 重启保持 | 持久化 fixture | 关闭并重开应用 | refresh 成功；用户身份和本地数据归属不改变 |
| S05 | 注销清理 | session 文件/safeStorage mock | 注销后重新打开 | session 为匿名；refresh 已撤销；本地 token 不可恢复 |
| S06 | 证据封存 | receipt/schema/secret scanner | 检查最终 evidence bundle | run ID、版本、时间和结果完整；任何 secret canary 都不存在 |
| L01 | 旧桥移除/隔离 | 全仓引用检查、旧兼容测试 | 检查仍受支持的登录入口 | 无死 IPC/API；旧桥不会被 HepAI OIDC 使用 |

## 7. 测试分层

### 7.1 服务端单元测试

- 状态机、TTL、轮询间隔、`slow_down`、并发兑换。
- client/scope 校验、code 哈希和 user-code 规范化。
- claims 与 authorization-code grant 共用同一 token service。
- 审计内容不含 secret。

### 7.2 服务端集成测试

- discovery → device authorization → 用户批准/拒绝 → token → refresh → revoke 全链路。
- 数据库事务和多个服务实例下的并发兑换。
- feature flag、数据库迁移升级和回滚。
- 反向代理后的 verification URI、HTTPS 和 host 校验。

### 7.3 客户端单元与组件测试

- 使用 fake timer 确认绝不早于 interval 轮询。
- 每次 `slow_down` 后至少增加 5 秒。
- 网络 5xx/timeout 采用有上限的退避，但不越过 expires_at。
- terminal 状态清理 timer、listener 和敏感内存引用。
- LoginScreen 的倒计时、复制、打开、拒绝、过期和辅助功能。

### 7.4 客户端集成/E2E

- 本地 fake OIDC 同时实现 authorization code 和 device grant。
- 分别测试 desktop authorization-code default、Sandbox forced-device、用户显式 device、设备能力缺失、取消和重启。
- 对 token 校验、gateway header、Runtime principal 和用户数据归属做现有回归。

### 7.5 ai-dev 真实联调

使用非特权测试账号，在 ai-dev 完成一次批准、拒绝、过期、slow_down、重放、refresh 和 revoke。不得在 CI 中保存账号密码或长期 refresh token。

### 7.6 Windows Sandbox 发布验收

候选 MSI 必须在干净 Sandbox 中通过 S01-S06。用户只在宿主机进行一次真实授权确认；其余安装、轮询、聊天、搜索、重启和证据收集自动执行。

## 8. 验收门槛

以下条件全部满足才允许发布设备码能力并用于 Sandbox/受限环境；普通桌面的默认方式仍为授权码 + PKCE：

1. ai-dev discovery、endpoint、确认页、token grant 已部署且服务端测试全绿。
2. 客户端 D/C 类自动测试全绿，现有 authorization-code E2E 无回归。
3. ai-dev 真实账号完成批准、拒绝、过期、重放、刷新、撤销验收。
4. Windows Sandbox S01-S06 全部通过并生成密封证据。
5. 服务端和客户端日志通过 secret canary 扫描。
6. 安全评审确认不存在密码/Cookie/token 复制和免确认路径。
7. rollback 已验证：服务端关闭 device discovery 宣告后，设备码入口不可用，但普通桌面的授权码 + PKCE 登录保持正常。
8. 指标和告警可观察 pending 数、批准率、拒绝率、过期率、slow_down 和兑换错误，且不使用 user code/device code 作为标签。

## 9. 实施顺序和交付物

### 阶段 A：服务端能力

- 数据库迁移、device endpoint、确认页、token grant、discovery、审计和测试。
- 先部署但通过 feature flag 隐藏 discovery 宣告。

交付物：API 契约、迁移脚本、测试报告、部署与回滚说明。

### 阶段 B：客户端能力

- shared auth 状态机、类型/IPC、UI、mock、单元测试、loopback 回退。
- Windows 和 macOS 共用业务实现，平台层只负责打开系统浏览器。

交付物：客户端代码、组件测试、fake OIDC E2E 和诊断脱敏测试。

### 阶段 C：Sandbox 自动验收

- run ID、宿主机验证 URL 交接、自动聊天/搜索/重启/注销、证据封存。

交付物：验收脚本、证据 schema、密封 evidence bundle 和验证报告。

### 阶段 D：灰度和受限场景启用

- ai-dev 开启 discovery 宣告。
- 先在 Windows Sandbox 验收启用，再向需要“其他设备登录”的 ai-dev 桌面用户开放次要入口。
- 稳定后评估生产 `ai.ihep.ac.cn`。

交付物：灰度指标、故障演练、回滚记录和生产启用决策。

### 阶段 E：遗留清理

- 确认旧 desktop-auth 自定义桥调用情况。
- 删除无调用模块，或重命名并严格隔离仍需保留的旧 SSO/微信桥。

交付物：引用审计、兼容性说明和移除后的回归报告。

## 10. 风险与处理

| 风险 | 处理 |
|---|---|
| user code 被枚举 | 足够码空间、短 TTL、IP/账号/设备多维限速、统一错误页 |
| 轮询形成服务端压力 | interval + slow_down、客户端抖动、全局并发限制 |
| 两套登录实现 claims 漂移 | 两种 grant 共用 token service，并增加 claims 等价性测试 |
| 设备授权钓鱼 | 确认页展示 client/scope/device，要求明确批准，提供安全提示 |
| Sandbox 证据泄密 | 只传验证状态，结构化脱敏，封存前 canary/secret scan |
| 老服务不兼容 | discovery 能力检测；隐藏设备码入口，保留默认 Authorization Code + PKCE |
| 数据库并发导致重复兑换 | 行锁/条件更新事务，唯一消费约束，并发集成测试 |
| 客户端退出后继续轮询 | AbortController、生命周期统一清理、退出测试 |

## 11. 当前协作状态

ai-dev 维护任务已确认现有 OIDC Provider 可以复用公共客户端、PKCE、数据库和 RS256 token service。截至本文创建时，服务端正在实现 discovery、设备授权签发、浏览器确认/拒绝、RFC token 轮询、一次性兑换、哈希存储、TTL、轮询退避和审计；最终完成状态以协作任务的测试报告和部署结果为准。
