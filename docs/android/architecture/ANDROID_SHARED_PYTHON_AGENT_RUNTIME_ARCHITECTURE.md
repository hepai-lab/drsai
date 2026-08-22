# OpenDrSai Android 共享 Python Agent Runtime 目标架构

> 文档状态：目标架构，待原型验证  
> 决策日期：2026-08-02  
> 适用阶段：Android 第 6 阶段  
> 原型计划：[ANDROID_SHARED_PYTHON_RUNTIME_PROTOTYPE_PLAN.md](../plans/runtime/ANDROID_SHARED_PYTHON_RUNTIME_PROTOTYPE_PLAN.md)

## 1. 架构决策

Android 下一阶段不再继续复制一套独立的 Kotlin Agent Loop，而是复用 TUI、Desktop 已使用的 Python Agent Core。复用范围包括 Agent Loop、上下文、工具调度、Skill、子智能体、Run/Event、Approval、幂等和恢复语义；Android 操作系统能力继续由 Kotlin 实现。

这里的“完整 Runtime”指完整的 OpenDrSai Agent 编排语义，不代表把 Windows 后端、Shell、PTY、Node/Codex CLI、Docker或桌面文件系统原样搬到手机。桌面专属能力继续由远程 Windows Runtime 执行。

当前 Kotlin Lite Runtime 保留为已发布的稳定实现和迁移回退路径。只有原型达到本文性能、安全和兼容门槛后，共享 Python Core 才能成为默认本地 Runtime。

## 2. Android 如何运行 Python

Android 系统不预装 Python，也不提供可依赖的 `python` 命令。应用通过 Chaquopy 将为 Android ABI 编译的 CPython、标准库、OpenDrSai Python 包和依赖 Wheel 一起打入 APK：

```text
OpenDrSai APK
├─ Kotlin / Compose / Room / OkHttp
├─ libpython3.12.so
├─ Python 标准库与编译后的 Python 模块
├─ drsai-core
└─ arm64-v8a Android Wheels
```

Kotlin 通过 Chaquopy 的 JNI 桥启动解释器并调用 Python。生产 APK 只包含 `arm64-v8a`，开发构建额外包含 `x86_64` 供模拟器使用。当前工程 `minSdk 26`、AGP 8.7.3 与 Chaquopy 17 的 API 24+、AGP 7.3–9.2 支持范围兼容。

Python 代码和依赖必须随签名 APK 静态发布；应用不在运行时执行 `pip install`，不下载并执行新的 Python、原生库或二进制文件。

## 3. 总体分层

```text
Compose UI / ViewModel
        │ Runtime V2 command/event
        ▼
Android Runtime Client
        │ Binder
        ▼
Android Runtime Service (:runtime，同 UID 独立进程)
        │ 粗粒度 JSON 消息桥
        ▼
共享 Python drsai-core
 ├─ Agent Loop
 ├─ Context / Memory policy
 ├─ Tool planning / dispatch
 ├─ Skill loader
 ├─ Logical subagents
 └─ Run / Event / Approval / Recovery semantics
        │ Host Port 请求
        ▼
Kotlin Android Host Adapters
 ├─ Model/OIDC/HTTP/SSE
 ├─ Room/Journal
 ├─ SAF Workspace
 ├─ Approval/Audit
 ├─ Camera/Photo/File/Share
 └─ Lifecycle/Notification/Connectivity
```

不在手机上启动 localhost FastAPI 或 Uvicorn。UI 与 Runtime 使用 Android Binder；Python 与 Kotlin 通过少量、版本化的消息类型通信，避免高频细粒度 JNI 调用。

`:runtime` 是同一应用 UID 下的独立 Android 进程，不设置 `isolatedProcess=true`。这样既能通过受控 Kotlin Adapter 使用 Room、Keystore 和 SAF，也能在本地任务结束或内存紧张时结束 Runtime 进程并释放 CPython 内存。

## 4. 共享 Core 与 Host Adapter 边界

### 4.1 三端共享的 Python Core

- Agent Loop 与多轮模型/工具循环；
- System、Agent、Project、用户和会话上下文组装；
- Token Budget、裁剪、摘要和记忆策略；
- Tool 定义、参数 Schema、能力需求、选择、调度和结果回填；
- Skill 元数据、指令加载、能力匹配和 Prompt 注入；
- 子智能体创建、取消、并发限制和结果汇总；
- Run 状态机、Runtime Event、Approval 和 Audit 语义；
- checkpoint、幂等键、重试分类和恢复决策；
- 模型、存储、文件、工具和系统能力的抽象 Port。

TUI、Desktop 和 Android 必须从同一 `drsai-core` 源码构建，并用相同 fixture 验证关键决策和事件序列。不得在 Android 中复制第二份 Agent Loop。

### 4.2 Android 必须使用 Kotlin 的能力

| Port | Kotlin 实现 | Python 可见信息 |
| --- | --- | --- |
| `ModelPort` | OkHttp、OIDC 单次刷新、SSE、网络切换 | 模型请求与脱敏响应事件，不含 Token |
| `StateStorePort` | Room、事务、Migration、账户隔离 | 版本化快照、Journal 和不透明对象 ID |
| `WorkspacePort` | Storage Access Framework | 授权范围内的相对路径和受限内容 |
| `ToolHostPort` | Android 工具注册、权限和实际副作用 | Tool schema、调用结果和结构化错误 |
| `ApprovalPort` | Compose Approval UI、通知和审计 | approve/reject/expired 决策 |
| `SecretPort` | Android Keystore | 不向 Python 返回原始 Token/密钥 |
| `LifecyclePort` | ProcessLifecycle、Service、网络/电量/温度 | 前后台和资源约束状态 |
| `ArtifactPort` | FileProvider、保存、打开和分享 | 不透明 artifact ID、MIME、大小和摘要 |

Python Core 不能直接读取 Android Keystore、OIDC Token、Room 数据库文件或任意 `content://` URI。

## 5. 消息桥合同

跨进程和跨语言只传递 Runtime V2 的版本化命令与事件。建议最小消息集合：

```text
Kotlin → Python
StartRun, CancelRun, ResumeRun,
ModelChunk, ModelCompleted, ModelFailed,
ToolResult, ApprovalResult, LifecycleChanged

Python → Kotlin
RuntimeEvent, ModelRequest, ToolCallRequest,
ApprovalRequest, CheckpointRequest, ArtifactRequest
```

消息包含 `protocol_version`、`request_id`、`run_id`、`session_id`、`sequence` 和幂等键。Binder 单条消息必须远低于 1 MiB；附件、长工具输出和大上下文通过 Room、临时文件或不透明 Artifact 引用传递，不能直接塞入 Binder 或日志。

桥接层应是单入口、Actor 化的串行状态提交模型。Compose 重组、Activity 重建和重复绑定不能创建第二个 Python解释器或第二个 Run。

## 6. Tool、Skill 与子智能体

### 6.1 Tool

工具分为三类：

1. **纯 Core 工具**：文本、计划、上下文和结构化数据处理，在 Python 内执行。
2. **Android Host 工具**：由 Python选择，Kotlin检查 Capability、权限与 Approval 后执行，例如 SAF 文件、相机、相册、通知和分享。
3. **桌面专属工具**：Shell、PTY、Docker、Node/Codex CLI、任意路径和浏览器自动化，不注册到 Android 本地 Runtime；需要时显式 handoff 到远程 Runtime。

模型只能看到当前设备真实可执行的 Tool schema。不可用工具必须在模型调用前过滤，不能调用后才静默失败。

### 6.2 Skill

Skill 定义可由三端共享，但必须声明所需 Capability。Android 对 Skill 计算 `local`、`partial/remote-required` 或 `unsupported`，并在 UI 中展示运行位置。Skill 不得通过指令绕过 Android Tool Registry、SAF、Approval 或网络白名单。

### 6.3 子智能体

Android 子智能体是同一 Python解释器中的逻辑异步任务，不为每个子智能体启动进程。默认最大活跃数为 3、最大并行数为 2；系统进入低内存、后台或高温状态时降级为串行、暂停或建议远程执行。

## 7. 数据、生命周期与恢复

- Room/Journal 是 Android 本地状态的持久化权威；Python 内存对象只是运行投影。
- 模型调用前、工具副作用前后、Approval 前后和终态必须形成 checkpoint。
- 同一 Session 只允许一个本地活跃 Run；重复发送使用幂等键合并。
- Activity 销毁不终止 Run；`:runtime` 进程被系统杀死后，重新绑定并从最后完整 checkpoint恢复。
- App 进入后台时不维持普通空闲 Runtime。用户可见的长任务只能使用带通知和取消入口的合规 Foreground Service。
- 登出立即取消 Run、停止 Runtime 服务、清理 Python 内存态并按账户策略删除敏感缓存。

Android 官方允许系统在内存紧张时终止后台缓存进程，因此任何依赖“Python 始终存活”的设计都不成立。

## 8. 安全边界

- OIDC Token 和设备私钥不进入 Python、Room、Runtime Event、日志或诊断包。
- Python只能通过 Host Port访问网络和用户授权文件；默认不开放任意网络请求。
- 不包含通用 Shell，不暴露 Android内部路径，不执行动态下载代码。
- 工具副作用继续使用 Capability、风险级别、一次/会话 Approval和 Audit。
- Python异常必须在边界转换为脱敏结构化错误，不把栈中的本地路径、请求正文或密钥展示给用户。
- APK内 Python包、Wheel和协议 Schema均纳入依赖清单、许可证清单、哈希和供应链扫描。

## 9. Python 移动依赖集

当前 `drsai` 包含 FastAPI、Uvicorn、SQLModel、Alembic、debugpy、Boto3、TUI、Daemon、WeChat和Codex Adapter等 Android不需要的依赖，不能整体放入 APK。需要形成独立的移动依赖锁：

```text
drsai-core-mobile
├─ drsai-core
├─ AutoGen core/agentchat 的必要子集
├─ Pydantic 与 JSON schema
├─ 移动兼容的 Token 预算实现
└─ 必需的纯 Python工具
```

原型必须逐项验证 `pydantic-core`、`tiktoken`、`cryptography`、`aiohttp` 及 AutoGen 间接依赖的 Android Wheel。无法稳定支持的依赖应替换、下沉到 Kotlin或从移动依赖集中删除，不能通过降低安全版本要求强行构建。

## 10. 性能预算

以下是原型的候选门槛，不代表尚未执行的真机结果：

| 指标 | Go 门槛 |
| --- | ---: |
| arm64 Release APK | 不超过 90 MB |
| 安装后总占用 | 不超过 220 MB |
| Python Core 冷启动 P95 | 不超过 3 秒 |
| 普通对话前台 PSS P95 | 不超过 220 MB |
| 压力场景峰值 PSS | 不超过 320 MB |
| UI 主线程 ANR | 0 |
| 本地 Agent 并行数 | 默认不超过 2 |
| Runtime空闲释放 | 退出本地任务后可结束 `:runtime` 进程 |

参考设备至少覆盖当前三星真机与 API 35 `arm64/x86_64` 模拟器。4 GB设备若无法满足稳定性门槛，应禁用共享 Python Runtime或默认使用远程 Runtime，而不是依赖 `largeHeap`。

## 11. 迁移策略

1. 保持 Compose、Room、OIDC、附件、远程工作区和 Runtime V2 API不变。
2. 从 Python `drsai` 抽取无桌面依赖的 `drsai-core` 和 Host Port。
3. TUI/Desktop先切换到新 Core入口并保持行为不变。
4. Android增加独立 `:runtime` 服务和 Python Bridge，先并行于 Kotlin Lite Runtime。
5. 使用同一 fixture 对比 Kotlin Lite、Python Android、TUI和Desktop的事件投影。
6. 原型通过后按用户或开发开关灰度，失败时可回退 Kotlin Lite或远程 Runtime。
7. 只有稳定性和升级测试通过后，才讨论移除 Kotlin Lite Agent Loop。

## 12. 不变量与非目标

必须保持的不变量：

- UI只依赖 Runtime Port，不直接依赖 Python或具体 Runtime实现。
- 同一 Agent Core源码用于 TUI、Desktop和Android。
- 同一 Run/Event/Approval合同跨端一致。
- Android系统副作用只由 Kotlin Host Adapter执行。
- 本地与远程 Runtime位置始终对用户可见，不静默迁移运行位置。

本阶段非目标：

- 手机本地大模型；
- Windows工具全集；
- Android任意 Shell、PTY、Docker或Codex CLI；
- 无通知长期后台常驻；
- 动态下载和执行 Skill代码或 Python包；
- 用 localhost HTTP服务器替代 Binder/消息桥。
