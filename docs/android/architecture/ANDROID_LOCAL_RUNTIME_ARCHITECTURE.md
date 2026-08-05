# OpenDrSai Android 本地 Kotlin Agent Runtime

## HAI 开发环境联调状态（2026-07-14）

- 开发环境基础地址：`https://ai-dev.ihep.ac.cn`。
- Android OIDC issuer：`https://ai-dev.ihep.ac.cn/api`。
- HAI 已注册 `opendrsai-android` Public Client，原生回调精确为
  `ai.drsai.remote:/oauth2redirect`，要求 PKCE S256 并允许 Refresh Token。
- Android 构建通过 `OPENDRSAI_ANDROID_HAI_BASE_URL` 同时切换 OIDC 和模型 API；未设置时仍默认生产环境。
- HAI 下游客户端回调与 IHEP 上游回调是两层地址：Android 回调是
  `ai.drsai.remote:/oauth2redirect`；IHEP `client_id=13388` 实际登记并必须继续使用
  `https://ai-dev.ihep.ac.cn/umt/callback`。
- 开发环境实测链路为 HAI authorize `307` → HAI upstream login `307` →
  `newlogin.ihep.ac.cn` 接受 `/umt/callback` 并显示统一认证登录页；无
  `invalid_client`、`redirect_uri_mismatch` 或 Android redirect URI 宽松匹配。
- HAI OIDC 聚焦测试 `16 passed`；Android 单元测试、Lint、R8/MVP 构建及模拟器 7 项设备测试通过。
- 尚需测试人员在系统浏览器输入真实 IHEP 凭据，完成授权、App 回跳、Token exchange、模型列表和首轮对话的人工闭环；自动化不得读取或代填用户凭据。

## 产品定位

Android 最小 MVP 在手机本机运行精简 Agent 编排，模型推理由 HAI 云端完成。它不依赖 Windows、OpenDrSai WebUI 后端或 `opendrsai.ihep.ac.cn`。

```text
HAI OIDC（ai.ihep.ac.cn/api）
→ Android Kotlin Agent Runtime
→ HAI OpenAI 兼容模型 API（ai.ihep.ac.cn/apiv2/v1）
→ Room 本地会话和记忆
```

## MVP 能力

- Authorization Code + PKCE、state、nonce、JWKS 和 RS256 Token 校验；
- 授权完成后从系统浏览器自动返回 OpenDrSai；
- Access Token 加密存储、401 自动刷新和注销撤销；
- 自动读取当前账号可用模型，优先 DeepSeek V4 Pro；
- 一个内置 OpenDrSai Agent；
- HAI SSE 流式回答；
- 标准 Function Calling 循环；
- 当前时间、保存本地记忆、查询本地记忆三个安全工具；
- 一个并发 Run，停止、失败重试和退后台暂停；
- 按 OIDC 用户隔离的本机会话、消息和记忆；
- 本机历史、新对话、深色模式和可安装 APK。

第一版不支持 Shell、任意文件、任意网络工具、浏览器自动化、Python、MCP 子进程、本地模型、多 Agent、后台常驻和跨设备历史同步。

## Runtime 安全与资源限制

- 最近最多 20 条消息、32,000 字符上下文；
- 每个用户请求最多 8 个模型轮次；
- 每轮最多 5 个工具调用，顺序执行；
- 工具输出最多 4,096 字符；
- 记忆内容 1–500 字符，查询词最多 100 字符，返回 1–10 条；
- 模型不支持 tools 时自动降级为纯对话并提示；
- Activity 进入后台立即取消网络流并将消息标记为 paused；
- 不记录 Authorization、Cookie、Access Token 或 Refresh Token。

## 数据与网络

Room v2 使用本地 UUID，并按 userId 隔离 Conversation。旧版服务器数字 ID 缓存会在首次升级时清除。退出登录保留该用户的本机历史，其他账号无法读取。

Release 只访问：

```text
https://ai.ihep.ac.cn/api/.well-known/openid-configuration
https://ai.ihep.ac.cn/api/oauth2/*
https://ai.ihep.ac.cn/apiv2/v1/models
https://ai.ihep.ac.cn/apiv2/v1/chat/completions
```

Release 禁止明文流量，不包含 `/api/mobile/v1`、WebSocket 或可编辑服务器地址。

## OIDC 浏览器回调与多设备方案

### 正式方案：Android 原生回调

所有 Android 安装实例共用一个 Public Client 和一个回调 URI，不为每台手机分配地址：

```text
client_id: opendrsai-android
redirect_uri: ai.drsai.remote:/oauth2redirect
grant: authorization_code + PKCE(S256)
```

HAI 的授权响应返回发起登录的浏览器；Android 再把 URI 分发给同一台手机上的 OpenDrSai。因此 N 台手机可以
使用相同回调。每次登录由各设备独立生成 `state`、`nonce` 和 PKCE verifier；授权码只能由持有对应 verifier
的设备兑换，不在回调 URI 中携带设备 ID、IMEI 或序列号。

为允许授权期间发生进程回收，原生登录事务必须加密持久化：`client_id`、`redirect_uri`、`state`、`nonce`、
PKCE verifier 和创建时间。深链唤醒新进程后加载事务，先严格匹配 scheme/path、state 和五分钟有效期，再兑换
Token；成功、失败或取消后立即删除事务。Access Token、Refresh Token 继续按设备保存在 Android Keystore。

同一账号在多设备并发登录时：

- 手机 A 的 `state/verifier` 只匹配 A 的回调；
- 手机 B 的 `state/verifier` 只匹配 B 的回调；
- 回调不需要服务端选择设备；
- 单设备注销只撤销该设备 Refresh Token，全局注销需由 HAI 另行提供。

长期优先将回调升级为经过域名归属验证的 Android App Link；自定义 Scheme 仍必须使用 PKCE，降低同设备其他
App 抢占 Scheme 后截获授权码的风险。

### HAI 配置契约与当前状态

2026-07-14 实时探测结果：`opendrsai-android` 返回 `invalid_client: Unknown client_id`；现有
`opendrsai-desktop` 接受随机 loopback 端口。因此 HAI 管理员仍需注册上述 Android Public Client，并允许
完整 redirect URI；不得为 Public Client 配置或在 APK 内放置 client secret。

客户端在 HAI 配置生效前保留兼容模式：

```text
client_id: opendrsai-desktop
redirect_uri: http://127.0.0.1:{random_port}/callback
```

兼容模式只用于避免现有版本立即失去登录能力。它依赖 App 进程中的临时本地端口，在真机后台回收、VPN、代理
或五分钟超时下可能失败，不作为 Android 正式回调方案。HAI 注册完成后，通过构建参数启用原生模式：

```powershell
$env:OPENDRSAI_ANDROID_OIDC_CLIENT_ID="opendrsai-android"
$env:OPENDRSAI_ANDROID_OIDC_REDIRECT_URI="ai.drsai.remote:/oauth2redirect"
$env:OPENDRSAI_ANDROID_HAI_BASE_URL="https://ai-dev.ihep.ac.cn"
```

验收项：

- [x] 客户端支持原生深链与 loopback 兼容模式；
- [x] 原生事务加密持久化，可在进程重建后继续；
- [x] 回调严格校验 redirect URI、state、nonce、PKCE、issuer、audience、签名和有效期；
- [ ] HAI 注册 `opendrsai-android` Public Client；
- [ ] 在至少两台不同品牌真机上并发登录验证；
- [ ] 正式构建切换到原生回调并移除 loopback 兼容模式。

## 完成标准

1. APK 可在 Android 8+ 安装；
2. 真实 HAI 账号登录、浏览器自动回跳、刷新和注销正常；
3. 可用模型加载成功并完成三轮流式对话；
4. 三个本地工具均能完成模型调用闭环；
5. 停止、网络失败、后台暂停和重试正常；
6. 杀进程后恢复本机历史且账号间数据隔离；
7. 单元测试、Lint、设备测试、R8 和签名检查全部通过；
8. APK 小于 30 MB，前台对话 PSS 目标小于 150 MB；
9. 网络记录中不存在 `opendrsai.ihep.ac.cn` 或 `/mobile/v1`。

产物名称：`OpenDrSai-Android-v{系统版本}.apk`。内测 MVP 使用 Android Debug Certificate；公开发布前必须配置组织 Release Keystore。
