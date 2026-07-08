# OpenDrSai Windows 登录功能开发计划

本文档用于指导 OpenDrSai Windows 桌面端完整登录功能开发。目标用户流程是：

```text
用户点击登录 -> 打开 AI 平台/IHEP SSO 浏览器认证 -> HAI OIDC 签发授权码和 token
-> 桌面端 loopback callback 收到授权码 -> 桌面端换取并验证 token
-> OpenDrSai 使用 HAI access token 调用后续 API -> 用户可刷新会话或退出登录
```

参考设计文档：

- `apps/desktop/windows/docs/login_plan/oidc-login-plan.md`

涉及仓库：

- `C:\Users\win11\VSProjects\drsai`
- `C:\Users\win11\VSProjects\hai-ai-platform-backend`

后端改动原则：

- `hai-ai-platform-backend` 只做最小必要改动。
- 后端改动主要集中在 `backend/webui/oidc`。
- OpenDrSai Windows 侧承担主要登录体验、token 验证、存储、刷新、退出、测试闭环。

## 功能范围

本期明确实现 8 个功能。

### F1. AI 平台 OIDC Discovery

桌面端根据配置的 issuer 读取：

```text
{issuer}/.well-known/openid-configuration
```

必须使用 discovery 返回的：

- `authorization_endpoint`
- `token_endpoint`
- `jwks_uri`
- `revocation_endpoint`，如果存在

验收标准：

- discovery 返回的 `issuer` 必须与配置 issuer 完全一致。
- discovery 缺失必要端点时登录失败并显示可重试错误。
- 本地 E2E 能证明 discovery endpoint 被访问。

### F2. 浏览器登录跳转

用户在 Windows 登录页点击 IHEP SSO/AI 平台登录后，桌面端打开系统浏览器到 discovery 返回的授权端点。

授权请求必须包含：

- `client_id=opendrsai-desktop`
- `response_type=code`
- `redirect_uri=http://127.0.0.1:{port}/callback`
- `scope=openid email profile roles groups hai_api`
- `offline_access`，仅在用户选择保持登录时添加
- `code_challenge`
- `code_challenge_method=S256`
- `state`
- `nonce`

验收标准：

- 点击登录后进入浏览器认证。
- 同一时间只有一个 pending OIDC 登录。
- 用户可以取消 pending 登录。

### F3. Loopback Callback 与授权码交换

桌面端启动临时 `127.0.0.1` callback server 接收 AI 平台重定向。

验收标准：

- 只接受 `/callback` 路径。
- `state` 不匹配时拒绝。
- callback error 参数能显示为登录失败。
- 成功后使用授权码和 PKCE verifier 调 token endpoint。
- callback server 在成功、失败、取消、超时后关闭。

### F4. Token 验证与用户会话创建

桌面端收到 token 后必须验证：

- JWT 格式有效。
- header `alg` 是 `RS256`。
- 根据 JWKS 验证 ID token 和 access token 签名。
- `iss` 等于配置 issuer。
- ID token `aud` 包含 desktop client id。
- access token `aud` 包含 `hai-api`。
- token 未过期。
- 首次登录时 ID token `nonce` 等于发起登录时的 nonce。

验收标准：

- 签名错误、issuer 错误、audience 错误、nonce 错误、过期 token 都不能创建会话。
- 会话 user 字段来自 OIDC claims。
- public session 不暴露 raw token。

### F5. 安全 token 存储

raw tokens 只允许在主进程持有和存储。

验收标准：

- `accessToken`、`refreshToken`、`idToken` 使用 Electron `safeStorage` 加密后写入 session 文件。
- public renderer session 只包含认证状态、用户信息、过期时间、authMode、authProvider。
- renderer localStorage 不保存 token。
- logout 后 session 文件被清理。

### F6. 自动刷新与后续 API Bearer

桌面端后续 chat/agent/API 请求必须使用 OIDC access token。

验收标准：

- `requireAuthContext()` 能读取并按需刷新 OIDC 会话。
- access token 接近过期时通过 refresh token 换新 token。
- refresh token 被撤销或过期时回到未登录状态。
- chat 和 agent run 请求带：
  - `Authorization: Bearer <access_token>`
  - `X-OpenDrSai-Auth-Mode: oidc`
  - metadata `auth_mode=oidc`

### F7. 退出登录与 refresh token 撤销

用户退出登录时，桌面端先 best-effort 调用 OIDC revocation endpoint 撤销 refresh token，再清理本地凭证。

验收标准：

- revocation endpoint 可用时收到 refresh token revoke 请求。
- revoke 失败不能阻止本地退出。
- 本地 session 文件被删除。
- 退出后 `getAuthSession()` 返回 anonymous session。

### F8. 跨仓库联调与验收

OpenDrSai Windows 和 HAI backend 必须协同测试。

验收标准：

- 本地 fake OIDC issuer E2E 覆盖完整主流程。
- HAI OIDC discovery/JWKS/authorize/token/revoke 行为与桌面端 expectations 对齐。
- 真实环境最终验收需使用：
  - `https://aidev.ihep.ac.cn/backend`
  - IHEP SSO 可用账号
  - Windows 桌面端浏览器登录

## 开发任务清单

本期拆分为 24 个原子开发任务。

### T01. 移动并归档原始 OIDC 规划

仓库：`drsai`

范围：

- 将 `apps/desktop/windows/docs/oidc-login-plan.md` 移动到：
  `apps/desktop/windows/docs/login_plan/oidc-login-plan.md`

验证：

- 旧路径不存在。
- 新路径存在且内容完整。

### T02. 定义桌面端 OIDC API 类型

仓库：`drsai`

范围：

- `apps/desktop/windows/src/shared/desktopApi.ts`

任务：

- 扩展 `AuthSession.authMode` 支持 `oidc`。
- 扩展 `authProvider` 支持 `hai`。
- 增加 `startOidcLogin(request?: { rememberMe?: boolean })`。
- 增加 `cancelOidcLogin()`。

验证：

- `npm run typecheck`

### T03. 暴露 preload IPC

仓库：`drsai`

范围：

- `apps/desktop/windows/src/preload/index.ts`

任务：

- 暴露 `desktop:start-oidc-login`。
- 暴露 `desktop:cancel-oidc-login`。

验证：

- `npm run typecheck`
- `npm run verify:oidc-login`

### T04. 注册主进程 IPC

仓库：`drsai`

范围：

- `apps/desktop/windows/src/main/index.ts`

任务：

- 注册 `desktop:start-oidc-login`。
- 注册 `desktop:cancel-oidc-login`。
- 复用现有 `secureHandle` sender 校验。

验证：

- `npm run typecheck`
- `npm run verify:oidc-login`

### T05. 实现 OIDC discovery client

仓库：`drsai`

范围：

- `apps/desktop/windows/src/main/auth.ts`

任务：

- 从 `OPENDRSAI_OIDC_ISSUER` 读取 issuer。
- fallback 到 `HAI_OIDC_ISSUER`。
- fallback 到 `https://aidev.ihep.ac.cn/backend`。
- 请求 `.well-known/openid-configuration`。
- 校验 discovery issuer。
- 缓存 metadata。

验证：

- `npm run verify:oidc-login`
- `npm run verify:e2e-oidc-login`

### T06. 实现 PKCE/state/nonce 生成

仓库：`drsai`

范围：

- `apps/desktop/windows/src/main/auth.ts`

任务：

- 使用高熵随机 verifier。
- 生成 S256 challenge。
- 生成 state。
- 生成 nonce。

验证：

- `npm run verify:oidc-login`

### T07. 实现 loopback callback server

仓库：`drsai`

范围：

- `apps/desktop/windows/src/main/auth.ts`

任务：

- 监听 `127.0.0.1` 随机端口。
- callback 路径固定为 `/callback`。
- 校验 state。
- 提取 authorization code。
- 处理 error/error_description。
- 实现超时、关闭、取消。

验证：

- `npm run verify:e2e-oidc-login`

### T08. 实现浏览器跳转登录

仓库：`drsai`

范围：

- `apps/desktop/windows/src/main/auth.ts`

任务：

- 拼装授权 URL。
- 使用 discovery authorization endpoint。
- 调 `shell.openExternal()` 打开浏览器。
- 支持取消旧 pending login。

验证：

- `npm run verify:oidc-login`
- 真实环境手工验收：点击登录后浏览器进入 AI 平台/IHEP SSO。

### T09. 实现 token endpoint 交换

仓库：`drsai`

范围：

- `apps/desktop/windows/src/main/auth.ts`

任务：

- authorization code grant。
- refresh token grant。
- 解析 FastAPI/OAuth error response。
- 错误信息包含 auth service URL。

验证：

- `npm run verify:e2e-oidc-login`

### T10. 实现 JWKS + RS256 验签

仓库：`drsai`

范围：

- `apps/desktop/windows/src/main/auth.ts`

任务：

- 读取 discovery `jwks_uri`。
- 缓存 JWKS。
- 根据 JWT `kid` 选择 JWK。
- 使用 Node crypto 验 RS256 签名。
- `kid` cache miss 时重新拉取 JWKS。

验证：

- `npm run verify:oidc-login`
- `npm run verify:e2e-oidc-login`

### T11. 实现 OIDC claims 校验

仓库：`drsai`

范围：

- `apps/desktop/windows/src/main/auth.ts`

任务：

- 校验 `iss`。
- 校验 ID token `aud`。
- 校验 access token `aud=hai-api`。
- 校验 `exp`。
- 校验首次登录 `nonce`。

验证：

- `npm run verify:oidc-login`

### T12. 创建 OIDC session

仓库：`drsai`

范围：

- `apps/desktop/windows/src/main/auth.ts`

任务：

- 从 token claims 提取用户 ID、邮箱、名称、头像、角色。
- 设置 `authMode=oidc`。
- 设置 `authProvider=hai`。
- 记录 access token 过期时间。
- 根据 rememberMe 决定是否保存 refresh token。

验证：

- `npm run verify:e2e-oidc-login`

### T13. 实现 token 安全存储

仓库：`drsai`

范围：

- `apps/desktop/windows/src/main/auth.ts`

任务：

- 用 Electron `safeStorage` 加密 token。
- 写入 `encryptedAccessToken`。
- 写入 `encryptedRefreshToken`。
- 写入 `encryptedIdToken`。
- 兼容旧 plaintext session 读取。
- public session 不返回 raw token。

验证：

- `npm run verify:e2e-oidc-login`

### T14. 实现自动刷新

仓库：`drsai`

范围：

- `apps/desktop/windows/src/main/auth.ts`

任务：

- `getAuthSession()` 按需刷新。
- `refreshAuthSession()` 强制刷新。
- `requireAuthContext()` 请求前刷新。
- refresh 失败且 access token 已过期时清理 session。

验证：

- `npm run verify:e2e-oidc-login`

### T15. 实现 logout revoke

仓库：`drsai`

范围：

- `apps/desktop/windows/src/main/auth.ts`

任务：

- logout 前读取当前 OIDC refresh token。
- 调 discovery `revocation_endpoint`。
- 发送 `token_type_hint=refresh_token`。
- revoke 失败仍本地清理。

验证：

- `npm run verify:e2e-oidc-login`

### T16. 登录 UI 改为 AI 平台/IHEP SSO 主路径

仓库：`drsai`

范围：

- `apps/desktop/windows/src/renderer/src/auth/LoginScreen.tsx`

任务：

- 默认登录模式为 `oidc`。
- 主按钮文案为 IHEP SSO/AI 平台登录。
- 保留 API key 登录 fallback。
- 保留账号密码占位或兼容路径。
- pending 时显示取消登录。

验证：

- `npm run verify:ui`
- `npm run verify:mojibake`

### T17. AuthProvider 接入 OIDC

仓库：`drsai`

范围：

- `apps/desktop/windows/src/renderer/src/auth/AuthProvider.tsx`

任务：

- 提供 `startOidcLogin()`。
- 提供 `cancelOidcLogin()`。
- 管理 busy/message/session 状态。

验证：

- `npm run typecheck`
- `npm run verify:ui`

### T18. Mock desktop API 支持 OIDC

仓库：`drsai`

范围：

- `apps/desktop/windows/src/renderer/src/mockDesktopApi.ts`

任务：

- mock `startOidcLogin()`。
- mock `cancelOidcLogin()`。
- mock session 使用 `authMode=oidc`、`authProvider=hai`。

验证：

- `npm run verify:ui`

### T19. 后续请求使用 OIDC bearer token

仓库：`drsai`

范围：

- `apps/desktop/windows/src/main/chat.ts`
- `apps/desktop/windows/src/main/agentRuns.ts`

任务：

- 通过 `requireAuthContext()` 获取 access token。
- 请求 header 添加 `Authorization: Bearer <access_token>`。
- 请求 header 添加 `X-OpenDrSai-Auth-Mode`。
- metadata 添加 `auth_mode`。

验证：

- `npm run verify:oidc-login`
- fake gateway/E2E 后续可扩展验证收到 bearer header。

### T20. 新增 OIDC contract verifier

仓库：`drsai`

范围：

- `apps/desktop/windows/scripts/verify-oidc-login.mjs`
- `apps/desktop/windows/package.json`

任务：

- 增加 `npm run verify:oidc-login`。
- 检查 OIDC API、IPC、PKCE、loopback、discovery、JWKS、token storage、logout revoke、bearer request path。

验证：

- `npm run verify:oidc-login`

### T21. 新增 OIDC E2E smoke

仓库：`drsai`

范围：

- `apps/desktop/windows/scripts/verify-e2e-oidc-login.mjs`
- `apps/desktop/windows/src/main/index.ts`
- `apps/desktop/windows/src/main/e2eSmoke.ts`
- `apps/desktop/windows/package.json`

任务：

- 启动 fake OIDC issuer。
- fake issuer 支持 discovery、authorize、token、JWKS、revoke。
- fake issuer 使用 RS256/JWKS。
- Electron main process 执行 OIDC 登录。
- 验证 session restore。
- 验证 refresh。
- 验证 `requireAuthContext()` 有 OIDC bearer token。
- 验证 safeStorage 加密字段。
- 验证 logout revoke 和本地清理。

验证：

- `npm run build`
- `npm run verify:e2e-oidc-login`

### T22. HAI backend 修正 upstream login 路径

仓库：`hai-ai-platform-backend`

范围：

- `backend/webui/oidc/service.py`

任务：

- 未登录访问 `/oauth2/authorize` 时，跳转到：
  `{OIDC_ISSUER}/oauth2/upstream/ihep/login?request_id=...`
- 避免生产路径 `/backend` 被相对 URL 丢失。

验证：

- `python -m py_compile backend\webui\oidc\service.py`
- HAI unit test：`test_authorize_uses_issuer_for_upstream_login`

### T23. HAI OIDC unit test 覆盖

仓库：`hai-ai-platform-backend`

范围：

- `backend/webui/test/apps/webui/oidc/test_oidc_unit.py`

任务：

- 增加 upstream login absolute issuer test。
- 保留 redirect URI dynamic port test。
- 保留 PKCE requirement test。

验证：

- `python -m py_compile backend\webui\test\apps\webui\oidc\test_oidc_unit.py`
- 能配置好 Python 依赖后运行：
  `python -m pytest backend\webui\test\apps\webui\oidc\test_oidc_unit.py -q`

### T24. 真实环境联调验收

仓库：两个仓库协同

前置条件：

- HAI backend 部署 `feature/oidc_auth` 或包含同等 OIDC 能力。
- `HAI_OIDC_ISSUER=https://aidev.ihep.ac.cn/backend`。
- IHEP SSO callback 注册：
  `https://aidev.ihep.ac.cn/backend/oauth2/upstream/ihep/callback`
- 默认 desktop client 存在：
  `opendrsai-desktop`
- Windows 端设置：
  `OPENDRSAI_OIDC_ISSUER=https://aidev.ihep.ac.cn/backend`

测试步骤：

1. 启动 HAI backend。
2. 验证 discovery：
   `GET https://aidev.ihep.ac.cn/backend/.well-known/openid-configuration`
3. 验证 JWKS：
   `GET https://aidev.ihep.ac.cn/backend/.well-known/jwks.json`
4. 启动 OpenDrSai Windows app。
5. 点击 IHEP SSO/AI 平台登录。
6. 浏览器跳到 AI 平台/IHEP。
7. 完成认证。
8. 浏览器返回 `127.0.0.1:{port}/callback`。
9. 桌面端显示已登录用户。
10. 发送一次 chat/agent 请求，确认 HAI/API 收到 bearer token。
11. 重启桌面端，确认 session restore。
12. 强制 refresh，确认 token 更新。
13. 点击退出，确认 revoke 和本地清理。

验收标准：

- 登录成功。
- 用户身份正确。
- token 验签通过。
- 后续 API 请求可用。
- refresh 可用。
- logout 可用。
- 失败场景有可读错误信息。

## 运行与测试计划

### OpenDrSai Windows 本地命令

工作目录：

```text
C:\Users\win11\VSProjects\drsai\apps\desktop\windows
```

必须运行：

```powershell
npm run typecheck
npm run build
npm run verify:oidc-login
npm run verify:e2e-oidc-login
npm run verify:ui
npm run verify:mojibake
```

建议运行：

```powershell
npm run verify
```

当前已知：`npm run verify` 可能仍有非登录历史门禁失败，需要单独处理，不作为 OIDC 登录功能阻断项。

### HAI Backend 本地命令

工作目录：

```text
C:\Users\win11\VSProjects\hai-ai-platform-backend
```

必须运行：

```powershell
$env:PYTHONPYCACHEPREFIX='C:\Users\win11\VSProjects\drsai\.tmp\pycache-hai'
python -m py_compile backend\webui\oidc\service.py backend\webui\test\apps\webui\oidc\test_oidc_unit.py
```

依赖完整后运行：

```powershell
python -m pytest backend\webui\test\apps\webui\oidc\test_oidc_unit.py -q
```

### 跨仓库联调

联调分三层：

1. OpenDrSai fake issuer E2E：
   `npm run verify:e2e-oidc-login`
2. HAI backend OIDC 单测：
   `python -m pytest backend\webui\test\apps\webui\oidc\test_oidc_unit.py -q`
3. 真实 AI 平台/IHEP 浏览器登录：
   手工执行 T24。

## 完成定义

登录功能可以标记为完成，必须同时满足：

- F1-F8 全部实现。
- T01-T23 通过本地验证。
- T24 在真实环境通过。
- Windows 端没有 raw token 暴露到 renderer public session。
- logout 会 best-effort revoke refresh token。
- 后续 chat/agent/API 请求使用 OIDC bearer token。
- HAI backend 改动保持在 oidc 范围内，且不破坏现有登录。

## 当前外部阻塞项

以下不是代码实现项，但会影响最终真实验收：

- 需要可用的 `https://aidev.ihep.ac.cn/backend` 部署。
- 需要可用的 IHEP SSO 测试账号。
- 需要确认 IHEP SSO callback 已注册。
- 当前本机 HAI pytest 环境依赖不完整时，pytest 可能超时或无法完成。
- 当前本机 `electron-builder --dir` 可能因 Visual Studio Build Tools 缺 Spectre mitigated libraries 而无法完成 unpack 构建。
