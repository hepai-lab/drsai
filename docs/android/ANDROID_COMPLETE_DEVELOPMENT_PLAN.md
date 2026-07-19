# OpenDrSai Android 完整开发计划

> 本文统一整理 Android App 从第一版 MVP 到远程工作区的四个开发阶段。
> 阶段 1、2 是对早期散落在 `docs/android_app` 中的方案和实现记录进行结构化补全；阶段 3、4 沿用已有专项计划。

## 1. 总体范围

Android 产品最终形成四条连续能力链：

1. **原生 Android MVP**：登录、聊天、本地 Kotlin Agent Runtime、本地会话和安全工具。
2. **HAI 平台 Agent**：平台 Agent 目录、能力门控、Session 绑定、SSE 对话和错误恢复。
3. **附件闭环**：拍照、相册、文件选择、预处理、上传、Agent 处理和结果文件。
4. **远程工作区**：通过 Relay 连接 Full Runtime，访问 Workspace、Session、Run、Approval、Files、Git 和 Artifact。

阶段 3 和阶段 4 的对象模型、附件引用、OIDC 身份和聊天事件应复用前一阶段能力，不创建平行账户或聊天体系。

## 2. 四阶段统计

| 阶段 | 名称 | 模块数 | 功能点数 | 当前状态 |
|---|---|---:|---:|---|
| 第 1 阶段 | 原生 Android MVP | 6 | 58 | 自动更新代码、测试和构建已完成；模拟器 E2E 待执行 |
| 第 2 阶段 | HAI 平台 Agent 接入 | 4 | 22 | 已实现 |
| 第 3 阶段 | v1.4.6 附件闭环 | 10 | 66 | 代码与 Beta 已实现，部分环境验收保留 |
| 第 4 阶段 | Android 远程工作区 | 12 | 96 | 96/96 已完成，Codex E2E 已通过 |
| **合计** |  | **32** | **242** | 以各阶段验收口径为准 |

> 242 是四份阶段计划加上第一阶段自动更新模块后的功能点总和，不是去重后的代码 API 数量。OIDC、聊天、SSE、Room、Artifact 和更新发布链路等跨阶段能力在后续阶段被扩展时，仍按所属阶段的交付验收计数。

## 3. 第 1 阶段：原生 Android MVP（6 个模块、58 个功能点）

### P1-A 认证与账户（5）

- OIDC Authorization Code + PKCE 登录。
- `state`、`nonce`、issuer、audience、JWKS 和有效期校验。
- Android 原生回调及 loopback 兼容回调。
- Token 加密保存、刷新和撤销。
- 按用户隔离本地会话与记忆，退出后不可跨账户读取。

### P1-B Kotlin Lite Agent Runtime（7）

- HAI OpenAI 兼容模型目录读取。
- 默认模型选择与不可用模型降级。
- 文本对话请求和 SSE 流式响应。
- Function Calling 解析与有限循环。
- 上下文窗口、轮次、工具输出和内存上限。
- 网络超时、断流、Token 过期和可理解错误映射。
- 前后台切换时取消/暂停网络任务。

### P1-C 聊天与会话（6）

- 新建、切换和恢复本地会话。
- 用户消息、Assistant 流式文本和终态保存。
- 停止生成、失败重试和空状态。
- 会话与 Agent 绑定，切换 Agent 不串用历史。
- Room 迁移和进程重建恢复。
- 当前会话滚动、输入框和 IME 自适应。

### P1-D 安全本地工具与记忆（5）

- 当前时间工具。
- 保存本地记忆工具。
- 查询本地记忆工具。
- 工具调用次数、输出长度和内容上限。
- 禁止 Shell、任意文件、任意网络和后台常驻执行。

### P1-E Android 交付与质量（5）

- Android 8+ 安装兼容。
- OpenDrSai Logo 和应用图标。
- `OpenDrSai-Android-v{系统版本}.apk` 命名。
- Debug/MVP 构建、R8、Lint 和模拟器测试。
- 生产域名、HTTPS、明文流量关闭和签名校验。

### P1-F APP 自动更新（30）

详细方案见 [ANDROID_APP_UPDATE_DEVELOPMENT_PLAN.md](./ANDROID_APP_UPDATE_DEVELOPMENT_PLAN.md)。本模块参考 Windows
桌面端的版本清单、固定 HTTPS 发布源、大小/SHA-256 校验、渠道和最低版本策略，适配
Android 的系统 Package Installer：

- 清单解析、versionCode 比较、stable/Beta 渠道和强制更新门禁；
- 白名单 HTTPS、可信重定向、断点下载、进度通知和失败重试；
- APK applicationId、版本、签名证书、大小和 SHA-256 校验；
- FileProvider + Package Installer 用户确认安装，取消或失败时保留旧版本；
- WorkManager 周期检查、进程恢复、发布脚本、GitHub Release 资产一致性；
- JVM、API 30/API 35 模拟器和连续升级验收；由开发环境自动执行“旧 APK → 新 APK →
  点击更新 → 安装器确认 → 版本/数据/核心功能核验”的端到端验收，并保留 JSON 报告。

## 4. 第 2 阶段：HAI 平台 Agent 接入（4 个模块、22 个功能点）

### P2-A Agent 目录与能力（6）

- `/api/native/v1/agents` 目录读取。
- 新旧目录响应结构兼容。
- Agent 名称、描述、Logo、模式和可用状态展示。
- `chat`、视觉、附件等 capabilities 解析。
- 目录按 OIDC 用户隔离缓存。
- 手动刷新、加载失败和空目录状态。

### P2-B Agent 路由与会话绑定（5）

- 本机 Agent 与平台 Agent 统一展示。
- 新会话显式绑定 `agentId`、名称和来源。
- 历史会话保留原 Agent 绑定。
- 不可用或无 `chat` 能力的 Agent 只读展示。
- 平台 Agent 请求固定走 `/api/native/v1/agents/{id}/chat`。

### P2-C 平台 SSE 与任务控制（6）

- 平台 Agent SSE 流式文本。
- `data: [DONE]` 终止处理。
- `null` 内容过滤，避免乱码。
- 停止当前 HTTP Call。
- 断流保留已收到文本并标记失败。
- 后台暂停、恢复和失败重试。

### P2-D 平台安全与验收（5）

- Bearer Token 只发送到构建指定的 HAI HTTPS 域名。
- `token_expired` 单次刷新并重放。
- invalid token、权限不足、Agent 不存在和额度错误映射。
- 不保存平台 Agent API Key、私有 URL 或执行配置。
- Android JVM、Lint、模拟器和真实授权回跳验收。

## 5. 第 3 阶段：v1.4.6 附件闭环

本阶段沿用 [V1.4.6_ATTACHMENT_DEVELOPMENT_PLAN.md](./V1.4.6_ATTACHMENT_DEVELOPMENT_PLAN.md)，共 **10 类模块、66 个功能点**：

- 产品边界与协议基线：5
- Android 选择与输入交互：8
- Android 文件预处理：7
- Android 上传与任务控制：7
- HAI Native 附件服务：9
- Agent 与聊天链路集成：8
- 数据持久化与结果展示：6
- 安全、隐私与资源治理：5
- 自动化与设备测试：7
- 发布与运维验收：4

核心结果是：加号入口支持拍照、相册和系统文件选择器；附件经过类型、大小、魔数、SHA-256 和图片压缩校验；上传后以附件 ID 绑定消息；本机 Runtime 和平台 Agent 按能力处理；结果文件支持下载、校验和系统打开。

当前专项报告记录为 62/66 完成；开发环境端到端、生产验证和设备验收按专项报告的最新门禁执行。

## 6. 第 4 阶段：Android 远程工作区

本阶段沿用 [ANDROID_REMOTE_WORKSPACE_DEVELOPMENT_PLAN_V1.md](./ANDROID_REMOTE_WORKSPACE_DEVELOPMENT_PLAN_V1.md)，共 **12 个模块、96 个功能点**：

- 架构、领域模型与产品边界：8
- Relay Runtime Protocol 与 Schema：8
- Runtime 注册、发现与连接：8
- 身份、票据、权限与安全存储：8
- Android 本地数据与非权威缓存：8
- Runtime、Workspace 与 Session 体验：8
- Run、聊天与流式 Event：8
- Approval、用户决策与 Audit 投影：8
- 只读 Files、Git 与 Artifact：8
- 移动网络、后台与可靠性：8
- Backend 无关兼容与 OpenDrSai 验收：8
- 自动化、模拟器、构建与发布验收：8

当前验收范围为 96 项，已完成 96 项；M11-F03 Codex Backend 真实 E2E 已通过。OpenDrSai 与 Codex 真实 Full Runtime/Backend 使用本仓库 `apps/desktop/windows`。

## 7. 总体验收口径

- 阶段 1、2：以 Android JVM、Lint、模拟器和 HAI OIDC/Native API 闭环为证据。
- 阶段 3：以附件专项自动化、Native 后端测试、Beta APK 和环境联调为证据。
- 阶段 4：以 Relay/Runtime E2E、Android JVM、API 30/API 35 模拟器、Lint、契约零漂移和 APK Release 为证据。
- 真机测试不作为当前发布门禁。
- Codex Backend 真实 E2E 已通过；Android 仍通过稳定 Relay/Runtime 契约保持 Backend 无关。

## 8. 当前版本产物

- APK：`OpenDrSai-Android-v1.4.6.apk`
- 生产 HAI 地址：`https://ai.ihep.ac.cn`
- GitHub Release：[android-v1.4.6](https://github.com/hepai-lab/drsai/releases/tag/android-v1.4.6)
- 远程工作区进度：[ANDROID_REMOTE_WORKSPACE_DEVELOPMENT_PROGRESS.md](./ANDROID_REMOTE_WORKSPACE_DEVELOPMENT_PROGRESS.md)
- 附件测试报告：[V1.4.6_ATTACHMENT_TEST_REPORT.md](./V1.4.6_ATTACHMENT_TEST_REPORT.md)
- 自动更新实现报告：[ANDROID_APP_UPDATE_IMPLEMENTATION_REPORT.md](./ANDROID_APP_UPDATE_IMPLEMENTATION_REPORT.md)
