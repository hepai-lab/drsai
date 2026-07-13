# OIDC 模型服务凭证实施计划

## 目标

OpenDrSai 用户完成 HAI OIDC 登录后，不再要求单独配置 `HEPAI_API_KEY`。桌面端将有效的 OIDC access token 传给本地 DrSai Gateway，Gateway 以请求级凭证上下文驱动 Agent 和 HepAI 模型客户端，最终调用 HAI-DDF `/apiv2`。

开发环境使用：

- OIDC issuer：`https://ai-dev.ihep.ac.cn/api`
- 模型服务：`https://ai-dev.ihep.ac.cn/apiv2/v1`

产品环境使用：

- OIDC issuer：`https://ai.ihep.ac.cn/api`
- 模型服务：`https://ai.ihep.ac.cn/apiv2/v1`

环境变量只用于显式部署覆盖。token 不进入 Renderer、日志、数据库、Agent 状态或进程环境变量。

## 请求链路

```text
Renderer
  -> Electron Main AuthSession.getValidAccessToken()
  -> local Gateway /v1/chat/completions
     Authorization: Bearer <OIDC access token>
     X-OpenDrSai-Gateway-Token: <local instance secret>
  -> Gateway validates local caller and builds request credential context
  -> cached Agent reads current request credential dynamically
  -> HepAI model client calls /apiv2 with the OIDC Bearer token
  -> HAI-DDF validates issuer, signature, audience, type, expiry and permission
```

## 安全不变量

- Renderer API 和状态中没有 raw token。
- 本地 Gateway 只监听 loopback，并用随机实例密钥验证 Electron 调用方。
- OIDC token 只保存于 Electron `safeStorage` 和一次运行的内存上下文。
- 不允许用 `os.environ["HEPAI_API_KEY"]` 传递 OIDC token。
- 缓存 Agent 不永久持有首次请求 token；每次模型调用读取当前 run 凭证。
- HAI Backend access token 必须携带 `umt_id`；DDF 使用该 claim 映射自身用户，不能把 Backend `sub` 当作 DDF 用户主键。
- 401 最多刷新并重试一次；403 不刷新。
- 所有日志、SSE、异常和测试输出必须脱敏。

## 功能清单

- [x] F1 Electron 请求前保证 OIDC access token 有效。
- [x] F2 Electron 与本地 Gateway 之间有实例级调用认证。
- [x] F3 Gateway 建立并清理请求级 OIDC 凭证上下文。
- [x] F4 Gateway 对请求身份字段和 token subject 做一致性约束。
- [x] F5 模型客户端动态读取请求凭证，不依赖全局环境变量。
- [x] F6 开发/产品模型服务地址自动选择且可安全覆盖。
- [x] F7 缓存 Agent、子 Agent、规划器和工具模型继承当前凭证。
- [x] F8 `/apiv2` 验证 HAI OIDC access token 与模型权限。
- [x] F9 401 token 过期触发一次刷新重试，403 直接报告权限不足。
- [x] F10 Gateway/SSE/Renderer 贯通结构化、脱敏错误。
- [x] F11 API key 模式作为显式备用来源继续可用。
- [x] F12 本地 fake、Electron E2E 和远端真实 `/apiv2` 联调通过。

## 原子开发任务

- [x] T01 定义 Electron、Gateway、HAI-DDF 共用的认证与错误契约。
- [x] T02 Electron 启动 Gateway 时生成 256-bit 随机实例密钥，只通过子进程环境传入。
- [x] T03 chat、agent run、models probe 请求携带 Gateway 实例密钥。
- [x] T04 Gateway 中间件使用恒定时间比较实例密钥并拒绝未授权调用。
- [x] T05 定义 `PlatformAuthContext` 和 `ContextVar` 生命周期。
- [x] T06 解析 Bearer token 的非秘密 claims，用 `sub` 绑定 user id，并记录 expires-at。
- [x] T07 将凭证上下文传入 Agent run，确保 finally 清理。
- [x] T08 定义 `ModelCredentialProvider`，实现 OIDC、静态 key 和环境变量来源。
- [x] T09 改造 OpenAI 与 Anthropic HepAI 客户端的 base URL 和 authorization 获取方式。
- [x] T10 改造 Agent 缓存，防止 token 固化或跨用户复用。
- [x] T11 检查子 Agent、规划器和工具调用的独立模型客户端并接入 provider。
- [x] T12 Electron 实现结构化 401 判断、强制刷新和单次安全重试。
- [x] T13 SSE parser 和 Renderer 展示 token_expired、invalid_token、model_forbidden、quota_exceeded。
- [x] T14 HAI-DDF 实现 HAI OIDC JWT 校验和权限决策。
- [x] T14a HAI Backend authorization-code 与 refresh grant 新签发 token 均包含非空 `umt_id`。
- [x] T15 增加 canary token 脱敏测试和并发用户隔离测试。
- [x] T16 增加 fake `/apiv2` 集成测试，验证 header、base URL、401/403/429。
- [x] T17 增加 Electron OIDC -> local Gateway -> fake `/apiv2` E2E。
- [x] T18 在 `zzd_3090_via_chat_ihep` 运行真实 access token 联调。
- [x] T19 更新配置、部署和故障排查文档。
- [x] T20 完成逐项审计，只有 F1-F12 和 T01-T19 均有证据时才标记完成。

## 错误契约

```json
{
  "error": {
    "code": "token_expired",
    "message": "Your HepAI session expired.",
    "retryable": true,
    "request_id": "..."
  }
}
```

错误码：

- `token_expired`：Electron 强制刷新后重试一次。
- `invalid_token`：清除登录并要求重新认证。
- `model_forbidden`：不刷新，提示当前账号无模型权限。
- `model_not_found`：提示更换模型。
- `quota_exceeded`：提示额度或并发限制。
- `upstream_unavailable`：保留登录状态，可稍后重试。
- `gateway_unauthorized`：本地实例认证失败，重启 Gateway。

## 验收证据

每个勾选项必须至少对应一个代码引用和一个自动化测试。最终验收要求：

1. `npm run typecheck`、Windows OIDC/chat/gateway verifiers 通过。
2. Python 单元测试覆盖 ContextVar 生命周期、并发隔离和 credential provider。
3. Electron E2E 捕获 fake `/apiv2` 请求并证明使用 OIDC Bearer token。
4. 测试 token 不出现在日志、SSE、Renderer 或持久化文件。
5. 远端 HAI-DDF 测试通过，并用真实开发环境完成一次流式模型响应。
6. 开发构建不访问生产模型域名；正式构建不默认访问开发域名。

## 当前验收状态（2026-07-12）

- 本地 `npm run verify` 通过。
- 平台认证单元测试 9 项通过，覆盖并发隔离、动态重绑、静态 key fallback、双协议地址、真实 OpenAI 客户端 Bearer 转发和错误脱敏。
- Electron chat、agent run、OIDC E2E 均通过。
- OIDC Electron E2E 会将 chat 与 agent 请求继续转发到独立 fake `/apiv2`，并断言两次下游调用均携带 Bearer token；测试诊断不保存完整 Authorization。
- 远端 Backend OIDC 9 项、DDF OIDC 12 项通过；公开 OIDC token 调用 `/apiv2/v1/models` 返回 200。
- OpenAI `/apiv2/v1` 与 Anthropic `/apiv2/anthropic` 均确认接入同一 OIDC authorizer。
- 远端 DDF 流终止逻辑测试 2 项通过：正常 EOF 补发一次 `[DONE]`，上游已有 `[DONE]` 时去重。
- 使用本机安全存储中的真实开发环境 OIDC 会话完成联调：`/apiv2/v1/models` 返回 200，规范模型名 `deepseek-ai/deepseek-v4-pro` 的 chat 返回 200 和 `text/event-stream`，同时检测到内容事件与且仅一次 `[DONE]`；验证器不输出 token 或响应内容。
