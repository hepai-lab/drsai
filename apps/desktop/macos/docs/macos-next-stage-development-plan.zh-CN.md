# OpenDrSai macOS 下一阶段开发计划

更新时间：2026-07-29<br>
基线分支：`feature/desktop`<br>
基线提交：`d2bbd033`<br>
macOS 已发布版本：`1.5.1`<br>
macOS 开发版本：`1.5.3`<br>
Windows 对照版本：`1.5.3`<br>
当前发布判定：`v1.5.1 production-published / v1.5.3 development`

## 1. 阶段目标

下一阶段不重写 Windows 已经下沉到 `apps/desktop/shared` 的业务能力，重点完成四件事：

1. 补齐 macOS 对 Runtime Conversation 和 Remote Workspace V3 的主进程接线与恢复语义。
2. 在当前提交上重新建立 clean L4、完整 L5 和逐功能机器证据，消除旧提交回执与当前代码不一致的问题。
3. 在 Apple Developer 会员、Developer ID 和公证凭据到位后完成 signed L6。
4. 以 fail-closed 方式完成 OSS/CDN/GitHub 首发演练，只有真实证据齐全后才允许晋级 stable。

本阶段完成后，macOS 应达到以下两个层级之一：

- 签名尚未到位：`unsigned-validated / feature-parity-ready / production-promotion-blocked`；
- 签名和 L6 全部通过：`signed-update-verified / production-promotion-enabled`。

## 2. 当前基线与差距

### 2.1 已有能力

- Electron/React 主框架、主进程组合根和领域 IPC registrar 已建立。
- Swift Native Helper、版本化协议、能力协商和 XCTest 7/7 已完成。
- Runtime/Gateway 使用与 Windows 相同的 Python 后端代码和协议，macOS 使用独立 darwin-arm64 Runtime 产物。
- Chat、Agent、Thread、审批、Workspace、Git、终端、SSH、自动化、记忆、技能、分享、渠道、展示和语音的大部分逻辑已下沉到共享层。
- macOS 已具备 unsigned App、Runtime 可复现构建、packaged smoke、更新检查/下载、CDN 优先与 GitHub 回退、更新健康标记和 watchdog 回滚框架。
- OSS 不可变资产、stable 元数据最后晋级和失败恢复脚本已经实现。

### 2.2 P2 状态基线

当前机器台账共 50 点：

| 状态 | 数量 |
| --- | ---: |
| accepted | 31 |
| implemented_unsigned | 8 |
| in_progress | 9 |
| blocked_on_signing | 2 |
| not_started | 0 |

当前状态台账和进度文档仍绑定较早轮次；现有 L4/部分 acceptance 回执也绑定旧提交，不能直接作为 `3a6726cb` 的发布证据。

### 2.3 Windows/macOS 差距

共享 Preload 当前定义 275 个 IPC，Windows 注册 275 个，macOS 注册 273 个。macOS 明确缺少：

- `desktop:subscribe-thread-snapshot`
- `desktop:unsubscribe-thread-snapshot`

此外，若干相同 IPC 在 macOS 上只有本地语义，尚未覆盖 Windows 已有的 Runtime/Remote fallback：

- Thread 首次快照未优先读取 Remote/Runtime Conversation；
- Thread 消息搜索未查询远端 Runtime；
- Remote Workspace 保存了 `autoReconnect`，但应用重启时未恢复连接；
- 远程文件变化未向 Renderer 发布失效事件；
- Remote Workspace checkpoint、worktree、commit 和移动端同 Session 协作缺少 macOS packaged E2E。

### 2.4 签名阻塞

Apple Developer 已付款，但会员需要先变为 Active。当前仍缺：

- `Developer ID Application` 证书和对应私钥；
- Team ID；
- App Store Connect API Key、Issuer ID 和 Key ID；
- 可运行签名发布的 Apple Silicon self-hosted Runner；
- 一份低于候选版本的稳定签名 macOS Release。

在上述条件满足前，不得把 ad-hoc sealing、unsigned ZIP 或静态签名契约记为 signed L6。

## 3. 范围与非目标

### 3.1 本阶段范围

- Runtime Thread 实时同步与恢复；
- Remote Workspace 自动恢复、远端搜索和文件变化事件；
- 关键 Windows packaged 旅程的 macOS 等价验收；
- clean L4、完整 L5、signed L6；
- Developer ID、公证、Gatekeeper、DMG/ZIP、在线更新和回滚；
- P2 台账、全功能 72 点证据和发布判定同步更新。

### 3.2 非目标

- 不复制 Windows MSI、WiX、PowerShell、Windows Sandbox 或注册表实现；
- 不新建第二套 Python 后端；
- 不把 Windows 平台文件直接导入 macOS 平台目录；
- 不在本阶段承诺 Intel/x64 或 universal build；
- 不为提高更新成功率关闭 TLS、Runtime 兼容检查、签名检查或 Gatekeeper；
- 不在 signed L6 完成前开放生产 stable promotion。

## 4. 工作流总览

```text
M1 Runtime/Remote parity
  -> M2 macOS packaged parity
  -> M3 clean L4
  -> M4 full L5
  -> M5 signing/notarization readiness
  -> M6 signed L6
  -> M7 production rehearsal and launch
```

M1～M4 不依赖 Developer ID，可立即执行；M5 的代码和预检可并行完成，但真实证书步骤需要 Apple 会员 Active；M6～M7 必须在签名条件齐备后执行。

## 5. M1：Runtime Conversation 与 Remote Workspace 对齐

### M1-F01 Runtime Thread 实时订阅

实施内容：

1. 在 macOS Catalog IPC 中注册 `subscribe-thread-snapshot` 和 `unsubscribe-thread-snapshot`。
2. 复用 `shared/main/threadRuntimeSubscription.ts`，不得复制 Windows 订阅实现。
3. 按 `webContents + threadId` 管理唯一订阅，重复订阅先停止旧实例。
4. 窗口销毁、Thread 切换、Runtime stream 结束和 App shutdown 时释放订阅。
5. 支持 snapshot、增量事件、resume cursor 和 cursor expired 后重建快照。
6. 对不支持所需 capability 的 Runtime 返回 `false`，Renderer 保持显式降级，不伪造实时状态。

完成标准：

- IPC inventory 达到 `preload=275 / windows=275 / macos=275`；
- 同一事件不会重复进入 Thread；
- sequence 单调，重连后不丢失已确认项目；
- 窗口销毁后无残留 SSE、timer 或 subscription；
- packaged App 中可看到来自第二客户端的实时消息。

### M1-F02 Runtime/Remote Thread 首次快照

将 macOS `get-thread-snapshot` 调整为：

```text
Remote Workspace snapshot
  -> local Runtime conversation snapshot
  -> persisted local Thread snapshot
```

完成标准：

- 本地静态 Thread 行为不回归；
- Runtime Session 未连接时安全回退；
- Remote Workspace 离线时返回明确的 stale/offline 结果或本地 fallback；
- 非法 Thread ID 和跨 Workspace 访问失败关闭。

### M1-F03 远程消息搜索

实施内容：

- 搜索请求包含 Remote Thread 时查询远端 Runtime；
- 本地和远端结果统一排序、去重和截断；
- 不把远端 token、Gateway header 或内部 URL写入搜索结果和日志；
- 远端离线时明确标记不完整结果，不把部分结果误报为完整。

完成标准：本地、远端和混合 Thread 查询均有正向、离线、超时、越权和去重测试。

### M1-F04 Remote Workspace 自动恢复

实施内容：

1. 应用 ready 后读取持久化 Remote Workspace。
2. 只恢复 `autoReconnect=true` 的条目。
3. 对同一 host/path 使用 single-flight，避免重复 SSH tunnel 和 Gateway。
4. 恢复流程包含 host key、ControlMaster、端口转发、Gateway handshake、Runtime identity 和 Workspace registration。
5. 指数退避必须有上限；用户显式 disconnect 后取消自动恢复。
6. Runtime identity/generation 改变时清理旧 Thread 绑定和 cursor。

完成标准：正常重启、网络断开后恢复、Gateway 被杀、host key 改变、重复启动和用户取消均有测试。

### M1-F05 远程文件变化事件

实施内容：

- 为 macOS 接入 `desktop:workspace-file-change-event` publisher；
- Remote Gateway 支持事件流时订阅真实文件变化；
- 不支持事件流时使用有界、可停止的失效检查，不进行高频全目录轮询；
- Renderer 收到事件后只失效对应 Workspace/path 的文件树、预览和 diff。

完成标准：外部修改、Agent 修改、删除、重命名、断线重连和窗口关闭均不产生陈旧 UI 或资源泄漏。

### M1 门禁

建议新增或扩展：

- `verify:inventory`
- `verify:runtime-thread-subscription`
- `verify:remote-thread-content`
- `verify:remote-workspace-recovery`
- `verify:remote-file-events`
- `verify:mobile-session-sync`

## 6. M2：关键 Windows 功能的 macOS packaged 等价验收

本里程碑不机械复制全部 Windows 脚本，优先覆盖高风险、平台敏感和用户可见旅程。

### M2-F01 Remote Workspace 核心旅程

- SSH host key 批准与拒绝；
- Remote Gateway 安装、升级、取消、失败恢复；
- 文件树、预览、受控写入和外部冲突；
- Git diff、stage/revert、checkpoint、worktree 和 commit 审批；
- Remote Thread 实时消息、搜索和移动端同 Session 同步；
- Port Forward 创建、暂停、恢复、删除和 App 重启恢复。

### M2-F02 Debugger 与诊断

- 真实 Python DAP 启动、断点、停止和异常退出；
- CDP 会话连接、取消和进程清理；
- 诊断包秘密脱敏、权限 `0600` 和可复现性；
- 源码导航、错误归因和 Runtime/Gateway 关联；
- packaged App 退出后无 DAP/CDP/Browser 残留进程。

### M2-F03 任务与结果恢复

- Chat/Agent 断网重连；
- App 关闭、强杀和重启后 active run 恢复；
- Presentation/PDF 任务暂停、继续、取消和失败重试；
- 结果版本、预览、下载、本地编辑和分享撤销；
- 定时任务触发、幂等和重启恢复。

### M2-F04 macOS 系统能力

- Keychain CRUD、锁定、拒绝和迁移；
- TCC 状态、显式权限请求和系统设置跳转；
- 通知展示、点击回跳和拒绝状态；
- Finder/PDF/IDE LaunchServices 交接；
- 睡眠、唤醒、锁屏、显示器变化和网络恢复。

完成标准：每个旅程必须通过真实 packaged App 的 preload/IPC 入口执行，不接受直接调用内部函数代替产品路径。

## 7. M3：在当前提交上重建 clean L4

### 执行要求

1. 工作树干净，source snapshot 绑定精确 commit。
2. 使用锁定依赖构建 Runtime 两次，归档哈希一致。
3. 构建隔离 Bundle ID 的 unsigned arm64 App。
4. 验证 Runtime 安装、重定位、manifest、SBOM、provenance 和文件 inventory。
5. 执行 packaged smoke、Renderer L3、Native Helper、PTY、Gateway 和进程清理。
6. 生成 L4、P2、72 点 acceptance 和 release decision 回执。

### 完成标准

- 所有回执 commit 等于当前 HEAD；
- source snapshot 为 clean；
- Runtime 两次 SHA-256 完全一致；
- P0/P1 缺陷为 0；
- release decision 至少达到 `unsigned-validated`；
- 旧提交回执不得混入聚合结果。

## 8. M4：完整 unsigned L5

### 必测场景

- 100 次应用启动/退出；
- Gateway、Native Helper、PTY、Browser、DAP/CDP 的崩溃与恢复；
- App 强杀后的 Thread/Run/审批状态恢复；
- 2 小时持续运行；
- 睡眠/唤醒和网络切换；
- Remote Workspace 断线与自动恢复；
- CPU、RSS、文件描述符、子进程和临时文件预算；
- 最终残留进程为 0。

### 台账迁移目标

L5 通过后重新评估并尽量推进：

- P2-F01.1 基线；
- P2-F06.3 崩溃与强杀恢复；
- P2-F06.5 残留与泄漏预算；
- P2-F08.5 性能预算；
- P2-F09.1 unsigned Debug/dir 构建；
- P2-F10.2 unsigned packaged 门禁；
- P2-F10.3 Nightly 真机稳定性；
- P2-F10.5 证据聚合与发布判定。

状态迁移只能由当前 commit 的机器证据驱动，不按计划完成度人工提升。

## 9. M5：签名与公证准备

### 外部准备

- Apple Developer Membership 为 Active；
- Keychain 中存在且仅存在预期的 `Developer ID Application` 身份；
- 公证 API Key 保存在受控路径或 CI secret；
- `.p8`、证书私钥、密码和 2FA 不进入 Git、日志或聊天；
- release Runner 标签和 GitHub Environment reviewer 配置完成。

### 工程预检

- `preflight:release` 输出 `ready-to-build-signed-rc`；
- inside-out signing graph 完整覆盖 Helper、dylib、Electron Framework、App；
- hardened runtime 和 entitlements 最小化；
- stable Bundle ID、Team ID、Designated Requirement 固定；
- 候选版本高于上一稳定签名版本；
- 完整 DMG 与薄更新 ZIP 的 Runtime 元数据一致。

## 10. M6：signed L6

### L6 验收矩阵

1. Developer ID 签名和 `codesign --deep --strict`；
2. Apple notarization、ticket 和 stapling；
3. Gatekeeper `spctl --assess`；
4. 干净用户 DMG 安装和首次启动；
5. 上一稳定签名版本从 CDN 更新成功；
6. CDN 故障时 GitHub fallback 更新成功；
7. 损坏、摘要不一致、签名不一致和 Runtime 不兼容均拒绝安装；
8. 新版本在时限内写入健康标记；
9. 启动失败时 watchdog 恢复上一签名 App；
10. Workspace、用户数据、Keychain 引用、TCC 和通知授权保持；
11. 回滚只恢复 App，不回滚或删除用户数据；
12. L4/L5/L6、P2、72 点、缺陷和 artifact hash 聚合一致。

### 完成标准

只有以下字段全部为 true 才允许通过：

- `cdnUpdateInstalled`
- `githubFallbackInstalled`
- `healthConfirmed`
- `rollbackVerified`
- `userDataPreserved`
- `codesignVerified`
- `gatekeeperAccepted`
- `notarizationStapled`

## 11. M7：生产发布演练与首发

### 发布顺序

```text
构建一次
-> signed L6
-> GitHub draft
-> OSS 不可变版本资产
-> CDN HEAD/Range/digest
-> GitHub/OSS 字节一致性
-> GitHub Release publish
-> stable 元数据快照
-> 原子替换 stable latest-mac.yml
-> stable 校验
-> 失败时自动恢复旧 stable
```

### 首发观察

- 下载页面 DMG 成功率；
- CDN channel 请求和 ZIP 下载成功率；
- GitHub fallback 使用率；
- digest、签名和 Runtime 不兼容失败率；
- 更新健康确认与 watchdog 回滚次数；
- 带宽、Range、缓存和错误码；
- 首发回执、Release URL、tag、commit 和资产摘要归档。

## 12. CI 调整计划

### PR 门禁

- IPC inventory 必须 275/275/275；
- Runtime Thread subscription 单元与集成测试；
- Remote Workspace 恢复/搜索/文件事件测试；
- TypeScript、Native Helper、security、UX、coverage、defect；
- unsigned 更新 feed、薄包和发布顺序契约。

### Nightly

- self-hosted Apple Silicon；
- clean L4 重建；
- Remote/Runtime packaged 旅程；
- 100 次重启和 2 小时 soak；
- 资源、残留和恢复证据。

### Signed RC

- 只允许 tag 或显式授权的 workflow dispatch；
- Developer ID、公证和上一稳定版本预检；
- signed L6 全矩阵；
- `--require-releasable` 必须通过。

### Production

- 只允许受保护 Environment；
- 版本资产不可覆盖；
- stable key 是唯一可替换对象；
- 任一校验失败自动恢复旧 stable，且不得删除历史资产。

## 13. 测试和证据要求

每个验收回执至少包含：

- schemaVersion、testId、platform、arch；
- commit、source snapshot hash、artifact hash；
- App version、Runtime version、protocol version；
- 测试场景、开始/结束时间、结果和失败码；
- 签名阶段的 Team ID、Designated Requirement 摘要和 notarization 状态；
- 不包含 token、Cookie、Authorization、预签名 URL、`.p8` 或证书私钥。

证据文件默认权限应为 `0600`；聚合器必须拒绝旧 commit、缺字段、重复 testId 和签名级别不足的回执。

## 14. 风险与控制

| 风险 | 控制 |
| --- | --- |
| Windows/macOS 平台逻辑继续漂移 | 优先下沉共享模块；IPC inventory 强制全覆盖 |
| Runtime 事件重复或乱序 | session sequence、cursor 持久化、幂等 upsert |
| Remote Workspace 重复 tunnel | host/path single-flight 与 generation ownership |
| 远端断线后 UI 显示陈旧数据 | stale/offline 状态和文件失效事件 |
| L5 使用旧产物 | commit/source/artifact 三重绑定 |
| ad-hoc 签名误报正式通过 | signed L6 强制 Developer ID、Team ID、公证和 Gatekeeper |
| stable 发布中断 | 版本资产不可变、元数据最后切换、旧 stable 快照恢复 |
| 薄更新与 Runtime 不兼容 | 版本和 archive SHA-256 双重匹配，失败要求完整 DMG |
| 私密凭据泄漏 | Keychain/CI secret、日志脱敏、回执字段白名单 |

## 15. 交付物

### 代码

- macOS Runtime Thread subscription handlers；
- Remote/Runtime snapshot 和搜索路由；
- Remote Workspace startup recovery；
- remote file change publisher；
- 对应 shutdown、cleanup 和错误映射；
- 必要的共享模块重构，不产生 Windows/macOS 交叉导入。

### 测试

- IPC 275/275/275；
- Runtime/Remote conversation 同步；
- Remote Workspace 恢复与文件事件；
- macOS packaged parity journeys；
- clean L4、完整 L5、signed L6。

### 文档

- 更新 `macos-phase-2-progress.zh-CN.md`；
- 更新 P2 机器状态台账；
- 修正自动更新实施计划中“CDN/OSS 尚未接入”的过期描述；
- 更新 release runbook、签名 Runner 和首发回滚操作；
- 更新交接文档的 HEAD、版本和可信证据基线。

## 16. 最终完成定义

下一阶段只有在以下条件全部满足时才算完成：

1. macOS IPC inventory 与共享 Preload 完全一致；
2. Runtime/Remote Thread 可实时同步、恢复和搜索；
3. Remote Workspace 可在重启后安全恢复，并正确发布文件变化；
4. 关键 Windows 用户旅程存在 macOS packaged 等价证据；
5. 当前发布 commit 的 clean L4 和完整 L5 通过；
6. Developer ID、公证、Gatekeeper 和 signed L6 通过；
7. CDN 更新、GitHub fallback、健康确认和自动回滚均在真机完成；
8. P2 和 72 点台账由当前机器证据重新计算；
9. release decision 输出 `releasable`；
10. stable promotion 完成一次受保护演练，失败恢复路径得到验证。

若第 6～10 项因 Apple 会员或外部凭据尚未满足而无法执行，本阶段只能标记为：

> `unsigned parity complete / signed release blocked on external credentials`

不得标记为正式发布完成。
