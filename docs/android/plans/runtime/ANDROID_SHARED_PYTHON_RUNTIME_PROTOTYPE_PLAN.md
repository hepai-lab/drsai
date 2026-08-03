# OpenDrSai Android 共享 Python Runtime 原型开发方案

> 状态：计划中，完成原型前不得宣称生产可用  
> 目标架构：[共享 Python Agent Runtime](../../architecture/ANDROID_SHARED_PYTHON_AGENT_RUNTIME_ARCHITECTURE.md)  
> 原型性质：技术可行性、资源预算和跨端一致性验证，不直接替换 Kotlin Lite Runtime

## 1. 目标与结论门槛

原型验证 Android 能否在应用沙箱内嵌 CPython，直接运行与 TUI、Desktop 相同的 OpenDrSai Agent Core，同时将 OIDC、模型网络、Room、SAF、Approval、通知和生命周期交给 Kotlin Host Adapter。

原型必须回答以下问题：

1. 当前 Agent Core 和必要依赖能否稳定构建为 Android `arm64-v8a`/`x86_64` 产物？
2. TUI、Desktop、Android能否真正引用同一 Core源码，而不是行为相似的复制实现？
3. Agent Loop、上下文、Tool、Skill、子智能体和 Run/Event语义能否在 Android 完成最小闭环？
4. Python Runtime 被杀、后台恢复、网络切换和重复请求时能否保持幂等且无重复副作用？
5. APK、启动时间、内存、CPU、耗电和温度是否在移动设备可接受范围？

只有所有阻断门槛通过，才进入完整产品化；任一安全门槛失败则停止，保留 Kotlin Lite + 远程 Full Runtime。

## 2. 范围统计

原型分为 **8 个模块、40 个功能点**：

| 模块 | 名称 | 功能点 |
| --- | --- | ---: |
| PR01 | 基线、合同与工程隔离 | 5 |
| PR02 | CPython/Chaquopy构建与依赖 | 5 |
| PR03 | 共享 Agent Core抽取 | 5 |
| PR04 | Runtime Service与消息桥 | 5 |
| PR05 | Android Host Adapters | 5 |
| PR06 | Tool、Skill与子智能体闭环 | 5 |
| PR07 | 恢复、安全与资源治理 | 5 |
| PR08 | 跨端一致性、性能与 Go/No-Go | 5 |
| **合计** |  | **40** |

## 3. 交付结构

建议最终形成以下工程边界；准确目录可在 PR01 冻结，但依赖方向不能反转：

```text
cores/python/packages/drsai-core/       # 三端共享 Python Core
cores/protocol/runtime-v2/              # 命令、事件和 fixtures
apps/desktop/windows/                   # Desktop Host Adapter
apps/ui-tui/                            # TUI Host Adapter
apps/android/app/src/main/python/       # Android bootstrap/bridge，不复制 Core
apps/android/.../runtime/python/        # Service、Binder和 Kotlin adapters
apps/android/runtime-mobile.lock        # Android Python依赖锁和哈希
```

Android 构建可直接引用共享 Core源码或已构建 Wheel，但发布产物必须能证明 Wheel来自当前仓库 revision，并通过哈希/版本检查。Android `src/main/python` 只能包含 bootstrap和桥接代码，不得形成第二份 Agent Core。

## 4. 模块与逐项测试验收

### PR01 基线、合同与工程隔离（5）

| ID | 功能点 | 自动测试与验收 |
| --- | --- | --- |
| PR01-F01 | 记录 Kotlin Lite、TUI和Desktop的 Agent入口、事件、工具和依赖基线 | 静态清单测试生成源码 revision、依赖树和入口；人工审计无遗漏后保存脱敏报告。 |
| PR01-F02 | 冻结 Android Python Runtime的 Capability与明确非目标 | 合同测试断言本地无 Shell、PTY、Docker、Codex CLI、任意路径和动态代码加载。 |
| PR01-F03 | 冻结版本化 Bridge command/event schema | Python/Kotlin双解析 fixture；未知可选字段向前兼容、未知必需版本 fail closed。 |
| PR01-F04 | 建立架构依赖守卫 | 静态测试断言 Compose不依赖 Chaquopy，Core不导入 Android/Desktop backend，Android bootstrap不复制 Agent Loop。 |
| PR01-F05 | 建立 Kotlin Lite回退和 Feature Flag | JVM/UI测试覆盖 Python unavailable、初始化失败和用户切换；验收不丢会话且运行位置明确。 |

### PR02 CPython/Chaquopy构建与依赖（5）

| ID | 功能点 | 自动测试与验收 |
| --- | --- | --- |
| PR02-F01 | 接入 Chaquopy 17和 CPython 3.11 | `compileDebugPython`、API 35模拟器 import smoke；输出 Python/ABI/API版本，不输出设备标识。 |
| PR02-F02 | 生产只包含 `arm64-v8a`，调试支持 `x86_64` | APK Analyzer脚本检查 `.so` ABI；错误 ABI或重复库直接失败。 |
| PR02-F03 | 建立最小移动依赖锁 | 离线可重复构建；锁文件包含版本、来源、SHA-256和许可证，禁止未锁定传递依赖。 |
| PR02-F04 | 验证 AutoGen、Pydantic、加密、HTTP和 Token预算依赖 | 每个包独立 import/最小调用测试；缺失 Wheel、加载崩溃或版本降级均记为阻断。 |
| PR02-F05 | 验证 4 KiB/16 KiB page、冷启动和 Python异常边界 | 支持设备/模拟器运行 native load测试；无法覆盖的16 KiB项明确列为发布阻塞而非假通过。 |

### PR03 共享 Agent Core抽取（5）

| ID | 功能点 | 自动测试与验收 |
| --- | --- | --- |
| PR03-F01 | 从 `drsai` 抽取不依赖 backend/UI的 `drsai-core` | Import graph测试禁止 FastAPI、Uvicorn、SQLModel、Daemon、TUI、WeChat、Codex Adapter进入 Core。 |
| PR03-F02 | 定义 Model、StateStore、Workspace、ToolHost、Approval、Lifecycle、Artifact Ports | Fake Port单测覆盖成功、错误、取消和超时；Core不访问 Token、绝对路径或 Android对象。 |
| PR03-F03 | TUI/Desktop切换到共享 Core factory | 现有 Python回归 + golden Agent Loop测试；切换前后固定输入得到相同规范化事件摘要。 |
| PR03-F04 | 建立 Android Mobile factory与能力注入 | Python单测分别注入完整/缺失 Capability；不可用 Tool/Skill在模型请求前被过滤。 |
| PR03-F05 | 打包共享 Wheel并绑定仓库 revision | 构建检查 Wheel metadata、源码 revision和哈希；Android禁止引用手工复制目录。 |

### PR04 Runtime Service与消息桥（5）

| ID | 功能点 | 自动测试与验收 |
| --- | --- | --- |
| PR04-F01 | 在同 UID独立 `:runtime` 进程运行 Bound Service | Instrumentation断言 PID与UI不同、UID相同、未导出且第三方无法绑定。 |
| PR04-F02 | 实现单实例 CPython生命周期 | 重复 bind、旋转、后台/前台和Compose重组压力测试；始终只有一个解释器和一个调度 Actor。 |
| PR04-F03 | 实现版本化 Binder/JSON command-event桥 | 分片、乱序、重复、超限和恶意JSON测试；大正文/附件不得进入 Binder。 |
| PR04-F04 | Python事件映射到现有 Runtime V2 reducer | Kotlin/Python golden fixtures覆盖文本、工具、审批、artifact和终态；UI无需分支判断 Python Runtime。 |
| PR04-F05 | 支持取消、Service死亡和重新绑定 | 进程死亡 instrumentation；网络调用取消、UI不永久“思考中”、恢复只创建一次。 |

### PR05 Android Host Adapters（5）

| ID | 功能点 | 自动测试与验收 |
| --- | --- | --- |
| PR05-F01 | Kotlin ModelPort复用现有 OIDC、OkHttp和SSE | MockWebServer覆盖流式、401单次刷新、超时、取消和换网；Python从未获得 Bearer。 |
| PR05-F02 | Room StateStore/Journal事务适配 | Migration、账户隔离、checkpoint原子性和进程恢复测试；Python内存不能覆盖Room权威终态。 |
| PR05-F03 | SAF Workspace适配 | Fake ContentResolver + API 35测试目录授权、遍历阻断、限长读取、审批写入和原子提交。 |
| PR05-F04 | Approval/Audit/Artifact适配 | approve/reject/expired双分支、FileProvider URI和脱敏审计测试；审批前零副作用。 |
| PR05-F05 | Lifecycle/Notification/Constraint适配 | 前后台、通知权限、低内存、低电量、高温和网络状态测试；空闲Runtime不后台常驻。 |

### PR06 Tool、Skill与子智能体闭环（5）

| ID | 功能点 | 自动测试与验收 |
| --- | --- | --- |
| PR06-F01 | 运行一个纯 Python Core工具 | 固定模型选择文本/JSON工具并回填结果；事件序列与TUI/Desktop一致。 |
| PR06-F02 | 运行一个 Kotlin Android工具 | Python发出 ToolCallRequest，Kotlin执行 `get_current_time`或安全设备信息并返回，严格断言一次调用。 |
| PR06-F03 | 运行 SAF读写工具和 Approval | 读取授权fixture、写入临时文件、批准/拒绝；断言拒绝无副作用、批准产生可审计结果。 |
| PR06-F04 | 加载共享 Skill并进行Capability过滤 | local/remote-required/unsupported三类fixture；模型看不到不可执行工具，UI显示真实运行位置。 |
| PR06-F05 | 启动两个逻辑子智能体并汇总 | Fake Model确定性并发测试；最大并行2、取消可传播、上下文隔离且不创建额外Python进程。 |

### PR07 恢复、安全与资源治理（5）

| ID | 功能点 | 自动测试与验收 |
| --- | --- | --- |
| PR07-F01 | 在模型、工具副作用和审批边界持久化checkpoint | 故障注入逐点杀进程；恢复后消息不丢、工具不重复执行、非法状态转移fail closed。 |
| PR07-F02 | 同Session单活跃Run和端到端幂等 | 双击、重放和重绑并发测试；相同key只产生一个用户消息、Run和副作用。 |
| PR07-F03 | Token、私钥、路径和正文跨边界脱敏 | 扫描Python对象导出、Binder抓取、Room、no-backup、logcat和诊断包；任一命中即失败。 |
| PR07-F04 | 禁止动态代码、任意网络和桌面工具 | 恶意Skill/Tool fixture尝试import subprocess、socket外连、pip和绝对路径；全部被构建或Runtime policy阻断。 |
| PR07-F05 | 资源约束和自动降级 | 注入低内存/高温/后台条件；并行转串行、暂停或提示远程执行，不使用`largeHeap`掩盖问题。 |

### PR08 跨端一致性、性能与 Go/No-Go（5）

| ID | 功能点 | 自动测试与验收 |
| --- | --- | --- |
| PR08-F01 | 同一 fixture在TUI、Desktop、Android运行 Agent Loop | 比较规范化prompt层、tool plan、event序列和终态digest；允许时间/ID脱敏后差异为零。 |
| PR08-F02 | Android端到端文本→工具→Skill→子智能体→结果 | API 35模拟器完整E2E，保存脱敏report和事件digest，不输出消息正文/Token/路径。 |
| PR08-F03 | 进程死亡、换网、后台和30分钟稳定性 | 故障矩阵零重复副作用、零永久running、零ANR；稳定性报告记录P50/P95/峰值。 |
| PR08-F04 | 三星真机性能与安装验收 | `adb install -r`保留数据；测APK/安装占用、冷启动、PSS、CPU、温度和退出后进程释放。 |
| PR08-F05 | 生成自动Go/No-Go报告 | 所有功能点、依赖、安全、回归和性能门槛机器判定；缺失证据或未跑真机必须No-Go。 |

## 5. 测试层级与证据

| 层级 | 运行位置 | 证明内容 |
| --- | --- | --- |
| L0 静态/构建 | Windows CI | Import边界、依赖锁、ABI、密钥和动态代码扫描 |
| L1 Python | CPython 3.11 | Core、Port、Agent Loop、Tool/Skill/Subagent语义 |
| L2 Android JVM | Gradle JVM | DTO、Bridge、Reducer、Repository和错误映射 |
| L3 Instrumentation | API 35模拟器 | Python加载、Service/Binder、Room、SAF、进程死亡和UI闭环 |
| L4 跨端合同 | TUI/Desktop/Android | 相同fixture的规范化事件和终态digest |
| L5 真机 | 当前三星设备 | ARM64加载、安装升级、PSS、启动、稳定性、温度和生命周期 |

建议证据目录：

```text
docs/android/testing/acceptance/shared-python-runtime/
├─ dependency-report.json
├─ contract-digests.json
├─ emulator-e2e.json
├─ process-death-matrix.json
├─ security-scan.json
├─ samsung-performance.json
└─ go-no-go.json
```

报告不得包含 OIDC Token、设备subject、消息正文、绝对路径、文件内容或可重放凭据。

## 6. 性能和发布门槛

| 指标 | Go | No-Go |
| --- | ---: | --- |
| arm64 Release APK | ≤ 90 MB | > 90 MB |
| 安装后占用 | ≤ 220 MB | > 220 MB |
| Python Core冷启动P95 | ≤ 3秒 | > 3秒且无明确优化路径 |
| 普通对话PSS P95 | ≤ 220 MB | > 220 MB |
| 压力峰值PSS | ≤ 320 MB | OOM或持续超过320 MB |
| 30分钟ANR/Crash | 0 | 任意1次 |
| 工具重复副作用 | 0 | 任意1次 |
| Token/路径/正文泄露 | 0 | 任意1次 |
| 跨端合同差异 | 0个未解释差异 | 任一核心语义漂移 |

性能门槛是原型决策线，不通过时先裁剪依赖、降低并发或优化初始化；不得使用`largeHeap`、关闭安全检查或删除恢复机制来换取通过。

## 7. 实施顺序

| 里程碑 | 内容 | 退出条件 |
| --- | --- | --- |
| P0 可构建性 | PR01、PR02 | CPython和必要依赖在arm64/x86_64 import成功，依赖风险清单冻结 |
| P1 共享Core | PR03 | TUI/Desktop切换共享Core且Python回归无行为漂移 |
| P2 Android桥 | PR04 | 独立Runtime进程完成start/event/cancel/rebind |
| P3 Android能力 | PR05、PR06 | 模型、Room、SAF、Tool、Skill、两个子智能体闭环 |
| P4可靠性 | PR07 | 杀进程、重放、安全扫描和资源降级通过 |
| P5决策 | PR08 | 模拟器和三星真机报告齐全，自动输出Go或No-Go |

PR08测试骨架从P0开始维护，不能在功能写完后补造证据。每轮报告按功能ID给出`not_started/in_progress/local_pass/device_pass/blocked`，不得把源码存在等同于验收通过。

## 8. 原型非目标

- 不替换当前生产Kotlin Lite Runtime；
- 不发布给普通用户；
- 不实现本地大模型；
- 不实现任意Shell、PTY、Docker、Node/Codex CLI或桌面浏览器控制；
- 不新增localhost FastAPI服务；
- 不允许Runtime动态安装Python包或Skill代码；
- 不以远程Windows Runtime成功冒充Android本地Python Runtime成功。

## 9. 原型完成定义

原型只有在以下条件全部满足时才算完成：

1. PR01–PR08共40个功能点均有代码和可复现证据；
2. TUI、Desktop和Android运行同一Core revision；
3. Android真实执行Agent Loop、上下文、工具、Skill和两个逻辑子智能体；
4. Android系统能力全部经Kotlin Host Adapter执行；
5. 模拟器和三星真机性能、安全与恢复门槛通过；
6. 当前OIDC、聊天、附件、自动更新和远程工作区回归无阻断；
7. 自动`go-no-go.json`给出`GO`，且不存在缺失证据。
