# OpenDrSai for Android 产品规划

## 1. 产品定位

OpenDrSai for Android 第一版是一款面向普通用户的 AI Agent 对话应用，而不是桌面端遥控器。

用户应当像使用 DeepSeek 等主流 AI App 一样，完成登录后立即开始对话。OpenDrSai 的差异化在于用户可以选择不同能力的 Agent，但 App 不应要求用户理解 WebSocket、IP 地址、桌面端口或 Agent 运行架构。

第一版的核心路径为：

```text
启动 App → 登录 OpenDrSai → 进入新对话 → 选择 Agent → 发送消息 → 获得流式回答
```

## 2. DeepSeek App 调研结论

DeepSeek App 的产品结构围绕“快速进入对话”展开，其官方公布的主要能力包括：

- 邮箱、Google Account 和 Apple ID 登录；
- 跨平台聊天记录同步；
- 新建对话与历史会话管理；
- 流式 AI 对话；
- 联网搜索与深度思考模式；
- 文件上传和文本提取。

其最值得参考的不是具体视觉，而是低认知负担的主流程：登录完成后直接面对输入框，模型和高级能力作为对话过程中的辅助选项出现。

参考资料：

- [Introducing DeepSeek App](https://api-docs.deepseek.com/news/news250115)
- [DeepSeek 官方网站](https://www.deepseek.com/)
- [DeepSeek Google Play 页面](https://play.google.com/store/apps/details?id=com.deepseek.chat)

## 3. OpenDrSai 的产品差异

DeepSeek 主要提供统一 AI 助手及模式切换；OpenDrSai 可以提供多个具有不同能力、工具和任务配置的 Agent。

在移动端，Agent 应被呈现为用户可以选择的“专业 AI 助手”，而不是复杂的运行时对象。例如：

- 通用助手：日常问答、写作与分析；
- 编程助手：代码生成、解释与调试；
- 深度研究：多步骤搜索、资料整理与报告生成。

第一版只展示 Agent 名称、头像、描述和可用状态。工具参数、子 Agent 拓扑、内部调试日志和运行环境配置不面向普通用户展示。

## 4. 第一版目标

第一版需要实现一个完整、可持续使用的闭环：

1. 用户使用现有 OpenDrSai 账户登录；
2. App 安全保存和刷新登录凭证；
3. App 加载用户可用的 Agent；
4. 用户选择 Agent 并创建会话；
5. 用户发送文本消息；
6. Agent 流式返回回答；
7. 会话记录同步到云端并可跨端恢复；
8. 用户可以停止生成、重试和退出登录。

第一版不依赖桌面端在线，也不要求连接局域网服务。

## 5. 页面与交互

### 5.1 启动页

启动页展示 OpenDrSai 品牌，并在后台检查本地登录状态。

```text
        OpenDrSai

  Your personal AI agents
```

状态处理：

- Token 有效：直接进入对话首页；
- Access Token 过期且存在 Refresh Token：静默刷新；
- 未登录或刷新失败：进入登录页；
- 网络不可用：显示可重试的网络提示。

### 5.2 登录页

登录页应尽量减少选项，优先沿用现有 OpenDrSai 账户体系。

```text
OpenDrSai

登录后开始与智能 Agent 对话

[ 使用 HAI 账号登录 ]
[ 使用微信登录       ]

登录即表示同意《用户协议》和《隐私政策》
```

第一版优先实现 HAI OIDC 登录：

- 通过 Android 系统浏览器发起 Authorization Code + PKCE；
- 通过 App Link/Deep Link 返回 App；
- 校验 state、nonce、issuer、audience 和 token 有效期；
- Access Token 和 Refresh Token 保存到 Android 加密存储；
- 支持自动刷新和退出登录时撤销凭证。

不应在 App 内直接收集或保存用户密码。微信登录可在 OIDC 主流程稳定后接入。

### 5.3 对话首页

登录成功后直接进入新对话，而不是设备连接页或功能仪表盘。

```text
☰          OpenDrSai          ＋

你好，我是 OpenDrSai
今天想完成什么？

┌──────────────────────────┐
│ 给 Agent 发送消息…       │
│                    发送 ↑│
└──────────────────────────┘

              通用 Agent ▾
```

交互原则：

- 输入框是页面视觉中心；
- 默认 Agent 自动选中；
- 第一次发送消息时自动创建会话；
- 支持少量示例问题，用户开始输入后隐藏；
- 顶部按钮用于打开历史会话和新建对话。

### 5.4 Agent 选择

Agent 选择器从输入框附近或顶部标题打开：

```text
选择 Agent

● 通用助手
  日常问答、写作与分析

○ 编程助手
  代码生成、解释与调试

○ 深度研究
  多步骤搜索与报告生成
```

第一版支持：

- 加载当前用户可用 Agent；
- 显示 Agent 名称、头像和一句描述；
- 为当前会话选择 Agent；
- 记住用户上次选择；
- Agent 不可用时给出明确提示和替代选择。

第一版不支持在 Android 端创建、安装或编辑 Agent。

### 5.5 对话详情

对话使用主流 AI App 的消息布局：

- 用户消息；
- Agent 流式回复；
- Markdown、列表、表格和代码块；
- 复制回答；
- 停止生成；
- 错误重试；
- 重新生成回答；
- 自动滚动与返回底部；
- 网络中断后的恢复提示。

Agent 工具行为以简洁状态显示：

```text
正在搜索资料…
正在读取文件…
正在分析代码…
```

第一版不展示工具 JSON 参数、内部推理过程或完整调试日志。

### 5.6 历史会话

左侧抽屉或独立页面展示云端会话：

```text
＋ 新对话

今天
  Android App 产品规划
  分析登录接口

昨天
  Python 脚本调试
  项目架构建议
```

第一版支持：

- 加载和刷新会话列表；
- 打开历史会话；
- 新建对话；
- 云端同步消息；
- 自动生成会话标题；
- 删除会话；
- 空状态和加载失败状态。

搜索、置顶、归档和批量管理可以后续实现。

### 5.7 个人中心

个人中心保持精简：

- 用户头像、名称和账号；
- 默认 Agent；
- 语言；
- 浅色/深色/跟随系统；
- 用户协议；
- 隐私政策；
- 退出登录。

## 6. 第一版功能范围

### 必须实现

- OpenDrSai OIDC 登录；
- 登录状态持久化；
- Token 自动刷新和安全存储；
- 获取 Agent 列表；
- 默认 Agent 和 Agent 切换；
- 新建会话；
- 文本消息发送；
- 流式回答；
- Markdown 与代码块展示；
- 历史会话和消息同步；
- 停止生成；
- 错误提示与重试；
- 深色模式；
- 退出登录。

### 第一版暂不实现

- 手动输入桌面 WebSocket 地址；
- 局域网发现和桌面配对；
- 桌面任务遥控；
- Agent 创建、安装和高级配置；
- 子 Agent 关系图；
- 完整工具调用日志；
- 命令审批中心；
- 语音输入；
- 推送通知；
- 离线模型；
- 多服务器管理。

文件和图片上传是第一版闭环完成后的首要增强功能。

## 7. 与现有 OpenDrSai 的复用关系

当前 OpenDrSai 已具备可复用的认证与对话基础：

- HAI OIDC；
- IHEP SSO；
- 微信授权登录入口；
- Access Token 与 Refresh Token；
- Token 刷新和注销；
- 用户 ID、名称与头像；
- Agent 列表；
- 会话创建、历史记录和流式对话；
- 文件上传和多种 Agent 能力。

Android 端不应复制桌面 Electron IPC 层，而应直接复用后端公开的 HTTPS、OIDC 和流式对话协议。

现有桌面代码中的密码登录只是本地占位实现，明确写有“Remote password verification is not connected yet”。因此 Android 第一版不应基于该占位逻辑构建账号密码登录。

## 8. 技术方案

### 8.1 Android 客户端

建议采用：

- Kotlin；
- Jetpack Compose；
- Material 3；
- Navigation Compose；
- ViewModel + StateFlow；
- Retrofit/OkHttp；
- Server-Sent Events 或后端已有流式协议；
- Android Credential Manager/EncryptedSharedPreferences 或 Keystore；
- AppAuth for Android 或经过审计的 OIDC PKCE 实现；
- Room 用于会话摘要和消息缓存；
- Coil 用于头像和图片。

现有试验版使用 XML View 和桌面 WebSocket，正式第一版需要逐步迁移为面向云端登录与对话的数据层。是否迁移至 Compose，可在开始实现前通过小型界面原型验证；不应让 UI 技术迁移阻塞认证和对话闭环。

### 8.2 客户端分层

```text
UI
├─ 登录
├─ 对话首页
├─ 会话详情
├─ Agent 选择
├─ 历史会话
└─ 个人中心

Domain
├─ AuthRepository
├─ AgentRepository
├─ ConversationRepository
└─ UserRepository

Data
├─ OIDC/Auth API
├─ Agent API
├─ Conversation API
├─ Streaming Client
├─ Secure Token Store
└─ Room Cache
```

### 8.3 需要确认或补齐的后端契约

正式编码前需形成移动端可使用的 API 契约：

- OIDC discovery、client ID、redirect URI 和允许的 scope；
- 刷新与撤销 Token 的接口；
- 当前用户信息接口；
- 当前用户可用 Agent 列表；
- 创建会话；
- 会话分页列表；
- 会话消息分页；
- 发送消息和流式事件格式；
- 停止生成；
- 删除会话；
- 错误码、限流和 Token 失效语义。

所有业务接口通过 HTTPS，并使用：

```http
Authorization: Bearer <access_token>
```

不把 API Key、用户密码或桌面端私有凭证硬编码进 APK。

## 9. 验收标准

第一版达到以下条件才算完成：

1. 新用户可以从登录页完成官方账户登录；
2. 关闭并重新打开 App 后仍保持登录；
3. Token 过期时可以自动刷新；
4. 登录后能看到可用 Agent 并选择其中一个；
5. 用户发送第一条消息后自动创建云端会话；
6. Agent 回答可以实时流式显示；
7. App 被切入后台再返回时不会丢失当前消息；
8. 重新安装以外的正常重启不会丢失历史会话；
9. 同一账号在 Web、桌面和 Android 上看到一致的会话记录；
10. 网络断开、登录过期、Agent 不可用和服务端错误都有用户可理解的处理；
11. 用户可以停止生成、重试失败请求并退出登录；
12. Android App 不要求桌面端在线。

## 10. 实施顺序

### 阶段 A：API 契约与基础工程

- 确认移动端认证方式和 OIDC 配置；
- 固化 Agent、会话和流式消息 API；
- 建立环境配置、网络层和错误模型；
- 建立导航与主题。

### 阶段 B：登录闭环

- 启动状态检查；
- OIDC + PKCE；
- Deep Link 回调；
- 安全 Token 存储；
- 自动刷新；
- 用户信息与退出登录。

### 阶段 C：对话闭环

- Agent 列表和默认 Agent；
- 新对话；
- 文本发送；
- 流式回答；
- 停止、错误和重试；
- Markdown 与代码块。

### 阶段 D：历史与质量

- 云端历史会话；
- 本地缓存；
- 删除和标题；
- 深色模式；
- 网络恢复；
- 自动化测试与真机验证。

### 后续增强

- 文件和图片；
- 联网搜索等 Agent 能力开关；
- 语音输入；
- 通知与审批；
- 桌面配对和本地 Agent；
- 平板布局。

## 11. 当前试验版处置

仓库中的现有 Android 试验版已经验证了 Kotlin 构建、模拟器运行和 WebSocket 流式事件处理，但产品入口与本规划不一致。

后续实现时应：

1. 保留可复用的构建环境和基础网络经验；
2. 将连接地址页替换为启动页和登录页；
3. 将桌面 GatewayClient 替换为带 Bearer Token 的云端数据层；
4. 重构会话模型以匹配云端 API；
5. 将工具和子 Agent 事件压缩为用户可理解的状态；
6. 在认证与对话闭环稳定后，再评估桌面连接作为高级功能加入。

