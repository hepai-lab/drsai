# Windows 智能体广场开发追踪与会话映射

> 最新复核（2026-07-19，Asia/Shanghai）：本节取代下方 2026-07-14 的初始 `0/35` 快照。按实施计划第八轮和当前代码/测试重新核查，结论为 **34/35 完成，E4 部分完成**；不得据旧快照回退统计，也不得在 E4 完成真实三模式验收前宣布 35/35。

## E 类最新状态（2026-07-19）

| ID | 状态 | 当前证据 | 缺口 / 下一步 |
| --- | --- | --- | --- |
| E1 | 完成 | 受认证 Native 目录按 OIDC subject 返回公开 DTO；目录缓存字段白名单与 secret-like 字段检查已覆盖。 | 保持目录/OIDC 回归。 |
| E2 | 完成 | 默认、最近使用接口以及一次 401 刷新契约已覆盖；`npm run verify:platform-auth` 通过。 | 保持默认/usage 回归。 |
| E3 | 完成 | Windows 按显式 agentId 调用 Native SSE；`npm run verify:e2e-agent-cloud-route` 覆盖一次 HTTP 401 刷新、text/tool/file/input、continuation、stop 和 secret isolation。 | 保持路由和 SSE 回归。 |
| E4 | **部分完成 / 平台阻塞** | DDF Native 路由代码已存在；Windows 平台请求继续发送 `messages`、`stream`、`thread_id`、`run_id`、`model`、`attachments`、`metadata`。2026-07-19 将 `verify-live-platform-oidc.cjs` 的 live chat 从通用模型接口修正为真实 `POST /api/native/v1/agents/{agentId}/chat`，只从认证目录选择声明 `ddf + chat + streaming` 的 agent，并仅输出脱敏的 HTTP/SSE、agentId、类型、能力、耗时、错误码、文本 delta/[DONE] 布尔证据。脚本语法检查、云路由 E2E、Node typecheck 通过。平台协作会话 `019f5208-0f19-7883-b3e2-4dcc8ffa4b61` 已完成只读核查：HAI DDF 按 subject+agentId 解析且不以客户端 model 选 runtime；remote/custom 当前明确返回 `409 agent_chat_unsupported`。HAI 无可直接嵌入的 OpenDrSai factory/run manager；现有 gateway 接受客户端 user_id/model/work_dir、按本地默认工厂运行，不可直接暴露或代理。建议在 OpenDrSai 增加仅 HAI 服务身份可调用的 internal chat/stop/input Runtime API，以 `(subject, agent_id, thread_id)` 隔离会话并在服务端加载私有配置。 | 仍缺：① 正常运行且已登录的 Windows App 上真实 ai-dev DDF 文本 delta + `[DONE]`；独立 Electron 因 DPAPI `0x8009000B` 不能替代 App 登录态证据。② HAI/OpenDrSai 实现上述 remote/custom 内部受认证入口并提供各一条真实样例；禁止信任或透传客户端 model/URL/config。③ DDF、remote、custom 各一稳定测试 agent，完成连续对话、停止、401/403、下线和断流冒烟。未满足前保持 partial/blocked。 |
| E5 | 完成 | 现有运行管理器和云路由 E2E 已覆盖连续线程、停止、文件/工具/输入事件与断流处理。 | 与 E4 三类真实样例一起复测。 |

### DDF 真实 Windows App 冒烟步骤与证据

1. 保持当前 Windows App 登录态，打开智能体广场并强制刷新；选择一个可用且能力含 `chat`、`streaming` 的 DDF 智能体。
2. 新建会话并发送无敏感内容的最小提示；确认 UI 至少收到一个非空文本增量并正常结束。随后在同一会话发送第二轮，确认 thread 继续使用。
3. 再发起一轮并点击停止，确认请求终止且 App 可继续使用；不得复制或记录用户正文、Authorization、API Key、URL 私有参数或 remote 配置。
4. 从 `C:\Users\win11\.drsai\logs\agent-telemetry.jsonl` 仅保留对应的 `execution_started` 与 `execution_completed`/`execution_failed`/`execution_cancelled` 记录：`timestamp`、脱敏 `agentId`、`mode=ddf`、`source=platform`、`durationMs`、`errorCode`（若有）。同时记录 HTTP 200、`Content-Type=text/event-stream`、目录能力 `chat/streaming`、`chatSawContent=true`、`chatSawDone=true`；不要记录 SSE data 内容。
5. 若必须使用安全脚本，应从与正在运行 App 相同的可解密用户上下文执行 `OPENDRSAI_LIVE_REFRESH=1 OPENDRSAI_LIVE_CHAT=1 npm run verify:live-platform-oidc`；出现 DPAPI `0x8009000B` 时只记为脚本上下文限制，不算业务失败或联调通过。


更新时间：2026-07-19 19:49:42 +08:00
实施依据：`apps/desktop/windows/docs/agent-square-implementation-plan.md`  
当前结论：34/35 完成。唯一未完全验收项为 E4。DDF Windows/HAI 代码链和本地 E2E 已打通，但本轮仍缺正在登录的 Windows App 对 ai-dev 真实 DDF 文本流与 `[DONE]` 冒烟；remote/custom 仍缺 HAI/OpenDrSai 受认证服务端执行入口和稳定真实样例，不能宣布 35/35。

## 会话映射

| 开发项 | 规定标题 | threadId | hostId | 创建时间 | 最后派发功能点 | 当前状态 |
| --- | --- | --- | --- | --- | --- | --- |
| A | app产品平台契约与身份认证能力开发与测评 | 019f5cb5-d343-7462-ad86-6d6f4766eddf | local | 2026-07-14 02:20 +08:00 | A1/A2/A3 P0 契约验证闭环 | 已完成；历史阻塞已被实施计划第七/八轮平台热加载和 Windows App 联调记录覆盖 |
| B | app产品智能体目录与数据适配能力开发与测评 | 未创建 | 未定 | 未创建 | 未派发 | 按实施计划第八轮和本轮契约验证为完成；暂无未完成任务 |
| C | app产品智能体广场产品界面能力开发与测评 | 未创建 | 未定 | 未创建 | 未派发 | 按实施计划第八轮和本轮 UI/契约验证为完成；暂无未完成任务 |
| D | app产品聊天选择与执行路由能力开发与测评 | 未创建 | 未定 | 未创建 | 未派发 | 按实施计划第八轮和本轮云端路由 E2E 为完成；暂无未完成任务 |
| E | app产品Native云端执行接口能力开发与测评 | 019f7a35-8b35-7b90-940d-e76dbefa8b73 | local | 2026-07-19 19:49 +08:00 | E4 DDF/remote/custom 真实执行闭环 | 运行中；E4 部分完成 |
| F | app产品安全可靠性与可观测性能力开发与测评 | 未创建 | 未定 | 未创建 | 未派发 | 按实施计划第八轮和本轮安全/脱敏抽查为完成；暂无未完成任务 |
| G | app产品测试发布与灰度能力开发与测评 | 未创建 | 未定 | 未创建 | 未派发 | 按实施计划第八轮为完成；本轮未重跑打包版 E2E |

## 本轮复核证据

- 已完整读取实施计划，计划第八轮明确列出 A1-A4、B1-B6、C1-C7、D1-D6、E1-E3、E5、F1-F4、G1-G3 完成，E4 部分完成。
- 已读取旧追踪文件，发现其仍停留在 2026-07-14 02:23 的 0/35 结论；本文件继续作为唯一追踪记录，不新增第二份追踪文件。
- `git status --short` 显示当前工作树包含本主线程改动和并发 E 会话/既有改动：`apps/desktop/windows/docs/agent-square-development-session-map.md`、`apps/desktop/windows/scripts/verify-agent-cloud-route-e2e.mjs`、`apps/desktop/windows/scripts/verify-live-platform-oidc.cjs`、`apps/android/app/src/main/java/ai/drsai/remote/data/AndroidUpdate.kt`、`apps/desktop/windows/scripts/verify-f4-anomaly-decision.mjs`、`apps/desktop/windows/src/main/e2eSmoke.ts`、`docs/product/opendrsai-windows-product-acceptance-tracker.md`。本主线程直接修改的是追踪文件和云端路由 E2E 验证脚本；其余改动未在本主线程编辑。
- 已读取 A 会话 `019f5cb5-d343-7462-ad86-6d6f4766eddf`：A 会话完成了 OIDC-first 目录路径、一次 401 刷新、Native API 降级、公开 DTO 密钥隔离和真实联调阻塞记录；后续实施计划第七/八轮记录平台已热加载并由正常 Windows App 完成真实目录刷新。
- 已搜索 B～G 规定标题：除本轮创建的 E 会话外，未发现可复用主会话；因当前未完成项属于 E，未为 B/C/D/F/G 创建主会话。
- 已读取 HAI 协作会话 `019f5208-0f19-7883-b3e2-4dcc8ffa4b61` 最近状态：DDF 认证主体曾改造为 UUID `sub`；PM2 `run_haiddf` 曾恢复，但数据库隔离不明，要求停止后续 DDF 部署探测；后续讨论未提供 remote/custom Native 执行闭环证据。
- 本轮命令结果：
  - `npm run verify:platform-auth`：通过。覆盖 A1/A2/A3/E2 契约、B1-B6 目录、C1-C6/D1/D3/D4-client UI/路由、熔断和 14 项 Python 平台认证测试。
  - `npm run typecheck:node`：通过。
  - `npm run verify:e2e-agent-cloud-route`：首次失败，原因是验证脚本 stub 缺少 `listThreads` 和 `resolveRemoteWorkspaceTarget`；本轮已修复并复跑通过，覆盖显式 agentId、一次 401 刷新、SSE 文本/工具/文件/输入、连续线程、停止和私有配置隔离。
  - `OPENDRSAI_LIVE_REFRESH=1 OPENDRSAI_LIVE_CHAT=1 npm run verify:live-platform-oidc`：失败于独立 Electron 进程无法解密现有 Windows DPAPI 会话，`safeStorage.decryptString` 返回 `0x8009000B`。该失败不能证明平台业务失败，也不能作为 E4 真实联调通过证据。
- 本轮公开缓存/遥测抽查：
  - `C:\Users\win11\.drsai\cache\platform-agents.v1.json` 最后写入 2026-07-18 17:28:11，含 2 个公开 agent，字段不含 secret-like 名称。
  - `C:\Users\win11\.drsai\logs\agent-telemetry.jsonl` 最近记录包含 `catalog_refresh` ready count=4 和本地 `my-codex` execution completed；未发现真实平台 DDF chat completed 证据。

## 35 点状态

| ID | 状态 | 缺口 | 验收标准 | 代码/测试/联调证据 | 下一步 |
| --- | --- | --- | --- | --- | --- |
| A1 | 完成 | 无新缺口 | Windows OIDC Token 访问 ai-dev 目录且不依赖 HEPAI_API_KEY 主路径 | 实施计划第七轮 Windows App 真实刷新出 HAI DDF 目录；本轮 `verify:platform-auth` 通过 | 保持回归覆盖 |
| A2 | 完成 | 无新缺口 | 临期刷新与一次 401 安全重试，不无限重试不泄密 | A 会话实现和本轮 `verify:platform-auth` 通过 | 保持回归覆盖 |
| A3 | 完成 | 无新缺口 | 能力/版本探测和 Native API 未部署降级 | A 会话实现；本轮 `verify:platform-auth` 通过 | 保持回归覆盖 |
| A4 | 完成 | 无新缺口 | 服务端只信任 Token subject，不信任客户端 user_id | 实施计划第七/八轮 HAI Native/OIDC 测试与热加载记录 | 保持平台回归 |
| B1 | 完成 | 无新缺口 | 聚合 My DrSai 与平台默认/DDF/remote/custom 目录 | 实施计划第七轮真实目录修复；本轮 `verify:platform-auth` 通过 | 保持回归覆盖 |
| B2 | 完成 | 无新缺口 | 统一公开 DesktopAgent DTO | 本轮 `verify-agent-square-catalog` 经 `verify:platform-auth` 通过 | 保持回归覆盖 |
| B3 | 完成 | 无新缺口 | Main 私有执行描述符，不向 Renderer 发送密钥 | 本轮公开缓存 secret-like 扫描为 false；E2E secret isolation 通过 | 保持安全扫描 |
| B4 | 完成 | 无新缺口 | 去重、稳定 ID、排序、不可用归一化 | 本轮 `verify-agent-square-catalog` 通过 | 保持回归覆盖 |
| B5 | 完成 | 无新缺口 | 强制刷新、刷新时间、加载状态 | 本轮 `verify:platform-auth` 通过 | 保持回归覆盖 |
| B6 | 完成 | 无新缺口 | 本地公开缓存、过期和离线只读降级 | 本轮公开缓存抽查无密钥；`verify-agent-square-catalog` 通过 | 保持缓存扫描 |
| C1 | 完成 | 无新缺口 | 本地/官方/我的分组和数量 | 本轮 `verify-agent-square-ui` 经 `verify:platform-auth` 通过 | 保持 UI 回归 |
| C2 | 完成 | 无新缺口 | 名称/描述/作者/能力搜索 | 实施计划第七轮描述本地化与搜索证据；本轮 UI 验证通过 | 保持 UI 回归 |
| C3 | 完成 | 无新缺口 | 来源/状态/最近使用筛选排序 | 实施计划第八轮和本轮 UI 验证通过 | 保持 UI 回归 |
| C4 | 完成 | 无新缺口 | 卡片头像、描述、来源、状态、能力标签 | 实施计划第七轮卡片信息收敛；本轮 UI 验证通过 | 保持 UI 回归 |
| C5 | 完成 | 无新缺口 | 详情介绍、示例、作者、限制 | 实施计划第七轮详情和本地化证据；本轮 UI 验证通过 | 保持 UI 回归 |
| C6 | 完成 | 无新缺口 | 默认智能体跨广场/设置/聊天同步 | 实施计划第七轮默认路由修复；本轮 `verify:platform-auth` 通过 | 保持偏好回归 |
| C7 | 完成 | 无新缺口 | 最近使用、空态、离线、失败、重试 | 实施计划第八轮；本轮 UI/目录验证通过 | 保持 UI 回归 |
| D1 | 完成 | 无新缺口 | ChatRequest 显式传 agentId | 本轮云端路由 E2E 通过 | 保持 E2E |
| D2 | 完成 | 无新缺口 | 新会话绑定并展示选中智能体 | 实施计划第八轮会话持久化证据 | 保持 E2E |
| D3 | 完成 | 无新缺口 | My DrSai 继续本机 gateway | 本轮 `verify:platform-auth` 和云端路由 E2E 未触发本机 gateway 通过 | 保持 E2E |
| D4 | 完成 | 无新缺口 | 平台智能体进入 Native 云端执行接口 | 本轮云端路由 E2E 修复后通过 | 由 E4 继续补真实远端样例 |
| D5 | 完成 | 无新缺口 | 会话切换智能体时避免上下文串线 | 实施计划第八轮会话绑定证据 | 保持 E2E |
| D6 | 完成 | 无新缺口 | 本地/云端统一 SSE、停止、超时、错误、工具、文件事件 | 本轮云端路由 E2E 通过；实施计划第五轮打包矩阵证据 | 下轮可补跑打包版 |
| E1 | 完成 | 无新缺口 | 认证后统一目录只返回公开配置 | 实施计划第七/八轮 HAI Native 目录证据；本轮缓存扫描无密钥 | 保持平台回归 |
| E2 | 完成 | 无新缺口 | 默认和最近使用读写接口 | 实施计划第七轮默认接口热加载；本轮 `verify:platform-auth` 通过 | 保持平台回归 |
| E3 | 完成 | 无新缺口 | 按 agentId OpenAI 风格 SSE 聊天接口 | 实施计划第八轮 DDF Native chat 路由热加载；本轮云端路由 E2E 通过 | 由 E4 补真实样例 |
| E4 | 部分完成 | 缺真实 Windows App DDF 文本流 + `[DONE]`；remote/custom 缺受认证服务端执行入口和稳定样例 | DDF/remote/custom 三类均需服务端解析执行，且各有真实冒烟、停止、401/403、下线、断流证据 | 本轮已派发 E 会话 `019f7a35-8b35-7b90-940d-e76dbefa8b73`；本地云端路由 E2E 通过；独立真实脚本受 DPAPI `0x8009000B` 阻塞 | E 会话继续推进真实 DDF 冒烟和 remote/custom 平台入口 |
| E5 | 完成 | 无新缺口 | 云端连续线程、停止、文件事件、人机输入 | 本轮云端路由 E2E 通过；实施计划第八轮 HAI 路由记录 | 保持 E2E |
| F1 | 完成 | 无新缺口 | Token/API Key/remote 配置全链路隔离与脱敏 | 本轮缓存 secret-like 扫描 false，E2E secret isolation 通过 | 保持安全扫描 |
| F2 | 完成 | 无新缺口 | SSRF、重定向、访问目标允许策略 | 实施计划第八轮执行目标策略证据 | 保持平台回归 |
| F3 | 完成 | 无新缺口 | 超时、取消、有限重试、熔断、友好错误 | 本轮熔断验证和云端路由 E2E 通过 | 保持 E2E |
| F4 | 完成 | 无新缺口 | 记录刷新/选择/成功率/延迟/错误类型，不记正文和密钥 | 本轮遥测抽查仅含事件、agentId、mode、source、duration 等字段 | 保持日志脱敏扫描 |
| G1 | 完成 | 无新缺口 | 单元/契约测试覆盖目录、归一化、刷新、隔离 | 本轮 `verify:platform-auth` 通过 | 保持 CI |
| G2 | 完成 | 本轮未重跑打包版 E2E | 本地/云端路由、SSE、取消、下线、会话绑定 E2E | 实施计划第五轮打包 Electron + fake gateway + 云端路由矩阵证据；本轮云端路由 E2E 通过 | 下轮优先补跑 `build:unpack`/打包 E2E |
| G3 | 完成 | 无新缺口 | 开关、灰度、兼容检测、回滚策略 | 实施计划第八轮双重灰度开关和发布证据 | 保持发布检查 |

## 安全与联调阻塞

- 未完成安全阻塞：E4 不允许采用客户端 URL 或私有配置下发方案绕过 remote/custom 服务端入口。
- 当前真实联调阻塞：独立 Electron 脚本受 Windows DPAPI 上下文限制，不能读取正在登录 App 的 OIDC 会话；需要通过运行中的 Windows App 或同一用户交互上下文完成真实 DDF 文本流冒烟。
- HAI 协作阻塞：remote/custom 尚缺明确的受认证服务端执行入口；DDF 部署探测受数据库隔离不明约束，平台侧操作必须走协作会话并保持脱敏。

## 本轮实际执行/派发

- 实际修复：`apps/desktop/windows/scripts/verify-agent-cloud-route-e2e.mjs` 补齐 `listThreads` 和 `resolveRemoteWorkspaceTarget` stub，恢复云端路由 E2E 可重复验证。
- 实际派发：创建并命名 E 会话 `019f7a35-8b35-7b90-940d-e76dbefa8b73`，派发 E4 真实 DDF/remote/custom 执行闭环任务，包含缺口、验收标准、实现范围、自动化与人工测试、验证命令、联调步骤、证据要求和完成承诺。
- 即时快照：E 会话正在运行，已开始把真实联调脚本调整为 `POST /api/native/v1/agents/{agentId}/chat` 的脱敏 DDF 冒烟路径，并在跑语法、云路由 E2E 和 Node 类型检查。

## 下轮优先项

1. 读取 E 会话 `019f7a35-8b35-7b90-940d-e76dbefa8b73`，确认是否完成真实 DDF 文本流与 `[DONE]` 冒烟，或是否已形成合规 HAI 协作请求。
2. 若 E 会话仍在同一 E4 子项运行，不重复派发；可补跑打包版 `build:unpack` 和打包 E2E 刷新 G2 证据。
3. 若 remote/custom 平台入口仍缺失，继续保持 34/35，不宣布完成。
