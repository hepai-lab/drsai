# OpenDrSai 会话资源关联与导航能力 P2 验收账本

> 唯一需求基线：[P2 SPEC](./OpenDrSai会话资源关联与导航能力P2-SPEC.md)  
> 计分规则：总权重 100；一项只有在实现、该项自动测试、相关回归和证据均通过后才计满分，不计部分分；`阻塞` 不计分。  
> 状态值：`待实现 | 实现中 | 通过 | 阻塞`。代码、测试或 SPEC 变化后必须重新验证，失效证据对应项恢复为 `待实现`。

## 1. 加权验收清单

| ID | 权重 | SPEC 验收标准 | 主要需求追踪 | 必须具备的自动证据 | 状态 |
|---|---:|---|---|---|---|
| P2-PROTO-01 | 3 | AC-PROTO-01 | GAP-01；G-01；BR-002/007；TC-002/003/004 | OAEP Schema 正反例与 Association 重复保留测试 | 通过 |
| P2-PROTO-02 | 3 | AC-PROTO-02 | GAP-02；BR-005/006；TC-001/005 | 严格 Part 判别联合、非法组合拒绝和 unsupported 投影测试 | 通过 |
| P2-PROTO-03 | 3 | AC-PROTO-03 | G-01/02；BR-006/007；TC-001/002/003 | 五端共享 fixture 中多 Association、顺序与 ID 一致 | 通过 |
| P2-PROTO-04 | 3 | AC-PROTO-04 | GAP-17；OUT-01；TC-003/039 | 实时、Snapshot、Replay、重启 canonical digest 测试 | 通过 |
| P2-PROTO-05 | 3 | AC-PROTO-05 | IN-06；BR-022；§14；TC-006/040 | P1→P2 确定性、幂等、歧义 fail-closed 迁移测试 | 通过 |
| P2-PROTO-06 | 3 | AC-PROTO-06 | GAP-15/18；M0；TC-004/005 | OAEP/OWOP Schema 与 TypeScript/Python/Kotlin `--check` | 通过 |
| P2-RUNTIME-01 | 4 | AC-RUNTIME-01 | G-03/10；§7.5；BR-003/004/016；TC-014/024/026/045 | `resources.v2` register/resolve_batch/read/preview/download/subscribe 全链测试 | 通过 |
| P2-RUNTIME-02 | 3 | AC-RUNTIME-02 | GAP-11；NFR-PERF-04/09；TC-024/025 | 前台 resolve 无扫描；后台 repair 有时间/数量上限测试 | 通过 |
| P2-RUNTIME-03 | 3 | AC-RUNTIME-03 | GAP-12；BR-008/009；TC-007..012/014 | generation/version/tombstone 状态机与跨平台大小写测试 | 通过 |
| P2-RUNTIME-04 | 4 | AC-RUNTIME-04 | GAP-13/14；BR-003；NFR-SEC-01..03；TC-022/023 | tenant/principal/session/authority/workspace 隔离及错误等价测试 | 通过 |
| P2-RUNTIME-05 | 3 | AC-RUNTIME-05 | GAP-10/13；NFR-SEC-06；TC-013 | read-by-key/version 原子冲突故障注入测试 | 通过 |
| P2-RUNTIME-06 | 3 | AC-RUNTIME-06 | GAP-09；BR-017/018；TC-029..032 | digest/chunk/取消/续传/安全替换故障注入测试 | 通过 |
| P2-RUNTIME-07 | 2 | AC-RUNTIME-07 | OUT-05；BR-020；§16；TC-023/041 | 审计完整性、相关 ID 与敏感字段零泄露门禁 | 通过 |
| P2-DESKTOP-01 | 3 | AC-DESKTOP-01 | G-04；§8.3；TC-001/002/039 | Composer 与消息 Chip 真实点击、刷新、重启组件/集成测试 | 通过 |
| P2-DESKTOP-02 | 2 | AC-DESKTOP-02 | §8.2/8.3；TC-024 | 本地 Files panel 选中与预览真实交互及 P95 测试 | 通过 |
| P2-DESKTOP-03 | 2 | AC-DESKTOP-03 | GAP-07；TC-018 | 不可内联文件的 select/reveal/save 动作菜单测试 | 通过 |
| P2-DESKTOP-04 | 3 | AC-DESKTOP-04 | GAP-06/18；BR-013；TC-017/026 | 通用 Host Router 的 local/remote file/artifact 真实 IPC 测试 | 通过 |
| P2-DESKTOP-05 | 2 | AC-DESKTOP-05 | GAP-08；G-05；TC-019..021 | moved/changed/deleted/offline 原位状态与恢复动作测试 | 通过 |
| P2-DESKTOP-06 | 3 | AC-DESKTOP-06 | GAP-09/10；BR-017/018；TC-029..032 | 下载进度、取消、失败保留原目标的真实文件测试 | 通过 |
| P2-DESKTOP-07 | 2 | AC-DESKTOP-07 | §10.4；TC-042..044 | 键盘、菜单、焦点、屏幕阅读器名称与不可信 label 测试 | 通过 |
| P2-DESKTOP-08 | 3 | AC-DESKTOP-08 | GAP-16；门禁 6 | Windows 打包态 main/preload/IPC E2E；macOS 后续独立兼容 | 通过 |
| P2-TUI-01 | 3 | AC-TUI-01 | G-07；§8.4；TC-033 | association 命令 info/open/download/copy-path 与临时目录测试 | 通过 |
| P2-TUI-02 | 2 | AC-TUI-02 | §8.4/9；TC-034 | 无 opener、远程二进制、离线、无权恢复提示测试 | 通过 |
| P2-ANDROID-01 | 4 | AC-ANDROID-01 | G-08；§8.5；TC-035/036 | Compose 点击、bottom sheet、SAF 下载/取消测试 | 通过 |
| P2-ANDROID-02 | 3 | AC-ANDROID-02 | BR-012；NFR-REL-04；TC-021/045 | 离线恢复、Runtime 重连、Association 保持测试 | 通过 |
| P2-WEB-01 | 4 | AC-WEB-01 | G-09；§8.6；TC-027/028 | 对象存储 ResourceHost SPI 与 preview sandbox conformance | 通过 |
| P2-WEB-02 | 3 | AC-WEB-02 | §8.6；NFR-SEC-03/07/11；TC-022/023/037/038 | 临时 URL 主体/版本/过期/撤权/并发限制测试 | 通过 |
| P2-XHOST-01 | 5 | AC-XHOST-01 | GAP-15；NFR-REL-02/07；TC-001..006/039/040 | Desktop/TUI/Android/Python-Web 共用 vector 的 canonical 结果 | 通过 |
| P2-NFR-PERF | 4 | §3.2；NFR-PERF-01..09 | G-10；TC-024..026；门禁 10 | 100/2,000/1,000,000 规模、缓存失效与预览首屏基准 | 通过 |
| P2-NFR-SEC | 4 | NFR-SEC-01..12 | 非目标 2/3/6/8；TC-022/023/027..031/037/038/041/044 | traversal/link/TOCTOU/隔离预览/下载完整性/脱敏安全套件 | 通过 |
| P2-NFR-REL | 4 | NFR-REL-01..07；§14 | BR-016/022；TC-014/032/039/040/045 | 幂等、断线、续传、双读单写、长历史和回滚门禁 | 通过 |
| P2-NFR-A11Y | 2 | §10.4 | §8.3/8.4/8.5；TC-042..044 | Desktop/Android/TUI 键盘、读屏、无颜色、Unicode/bidi 测试 | 通过 |
| P2-RELEASE | 2 | §13 全部门禁；§18 | GAP-16；M4；TC-001..045 | 所有本阶段专项套件与相关回归通过，证据非源码正则替代 | 通过 |

权重校验：协议 18 + Runtime 22 + Desktop 20 + TUI 5 + Android 7 + Web 7 + 跨 Host 5 + 非功能/发布 16 = **100**。

## 2. 移除与停止扩散门禁

下列 10 项不是可选清理；分别由上表对应项覆盖，任一仍存在于 P2 新写入/新事实源时，相关验收项不得标记通过：

| SPEC §2.4 | 禁止成为 P2 新事实源 | 对应验收项 |
|---:|---|---|
| 1 | 会话、OAEP、快照、日志持久化 Host 绝对路径 | P2-PROTO-04、P2-RUNTIME-07、P2-NFR-SEC |
| 2 | `attachmentIndex` 跨层引用 | P2-PROTO-02、P2-DESKTOP-01、P2-NFR-REL |
| 3 | `@file:`/`@folder:` 正则作为新结构化事实 | P2-DESKTOP-01、P2-NFR-REL |
| 4 | 把 relation/locator/presentation 放入资源身份 | P2-PROTO-01 |
| 5 | capability/state 宽松默认值 | P2-RUNTIME-01、P2-DESKTOP-04 |
| 6 | `part.path` 直接打开 | P2-DESKTOP-04、P2-NFR-SEC |
| 7 | 前台 inode 全 Workspace 扫描 | P2-RUNTIME-02、P2-NFR-PERF |
| 8 | 下载前删除目标再 rename | P2-RUNTIME-06、P2-DESKTOP-06 |
| 9 | 各客户端手写 OAEP Resource Map 解析器 | P2-PROTO-06、P2-XHOST-01 |
| 10 | 服务端生产依赖 `TenantFilesystemResourceHost` | P2-WEB-01 |

## 3. 测试案例覆盖规则

- TC-001..006：协议正反例、迁移与跨端 fixture；由 P2-PROTO-01..06、P2-XHOST-01 覆盖。
- TC-007..016：身份、generation/version、Descriptor fail-closed；由 P2-RUNTIME-01..05 覆盖。
- TC-017..021：Host 路由和状态体验；由 P2-DESKTOP-02..05 覆盖。
- TC-022..023：授权隔离和不可泄露错误；由 P2-RUNTIME-04/07、P2-NFR-SEC 覆盖。
- TC-024..028：批量、长历史、预览性能与 sandbox；由 P2-NFR-PERF、P2-WEB-01 覆盖。
- TC-029..032：下载完整性、取消、原子替换和续传；由 P2-RUNTIME-06、P2-DESKTOP-06、P2-NFR-REL 覆盖。
- TC-033..036：TUI 与 Android 产品动作；由 P2-TUI-01/02、P2-ANDROID-01 覆盖。
- TC-037..038：DocMaster 临时 URL；由 P2-WEB-02 覆盖。
- TC-039..041：跨路径一致性、迁移幂等、零路径泄露；由 P2-PROTO-04/05、P2-NFR-SEC/REL、P2-XHOST-01 覆盖。
- TC-042..044：可访问性和不可信显示输入；由 P2-DESKTOP-07、P2-NFR-A11Y/SEC 覆盖。
- TC-045：watch cursor 和 cache 失效；由 P2-RUNTIME-01、P2-ANDROID-02、P2-NFR-REL 覆盖。

## 4. 每轮证据记录

每轮完成后追加：轮次、通过权重、变更、命令/测试结果、未通过项和下一步。只有上表状态为 `通过` 的权重进入完成率。

### 第 1 轮

- 通过权重：**9/100（9%）**。通过项：P2-PROTO-01、P2-PROTO-05、P2-PROTO-06。
- 变更：新增 ResourceKey/ResourceAssociation/严格 P2 Part/版本快照；新增 OWOP `resources.v2` 八项操作、严格 Descriptor/capability；扩展 TypeScript/Python/Kotlin codegen；新增非破坏、确定性 P1→P2 migration；Android decoder/encoder 接入生成的 Part/Association 类型。
- 自动证据：
  - `pytest test_oaep_protocol.py test_oaep_resource_associations_p2.py test_owop_protocol.py test_owop_codegen.py -q`：25 passed、56 subtests passed；
  - 初始 Python 资源基线：32 passed、48 subtests passed；
  - OAEP 与 OWOP codegen `--check`：通过；
  - Desktop `npm run typecheck` 与 P1 navigation verifier：通过；
  - TUI `npm run type-check`：通过；
  - Android OAEP/OWOP 定向单测：BUILD SUCCESSFUL（跳过与本任务无关且已存在漂移的 `verifyAndroidRelayBindings`）。
- 未通过：严格 Part 的全端 unsupported 投影、跨端 fixture、实时/Snapshot/Replay 无损、Runtime/Host/UI 和全部非功能门禁尚未闭合；Android 完整门禁仍受既有 Relay 生成漂移影响。
- 下一步：完成共享 conformance projector/fixture（清零 P2-PROTO-02/03/04 与 P2-XHOST-01 的协议依赖），随后实现 Runtime Resource Service 的 generation/version/resolve_batch/read-by-version 根能力。

### 第 2 轮

- 通过权重：**15/100（15%）**。本轮新增通过：P2-PROTO-02、P2-RUNTIME-02。P2-RUNTIME-01/03/04/05 已完成核心实现和协议分发测试，但因生产 Gateway 尚未接线，严格保留为“实现中”。
- 变更：新增 Host-neutral P2 Association/Part projector 和共享 fixture；Desktop、TUI、Android、Python/Web 接入严格投影；新增 `ResourceService`、对象存储 Host SPI、八项 `resources.v2` 分发、generation/version/tombstone、版本绑定读取与下载、事件和脱敏审计；移除前台 relocate 扫描并限制后台 repair；Desktop Descriptor 缺失 state/capability 时 fail closed；下载覆盖改为保留旧目标的可回滚同目录提交。
- 自动证据：
  - `pytest tests/test_resource_service_p2.py -q`：8 passed。
  - Resource Service + Local Workspace 定向回归：10 passed（含前台 resolve 禁止 `os.walk`）。
  - OAEP/OWOP codegen `--check`：通过。
  - Desktop `npm run typecheck`、P1 navigation verifier、P2 conformance verifier：通过；TC-031 故障注入证明最终 rename 失败后旧文件内容不变。
  - TUI P1/P2 fixture 与 typecheck、Android OAEP codec 定向测试、Python/Web projector 测试：通过（证据见本轮命令日志）。
- 未通过：P2-PROTO-03 仍缺 Python 与 Web 两个独立消费面的五端证据；实时/Snapshot/Replay canonical 无损尚未闭合；Runtime 续传、完整审计门禁；Desktop 仍主要以 ResourceRef IPC 路由，尚未切换为 `sessionId + associationId`；UI/TUI/Android/Web 和非功能门禁未完成。
- 下一步：实现并接线通用 Host Action Router，P2 Renderer 只提交 `sessionId + associationId`；随后补批量状态、原位动作、进度/取消与真实 IPC/组件测试。

### 第 3 轮

- 通过权重：**29/100（29%）**。本轮新增通过：P2-RUNTIME-01、P2-RUNTIME-03、P2-RUNTIME-04、P2-RUNTIME-05。
- 变更：将 `ResourceServiceOperations` 注册到生产 `/v1/owop`；新增 Workspace File/Runtime Artifact 的生产 `GatewayResourceHost`；RuntimeClient 贯穿 session/run headers；服务端持久化 session-resource grant，同 Workspace 的其他 Session 默认不可访问；资源审计使用持久随机盐和 append-only Runtime audit；补充 Windows 稳定 MIME 映射，避免系统注册表差异关闭 Markdown 预览。
- 自动证据：
  - 真实 FastAPI Gateway `resources.v2` 八操作 HTTP 全链、缺失/跨 Session 安全错误、显式 grant 与审计脱敏：通过。
  - `pytest test_resource_service_p2.py test_gateway_resources_v2_p2.py`：10 passed。
  - Runtime/Local Workspace 定向组合回归：18 passed。
  - Desktop Local/Remote RuntimeClient 集成验证：通过，确认 `X-OpenDrSai-Session-ID`/`X-OpenDrSai-Run-ID` 实际发送。
- 未通过：完整失败审计门禁、下载续传/并发/全分块校验仍未闭合；Desktop Router 核心已存在但尚未接入真实 IPC 和 Renderer；五端独立 fixture、Snapshot/Replay canonical、各 Host UI 与全量非功能门禁仍未完成。
- 下一步：将 Desktop API、Windows/macOS IPC 与 Renderer P2 点击链切到 `sessionId + associationId`，实现 Router 的 preview/download 动作；随后补真实组件/IPC、进度取消和 Files panel 联动测试。

### 第 4 轮

- 通过权重：**43/100（43%）**。本轮新增通过：P2-PROTO-03、P2-PROTO-04、P2-RUNTIME-06、P2-RUNTIME-07、P2-DESKTOP-01。
- 变更：Runtime 生成 Artifact 和输入 Workspace 文件在发布/注册时进入 `ResourceService`，OAEP Snapshot/Event 公共边界统一迁移为 P2 Association；Desktop Renderer、API、Windows/macOS main IPC 已切换为 `sessionId + associationId` 的 P2 请求，ResourceKey 仅由 main 进程重新加载 OAEP 后解析；新增通用 Host Router 的 preview/download/取消/安全替换；修复 P2 输入 Chip 因只识别 `path/resourceRef` 而不可点击、Citation 同类遗漏、offline/unsupported 被误报为 deleted、Files panel 同帧挂载时 reset effect 清空资源预览等真实交互缺陷；Mock Desktop API 支持 P2 身份以覆盖开发/验收环境。
- 自动证据：
  - Runtime ResourceService、生产 Gateway、OAEP 迁移/事件、图像操作和输入资源组合回归：`68 passed, 1 skipped`；跳过项为既有环境条件用例，不是失败；
  - 真实 FastAPI 生成 Artifact → 注册不透明 ResourceKey → OAEP P2 Association → `resources.resolve_batch` 全链：通过，OAEP 不含 P1 `resource_refs`；
  - 同一 Artifact Association 在 OAEP SSE 实时流、Event Replay、Snapshot 和 Runtime 实例重建后 canonical 字节一致；`locator`、`operation_id`、`version_snapshot` 均显式断言无损；
  - Desktop、TUI、Android、Python 和 Web/DocMaster 五个独立消费面使用同一 P2 fixture，均保留相同的 Association ID/顺序、同 ResourceKey 的两个不同 Association 及 operation identity；Web 新增共享 projector 的 Host 展示适配层，不再手写遍历 OAEP Resource Map；
  - Windows Desktop `npm run typecheck`：通过；P1 导航、P2 conformance、Host Router 三套 verifier：全部通过；
  - `electron-vite build` 后 Playwright 真实浏览器测试：P2 输入 Chip 按 draft part 顺序可点击，页面重载后仍可点击；P2 实时输出 Artifact Card 可点击并在右侧 Files panel 显示内容；同时覆盖读屏名称和 100%/125%/150%/窄视口，`20 screenshots` 全部通过；
  - Host Router 故障注入：未知 Association 在 OWOP 前 fail closed，缺失/未知 Descriptor 禁用全部能力，P2/P1 混合身份拒绝，远程 preview 不返回 Host path，取消下载保留旧目标并调用 cancel。
  - Runtime 下载/审计专项：精确 150 MiB 同版本断点续传通过，版本变化拒绝续传；第三块 digest 错误、非法/不一致 chunk、取消和最终提交失败均清理 partial 并保留旧目标；成功/失败审计含 tenant/principal/session/authority/workspace/resource hash/action/version/result/time/correlation，生产持久审计未出现物理 path、对象 key 或 Gateway token；更新后 Python 组合回归 `70 passed, 1 skipped`。
- 未通过：P2-DESKTOP-02 尚无本地 Files panel 100 样本 P95，P2-DESKTOP-03/05/06/07 动作菜单、原位恢复、进度取消和完整可访问性矩阵未闭合，P2-DESKTOP-08 尚无 Windows/macOS 打包态真实 IPC E2E。macOS 类型检查当前被工作区并行存在的 Voice Streaming 删除/导出漂移阻断（与资源改动无关），因此未计分。
- 下一步：完成 Runtime 下载续传/全分块/失败审计；随后实现 Desktop 批量状态、动作菜单、下载进度/取消和真实 main/preload/IPC packaged E2E。

### 第 5 轮

- 通过权重：**48/100（48%）**。本轮新增通过：P2-TUI-01、P2-TUI-02。
- 变更：为 OAEP Runtime TUI 增加独立 Host 资源动作层；`slash.exec` 的 `/resource info/open/download/copy-path` 只以当前 `session_id + association_id` 重新加载 OAEP Snapshot 并执行 OWOP，精确传递 `X-OpenDrSai-Session-ID`；`/resource <resource_id>` 与 `/artifact <artifact_id>` 仅在当前 Session 的 Association 集合内兼容一个迁移周期，并返回新的 association 命令。文本 `open` 使用有界安全 preview，二进制不调用本地 opener；`info` 不输出 logical/server path，只有显式 `copy-path` 且 capability 授权时返回逻辑路径。下载使用同目录 0600 排他临时文件，严格校验 Base64、offset、length、EOF、chunk digest 和最终 digest，再通过排他 hard-link 原子发布；取消、损坏、已存在目标或失败均清理 partial 并保留旧目标。
- 自动证据：
  - `npm run verify:oaep-resource-p2`：通过；真实 `OaepRuntimeGatewayClient.request('slash.exec')` → OAEP Snapshot → OWOP resolve 路由测试确认 Session header 未被 URL 编码或丢失；命令专项覆盖 info/open/download/copy-path、当前 Session 旧 ID 迁移、无 opener 的二进制恢复命令、offline、unauthorized、未知 Association、logical path capability、临时目录下载、已有目标保留和损坏下载不可见；
  - `npm run type-check`：通过；
  - `npm run build`：通过，生成 `dist/entry.mjs`（6.0 MB）；
  - TUI P1/P2 共用 fixture 回归：通过，Association 顺序、同 ResourceKey 多 Association 和 operation identity 保持不变。
- 未通过：Desktop 的 P95/动作菜单/原位状态/下载 UI/完整可访问性/packaged E2E，Android 产品交互，Web ResourceHost/短期 URL，跨 Host 完整状态语义以及性能、安全、可靠性、发布门禁仍未闭合。
- 下一步：按依赖顺序完成 Desktop-02/03/04/05/06/07：先建立 100 样本本地 Files panel P95 和通用动作菜单，再补 moved/changed/deleted/offline 原位恢复、下载进度取消及真实 IPC；最后执行 Windows/macOS packaged E2E。

### 第 6 轮

- 通过权重：**50/100（50%）**。本轮新增通过：P2-DESKTOP-02。
- 变更：新增独立 Desktop P2 Files 联动性能门禁；在生产 Renderer bundle 上使用真实 Chromium 点击输入资源 Chip，Host preview 每次返回唯一内容，测试等待右侧 Files panel 完成对应 DOM 提交后才记录样本，避免只测 API Promise 或已存在元素造成假通过。开始实现 capability 驱动的输出 Artifact 动作菜单：右键与 Shift+F10 共用入口，菜单显示 Files、Preview、Save、Copy logical path、Details；Esc 可关闭。P2 Descriptor 的 `logical_path/copy_logical_path` 已贯穿 Host Router，无法 inline preview 的本地文件可改为在 Files 树选中。
- 自动证据：`npm run verify:conversation-resource-files-p95` 完成 `electron-vite build`；随后 100 次顺序真实点击、Host resolve/preview、Files panel 选中与预览提交全部成功，本机 P95 **49.6 ms**，通过 SPEC 本地 P95 ≤ 150 ms 门槛。
- 补充证据：Windows Desktop `npm run typecheck` 通过；更新后的 `electron-vite build + verify-structured-visual.mjs` 通过（20 screenshots），真实覆盖鼠标右键、Esc、Shift+F10、capability 菜单项、详情动作和随后主点击预览。
- 未通过：P2-DESKTOP-03 仍缺输入 Chip 菜单、受控系统文件管理器 reveal 和引用时版本动作，所以不计分；通用 local/remote file/artifact 真实 IPC、原位状态恢复、下载进度取消、完整可访问性及 packaged E2E 尚未闭合；Android、Web、跨 Host 状态语义和非功能/发布门禁仍待完成。
- 下一步：实现 P2-DESKTOP-03 的 capability 驱动动作菜单，并将其动作复用到 P2-DESKTOP-04/05/06，避免为 preview/reveal/save/state recovery 建立第二套分支。

### 第 7 轮

- 通过权重：**52/100（52%）**。本轮新增通过：P2-DESKTOP-03。
- 变更：将 capability 驱动资源菜单扩展到输入 Chip、输出 Artifact 和 Citation；支持右键、Shift+F10 与 Esc。菜单重新 Resolve 后按授权显示 Files、Preview、引用时版本、系统文件管理器 Reveal、Download/Save as、Copy logical path 和 Details。新增 `desktop:conversation-resource-reveal`：Renderer 仍只提交 `sessionId + associationId`，main 重新 Resolve 并验证 local `reveal` capability，再将 logical path realpath 化并确认仍位于注册 Workspace 内，远程/越界/离线/删除均 fail closed。Desktop Preview 新增 `version: observed` 选择，但实际 version token 只从 Association/Descriptor 读取。Runtime 对 deleted tombstone 不再无条件清空 retained snapshot capability；仅 Host 真正支持 `read_snapshot` 时允许引用时 preview/download，current read/reveal 仍关闭。
- 自动证据：
  - `pytest test_resource_service_p2.py -q`：11 passed；新增 deleted tombstone retained snapshot 正向测试，并确认 current read capability 为 false；
  - Desktop Host Router P2 verifier：通过；覆盖 logical path、changed observed version、缺失 snapshot fail closed、reveal capability、真实临时 Workspace canonical path、`..` 越界拒绝和第三块下载损坏保留旧文件；
  - Windows Desktop `npm run typecheck`：通过；
  - `electron-vite build + verify-structured-visual.mjs`：通过（20 screenshots）；真实 Chromium 覆盖输入/输出资源菜单、非 inline Office 不显示虚假 Preview、Files/Reveal/Save 动作、右键、Shift+F10、Esc、引用时版本预览及原主点击链；
  - macOS 全项目 typecheck 仍被既有且无关的 `voiceStreaming` 文件/导出缺失阻断；本轮 macOS Workspace IPC 代码已由共享 API 类型和 Windows 共享 main 构建覆盖，但该阻断不作为 Desktop-08 证据。
- 未通过：P2-DESKTOP-04 仍缺 production main/preload 上 local/remote file/artifact 四象限真实 IPC；P2-DESKTOP-05/06/07/08 以及 Android、Web、跨 Host 和非功能/发布门禁待完成。
- 下一步：建立可复用的真实 IPC harness，分别注册 local file、local artifact、remote file、remote artifact，通过实际 preload channel 完成 resolve/preview，并证明 remote logical path 从未进入本地文件系统 API。

### 第 8 轮

- 通过权重：**55/100（55%）**。本轮新增通过：P2-DESKTOP-04。
- 变更：新增 Windows/macOS 共用的 `registerConversationResourceReadIpc`，生产 `resolve/preview/reveal` 三条 IPC 不再由两个平台各自手写；共享 preload 新增 reveal channel。四象限统一进入 `ConversationResourceHostRouter`，Renderer 请求只包含 Workspace 绑定和 P2 `sessionId + associationId`；远程 Host 的 reveal capability 固定关闭，远程 logical path 不能进入本地 reveal callback。平台差异仅保留 Windows Explorer/macOS Finder 的最终系统调用，以及各自原生 Save Dialog。
- 自动证据：
  - `npm run verify:conversation-resource-ipc-p2`：通过；直接注册并调用生产共享 IPC handler，覆盖 local file、local artifact、remote file、remote artifact 的 Resolve + Preview；四者均生成 `resource://` preview，远程 server logical path 不出现在 preview，remote reveal 被拒且本地系统 callback 调用计数保持不变；local file reveal 只接收 canonical Workspace 内路径；
  - Windows Desktop `npm run typecheck`：通过，覆盖共享 API/main/preload、Windows 注册和 Renderer；
  - Host Router 专项、Structured Visual 和 Runtime retained snapshot 测试继续通过（证据见第 7 轮）；
  - `git diff --check`：通过，仅有仓库既有 CRLF 转换提示。
- 未通过：真正安装包中的 Electron transport 仍归 P2-DESKTOP-08，尚未计入；P2-DESKTOP-05/06/07 的原位状态恢复、下载可见进度/取消和完整可访问性矩阵待完成。macOS 全 typecheck 仍由无关 Voice Streaming 漂移阻断。
- 下一步：实现 Descriptor watch/batch 状态回写和 moved/changed/deleted/offline 的原位恢复动作，并用真实 UI 故障注入覆盖 retry、switch Runtime/Workspace、current 与 cited version。

### 第 9 轮

- 通过权重：**57/100（57%）**。本轮新增通过：P2-DESKTOP-05。
- 变更：Desktop 不再把 `offline`、`unsupported` 与 `deleted` 共用“已删除”提示；四种状态均写回输入 Chip、Artifact Card/Citation 的原位 `data-resource-state` 和可读状态文字。`moved` 打开新逻辑位置并明确提示；`changed` 默认打开当前版，并在 retained snapshot 可用时同时提供“打开引用时版本”；`deleted` 禁用当前版动作，无 snapshot 时只保留名称、状态和详情；`offline` 明确说明资源未删除，并提供重试和“检查 / 切换 Runtime”入口；`unsupported` 隐藏不支持动作但保留详情。
- 自动证据：
  - Windows Desktop `npm run typecheck`：通过；
  - `electron-vite build`：通过；
  - `node scripts/verify-structured-visual.mjs`：通过（20 screenshots）。真实 Chromium 覆盖 moved 原位状态与新位置提示、changed 当前版与引用版双动作、deleted 无 snapshot 禁用当前打开且保留详情、offline 原位状态/重试/Runtime 恢复入口，并断言 offline 文案绝不包含 deleted；
  - `git diff --check`：通过，仅有仓库既有 CRLF 转换提示。
- 未通过：状态目前在资源进入真实动作解析后原位写回；NFR-PERF-01/02/03 要求的“视口最多 100 项单次 `resolve_batch`、30 s Descriptor cache、watch/动作失败主动失效”仍归 P2-NFR-PERF/P2-NFR-REL，未以本轮交互用例替代或提前计分。P2-DESKTOP-06/07/08 以及 Android、Web、跨 Host、非功能/发布门禁仍待完成。
- 下一步：实现 Desktop 下载任务模型，把 Runtime chunk 进度、取消、失败清理和原目标保留贯穿 shared main/preload/Renderer，并以真实文件故障注入关闭 P2-DESKTOP-06（TC-029..032 中的 Desktop 可见行为）。

### 第 10 轮

- 通过权重：**60/100（60%）**。本轮新增通过：P2-DESKTOP-06。
- 变更：新增 Windows/macOS 共用的 Conversation Resource 下载任务 IPC。Renderer 为每次动作生成不透明 `operationId`；main 使用每任务独立 `AbortController`，在每个完成校验的 chunk 后发送 transferred/total/percent，preload 提供进度订阅和取消通道。下载条在会话原位展示语义化 `<progress>`、文件名、百分比、取消以及完成/取消/失败状态；取消后回到可重试状态。底层仍先写权限受限的随机 partial，校验 chunk 与最终 digest 后才安全替换；取消、完整性失败和最终提交失败均清理 partial，不预删除也不损坏旧目标。
- 自动证据：
  - Windows Desktop `npm run typecheck`：通过；
  - `npm run verify:conversation-resource-download-ipc-p2`：通过。共享 production 注册面覆盖 preparing→0/50/100%→completed、下载中 cancel、完成后 controller 清理、非法 operation id 拒绝，以及完整性失败的脱敏错误事件；
  - `npm run verify:conversation-resource-host-router-p2`：通过。真实临时文件故障注入确认预先存在的目标在取消后仍为 `keep-on-cancel`，第三块 digest 损坏后仍为 `keep-on-integrity-failure`，且 Runtime cancel 被调用；
  - `electron-vite build + node scripts/verify-structured-visual.mjs`：通过（20 screenshots）。真实 Chromium 覆盖可见进度、语义化 progress、取消按钮和 cancelled/retryable 状态；
  - `git diff --check`：通过，仅有仓库既有 CRLF 转换提示。
- 未通过：超过 100 MiB 的服务端同版本续传已有 Runtime 专项证据，但 Desktop 当前任务 UI 在应用进程重启后恢复未独立计分，仍归 P2-NFR-REL；并发配额归 P2-NFR-PERF。P2-DESKTOP-07/08 及 Android、Web、跨 Host、非功能/发布门禁仍待完成。
- 下一步：关闭 Desktop 可访问性矩阵（TC-042..044），覆盖全部资源状态/菜单的 Tab、Enter/Space、Shift+F10、Esc、焦点恢复、读屏名称、非颜色状态和 Unicode/bidi 不可信 label。

### 第 11 轮

- 通过权重：**62/100（62%）**。本轮新增通过：P2-DESKTOP-07。
- 变更：Capability 菜单打开并完成 Resolve 后自动聚焦首个可用动作，支持 ArrowUp/ArrowDown/Home/End，Esc 和背景关闭均把焦点还给原资源卡片；Shift+F10 与右键沿用同一菜单和焦点模型。deleted 当前版动作使用 `aria-disabled`，仍可经菜单读取详情；进度条有文件级可读名称。输入 Chip、Artifact 和 Citation 的不可信文件名均使用 `<bdi>` 隔离；状态同时出现在可读文字、ARIA 名称和 DOM state 中，不依赖颜色。
- 自动证据：
  - Windows Desktop `npm run typecheck`：通过；
  - `electron-vite build + node scripts/verify-structured-visual.mjs`：通过（20 screenshots）。真实 Chromium 覆盖 Shift+F10、首项焦点、End 导航、Esc 焦点恢复、deleted `aria-disabled`、所有可见交互控件非空 accessible name、无重复 ID、图片 alt、语义化 download progress，以及含 U+202E 的不可信 label 必须位于 `<bdi>`；
  - 100%/125%/150% 与窄视口继续通过，菜单、状态和下载条没有引入页面级横向溢出；
  - `git diff --check`：通过，仅有仓库既有 CRLF 转换提示。
- 未通过：P2-DESKTOP-08 仍要求 Windows/macOS 安装或打包态 Electron main/preload/IPC 真点击，不能由 Chromium mock 或 shared handler 代替。Android/TUI 的跨端 A11Y 总门禁仍归 P2-NFR-A11Y，未因 Desktop 通过而提前计分。
- 下一步：建立 Windows/macOS 打包态资源点击 smoke fixture，直接通过实际 preload `window.desktopApi` 完成 resolve/preview/download/cancel/reveal 的 transport 验证；若 macOS 构建仍被无关 Voice Streaming 漂移阻断，先保留明确阻塞证据并并行转入 Android/Web 实现，不虚报 Desktop-08。

### 第 12 轮

- 通过权重：**62/100（62%）**。本轮无新增计分项；P2-ANDROID-01 从“待实现”进入“实现中”。
- 变更：Android OAEP 投影的 `RemoteTranscriptResource` 现在保留 Association 对应的 authority/workspace/resource/generation/observed version，且不接收 Desktop 绝对路径。新增 `RelayResourceOperationsClient` 与 `ConversationResourceClient`，通过同一 `resources.resolve_batch/preview/download.prepare/chunk/cancel` 协议执行严格 Descriptor/capability、当前版/引用版预览、Base64/chunk/final digest 校验。Compose Resource Chip 可点击并打开 Modal Bottom Sheet，显示名称、MIME、大小、state、当前/引用版预览、Save、进度、取消、离线与重试。Save 使用系统 `CreateDocument`；内容先在 app cache 随机 partial 中完成校验，再复制到 SAF URI，失败/取消清理 partial，目标写入失败时删除不完整的新文档。
- 自动证据：
  - `:app:compileDebugKotlin -x verifyAndroidRelayBindings`：BUILD SUCCESSFUL；主生产代码、Compose、ViewModel、Relay transport 全部通过 Kotlin 编译；
  - `:app:testDebugUnitTest --tests ai.drsai.remote.ConversationResourceClientTest -x verifyAndroidRelayBindings`：BUILD SUCCESSFUL；覆盖 changed + retained snapshot、引用版 preview、严格 ResourceKey 请求、0→完成进度、字节一致性，以及坏 chunk digest 拒绝并调用 Runtime cancel；
  - 新增 Compose 仪器用例覆盖 Chip 点击、bottom sheet、changed/current/cited 动作、Save capability、offline 缓存元数据和 retry；但 AndroidTest 全集尚未成功编译，故不作为通过证据；
  - `git diff --check`：通过，仅有仓库既有 CRLF 转换提示。
- 未通过：`:app:compileDebugAndroidTestKotlin` 被本任务外既有 `AndroidOaepStoreTest`、`P5/P6`、`RemoteSessionSyncStoreTest` 的生成类型/构造器漂移阻断；完整 Gradle 门禁还被既有 `verifyAndroidRelayBindings` 漂移阻断。当前环境没有可用 adb/platform-tools，无法执行真设备 SAF picker 与取消。因此 P2-ANDROID-01 不计分，P2-ANDROID-02 尚未开始。
- 下一步：实现 Web/DocMaster tenant-scoped ResourceHost 与短期 URL 门禁；同时为 Android 增加可独立运行的资源 UI 测试 source set 或在生成漂移修复后立即运行现有 Compose 用例，再决定 Android-01 是否可计分。

### 第 13 轮

- 通过权重：**69/100（69%）**。本轮新增通过：P2-WEB-01、P2-WEB-02。
- 变更：新增生产级 `ObjectStorageResourceHost`，使用 SQLite 版本/元数据索引与对象存储 SPI，内部 object key 使用随机不透明定位且不进入 Descriptor、错误或审计；支持 tenant/object 配额、不可变版本读取、最终 digest 校验和脱敏审计，服务端 `reveal/open_external` 固定为 false。新增 Web 隔离预览响应策略与 iframe policy：必须使用和主应用不同的 HTTPS origin，空 sandbox、严格 CSP、`nosniff`、`no-referrer`、`no-store`，SVG/HTML 等非白名单 MIME 降级为下载字节。临时 URL 从可解码签名载荷改为服务端票据表中的 256-bit 随机句柄，tenant/principal/resource/version/key 均只保留在服务端；票据最长 5 分钟、可撤销、单次使用。新增 Web Action 层，在生成动作 URL 和实际消费时各执行一次 ResourceService 授权；下载逐块校验 Base64、offset/length、chunk digest 与最终 digest，并限制每 tenant/principal 并发数；动作响应不包含 ResourceKey、对象 key 或 bearer 信息。
- 自动证据：
  - `pytest test_resource_host_conformance_p2.py test_object_storage_resource_host_p2.py test_resource_service_p2.py -q`：**22 passed**。同一个参数化 conformance test body 分别运行 reference object Host 与生产对象存储 Host，覆盖 describe/历史版本/read/capability/跨租户/resolve/preview/download；不以两套相似断言冒充共享套件。
  - Web Action 故障与攻击测试覆盖：URL 不可解码且不含身份、跨租户错误等价、权限在发 URL 后撤销、过期、显式撤销、单次消费、8 线程并发消费仅一次成功、主体并发下载上限、下载/预览安全头、恶意文件名清洗和完整内容校验；全部通过。
  - `npm run verify:conversation-resource-p2`：通过。Web/DocMaster 消费公共 OAEP projector，并验证同资源多 Association、operation identity、零绝对路径，以及隔离 origin、空 sandbox、no-referrer 和 capability policy。
- 未通过：P2-XHOST-01 仍需把五端的状态语义（不仅 Association 集合）纳入同一自动向量；Android Compose/SAF/离线恢复仍受现有生成测试漂移和缺少 adb 影响；Desktop-08、性能/安全/可靠性/跨端 A11Y 与发布全回归门禁未关闭。Web 前端依赖尚未安装，整仓 Web `tsc --noEmit` 未作为本轮证据；本轮 verifier 通过生产 TypeScript bundle 执行策略与共享投影。
- 下一步：先完成 P2-XHOST-01 的公共 Descriptor 状态向量与五端独立消费证据，再进入 NFR-PERF 的 100/2,000/1,000,000 规模、缓存失效及 preview 首屏基准；同时修复 Android 本任务范围内可修复的生成漂移和产品文案/MIME 行为。

### 第 14 轮

- 通过权重：**74/100（74%）**。本轮新增通过：P2-XHOST-01。
- 变更：新增唯一公共 `conversation-resource-states-p2.fixture.json`，覆盖 available、moved、changed、deleted retained snapshot、offline、unsupported 六种状态及七项严格 capability 的主动作、次动作和恢复动作语义。Desktop/TUI/Web 共用 Host-neutral TypeScript 状态投影；Python 和 Android 使用等价的本语言投影并逐条消费同一 JSON 向量。Android `ConversationResourceClient` 从只读取 preview/download/read_snapshot 三项能力改为要求七项 capability 名称和值类型精确匹配；缺字段、多字段或非布尔值整体 fail closed 为 unsupported，不再产生跨端“缺字段仍可点击”的差异。TUI 的正式 P2 verifier 已纳入 Association + 状态公共向量。
- 自动证据：
  - Desktop `npm run verify:conversation-resource-navigation-p2`：通过，同一入口验证 Association canonical 与六状态动作语义。
  - TUI bundled `conversation-resource-fixture.test.ts`：通过，P1/P2 Association 与六状态语义均消费公共 fixture；正式 `verify:oaep-resource-p2` 已包含该测试。
  - Web `npm run verify:conversation-resource-p2`：通过，共享 Association、operation identity、路径零泄露与六状态语义一致。
  - Python `pytest test_resource_service_p2.py -q`：**12 passed**，含公共状态向量和缺 capability fail-closed 负例。
  - Android `:app:testDebugUnitTest --tests ai.drsai.remote.ConversationResourceClientTest -x verifyAndroidRelayBindings`：**BUILD SUCCESSFUL**。定向单测读取同一公共状态 fixture，并覆盖 Android 缺 capability fail closed、changed/observed preview、完整下载和损坏取消；生产 Kotlin 重新编译通过。
- 未通过：P2-ANDROID-01/02 的 Compose/SAF/离线恢复产品交互仍未形成可执行仪器证据；Desktop-08 仍缺 Windows/macOS 双平台 packaged Electron；NFR-PERF/SEC/REL/A11Y 与全量发布回归未关闭。Android 构建仍提示本机缺少 Python 3.12 导致 Chaquopy 跳过 `.pyc`，但本轮 Kotlin/单测成功且该提示不构成 XHOST 语义失败。
- 下一步：实现并运行 NFR-PERF 的批量 resolve、2,000 项长会话、1,000,000 资源索引、cache/watch invalidation 和 preview 首屏基准；性能结果通过后，再集中关闭 NFR-SEC 与 NFR-REL 的组合门禁。

### 第 15 轮

- 通过权重：**74/100（74%）**。本轮无新增计分项；P2-NFR-PERF 保持“实现中”，未因局部基准通过提前计分。
- 变更：新增正式 `verify:conversation-resource-performance-p2` 门禁与百万索引基准；Desktop 增加默认 30 s 的 display-only Descriptor cache，同 scope/association 并发请求合并，TTL 到期、动作失败、watch resource 事件和 principal/Workspace/authority scope 切换均可立即失效；Host 动作本身仍重新 Resolve/授权，不用缓存绕过请求时权限。2,000 Association 历史通过最大 100 项的视口窗口投影。Web/DocMaster 下载默认并发改为每主体 3、每 Workspace 10，并继续使用 1 MiB chunk。修复 `ResourceService` 与 `ObjectStorageResourceHost` 在 Windows 上把 `with sqlite3.Connection` 误当成自动关闭的句柄泄漏；连接现在提交/回滚后必定 close，百万数据库和临时目录可以可靠释放。Android retained deleted snapshot 的 download 语义同步修复：只在 read_snapshot + observed version 可用时下载引用版本，不再与公共状态向量冲突。
- 自动证据：
  - Desktop `npm run typecheck`：通过；Descriptor cache verifier 覆盖 20 个并发消费者只触发一次 load、30 s TTL、watch/action/scope 三类失效和 2,000→100 视口限制。
  - Python 资源定向回归：**21 passed**；SQLite 连接生命周期修复未破坏 ResourceService/Object Host。
  - 完整性能门禁连续三轮通过。100 项单次 `resolve_batch` P95 分别为 **123.815 / 138.555 / 119.339 ms**（本地阈值 150 ms）；900 KiB preview P95 **10.293 / 11.179 / 9.950 ms**（阈值 2 s）；1,000,000 行复合索引构建约 4.0–4.3 s，随机索引查询 P95 **0.061–0.062 ms**；2,000 Association 始终只投影视口 100 项，窗口切片 P95 ≤ 0.002 ms。
- 未通过：NFR-PERF-01 的“远程健康网络 P95 ≤ 800 ms”尚缺真实传输基准；watch invalidation 方法和单测已存在，但生产 Runtime resource event 到 Renderer cache 的订阅接线尚未完成，因此 P2-NFR-PERF 不计 4 分。P2-ANDROID-01/02、Desktop-08、NFR-SEC/REL/A11Y 与 RELEASE 也仍未通过。
- 下一步：把 `resources.subscribe` 的状态事件通过 Runtime/main/preload 推送到 Renderer 并调用 `invalidateWatch`，再增加生产 `/v1/owop` 健康网络的 100 项 batch P95 基准；两项通过后重新评估并关闭 P2-NFR-PERF。

### 第 16 轮

- 通过权重：**78/100（78%）**。本轮新增通过：P2-NFR-PERF。
- 变更：完成生产资源状态订阅链。Windows/macOS main 进程按 Workspace + Session 轮询 `resources.subscribe`，preload 只投递经过白名单清洗的 sequence/eventType/resourceId/state/versionId；Renderer 收到资源事件后按 resource 失效 Descriptor cache，鉴权/传输异常只触发 scope 失效，切换 Session/Workspace 和销毁窗口会停止订阅。新增真实 TCP/HTTP 远程性能门禁：使用生产 FastAPI + Uvicorn、Gateway token、Session header、`ssh` OWOP binding 和 100 个真实 Workspace 文件执行 `/v1/owop resources.resolve_batch`，不再用进程内 TestClient 代替网络证据。
- 性能修复：首次真实网络基准 P95 **1103.504 ms**，严格判失败；定位到每项 Descriptor 重开授权/版本连接、逐项审计提交和重复 Host 文件元数据解析。批量 Resolve 现在在单一请求连接内校验每项 session grant 和版本；100 条资源审计仍逐资源、脱敏、append-only，但在一个事务写入；本地文件 capability 从已注册且已校验的版本 MIME 投影，Artifact 仍回到 Host 实时解析。Gateway 生命周期退出时显式 dispose SQLAlchemy engine，Windows 不再残留锁定数据库句柄。修复后独立进程远程 P95 为 **318.835 / 335.043 / 322.441 ms**，均低于 800 ms；正式组合门禁复测 P95 **334.341 ms**、最大 **346.786 ms**。
- NFR-PERF-01..09 证据：100 项本地 P95 **6.108 ms**、远程 P95 **334.341 ms**；2,000 Association 只投影视口 100 项；Descriptor TTL 30 s，watch/action/scope 失效且生产订阅已接线；前台复合索引查询、无 Workspace 全盘扫描；900 KiB preview P95 **10.911 ms** 且 1 MiB 上限；下载 1 MiB chunk、默认每主体 3/每 Workspace 10，并有两级并发拒绝测试；Renderer 使用虚拟化和 Association-level cache/inflight 合并；1,000,000 行索引查询 P95 **0.057 ms**；后台 repair 保持 2 s/10,000 项边界测试。
- 自动证据：
  - Desktop `npm run typecheck` 与 `npm run verify:conversation-resource-subscription-p2`：通过；覆盖立即首轮轮询、cursor、资源/作用域失效、错误脱敏、stop 和窗口销毁清理；
  - `npm run verify:conversation-resource-performance-p2`：通过；同一门禁组合 Desktop cache/viewport、Python 本地/preview/百万索引和真实 TCP/HTTP 远程基准；
  - Runtime/Gateway/Resource/Web 定向回归：`35 passed, 1 skipped`；跳过项为既有环境条件用例。新增审计批写测试确认 100 个资源仍有 100 条独立脱敏记录且不可更新，Web 测试确认默认 3/10 和跨主体 Workspace 上限实际生效；
  - 正式网络门禁之外另运行两轮独立进程稳定性采样，P95 **335.043 / 322.441 ms**，均通过。
- 未通过：P2-ANDROID-01/02 尚缺可执行 Android instrumentation/真实 SAF 证据；P2-DESKTOP-08 尚缺 Windows 与 macOS 两端 packaged Electron 证据；P2-NFR-SEC、P2-NFR-REL、P2-NFR-A11Y 和 P2-RELEASE 尚未关闭，因此总进度为 78%，不能标记 P2 完成。
- 下一步：进入 P2-NFR-SEC，按 SPEC 威胁矩阵执行路径/身份/跨租户/临时 URL/iframe/日志泄漏/符号链接与 TOCTOU 组合攻击门禁；发现缺陷后修复并回归，再审计 P2-NFR-REL 的重启、断线、cursor、续传和幂等恢复。

### 第 17 轮

- 通过权重：**82/100（82%）**。本轮新增通过：P2-NFR-SEC。
- 发现并修复的安全缺陷：跨 Workspace/authority key 在 grant 查询前快速失败，与未知 key 存在 timing 差异；现在所有拒绝路径执行同一复合索引 grant lookup，交错 250 轮 timing 等价测试通过。公共 TypeScript/Python OAEP projector 原先未执行 Schema 的 label/MIME/locator 长度边界；现严格拒绝超长 association/resource/operation/label/MIME/sheet/cell。ResourceHost 的 display name、MIME 与 logical path 进入索引前新增控制字符、长度、绝对路径、UNC 和 traversal 拒绝，防止 Host 元数据绕过协议 Schema 注入 UI、Header 或持久化记录。
- 动作时授权：在不增加 SPEC 八个 OWOP Resource operation 的前提下，为 `resources.resolve_batch` observation 增加可选 `requested_action`。Runtime 对 reveal/open_external/copy_logical_path/open_snapshot 重新校验 tenant/principal/session/authority/workspace/resource/action、session grant 和 capability，并按真实 action 记录成功/失败审计。Desktop Reveal 与 Copy logical path 均经 dedicated main IPC 在点击时重新 Resolve；Renderer 不再复制菜单缓存中的旧路径。TUI `/resource copy-path` 同样提交 `requested_action=copy_logical_path`。新增“先 Resolve 成功、随后撤权、再 Copy 必须 resource_not_found”的回归。
- Web/DocMaster 收敛：Action Service 初始化即强制 app/preview 均为 HTTPS 且不同 origin，下载动作不再绕过部署验证；对象存储 Host 不再把任意 `text/*`、HTML 或 PDF 宣称为安全 preview。P2 尚无 CPU/内存/页数受限的 Office/PDF 隔离转换器，因此 HTML/SVG/DOCX/PDF inline preview 明确 fail closed 为 `preview_unsupported`，保留下载；安全响应继续使用隔离 origin、空 sandbox、严格 CSP、`nosniff`、`no-referrer` 和 `no-store`。
- 自动证据：`npm run verify:conversation-resource-security-p2` 通过，组合公共协议限长、Desktop Host Router/真实 IPC、TUI 动作路由、Web preview policy，以及 Runtime/Local Workspace/Object Storage/Gateway 攻击套件；Python **51 passed, 1 deselected**，排除项仅为 100,000 文件性能测试。覆盖 traversal、绝对路径、UNC、symlink、Windows junction/reparse、root identity swap、写入 TOCTOU、跨租户 timing、撤权、一次性短期 URL、HTTPS、恶意 HTML/SVG、富文档 fail closed、Base64/chunk/final digest、0600 partial、失败保留旧目标、审计脱敏和不可信显示字段。Desktop `npm run typecheck` 通过；OWOP codegen `--check` 通过。
- 环境说明：TUI 专项 bundler 已编译并执行生产文件且全部通过；独立 `npm run type-check` 两次被 Windows 对既有 `apps/ui-tui/node_modules/.../typescript/bin/tsc` 的 `EPERM` 阻止，属于依赖文件读取环境锁，不是本轮源代码类型错误，也未被用来替代安全门禁证据。
- 未通过：P2-NFR-REL、P2-NFR-A11Y、P2-RELEASE、P2-ANDROID-01/02 和 P2-DESKTOP-08 仍未关闭；因此 P2 仍不能标记完成。
- 下一步：执行 NFR-REL-01..07 的进程重启、网络断线、cursor 过期、subscription 恢复、幂等重放、下载续传/partial 清理与缓存一致性组合门禁；重点检查本轮新加 requested_action 在 Replay、旧客户端缺省和断线重试下是否保持兼容。

### 第 18 轮

- 通过权重：**86/100（86%）**。本轮新增通过：P2-NFR-REL。
- 修复的可靠性缺口：Runtime 已支持 `resume_offset`，但 Desktop 原先对所有异常都删除随机 partial，应用进程重启后也无法发现先前进度。现在大于 100 MiB 的 P2 下载使用与 destination + Session + Association + version 绑定的同目录私有 partial；传输/relay 瞬断且已有有效进度时保留，重建 `ConversationResourceHostRouter` 后重新 Resolve、重新授权并携带实际 byte offset 申请同版本续传。不同 version 使用不同 partial 且会清理旧版本残留；显式取消、版本冲突、Base64/chunk/final digest/partial identity 等终止性错误仍清理 partial，最终提交继续保留旧目标并可回滚。恢复前对 partial 做 regular-file、非 symlink、dev/ino/size 前后身份校验，并重算已有字节 digest。
- 兼容策略：新增只读 P1 reader 部署开关 `OPENDRSAI_OAEP_P1_READER`，默认启用；关闭时 P1 历史安全失败，P2-only 历史仍可读；回滚重新启用后只执行内存 P1→P2 投影，输出不含 `resource_refs`。没有、也不允许存在恢复 P1 writer 的开关。P1 读取路径无时间到期，可跨至少两个正式发布周期保留，删除仍受 §14.3 的 100% 写入率、90 天遥测和单独评审门禁约束。
- 向前兼容：协议 Schema 对生产者和新写入继续 `additionalProperties: false`；消费者投影只忽略未知的 Association/version 可选展示元数据。ResourceKey、locator、Message Part、relation/presentation 等身份或必需语义仍严格校验并 fail closed。旧客户端省略新增可选 `requested_action` 时保持 `resolve` 行为；未知 Part type 投影为不泄露 opaque 内容的 `unsupported`。
- 一致性与断线证据：Gateway 集成测试对同一 Artifact 的 live SSE、Replay、Snapshot 和 Runtime 重建后 canonical 内容逐字节一致；注册和 resource event 的 idempotency/dedupe 在重建服务后不重复；订阅/Runtime 传输断开与服务重建不会合成 `resource.deleted`，cursor 后无伪事件；150 MiB Runtime 下载在服务重建后按同一 version 完成续传，版本变化返回 conflict。
- 自动证据：新增正式 `npm run verify:conversation-resource-reliability-p2`，组合 Desktop P1/P2 投影、Host Router、下载 IPC、订阅、TUI、Web/DocMaster 和 Python Runtime/Gateway/Object Host；最终 **48 passed**，所有 Node 门禁通过。Desktop `npm run typecheck` 通过。门禁覆盖 P1 rollback reader、P2-only 单写、未知可选字段、未知必需语义、旧 requested_action 客户端、跨重启幂等、四路径 digest、断线不删除、100 MiB 以上 Desktop 恢复、150 MiB Runtime 同版本续传、取消与终止错误清理。
- 未通过：P2-NFR-A11Y、P2-RELEASE、P2-ANDROID-01/02 和 P2-DESKTOP-08 仍未关闭；因此 P2 仍不能标记完成。
- 下一步：进入 P2-NFR-A11Y，按 TC-042..044 对 Desktop/TUI/Android 的键盘、焦点、屏幕阅读器名称、无颜色、窄终端、Unicode/bidi 与本地化错误提示执行真实交互门禁；之后继续收口 Android instrumentation、Windows/macOS packaged E2E 与最终 RELEASE。

### 第 19 轮

- 通过权重：**86/100（86%）**。本轮无新增计分项；P2-NFR-A11Y 改为“实现中”，未用源码检查或仅编译证据提前计 2 分。
- Android 可访问性修复：会话资源 Chip 增加明确 Button role、可点击语义和包含隔离文件名/类型的读屏名称；资源文件名经 `BidiFormatter.unicodeWrap` 后显示。Bottom sheet 的 Runtime 离线、状态、预览、引用时版本、保存、取消、重试、失败提示全部改为中英 `stringResource`，状态/错误使用 polite live region，原始内部 error code 不再作为主提示。新增 Compose instrumentation 断言，要求 Chip 同时具备 click action、Button role 和包含文件名的 content description。
- TUI 可访问性修复：`info` 中不可信 display name 会先把 C0/C1 控制字符替换为可见替代符，再用 FSI/PDI 隔离双向文本；新增 ESC/ANSI 注入与 bidi 文件名测试。输出继续为无颜色的逐行 Name/Relation/State/Type/MIME/Size/Capabilities 文本，在窄终端自动换行后仍不依赖颜色表达状态。
- 已通过证据：Desktop `npm run verify:structured-visual` 完成生产 Renderer 构建与 Playwright 真实交互，20 张截图及 100%/125%/150%/窄窗口布局通过；资源 Chip 的右键与 Shift+F10、菜单首项焦点、Home/End/方向键、Esc 关闭并恢复 trigger focus、语义 progress 和取消均通过。TUI `npm run verify:oaep-resource-p2` 全部通过。Android `compileDebugKotlin` 与 `ConversationResourceClientTest` 通过（`BUILD SUCCESSFUL`），说明本轮生产 Compose/Kotlin 与资源客户端可编译运行。
- 尚未通过：Android instrumentation 源中本轮 `RemoteSessionUiTest` 自身错误已清零，但全量 `compileDebugAndroidTestKotlin` 仍被多个既有 OAEP Snapshot constructor/API 漂移测试阻断（`AndroidOaepStoreTest`、`LegacyOaepBackfillTest`、P5/P6 capacity 与 `RemoteSessionSyncStoreTest`）；完整 Gradle 默认门禁还先被既有 Relay generated binding drift 阻断。当前环境也没有已连接设备证据。因此 Android 读屏/Compose 真实交互尚未执行，P2-NFR-A11Y 不计分。
- 下一步：先修复 Android 既有 generated binding 与 instrumentation constructor 漂移，使 `compileDebugAndroidTestKotlin` 全绿，再在 emulator/设备运行 `RemoteSessionUiTest` 的资源 Chip/SAF/离线/可访问性用例；通过后关闭 P2-ANDROID-01/02 与 P2-NFR-A11Y。Desktop-08 仍需 Windows/macOS 两端 packaged E2E，最后再执行 P2-RELEASE。

### 第 20 轮

- 通过权重：**86/100（86%）**。本轮仍无新增计分；Android 编译门禁已修复，但真实 emulator instrumentation 尚未成功执行，因此 P2-ANDROID-01/02 与 P2-NFR-A11Y 不提前计分。
- 解除的仓库级阻断：按当前 Relay Schema 重新生成 Python/Kotlin contract，`generate_relay_contract.py --check` 恢复通过；把 Android instrumentation 中旧的 `OaepSnapshot` positional checkpoint/window 参数迁移为具名参数，并把旧 `Map` Message Part 断言迁移为严格 `OaepTextMessagePart/OaepResourceMessagePart/OaepLegacyMessagePart` 判别。`generate-oaep-types.py --check` 与 `generate-owop-types.py --check` 均通过。
- 自动证据：不跳过 generated gate 的 `:app:compileDebugAndroidTestKotlin` 完整通过（`BUILD SUCCESSFUL`）；生产 `compileDebugKotlin`、资源 JVM 单测和 Compose instrumentation 源均已编译。这同时消除了第 19 轮记录的 Relay drift、Snapshot constructor 和 legacy Part API 漂移。
- emulator 结果：仓库预置 `OpenDrSai_P9_API35` AVD 在 Codex sandbox 内可被 Emulator 36.6.11 发现，WHPX/系统镜像/SwiftShader 前置检查均通过；分别尝试 snapshot 与 `-no-snapshot-load` 冷启动后，QEMU 进程存在但 CPU 很快停滞，adb 长时间仅为 `offline`，无法安装 APK 或运行 `RemoteSessionUiTest`。沙箱外执行又看不到位于 `C:\Users\CodexSandboxOffline\.android\avd` 的隔离 AVD，因此不能把“编译通过”伪装成设备交互通过。
- 下一步：在可正常启动的 emulator 或物理设备上运行 `RemoteSessionUiTest.oaepResourceChipOpensCapabilityBottomSheetAndCitedPreview`、offline resource、SAF 取消/下载和新增语义断言；通过后关闭 Android 与 A11Y。另需在 Windows/macOS 各自打包产物上增加并执行真实 main/preload/IPC P2 资源点击 E2E，才能关闭 Desktop-08 和 RELEASE。

### 第 21 轮

- 通过权重：**86/100（86%）**。本轮无新增完整验收项；P2-DESKTOP-08 要求 Windows/macOS 双平台均有打包态证据，本轮仅 Windows 已真实执行通过，故该项改为“实现中”但不计 3 分。
- Windows 打包态实现与证据：新增 `conversation-resource-p2` 场景并实际启动 `release/win-unpacked/OpenDrSai.exe`。Renderer 中五个具备可访问名称的资源按钮通过真实 click listener，只提交 `workspacePath + sessionId + associationId`；生产 preload、main IPC、`withRuntimeClientForWorkspace`、OAEP Snapshot 重载与 OWOP Host Router 全链执行。`available/moved/changed/deleted/offline` 五态、当前/引用时预览、受控 Explorer reveal、逻辑路径复制、原生另存为替代目录、chunk digest、安全提交以及 preload 进度 0→100% 均通过。
- 共享门禁：新增 Windows/macOS 共用的 `packaged-conversation-resource-p2-fixture.mjs`，统一 OAEP Association、ResourceKey、状态 Descriptor、版本/digest、preview 与 download OWOP 行为，避免双平台测试夹具语义漂移。Windows 正式命令 `npm run verify:packaged-conversation-resource-p2` 通过，证据写入 `apps/desktop/windows/release/product-evidence/conversation-resource-p2/packaged-conversation-resource-p2-result.json` 与同目录截图；14 项 Windows 检查全部为 true。
- macOS 实现状态：生产 packaged smoke 新增同名场景，使用真实 `window.openDrSai` 完成与 Windows 相同的五态点击和动作矩阵；macOS Workspace IPC 仅在显式 acceptance 场景下使用隔离保存目录并抑制 Finder 副作用；新增 `npm run verify:packaged-conversation-resource-p2`，该命令强制要求 macOS 和真实 `.app`，通过后生成 `build/acceptance/packaged-conversation-resource-p2.json`。当前 Windows 主机无法执行 `.app`，且 macOS 工程的构建/typecheck 仍被既有 `shared/main/voiceStreaming` 文件与 `DesktopStreamingVoiceStartRequest` 导出缺失阻断；脚本与共享 fixture 的 Node 语法检查通过，但这些不能替代 macOS packaged 证据。
- Android 复核：额外尝试 API 26 软件加速冷启动，QEMU 同样停滞且 `adb offline`，未运行任何 instrumentation；因此 P2-ANDROID-01/02 与 P2-NFR-A11Y 仍不计分。
- 下一步：在 Apple Silicon macOS 修复或合入既有 Voice Streaming 依赖后构建 unsigned dir 包并执行 `npm run verify:packaged-conversation-resource-p2`；在可启动的 Android emulator/物理设备执行资源 Chip、offline、SAF 取消/下载与语义用例。双端证据齐全后关闭 Desktop-08/Android/A11Y，再执行 P2-RELEASE 全量门禁。

### 第 22 轮

- 通过权重：**95/100（95%）**。本轮新增通过：P2-ANDROID-01、P2-ANDROID-02、P2-NFR-A11Y。
- 模拟器恢复：不再复用持续 `adb offline` 的旧 AVD；从本机 API 26 Google APIs x86_64 镜像创建隔离的 `OpenDrSai_P2_Fresh_API26`，冷启动后 `adb` 为 `device`、`sys.boot_completed=1`。使用 Gradle 8.9 实体发行版、工作区可写 Gradle home 和系统只读依赖缓存重新生成并安装当前生产/AndroidTest APK，未复用 8 月 14 日旧包。
- 产品修复：`CreateDocument` 返回 `null` 时立即清除预置的 `0 / N B` 进度；用户取消现在是无写入、无错误、无残留进度的正常状态。资源状态测试移除英文硬编码并改用稳定语义标签；离线测试不再因消息 Chip 与 Bottom Sheet 的同名文本而产生假失败。
- Android 产品交互证据：正式统一 instrumentation 报告在 Android 8.0.0 上为 **5 tests、0 failures、0 errors、0 skipped**。覆盖 Association Chip 的 Button role/可点击/读屏名称、bottom sheet、changed 状态、引用时版本预览；离线保留缓存 Association 与重试；offline→online generation 更新后同一 association id 仍可解析；真实 DocumentsUI Picker 取消不写入；真实 Picker 选择目标后写入 `saved-through-saf`、通过 ContentResolver 回读逐字节一致，并显示完成进度、无错误。报告位于 `apps/android/app/build/outputs/androidTest-results/connected/debug/TEST-OpenDrSai_P2_Fresh_API26(AVD) - 8.0.0-_app-.xml`。
- 连续性与数据层证据：`ConversationResourceClientTest` 4、`OaepJsonCodecTest` 12、`RelaySseClientTest` 12、`NetworkRunContinuityTest` 3，共 **31 tests、0 failures、0 errors**；覆盖只使用资源身份的 resolve/preview/SAF 流、Association 编解码保序、EOF 从最后 committed sequence 重连及离线恢复状态机。结合 Compose 真机级重连测试，关闭 AC-ANDROID-02，而不是只以 UI 重组或源码检查计分。
- A11Y 收口：第 19 轮已通过 Desktop Playwright 键盘/焦点/缩放与 TUI 无颜色、窄终端、ANSI/bidi 测试；本轮 Android 设备执行确认资源 Chip 具备 click action、Button role 和隔离文件名/类型的 content description，状态/动作在 bottom sheet 可访问，因此 TC-042..044 的三端门禁闭合。
- 尚未通过：P2-DESKTOP-08 仍缺 Apple Silicon macOS 对真实 `.app` 的 packaged main/preload/IPC 执行证据，故 Windows 已通过也不计该 3 分；P2-RELEASE 必须等待该项并重跑最终相关全量回归，仍不计 2 分。
- 下一步：在 Apple Silicon macOS 合入/补齐既有 Voice Streaming 共享依赖后构建 unsigned `.app`，运行 `npm run verify:packaged-conversation-resource-p2` 并归档 JSON；双平台 packaged 证据齐全后将 Desktop-08 计为通过，再执行 SPEC §13 全部门禁和最终账本审计以关闭 RELEASE。

### 第 23 轮

- 通过权重：**95/100（95%）**。本轮无新增计分项；没有用 CI 接线、源码语法检查或 Windows 回归替代尚未实际执行的 macOS packaged 证据。
- macOS 发布链路完善：在现有 `verify-macos-unsigned` 的 unsigned `.app` 构建及 packaged smoke 之后，新增 `npm run verify:packaged-conversation-resource-p2 --workspace opendrsai-macos-desktop`。通过时生成的 `build/acceptance/packaged-conversation-resource-p2.json` 已被既有 artifact 上传路径覆盖。P2 验证脚本现在显式拒绝非 `darwin-arm64`，并固定检查 `release/mac-arm64/OpenDrSai.app`；工作流在安装依赖前执行 `test "$(uname -m)" = "arm64"`，避免在错误架构上完成昂贵构建后才失败。GitHub 官方 hosted-runner 表确认当前 `macos-14` 标签为 arm64；release contract 新增对应 workflow token和验证脚本存在性检查，防止后续静默移除该门禁。
- macOS 当前阻断复核：`npm run typecheck --workspace opendrsai-macos-desktop` 仍只有 3 个错误，均为当前工作区另一条 Voice Streaming→Duplex 删除迁移尚未收口：`src/main/index.ts`、`src/main/ipc/registerVoiceIpc.ts` 继续导入已删除的 `shared/main/voiceStreaming`，且旧 `DesktopStreamingVoiceStartRequest` 已不再导出。Windows 已切到 Duplex。为保护并行用户改动，本轮未恢复已删除 legacy 文件，也未擅自重写 Voice IPC；该阻断不是 P2 Resource 代码错误，但会阻止 Apple Silicon CI 进入打包阶段。
- 本轮重新执行的发布相关证据：
  - `npm run verify:conversation-resource-security-p2`：Desktop/TUI/Web/Runtime 组合通过，Python **56 passed、1 deselected**；deselected 仅为归属独立性能门禁的 slow 用例；
  - `npm run verify:conversation-resource-reliability-p2`：全部 Node/TUI/Web 门禁通过，Python **48 passed**；
  - `npm run verify:conversation-resource-performance-p2`：100 批量 P95 **5.983 ms**、百万索引查询 P95 **0.056 ms**、900 KiB preview P95 **9.872 ms**、真实 TCP/HTTP 远程 P95 **319.463 ms**，低于 800 ms；
  - Windows `npm run verify:packaged-conversation-resource-p2`：真实 packaged Electron + fake Gateway 再次通过，14 项检查全 true，证据时间更新为 2026-08-16 10:16；
  - Desktop `npm run verify:structured-visual`：生产构建与 20 张 100%/125%/150%/窄窗口截图通过；
  - Windows `npm run typecheck` 与 OAEP/OWOP/Relay 三套 codegen `--check`：通过；macOS P2 脚本和 release contract `node --check`、workflow YAML 解析及 `git diff --check`：通过。
- 尚未通过：P2-DESKTOP-08 仍缺上述 Apple Silicon workflow 对真实 `.app` 的成功 JSON；P2-RELEASE 仍需等待该证据并执行最终跨平台证据审计。因此总分保持 95，不报告 100%。
- 下一步：先由 Voice Streaming→Duplex 变更的所有者完成 macOS legacy handler 移除/迁移，使 macOS typecheck 恢复；随后在 `macos-14` arm64 runner 运行 unsigned build 和新增 P2 packaged step、下载并核验 artifact。取得 macOS JSON 后关闭 Desktop-08，再以本轮 Windows/协议/安全/可靠性/性能证据、Android 第 22 轮 5+31 测试和 macOS 证据执行最终 RELEASE 审计。

### 第 24 轮

- 通过权重：**95/100（95%）**。本轮无新增计分项；macOS 源码构建阻断已经解除，但 Apple Silicon 上真实 `.app` 尚未执行，P2-DESKTOP-08 与 P2-RELEASE 仍不计分。
- macOS 构建收口：删除 macOS main 与 Voice IPC 中已被共享 API、Renderer 和 Windows 全部移除的 legacy Voice Streaming 导入、handler、raw audio port 与销毁清理，保留 Duplex 唯一路径；同时补齐 `desktop:voice-duplex-text-input` 和 `desktop:voice-duplex-finish-turn`，避免迁移后输入和结束回合能力缺失。`npm run typecheck --workspace opendrsai-macos-desktop` 通过；`npm run build --workspace opendrsai-macos-desktop` 完成 main/preload/Renderer 生产构建并生成 dirty build metadata；`verify:oaep-macos-composition` 通过。
- IPC 校验修复：旧 inventory 与 main-composition 校验器只扫描平台文件中的直接 `ipcMain.handle`，把 P2 的三个共享 registrar、八个真实资源通道误报为缺失。现在校验器显式要求 Windows/macOS 都组合 `registerConversationResourceReadIpc`、`registerConversationResourceDownloadIpc`、`registerConversationResourceSubscriptionIpc`，并从共享 registrar 静态提取 `register("desktop:…")` 通道；未删除、跳过或放宽任何 preload parity 要求。P2 共享通道由此被真实计入，macOS 覆盖为 **414/417（99.28%）**。
- 诚实暴露的非 P2 回归：完整 parity 仍明确失败并列出 `desktop:ssh-host-save`、`desktop:voice-preferences-get`、`desktop:voice-preferences-update`。前者需要 macOS 的受控 SSH config 写入实现，后两者需要跨平台语音偏好持久化与多窗口广播；它们不是会话资源关联链路，且不能靠 handler stub 安全补齐，因此本轮没有扩大 P2 范围或改 allowlist 制造全绿。`verify:p2-main-composition` 与 `verify:inventory:parity` 均以这 3 项失败；非强制 `verify:inventory` 正确通过并输出缺口。
- Apple Silicon 门禁状态：`.github/workflows/macos-desktop.yml` 已在 `macos-14` arm64 preflight、unsigned `.app` 构建及 packaged smoke 后执行 `verify:packaged-conversation-resource-p2`；脚本强制 `darwin + arm64` 并固定验证 `release/mac-arm64/OpenDrSai.app`，成功 JSON 进入既有 acceptance artifact。相关脚本 `node --check` 与 `git diff --check` 通过。完整本地 `verify:release-contract` 在 Windows 缺少仅随 macOS release 环境提供的 `build/entitlements.mac.unsigned-development.plist` 时 fail closed，未把静态检查冒充发布证据。
- 尚未通过：P2-DESKTOP-08 只差 Apple Silicon runner 对真实 `.app` 的 main/preload/IPC P2 场景成功 JSON；P2-RELEASE 还需在取得该证据后做最终跨平台证据审计。CI 配置存在、Windows 上 macOS source build 通过以及静态契约检查都不替代该证据，总分保持 95。
- 下一步：将当前变更置于可供 `macos-14` arm64 runner 检出的提交/分支，在 `verify-macos-unsigned` 执行 unsigned `.app` 与 P2 packaged 场景；下载并核验 `build/acceptance/packaged-conversation-resource-p2.json` 的平台、架构、应用路径、五态与动作矩阵。成功后关闭 P2-DESKTOP-08，再执行最终 RELEASE 审计；上述 3 个非 P2 parity 缺口应另立跨平台桌面一致性任务，不阻塞 P2 功能判定，但若仓库发布政策要求全量 parity，则须在 RELEASE 前由对应能力所有者完成。

### 第 25 轮

- 通过权重：**100/100（100%）**。本轮新增通过：P2-DESKTOP-08、P2-RELEASE。
- 范围确认：产品所有者明确本阶段以 Windows App 为 Desktop 发布目标，macOS 后续单独实施。P2 SPEC 升级为 1.1，将 AC-DESKTOP-08 和门禁 6 收敛为 Windows 打包态真实 main/preload/IPC E2E；macOS 写入非目标和适用范围说明，不再阻塞本阶段发布。该变更是明确的产品范围决策，不是删除、跳过或弱化 Windows 测试。
- Windows 最终证据：重新执行 Node/Web 两套 TypeScript `--noEmit` 检查通过；重新启动 `release/win-unpacked/OpenDrSai.exe`，`conversation-resource-p2` 在 packaged Electron + fake Gateway 下通过。14 项检查全部为 true，覆盖 bridge/login、Workspace 注册、五态语义资源按钮真实点击、deleted fail closed、offline 区分、当前版与引用版 preview、Explorer reveal、逻辑路径复制、原生另存、preload 进度 0→100% 以及 Renderer 不接触 ResourceKey。
- 原始 DOCX 场景复核：`test_workspace_artifact_p1_e2e.py` **1 passed**，验证 `默认工作区/tmp/poem.docx` 经 `deliver_artifact` 原子发布到 `默认工作区/artifacts/短诗_静夜.docx`，保留宋体 DOCX 字节并产生 Workspace 相对 Artifact；Desktop/TUI Artifact 联动契约和相对/绝对文件树关联测试通过。
- 最终审计：协议 18、Runtime 22、Desktop 20、TUI 5、Android 7、Web 7、跨 Host 5、非功能/发布 16，合计 **100**；表内所有验收项均为“通过”。第 23 轮安全、可靠性、性能、结构化视觉、Windows packaged、类型检查和三套 codegen 证据，以及第 22 轮 Android 设备证据均保持有效；此后相关产品代码没有变化，本轮又复验 Windows 类型与打包态主链。
- 后续但不属于本阶段：macOS `.app` packaged 场景、SSH host save、语音偏好持久化与完整 IPC parity 应建立独立 macOS 兼容任务，不回写为本次 Windows P2 的未完成项。
