# OpenDrSai Windows 适配 Android 扫码连接开发方案

> 版本：V1  
> 日期：2026-07-22  
> 范围：Windows 桌面端生成一次性二维码，Android 使用 HepAI 身份扫码关联已经注册的 OpenDrSai Full Runtime。  
> 规模：**9 个模块、54 个功能点**。

## 1. 代码现状与缺口

### 1.1 已有能力

1. Android 已在远程工作区首页提供“扫码关联已有计算机”，调用 Google Code Scanner，并将二维码原文交给 `RelayDiscoveryClient.associate()`。
2. Android 当前能解析裸 Access Grant Code，以及 `opendrsai://associate?code=...`。
3. Relay 已有 `POST /v1/runtimes/{runtime_id}/access-grants`，使用 `X-Runtime-Token` 生成默认 120 秒有效、单次消费的 Access Grant Code。
4. Android 使用当前 HepAI OIDC Bearer Token 调用 `POST /v1/associations` 兑换授权。
5. Windows Full Runtime 启动时会读取 `~/.drsai/runtime/relay/credential.dpapi` 和 `relay-wss-url`，并主动建立 WSS Relay 连接。
6. Windows Electron 已有 `shared/api → preload → secureHandle → main → LocalRuntimeClient → Python Gateway` 的成熟调用链，以及设置页“集成”分组和 Playwright/脚本验收框架。

### 1.2 实际缺口

1. Full Runtime 没有向本机桌面端暴露“创建/查询/撤销 Android Access Grant”的 loopback 控制接口。
2. Electron shared API、preload 和 main process 没有扫码连接 IPC。
3. Windows UI 没有“连接 Android”、二维码、倒计时、刷新和结果状态。
4. 当前 Relay 只返回 `code + expires_at`，没有可安全轮询的 `grant_id/status`，也不能主动撤销未使用授权码。
5. Android 代码与设计文档的二维码格式存在漂移；当前代码接受自定义 scheme，但尚未验证版本、issuer 和 environment。
6. Runtime 首次注册只有 CLI 骨架，桌面端必须能明确区分“未注册、凭据损坏、Relay 离线和正常可配对”，不能把这些状态都显示为二维码失败。

因此，当前完成的是“Android 扫码消费者 + Relay 基础码兑换”，还没有完成“Windows 二维码生产者和连接闭环”。

## 2. 关键架构决策

### 2.1 调用链

```text
Windows Renderer
  → typed DesktopApi
  → context-isolated Preload
  → secureHandle IPC
  → Electron Main
  → loopback LocalRuntimeClient
  → Python Full Runtime（读取 DPAPI 凭据）
  → HTTPS Runtime Relay（X-Runtime-Token）
  → 一次性 Access Grant
  → Windows Renderer 本地渲染二维码
  → Android 扫码
  → Android + HepAI OIDC Bearer Token
  → Relay 单次兑换
  → Windows 轮询得到 consumed
```

Runtime Token 不得进入 Electron renderer、preload 返回值、日志、诊断包、localStorage 或二维码。Electron main 也不直接读取 `credential.dpapi`；它只调用受本机 Gateway Token 保护的 Full Runtime loopback API。

### 2.2 二维码格式

V1 使用以下规范化载荷：

```text
opendrsai://associate?v=1&environment=production&issuer=https%3A%2F%2Fai.ihep.ac.cn&code=<opaque-code>
```

- `code` 是唯一敏感字段，随机、短时、单次消费。
- 不包含 Runtime Token、OIDC Token、IP、端口、SSH 信息、Workspace 路径或设备密钥。
- production、development 的 issuer/environment 必须精确匹配，禁止跨环境兑换。
- Android 保留对裸 code 的内部兼容，但桌面端只生成规范化 URI。

### 2.3 UI 入口

主入口放在：

```text
设置 → 集成 → Android 端 → 连接 Android
```

弹窗标题为“连接 Android”，包含计算机名、环境、二维码、剩余时间、手工配对码、“刷新二维码”和“取消”。已过期自动失效；扫码兑换成功后显示“已连接”，并允许关闭弹窗。MVP 不展示手机名称或用户实名，避免扩张 Relay 身份披露范围。

### 2.4 生命周期

Relay 为每个授权返回不透明 `grant_id`：

```text
PENDING → CONSUMED
       ↘ EXPIRED
       ↘ REVOKED
```

同一 Runtime 同时最多一个有效 grant。刷新二维码先撤销旧 grant；关闭弹窗尽力撤销；即使撤销请求失败，120 秒 TTL 仍是最终安全边界。状态接口只返回状态和时间，不返回关联用户身份。

## 3. 模块与功能点

### M01：跨端配对契约（6 项）

| ID | 功能点 | 自动验收 |
|---|---|---|
| M01-F01 | 定义 V1 `opendrsai://associate` URI schema | Node 与 Kotlin 使用同一 golden fixtures，字段逐项相等 |
| M01-F02 | 固定 `v/environment/issuer/code` 字段及编码规则 | Unicode、转义、参数乱序和重复参数测试 |
| M01-F03 | code 仅允许 16–128 位 URL-safe 字符 | 空值、超长、控制字符、Unicode、路径注入均拒绝 |
| M01-F04 | production/dev issuer 和 environment 精确匹配 | 跨环境、HTTP issuer、伪造子域全部拒绝 |
| M01-F05 | 保持 Android 裸 code 内部兼容 | Kotlin 回归测试验证裸 code 与规范 URI |
| M01-F06 | 协议 fixture 纳入仓库并做零漂移检查 | CI 重新生成/解析后必须零 diff |

### M02：Relay Access Grant 生命周期（6 项）

| ID | 功能点 | 自动验收 |
|---|---|---|
| M02-F01 | 创建 grant 返回 `grant_id/code/expires_at` | Relay API schema 和响应模型测试 |
| M02-F02 | 增加 runtime-token 保护的 grant 状态查询 | 正确 token 可查；错误 Runtime/token 返回 403/404 |
| M02-F03 | 增加撤销未消费 grant 接口 | PENDING 可转 REVOKED，重复撤销幂等 |
| M02-F04 | 同 Runtime 最多一个 PENDING grant | 并发创建测试确认旧码失效且新码唯一 |
| M02-F05 | 保持单次消费、TTL 和哈希存储 | 使用两次、过期、篡改 code 全部失败；存储无明文 |
| M02-F06 | 状态响应不披露 HepAI subject | schema/source scan 和 API 响应快照验证 |

### M03：Full Runtime 配对控制面（6 项）

| ID | 功能点 | 自动验收 |
|---|---|---|
| M03-F01 | 新增 `POST /v1/mobile-pairing/grants` loopback 接口 | Python Gateway TestClient 验证成功路径 |
| M03-F02 | 新增 GET 状态和 DELETE 撤销接口 | 状态机、幂等撤销和到期测试 |
| M03-F03 | Runtime 内部加载 DPAPI 凭据并调用 HTTPS Relay | fake protector/fake Relay 测试，凭据不离开 Runtime |
| M03-F04 | 从已配置 WSS URL安全派生 HTTPS Relay 根地址 | wss→https 正例；非 WSS、userinfo、非可信 host 拒绝 |
| M03-F05 | 输出注册状态：ready/not_registered/credential_invalid/offline | 四态 fixture 与错误码稳定性测试 |
| M03-F06 | 网络超时、TLS、401/403/429/5xx 映射为结构化错误 | 故障注入逐类验证 retryable/action/correlation_id |

### M04：Desktop API、IPC 与主进程（6 项）

| ID | 功能点 | 自动验收 |
|---|---|---|
| M04-F01 | shared `DesktopApi` 增加 pairing status/create/read/revoke 类型 | `typecheck:node`、`typecheck:web` 通过 |
| M04-F02 | shared preload 暴露最小配对方法 | 静态检查只允许定义的 IPC channel |
| M04-F03 | Windows main 用 `secureHandle` 注册三个 IPC | IPC 集成测试覆盖 create/status/revoke |
| M04-F04 | main 只连接本机 `LocalRuntimeClient`，renderer 不传 URL/token/runtimeId | 恶意参数和源扫描测试 |
| M04-F05 | main 维护单窗口 active grant，并限制重复创建 | 并发点击只产生一个有效 grant |
| M04-F06 | mockDesktopApi 提供确定性 PENDING→CONSUMED fixture | renderer/Playwright 无网络可完整运行 |

### M05：Windows UI 入口与二维码弹窗（6 项）

| ID | 功能点 | 自动验收 |
|---|---|---|
| M05-F01 | 设置→集成新增“Android 端”行和“连接 Android”按钮 | Playwright 按语义定位并打开弹窗 |
| M05-F02 | 弹窗展示计算机名、环境和隐私说明 | 中英文文本与字段可见性断言 |
| M05-F03 | 使用固定版本 `qrcode` 库在 renderer 本地绘制二维码 | 生成图不请求网络；二维码截图可被解码回原 URI |
| M05-F04 | 展示剩余秒数和进度，过期后禁用旧码 | fake clock 验证 120→0 和 EXPIRED UI |
| M05-F05 | 提供手工配对码复制、刷新和取消 | clipboard mock、刷新撤销、取消关闭测试 |
| M05-F06 | 完成键盘、缩放、高对比度和屏幕阅读器支持 | axe、Tab/Enter/Escape、125%/150%/200% 视觉测试 |

### M06：关联结果与恢复交互（6 项）

| ID | 功能点 | 自动验收 |
|---|---|---|
| M06-F01 | 仅在弹窗可见时以 2 秒间隔轮询状态 | fake timer 验证无后台无限轮询 |
| M06-F02 | CONSUMED 显示“已连接”并停止轮询 | 状态转换与请求次数断言 |
| M06-F03 | EXPIRED 显示“二维码已过期”和刷新入口 | 过期 fixture 视觉/交互测试 |
| M06-F04 | REVOKED/关闭弹窗清除二维码和内存 code | component unmount 和 heap-safe source scan |
| M06-F05 | renderer reload/窗口关闭时 main 尝试撤销 active grant | Electron lifecycle 集成测试 |
| M06-F06 | 网络恢复后允许显式重试，不自动创建新授权 | offline→online fixture 验证用户控制边界 |

### M07：安全、隐私与可靠性（6 项）

| ID | 功能点 | 自动验收 |
|---|---|---|
| M07-F01 | Runtime Token/完整 code 不进入日志和诊断导出 | canary secret + 日志/diagnostic 扫描 |
| M07-F02 | code 不写 localStorage、配置、SQLite 或崩溃恢复文件 | 文件系统快照前后差异测试 |
| M07-F03 | Relay URL 只来自 Runtime 受保护配置并强制 HTTPS | SSRF、localhost、userinfo、重定向攻击矩阵 |
| M07-F04 | 创建/查询/撤销均设置短超时、有限重试和 correlation ID | 网络故障注入与上界测试 |
| M07-F05 | grant 创建节流，防止连点和恶意 renderer 滥用 | burst 测试验证 429/本机节流 |
| M07-F06 | 错误文案脱敏，不显示 token、code、内部路径或堆栈 | 错误快照与敏感信息扫描 |

### M08：Android 兼容与端到端闭环（6 项）

| ID | 功能点 | 自动验收 |
|---|---|---|
| M08-F01 | Android parser 完整校验 V1、issuer、environment | API 30/35 instrumentation 与 JVM 参数矩阵 |
| M08-F02 | Android 扫描规范 URI 后只提交提取的 code | MockWebServer 请求体断言不含 URI 其他字段 |
| M08-F03 | Android 对过期、已使用、撤销和环境不符显示不同提示 | Relay 错误码到中文 UI 映射测试 |
| M08-F04 | 成功关联后刷新 Runtime/Workspace 并高亮新增计算机 | Compose UI + fake repository 验证 |
| M08-F05 | Android 不把扫码原文写日志、Room 或剪贴板 | canary 扫描和数据库断言 |
| M08-F06 | Desktop 生成的二维码与 Android parser 做真实交叉测试 | 解码桌面 QR，直接送入 Android test bridge 后关联成功 |

### M09：自动化验收与发布门禁（6 项）

| ID | 功能点 | 自动验收 |
|---|---|---|
| M09-F01 | Python Relay/Runtime 全量单元与契约测试 | pytest 零失败、零跳过 |
| M09-F02 | Desktop Node/Web TypeScript 与 IPC 测试 | 两套 typecheck 和 pairing verifier 全绿 |
| M09-F03 | Playwright UI、视觉、键盘和 axe 验收 | 中英文、缩放、亮暗主题截图零异常 |
| M09-F04 | API 30/API 35 Android 回归 | 双 API 全量测试零失败、零跳过 |
| M09-F05 | Windows+Relay fixture+Android Emulator 自动 E2E | 生成→截图解码→兑换→CONSUMED→Workspace 可见全通过 |
| M09-F06 | 单命令发布门禁及 54 项证据矩阵 | `verify:android-pairing-release` 输出 54/54 passed |

## 4. 预计修改位置

### Relay 与 Full Runtime

- `cores/python/packages/drsai/src/drsai/relay/models.py`
- `cores/python/packages/drsai/src/drsai/relay/registry.py`
- `cores/python/packages/drsai/src/drsai/relay/api.py`
- `cores/python/packages/drsai/src/drsai/relay/runtime_client.py`
- `cores/python/packages/drsai/src/drsai/backend/gateway.py`
- `cores/protocol/relay/runtime-relay.schema.json`
- `cores/protocol/relay/runtime-relay.openapi.json`

### Windows Desktop

- `apps/desktop/shared/api/desktopApi.ts`
- `apps/desktop/shared/main/runtimeClient.ts`
- `apps/desktop/shared/main/preload.ts`
- `apps/desktop/windows/src/main/index.ts`
- `apps/desktop/shared/renderer/src/App.tsx`
- `apps/desktop/shared/renderer/src/mockDesktopApi.ts`
- `apps/desktop/shared/renderer/src/styles.css`
- `apps/desktop/windows/package.json`

### Android

- `apps/android/app/src/main/java/ai/drsai/remote/remote/data/RelayDiscoveryClient.kt`
- `apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteHomeViewModel.kt`
- 对应 JVM、MockWebServer、Compose 和 instrumentation 测试。

## 5. 自动测试与自主验收方案

### 5.1 分层测试

1. **契约层**：同一份 JSON fixtures 同时由 Python、TypeScript、Kotlin 解析，验证 URI、环境和错误码零漂移。
2. **Relay 层**：使用内存 registry/FastAPI TestClient 覆盖创建、并发、查询、撤销、过期、单次消费、权限和脱敏。
3. **Runtime 层**：fake DPAPI protector + fake HTTPS Relay；验证 Runtime Token 不越界以及结构化错误。
4. **IPC 层**：启动 main handler fixture，模拟恶意 renderer 参数、并发调用、窗口销毁和 Runtime 故障。
5. **UI 层**：mockDesktopApi 驱动 PENDING/CONSUMED/EXPIRED/REVOKED/ERROR；运行 Playwright、截图、axe 和键盘矩阵。
6. **二维码层**：截取真实二维码像素，使用独立 decoder 解码，结果必须与 canonical payload 完全一致。
7. **Android 层**：API 30/API 35 模拟器验证扫码入口、parser、错误提示和关联后刷新。
8. **跨端 E2E**：真实启动 Relay fixture、Windows Full Runtime、Electron 和 Android Emulator；从桌面截图解码，而不是绕过二维码生成逻辑。

Google Code Scanner 的相机取景页属于 Google Play Services 外部 UI，不作为稳定的桌面自动化依赖。E2E 将桌面二维码真实解码后，通过 Android instrumentation test bridge 注入“扫描结果”；Android 自身另有 instrumentation 测试验证扫码按钮和结果回调。这既覆盖二维码真实性，也避免依赖模拟摄像头。

### 5.2 故障矩阵

必须自动覆盖：

- Runtime 未注册、DPAPI 不可用、凭据损坏；
- Relay DNS、连接、TLS、超时、401、403、404、409、429、5xx；
- code 过期、重复消费、撤销后消费、跨环境消费；
- 重复点击、并发创建、刷新旧码、关闭窗口、renderer reload；
- Android 离线、OIDC 过期、关联后刷新失败；
- 日志、诊断包、本地存储和错误 UI 的 canary secret 泄漏扫描。

### 5.3 性能与稳定性指标

- 正常网络下点击按钮至二维码可见：P95 ≤ 2 秒。
- 二维码生成本地耗时：P95 ≤ 100 ms。
- 状态轮询间隔：2 秒；单弹窗最多一个在途请求。
- 弹窗关闭后 1 秒内停止轮询并发起撤销。
- 连续生成/关闭 100 次无定时器、listener 或 active grant 泄漏。
- E2E 连续运行 20 轮，成功率 100%，无残留有效 grant。

### 5.4 最终验收门禁

新增统一命令：

```text
npm run verify:android-pairing-release
```

该命令必须依次检查：

1. Relay/Runtime pytest；
2. schema 生成零漂移；
3. Desktop node/web typecheck；
4. IPC 与安全 verifier；
5. QR 独立解码；
6. Playwright UI/visual/axe；
7. Android JVM、API 30、API 35；
8. Windows→Android 跨端 E2E；
9. 54 项 feature evidence。

任何测试失败、跳过、缺少证据或使用 mock 冒充跨端 E2E，均不得标记完成。

## 6. 实施顺序

1. 先冻结 M01 契约，并修正 Android parser/文档漂移。
2. 实现 M02 Relay grant 状态与撤销能力。
3. 实现 M03 Full Runtime 控制面，确保 Token 不越界。
4. 接通 M04 Desktop API/IPC 和 mock。
5. 完成 M05/M06 UI、二维码和状态闭环。
6. 完成 M07 安全故障矩阵与脱敏。
7. 完成 M08 双端兼容和跨端 E2E。
8. 建立 M09 单命令门禁，生成 54/54 验收证据。

## 7. 完成定义

只有同时满足以下条件才算完成：

- 9 个模块、54 个功能点全部有代码与自动测试引用；
- Windows 正常展示可被独立解码的二维码；
- Android 使用 HepAI 身份完成一次性关联；
- Windows 自动显示 CONSUMED，不依赖用户手工确认；
- 关闭、刷新、过期、重复扫码和跨环境均安全失败；
- Runtime Token 和完整 code 不进入持久化或诊断输出；
- API 30/API 35 与跨端模拟器 E2E 全绿；
- `verify:android-pairing-release` 输出 **54/54 passed**。

## 8. 实施结果（2026-07-22）

本阶段已经完成，最终状态为 **9 个模块、54/54 个功能点通过，0 项失败**。

统一发布门禁：

```text
npm --prefix apps/desktop run verify:android-pairing-release --workspace opendrsai-windows-desktop
```

最终自动验收结果：

- Relay、Full Runtime 与闭环协议：34 项 Python 测试通过；
- 共享契约生成零漂移，Desktop TypeScript 类型检查与生产构建通过；
- 控制器、UI、生命周期和安全 verifier 全部通过；
- 桌面端真实二维码经独立 `jsQR` 解码通过，Electron 视觉交互验收通过；
- 生产依赖安全审计为 0 个漏洞；
- Android JVM 测试 170 项通过；
- Android API 30、API 35 模拟器 instrumentation 测试各 68 项通过；
- Windows Runtime 到 Android 关联、状态回写和列表刷新闭环通过；
- 54 项功能证据均已生成，没有跳过项或以 mock 替代跨端协议闭环。

验收证据：

- `docs/android/testing/reports/WINDOWS_ANDROID_QR_PAIRING_ACCEPTANCE.md`
- `docs/android/testing/reports/WINDOWS_ANDROID_QR_PAIRING_ACCEPTANCE.json`
