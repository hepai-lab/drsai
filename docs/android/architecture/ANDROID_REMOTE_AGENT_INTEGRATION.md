# Android 远程智能体实现

状态：**最小 MVP 已实现（2026-07-14）**。

## 目标与边界

Android 复用 Windows App 已采用的 HAI Native API，不复制智能体私有配置，也不新增 `/api/mobile/v1`。OIDC Access Token 只发送给构建时指定的 HAI HTTPS 域名；平台在服务端解析用户身份、目录权限和智能体运行凭据。

本版包含：

- 合并 Android 本机 OpenDrSai 与 HAI 平台智能体目录；
- 选择一个智能体创建新会话；
- 会话永久绑定 `agentId`、名称和来源；
- 平台智能体 SSE 对话、停止、错误提示和 Token 过期刷新；
- 按用户隔离的平台公开目录缓存；
- 不可用或没有 `chat` 能力的智能体可见但不可发送。

本版不包含平台智能体并行编排、远程附件、交互式 input request、跨设备历史同步和服务端停止接口。

## 接口与路由

```text
GET  {HAI_BASE_URL}/api/native/v1/agents?refresh=false
POST {HAI_BASE_URL}/api/native/v1/agents/{platformId}/chat
Authorization: Bearer <OIDC access token>
```

客户端同时兼容 Native V1 当前结构 `data.agents + capabilities[]` 和早期扁平结构。目录只读取公开字段：ID、名称、描述、模式、可用状态、默认状态、能力、Logo 和示例。

发送消息时：

```text
agentSource == local    → Kotlin LocalAgentRuntime → /apiv2/v1/chat/completions
agentSource == platform → PlatformAgentRuntime    → /api/native/v1/agents/{id}/chat
```

平台返回 OpenAI 兼容 `choices[0].delta.content` SSE，`data: [DONE]` 结束。Android 过滤 JSON `null`，流异常断开时保留已收到文本并显示失败状态。用户停止时取消当前 HTTP Call，服务端通过断连回收执行。

## 身份与安全

- 使用现有 HepAI OIDC Authorization Code + PKCE 登录；
- 401 仅在 Native API 明确返回 `token_expired` 时刷新一次并重试；
- `invalid_token`、权限不足、智能体不存在、能力不支持、凭据异常和额度错误分别映射为用户可理解的提示；
- 不把平台智能体 API Key、私有 URL 或执行配置写入 Android 数据库；
- OkHttp 禁止自动跟随跨域重定向，Release/MVP 禁止明文 HTTP。

## 本地数据

Room 数据库升级到 v3：

- `conversations` 新增 `agentName`、`agentSource`；
- 旧 `opendrsai-android` 会话迁移为 `local:opendrsai`；
- 新增以 `(agentId, userId)` 为联合主键的 `agent_catalog`；
- 找不到原智能体的历史会话仍可查看，但禁止继续发送，避免静默切换运行时。

## UI

侧栏顶部显示智能体列表和刷新按钮，其下保留本机会话历史。每个智能体显示运行位置或不可用原因；欢迎语、消息作者、输入框占位和个人中心 Runtime 会随当前智能体变化。顶部悬浮栏保持原来的三个控制项，不增加 Logo 或智能体控件。

## 验证结果

- Android JVM 单元测试通过：目录结构、能力门控、OIDC 单次刷新、SSE `null` 过滤、错误映射、远程回复流式落库和请求路径；
- `lintDebug` 通过；
- Android API 35 模拟器 8 项设备测试通过（包含 v2→v3 数据迁移）；
- R8 压缩的 `assembleMvp` 构建通过；
- APK 已安装并在模拟器启动；登录页目视检查通过。

真实账号的“授权回跳 → 刷新平台目录 → 选择可对话智能体 → 流式对话”闭环已由测试人员验证成功。Android v1.4.5 发布构建使用生产地址 `https://ai.ihep.ac.cn`；自动化不读取或代填真实登录凭据。
