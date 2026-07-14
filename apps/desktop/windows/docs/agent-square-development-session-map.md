# Windows 智能体广场开发追踪与会话映射

更新时间：2026-07-14 02:23:49 +08:00  
实施依据：`apps/desktop/windows/docs/agent-square-implementation-plan.md`  
当前结论：0/35 完成。已有部分本地代码和契约测试证据，但尚无满足计划要求的最新完整证据链：Windows 打包版 E2E、真实 `https://ai-dev.ihep.ac.cn` HAI 联调、安全检查和可重复验收记录均未闭环。

## 会话映射

| 开发项 | 规定标题 | threadId | hostId | 创建时间 | 最后派发功能点 | 当前状态 |
| --- | --- | --- | --- | --- | --- | --- |
| A | app产品平台契约与身份认证能力开发与测评 | 019f5cb5-d343-7462-ad86-6d6f4766eddf | local | 2026-07-14 02:20 +08:00 | A1/A2/A3 P0 契约验证闭环 | 运行中 |
| B | app产品智能体目录与数据适配能力开发与测评 | 未创建 | 未定 | 未创建 | 未派发 | 待派发 |
| C | app产品智能体广场产品界面能力开发与测评 | 未创建 | 未定 | 未创建 | 未派发 | 待派发 |
| D | app产品聊天选择与执行路由能力开发与测评 | 未创建 | 未定 | 未创建 | 未派发 | 待派发 |
| E | app产品Native云端执行接口能力开发与测评 | 未创建 | 未定 | 未创建 | 未派发 | 待派发 |
| F | app产品安全可靠性与可观测性能力开发与测评 | 未创建 | 未定 | 未创建 | 未派发 | 待派发 |
| G | app产品测试发布与灰度能力开发与测评 | 未创建 | 未定 | 未创建 | 未派发 | 待派发 |

## 本轮复核证据

- 已完整读取实施计划。
- 未发现既有 `agent-square-development-session-map.md`，本文件作为唯一追踪记录创建。
- `git status --short` 显示当前工作树已有大量未提交改动；本轮只新增本追踪文件和自动化记忆。
- 抽查发现 `apps/desktop/windows/src/main/agents.ts` 当前平台目录主路径仍读取 `HEPAI_API_KEY` 并调用 `/agents/list_agents`，尚不满足 A1 的 OIDC-first Native API 要求。
- 抽查发现 `apps/webui/backend/src/drsai_ui/ui_backend/backend/web/routes/mobile.py` 提供认证后的 native/mobile 风格接口雏形，但仍需按计划验证公开 DTO、默认/最近使用、SSE 执行和密钥隔离。
- 本地命令：
  - `cd apps/desktop/windows; npm run verify:platform-auth`：通过，11 个平台认证测试通过。
  - `cd apps/desktop/windows; npm run verify:oidc-login`：通过，15 个 OIDC 登录检查通过。
  - `cd apps/desktop/windows; npm run typecheck:node`：通过。
  - `pytest apps/webui/backend/tests/test_mobile_api.py`：120 秒超时，未形成通过证据。
- 未执行真实 HAI 联调；无真实 Windows 登录 Token 对 `ai-dev.ihep.ac.cn` 目录读取、401/403、停止/超时、DDF/remote/custom 真实样例证据。
- 未执行 Windows 打包版 E2E；不能判定发布验收通过。

## 35 点状态

| ID | 状态 | 缺口 | 当前证据 | 下一步 |
| --- | --- | --- | --- | --- |
| A1 | 未完成 | 平台目录仍需 OIDC Access Token 优先路径和真实 ai-dev 目录读取证据 | `verify:platform-auth` 通过；`agents.ts` 抽查仍见 HEPAI_API_KEY 主路径 | A 会话补齐 OIDC-first 目录路径与真实联调记录 |
| A2 | 未完成 | 401 后一次安全重试、临期刷新和失败退出需目录链路证据 | `verify:oidc-login` 通过 | A 会话补齐目录请求 401/刷新契约测试 |
| A3 | 未完成 | 平台能力/版本探测与 Native API 未部署降级需实现和证据 | 未见专项证据 | A 会话补齐探测与降级测试 |
| A4 | 未完成 | 服务端需确认所有 native 执行入口只信任 token subject | `mobile.py` 依赖 `get_current_user_id` 的局部证据 | 后续派发 A4 服务端验收 |
| B1 | 未完成 | 本地、默认、DDF、remote、custom 聚合未验收 | 仅见旧本地/平台/remote 聚合雏形 | 派发 B 会话 |
| B2 | 未完成 | 统一公开 DTO 字段、语义和契约夹具未验收 | `DesktopAgent` 类型存在但来源/模式不足 | 派发 B 会话 |
| B3 | 未完成 | Main 私有执行描述符与 Renderer 密钥隔离未证明 | 未见按 agentId 私有描述符证据 | 派发 B/F 会话 |
| B4 | 未完成 | 去重、稳定 ID、排序、不可用归一化未验收 | 未见专项证据 | 派发 B 会话 |
| B5 | 未完成 | 强制刷新、刷新时间、加载状态未验收 | 未见专项证据 | 派发 B/C 会话 |
| B6 | 未完成 | 缓存、过期、离线只读降级未验收 | 未见专项证据 | 派发 B 会话 |
| C1 | 未完成 | 分组和数量需 UI/E2E 证据 | `AgentSquareView` 存在 | 派发 C 会话 |
| C2 | 未完成 | 名称/描述/作者/能力搜索需 UI/E2E 证据 | 未见专项证据 | 派发 C 会话 |
| C3 | 未完成 | 来源/状态/最近使用筛选排序需 UI/E2E 证据 | 未见专项证据 | 派发 C 会话 |
| C4 | 未完成 | 卡片头像、描述、来源、状态、能力标签需视觉证据 | 未见专项证据 | 派发 C 会话 |
| C5 | 未完成 | 详情完整介绍、示例、作者、限制需 UI/E2E 证据 | 未见专项证据 | 派发 C 会话 |
| C6 | 未完成 | 默认智能体跨广场/设置/聊天同步需 E2E 证据 | 未见专项证据 | 派发 C/E 会话 |
| C7 | 未完成 | 最近使用、空态、离线、失败、重试需 UI/E2E 证据 | 未见专项证据 | 派发 C 会话 |
| D1 | 未完成 | `ChatRequest` 显式 agentId 执行路由未闭环 | Renderer 有 agentId 相关代码但 `ChatRequest` 类型未见顶层 agentId | 派发 D 会话 |
| D2 | 未完成 | 新会话绑定与标题区持续展示未验收 | 未见专项证据 | 派发 D 会话 |
| D3 | 未完成 | My DrSai 本机 gateway 兼容路由需 E2E 证据 | 旧 gateway 路径存在 | 派发 D 会话 |
| D4 | 未完成 | 平台智能体到 Native 云端执行接口未真实验证 | 未见专项证据 | 派发 D/E 会话 |
| D5 | 未完成 | 会话中切换智能体确认/新建行为未验收 | 未见专项证据 | 派发 D/C 会话 |
| D6 | 未完成 | 本地/云端 SSE、停止、超时、错误、工具、文件事件未统一验收 | SSE 脚本存在但非云端闭环证据 | 派发 D/E/G 会话 |
| E1 | 未完成 | 认证后统一目录接口需公开 DTO 和密钥隔离验收 | `mobile.py /agents` 雏形 | 派发 E 会话 |
| E2 | 未完成 | 默认和最近使用读写接口未完整验收 | `mobile.py /agents/default` 局部证据 | 派发 E 会话 |
| E3 | 未完成 | 按 agentId 执行的 OpenAI 风格 SSE 接口未实现/验收 | 未见 native `/chat/completions` 证据 | 派发 E 会话 |
| E4 | 未完成 | DDF、remote、custom 服务端解析执行真实样例缺失 | 未见真实样例证据 | 派发 E 会话 |
| E5 | 未完成 | 云端连续对话、停止、文件、人机输入事件缺证据 | `mobile.py /runs/{run_id}/stop` 局部证据 | 派发 E 会话 |
| F1 | 未完成 | Token/API Key/remote 配置全链路隔离与脱敏需安全审计 | OIDC 本地检查通过但目录/执行链路未审计 | 派发 F 会话 |
| F2 | 未完成 | 远程 URL/重定向/目标允许策略和 SSRF 防护缺证据 | 未见专项证据 | 派发 F 会话 |
| F3 | 未完成 | 超时、取消、有限重试、熔断、友好错误映射缺端到端证据 | 局部请求 timeout 存在 | 派发 F/D 会话 |
| F4 | 未完成 | 指标记录且不记录正文/密钥缺实现与验收 | 未见专项证据 | 派发 F/G 会话 |
| G1 | 未完成 | 目录契约、归一化、身份刷新、密钥隔离测试未完整进入 CI | 本地认证脚本通过但覆盖不足 | 派发 G 会话 |
| G2 | 未完成 | 本地/云端路由、SSE、取消、下线、会话绑定 E2E 缺失 | 未执行打包版 E2E | 派发 G 会话 |
| G3 | 未完成 | 开关、灰度、兼容检测、回滚策略未验收 | 未见 agent-square 专项证据 | 派发 G 会话 |

## 安全与联调阻塞

- P0 最小联调闭环未通过；真实目录和执行能力不得标为发布验收通过。
- 当前缺真实 Windows OIDC 登录 Token、`ai-dev.ihep.ac.cn` 目录/执行联调记录、401/403 脱敏日志、DDF/remote/custom 真实样例。
- 未发现需要立即打扰 HAI 协作会话的具体平台错误；A 会话需先补齐本地契约与可复现调用，再按规则决定是否发送平台协作消息。

## 下轮优先项

1. 读取 A 会话 `019f5cb5-d343-7462-ad86-6d6f4766eddf`，确认 A1/A2/A3 是否完成本地修复或形成阻塞。
2. 若 A 会话仍在同一点执行，不重复派发；选择 B1/B2/B3 或 E1/E2 中不冲突的后续点派发。
3. 获取并记录真实 HAI P0 联调证据，或将缺失凭据/平台契约明确列为阻塞。
