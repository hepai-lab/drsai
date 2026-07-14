# OpenDrSai Android 本地 Kotlin Agent Runtime

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

## OIDC 浏览器回调（已完成）

状态：**已完成并在 Android 测试机验证（2026-07-13）**。

HAI 当前为 `opendrsai-desktop` 客户端接受桌面兼容的 loopback redirect URI。Android 继续使用随机端口的
`http://127.0.0.1:{port}/callback` 接收授权码，避免改变服务端客户端注册；本地回调收到请求后立即重定向到：

```text
opendrsai://oauth2redirect
```

Android Manifest 将该 URI 注册给 `MainActivity`，并使用 `singleTask` 保证浏览器回跳时复用现有 App 实例。
授权码不进入 App 深链，只由 loopback 回调接收；App 仍校验 PKCE verifier、state、nonce、issuer、audience、
签名和有效期。回调页同时提供“返回 OpenDrSai”链接，作为浏览器禁止自动唤起时的手动兜底。

已验证：

- [x] HepAI 同意授权后自动从浏览器返回 OpenDrSai；
- [x] 回跳前后 Android 进程 PID 相同，没有创建重复 Activity 实例；
- [x] `opendrsai://oauth2redirect` 仅负责唤醒 App，不携带授权码或 Token；
- [x] Debug/MVP 单元测试、Android 设备测试、Lint 和 APK 构建通过。

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
