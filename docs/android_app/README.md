# OpenDrSai for Android

OpenDrSai Android 第一版是面向普通用户的本地轻量 Agent 应用，而不是桌面遥控器或 WebUI 客户端。

核心路径：

```text
安装 APK
→ 使用 HAI/IHEP OIDC 登录
→ Android 本机 Kotlin Runtime 运行 Agent
→ 使用 HAI 云端模型获得流式回答
→ 会话和记忆保存在本机
```

当前实现、限制、测试和验收标准以 [REAL_DEVICE_DEVELOPMENT_PLAN.md](./REAL_DEVICE_DEVELOPMENT_PLAN.md) 为准。
主界面的布局和交互规范见 [MAIN_INTERFACE_DESIGN.md](./MAIN_INTERFACE_DESIGN.md)。

## 第一版范围

- 单一内置 OpenDrSai Agent；
- DeepSeek V4 Pro 优先、账号模型自动回退；
- SSE 流式对话；
- 当前时间、保存记忆、查询记忆三个安全本地工具；
- 本机会话历史、新对话、停止、重试和后台暂停；
- HAI OIDC Token 加密保存和自动刷新；
- HepAI 授权完成后通过 Android 深链自动返回 OpenDrSai；
- Android 8+ 可安装 APK。

## 已完成事项

- [x] 客户端实现 Android 原生 OIDC 深链与桌面 loopback 兼容模式；
- [x] 每台设备使用独立 state、nonce、PKCE 和加密持久化登录事务；
- [ ] HAI 注册 `opendrsai-android` Public Client 后切换正式构建；
- [ ] 两台以上不同品牌真机完成并发登录验收。

第一版不依赖 Windows、`opendrsai.ihep.ac.cn` 或 `/api/mobile/v1`，也不包含 Python、Shell、文件、浏览器自动化、本地大模型、多 Agent 和跨设备同步。
