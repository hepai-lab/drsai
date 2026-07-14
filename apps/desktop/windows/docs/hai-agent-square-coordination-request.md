# HAI 智能体广场联调请求

目标会话：`019f5208-0f19-7883-b3e2-4dcc8ffa4b61`

实际执行环境：`zzd_3090_via_chat_ihep`

请直接在当前会话实际运行环境中推进智能体广场平台联调。不要因为非交互 SSH 默认 `PATH` 中找不到 `codex` 而停止：当前会话已经由 Codex 恢复，应直接使用当前 shell 和仓库；如确需定位工具，使用绝对路径、login shell 或 `find`/`command -v` 探测，禁止假定默认 `PATH`。

## 背景

Windows 侧智能体广场 7 类 35 个功能点已完成 33 点，本地实现和自动化均通过。剩余真实联调项：

- A1：用真实 Windows OIDC Access Token 访问 `GET /api/native/v1/agents`；
- E4：在 `ai-dev.ihep.ac.cn` 对 DDF、remote、custom 三类平台智能体各运行一个真实流式任务。

当前外部探测：

- `GET https://ai-dev.ihep.ac.cn/api/native/v1/agents?refresh=false` 未认证返回 `401 Bearer`；
- `POST /api/native/v1/agents/nonexistent/chat` 返回 `404`。

这说明 Native 目录入口在线，但 Native Chat 路由尚未部署或热加载。

## 平台侧任务

1. 检查当前仓库和 ai-dev 部署状态，优先复用现有代码，补齐并部署 `POST /api/native/v1/agents/{agent_id}/chat`（OpenAI 风格 `text/event-stream`）、停止接口和人机输入回复接口；目录 capability 可用后包含 `agent-chat`。
2. 服务端必须从 OIDC Token subject 查找用户以及 agentId 对应私有配置，支持 DDF、remote、custom；不得在目录、SSE 或日志中泄露 API Key、内部 URL、Token 或原始 config。
3. 明确并验证 SSE 契约：`[DONE]`、文本增量、reasoning、工具、文件、人机输入、结构化错误；覆盖连续 `thread_id`、取消/断连、401、403、404。
4. 在 ai-dev 准备或识别当前用户可见的 DDF、remote、custom 测试智能体 ID，对三类各执行一次真实流式任务并给出脱敏结果。
5. 若平台代码位于不同工作树，直接在那里修改并测试；不要修改 Windows 客户端文件，不要覆盖其他人的改动。部署或热加载属于本任务授权范围，但不要提交、推送或创建 PR，除非已有会话明确要求。
6. 完成后回复：修改文件、部署位置和方式、接口状态、三类 agent ID（可脱敏但需供随后联调定位）、测试命令与结果、仍需 Windows 侧执行的最小动作。若受权限或凭据阻塞，请给出精确命令和所需负责人动作，不要只报告“无法完成”。

Windows 侧总方案为 `apps/desktop/windows/docs/agent-square-implementation-plan.md`。平台环境不必访问 Windows 绝对路径，本文件已经完整转述所需契约。
