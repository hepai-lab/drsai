# OpenDrSai Android 技术架构报告

> 文档性质：架构基线与关键技术决策  
> 适用范围：OpenDrSai Android 1.x  
> 最近更新：2026-07-15

## 1. 目标与边界

OpenDrSai Android 的目标不是把 Windows 客户端完整搬到手机，而是提供一个可长期维护的原生移动入口：用户通过 HAI 统一身份认证登录，在同一个聊天界面中使用手机本地轻量智能体或 HAI 平台远程智能体，并能够发送图片、文档和接收结果文件。

当前架构坚持以下边界：

- Android 直接连接 HAI，不依赖桌面网关、局域网配对或 `/api/mobile/v1` 中转层。
- 手机端只实现轻量编排，不在设备上部署模型权重；推理仍由 HAI 模型服务完成。
- 平台智能体由 HAI Native API 统一暴露，Android 不直接依赖各个 Agent 的内部实现。
- 本地 URI、文件路径和 DDF 内部地址不得进入公开聊天协议；跨系统传递的均为受控、不透明的附件标识。

## 2. 总体架构

```text
                         ┌─ HAI OIDC：身份认证与 Token 刷新
                         │
OpenDrSai Android ───────┼─ 本地 Kotlin Runtime ── HAI Model API
                         │
                         ├─ 平台 Agent Runtime ─── HAI Native API ── DDF/远程 Agent
                         │
                         └─ Room + 私有缓存：会话、记忆、附件和结果文件
```

Android 客户端采用 Kotlin、Jetpack Compose 和 Material 3。界面状态由 `ViewModel + StateFlow` 管理，异步任务使用 Coroutines/Flow，HTTP、multipart 和 SSE 使用 OkHttp，结构化本地数据使用 Room。应用最低支持 API 26，目标 API 35。

这种划分将 UI、身份、智能体运行和数据持久化分开：界面只消费统一状态与运行事件，不需要知道回复来自本地编排还是平台 Agent；两种 Runtime 则复用同一套会话展示、停止、重试和附件卡片机制。

## 3. 认证与环境配置

### 3.1 原生 OIDC

登录采用 HAI/IHEP OIDC Authorization Code Flow with PKCE，Android 是 Public Client，不在安装包中保存客户端密钥。

- Client ID：`opendrsai-android`
- 原生回调：`ai.drsai.remote:/oauth2redirect`
- 生产 Issuer：`https://ai.ihep.ac.cn/api`
- 生产 API：`https://ai.ihep.ac.cn`
- 开发 API：`https://ai-dev.ihep.ac.cn`

每次授权生成独立的 `state`、`nonce` 和 PKCE verifier。系统浏览器按照自定义 Scheme 把结果交还给发起授权的应用实例，因此多台手机可以使用同一个回调 URI，无需按设备注册不同地址，也不使用只适用于桌面端的 `127.0.0.1` 回调。

客户端验证回调状态后交换 Token。Access Token 过期时允许执行一次受控刷新；刷新失败回到登录状态。退出登录时撤销 Refresh Token 并清除账户会话。Token 使用 Android Keystore 支持的 `EncryptedSharedPreferences` 保存，不写入日志或普通数据库。

### 3.2 环境隔离

OIDC Issuer、HAI API Base URL 和模型 API Base URL 是独立构建配置，允许开发 API 复用统一认证服务，同时避免把 `ai-dev.ihep.ac.cn` 误打入生产包。开发环境 DDF 数据库应指向 `10.5.6.240/aidbtest`，生产数据库配置不进入 Android 工程。

## 4. 双 Runtime 设计

### 4.1 本地 Kotlin Runtime

本地 Runtime 在手机内维护智能体循环、上下文裁剪、历史消息、轻量记忆和安全工具，再通过 `/apiv2/v1` 请求 HAI 模型。它不运行本地大模型，因此主要开销来自 UI、数据库、文件预处理和短期上下文，适合常规 Android 设备。

Runtime 对外输出统一事件，包括开始、文本增量、工具开始/结束、结果附件、完成和失败。SSE 增量直接转换为这些事件，使聊天界面可以实时更新，同时支持停止和重试。

首版工具限定为低风险能力，例如获取当前时间、保存记忆和搜索记忆。不开放任意 Shell、任意网络访问或不受控文件系统操作。

### 4.2 平台 Agent Runtime

平台模式从 HAI Native API 获取 Agent 目录，并通过 `/api/native/v1` 创建会话、上传附件和接收 SSE 回复。远程 Agent 的执行环境、工具和 DDF 集成留在服务端，Android 只负责身份、交互和结果展示。

Agent 通过能力字段声明是否支持：

- `attachment-upload`
- `image-input`
- `document-input`
- `artifact-output`

客户端根据能力控制入口和发送行为。未声明的能力不会被假定支持，附件也不会被静默丢弃。这使不同平台 Agent 可以逐步接入，而不需要为每个 Agent 发布新的 Android 版本。

### 4.3 选择双 Runtime 的原因

只使用平台 Runtime 会让轻量聊天和本地记忆完全依赖远程 Agent；只使用手机 Runtime 又无法复用 HAI 中已经部署的复杂工具链。双 Runtime 保留了手机端快速、可控的基础体验，同时把高负载和组织级能力放在平台端。两者在 UI 层统一，可以避免形成两套产品体验。

## 5. 附件与多模态链路

### 5.1 输入与预处理

附件来源包括相机、系统照片选择器和 DocumentsUI。应用不申请全盘存储权限，而是通过 Activity Result API 和 FileProvider 获取单次授权，并立即以流式方式复制到应用私有缓存。

发送前执行以下处理：

1. 清理文件名并校验扩展名、MIME 和文件头。
2. 流式检查单文件及总大小，并计算 SHA-256。
3. 图片执行采样、EXIF 方向纠正、尺寸限制、压缩和缩略图生成。
4. 文本和 PDF 提取受限长度的安全上下文。
5. 保存附件状态，使失败、取消和重试均可恢复。

默认限制为单次最多 5 个文件、单文件 10 MiB、总计 25 MiB、图片最长边 4096 像素，同时上传数不超过 2。

### 5.2 两种发送路径

本地 Runtime 获取文本/PDF 的受限提取内容，并将其作为非展示上下文传给模型。图片仅在目标模型明确支持视觉输入时使用兼容的 `image_url` 消息结构；若当前模型是文本模型，客户端自动选择可用视觉模型，无法选择时在发送前给出明确提示，避免由服务端返回难以理解的协议错误。

平台 Runtime 先通过 `POST /api/native/v1/attachments` 上传文件，成功后只在聊天请求中提交附件 ID。所有附件上传成功后才创建本轮聊天；部分失败时保留文字和附件草稿，允许用户重试或移除失败项。

### 5.3 结果文件

DDF 或远程 Agent 产生文件时，内部事件先转换成短期有效、与用户/会话/运行绑定的不透明 artifact 引用。HAI 服务端拉取并校验文件后导入私有附件存储，再通过标准公开事件把附件元数据发送给 Android。

这条链路避免向手机暴露 DDF 内部 URL、服务器路径和服务密钥。Android 最终只展示普通结果卡片，并通过受认证接口执行下载、重试、打开或分享。

## 6. 数据模型与状态管理

Room 保存会话、消息、轻量记忆以及消息附件关系。附件记录包含本地缓存、远程 ID、MIME、大小、校验值、处理状态和错误信息，使应用重启后仍能恢复历史卡片，而不依赖可能已经失效的原始 `content://` URI。

附件采用显式状态机：

```text
selected → preparing → ready → uploading → uploaded → sending → sent
               └──────────── failed / cancelled / expired
```

UI 状态集中在 ViewModel 的 StateFlow 中。文件 I/O、图片处理、数据库和网络操作均在后台调度器执行，主线程只处理状态提交和 Compose 渲染。会话及本地数据按 HAI 用户标识隔离，避免退出后切换账户看到上一账户内容。

## 7. 安全与资源治理

安全设计基于“移动端不可信、公开协议不接受内部地址”的原则：

- 强制 HTTPS，禁用明文流量。
- 不记录 Token、授权码、消息正文、Base64、私有路径和敏感下载 URL。
- 服务端校验附件所有权以及用户、会话、运行之间的绑定关系。
- 拒绝路径穿越、MIME 伪造、跨用户附件 ID、任意 URL 拉取和内部路径注入。
- 上传、解析和下载均设置大小、数量、并发和超时限制。
- 草稿缓存、临时提取文件、过期 artifact 和下载缓存按生命周期清理。
- 对 401 的刷新和请求重放设置上限，避免认证失败循环。

正式公开发布必须使用组织持有的 Release Keystore。测试签名只用于当前内测线，不能作为长期升级链路的信任根。

## 8. 构建、验证与发布基线

工程使用 JDK 17、Android SDK 35 和 Gradle。版本号由系统版本源读取，APK 命名为：

```text
OpenDrSai-Android-v{versionName}.apk
```

每个候选版本至少通过以下门槛：

- JVM 单元测试：OIDC、模型协议、Runtime、文件校验和状态机。
- Android 仪器测试：Room 迁移、账户隔离、URI/文件选择和关键界面行为。
- Android Lint 与 R8 构建。
- HAI Native、DDF附件和 artifact 协议测试。
- 开发环境端到端测试：本地/平台 Runtime 分别覆盖文本、图片和 PDF。
- 真机测试：至少覆盖 Android 10/11 与 Android 13+，并检查授权回跳、相机、相册、文件、输入法和后台恢复。
- 生产构建检查：服务地址、签名、版本号、安装升级和 SHA-256 发布校验。

## 9. 主要风险与后续演进

当前需要持续关注的风险不是 Android UI 本身，而是跨系统协议一致性：模型能力元数据可能不完整，平台 Agent 能力声明可能与真实实现不一致，附件在 Android、HAI、DDF 三端可能出现生命周期差异。因此能力必须显式声明，协议必须有结构化错误，端到端组合测试不能仅由单元测试替代。

后续演进应优先保持现有边界：扩展本地工具时继续使用白名单和用户授权；增加音频或视频附件时复用附件状态机与 Native API；增加推送和后台任务时使用 Android 标准机制，而不是把长时间运行的 Agent 进程常驻手机。

## 10. 相关文档

- [`apps/android/README.md`](../../../apps/android/README.md)：构建、运行和 OIDC 配置入口。
- [`V1.4.6_ATTACHMENT_DEVELOPMENT_PLAN.md`](../plans/attachments/V1.4.6_ATTACHMENT_DEVELOPMENT_PLAN.md)：附件功能的开发项、接口契约和完成状态。
- [`V1.4.6_ATTACHMENT_TEST_REPORT.md`](../testing/reports/V1.4.6_ATTACHMENT_TEST_REPORT.md)：自动化测试、构建和当前验收结果。
- [`V1.4.6_BETA_DEVICE_CHECKLIST.md`](../releases/V1.4.6_BETA_DEVICE_CHECKLIST.md)：真机 Beta 验收清单。
- [`ANDROID_REMOTE_WORKSPACE_DEVELOPMENT_PLAN_V1.md`](../plans/remote-workspace/ANDROID_REMOTE_WORKSPACE_DEVELOPMENT_PLAN_V1.md)：Android 通过 Relay 委托 Full Runtime 的远程工作区开发与验收方案。
- [`ANDROID_REMOTE_WORKSPACE_UI_DESIGN_V1.md`](../design/ANDROID_REMOTE_WORKSPACE_UI_DESIGN_V1.md)：远程工作区的侧栏、计算机/工作区/会话导航、扫码关联和远程聊天交互方案。
