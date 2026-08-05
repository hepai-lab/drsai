# OpenDrSai for Android

OpenDrSai Android 第一版是面向普通用户的原生 Agent 应用。它既能运行 Android 本机精简 Runtime，也能连接当前 HAI 账号可见的平台智能体。

核心路径：

```text
安装 APK
→ 使用 HAI/IHEP OIDC 登录
→ 选择 Android 本机 OpenDrSai 或 HAI 平台智能体
→ 通过统一聊天界面获得流式回答
→ 会话和记忆保存在本机
```

当前实现、限制、测试和验收标准以 [Android 本机 Runtime 架构](../architecture/ANDROID_LOCAL_RUNTIME_ARCHITECTURE.md) 为准。
主界面的布局和交互规范见 [主界面设计](../design/MAIN_INTERFACE_DESIGN.md)。
平台智能体的接口、路由和完成状态见 [远程智能体集成](../architecture/ANDROID_REMOTE_AGENT_INTEGRATION.md)。

## 第一版范围

- 内置 OpenDrSai Agent 与当前账号可见的 HAI 平台智能体；
- DeepSeek V4 Pro 优先、账号模型自动回退；
- SSE 流式对话；
- 当前时间、保存记忆、查询记忆三个安全本地工具；
- 本机会话历史、新对话、停止、重试和后台暂停；
- HAI OIDC Token 加密保存和自动刷新；
- HepAI 授权完成后通过 Android 深链自动返回 OpenDrSai；
- Android 8+ 可安装 APK。
- 会话创建时绑定智能体，历史会话不会因切换智能体而误投递；
- 平台目录缓存、手动刷新、能力门控及远程 SSE 停止。

## 已完成事项

- [x] 客户端实现 Android 原生 OIDC 深链与桌面 loopback 兼容模式；
- [x] 每台设备使用独立 state、nonce、PKCE 和加密持久化登录事务；
- [x] HAI 开发环境注册 `opendrsai-android` Public Client 并启用原生回调；
- [x] 接入 `/api/native/v1/agents` 目录和 `/api/native/v1/agents/{id}/chat`；
- [x] 本机/平台运行时路由、会话绑定、离线目录和错误映射；
- [ ] 两台以上不同品牌真机完成并发登录验收。

第一版不依赖 Windows、`opendrsai.ihep.ac.cn` 或 `/api/mobile/v1`，也不包含 Python、Shell、文件、浏览器自动化、本地大模型、平台智能体并行编排和跨设备同步。
