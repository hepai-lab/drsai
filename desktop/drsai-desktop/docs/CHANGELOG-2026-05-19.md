# DrSai Desktop — 功能升级备忘录

> 日期：2026-05-19

---

## 一、Gateway 启动优化

### 1.1 去掉重复的 Gateway 启动日志

**问题：** 应用启动时 `Starting DrSai API gateway` 出现两次。

**根因：** `autoStartLocalGateway()` 和 `send-message` IPC handler 都调用了 `startGateway()`。

**修改文件：**

| 文件 | 修改 |
|---|---|
| `src/main/index.ts` | `autoStartLocalGateway()` 在窗口创建时调用 `startGateway()` 立即启动；`send-message` 中保留 `startGateway()` 作为崩溃后自动重启的兜底 |
| `src/main/drsai.ts` | `ensureInitialized` 添加 `export` |

---

### 1.2 修复 `thread_id=__default__` 问题

**问题：** 新聊天时 thread_id 为 `__default__`，所有新会话共享同一个 agent 状态。

**根因：** `chat_completions` 中 `thread_id = request.thread_id`，桌面端新聊天不传 `thread_id` 导致值为 `None`，`AgentManager` 使用 `"__default__"` 作为 key。

**修改文件：** `python/packages/drsai/src/drsai/backend/gateway.py`

| 位置 | 修改前 | 修改后 |
|---|---|---|
| L1076 `chat_completions` | `thread_id = request.thread_id` | `thread_id = request.thread_id or str(uuid.uuid4())` |
| L1084 `generate_sse` | `session_id = thread_id or str(uuid.uuid4())` | 删除，直接使用外层 `thread_id` |
| L1190 SSE 响应头 | `"X-Drsai-Session-Id": thread_id or "default"` | `"X-Drsai-Session-Id": thread_id` |

---

## 二、Session 恢复与消息类型

### 2.1 后端消息格式归一化

**问题：** 桌面端需要理解 autogen 内部格式（`type`, `source` 字段），实现复杂且易出错。

**修改文件：** `gateway.py`

新增 `_normalize_message()` 函数，将 autogen 消息转换为统一格式：

| autogen 类型 | source | 输出 role |
|---|---|---|
| `TextMessage` | `user` | `"user"` |
| `TextMessage` | `assistant` | `"assistant"` |
| `ToolCallExecutionEvent` | — | `"tool"` |
| `ToolCallRequestEvent` | — | `"tool_request"` |
| `ThoughtEvent` | — | `"thinking"` |
| `FunctionExecutionResultMessage` | — | `"tool"` |

`GET /v1/threads/{thread_id}` 端点调用 `_normalize_message` 归一化所有消息。

### 2.2 桌面端消息类型扩展

**修改文件：**

| 文件 | 修改 |
|---|---|
| `src/renderer/src/screens/Chat/types.ts` | 新增 `MessageRole` 类型（`"user" \| "agent" \| "tool" \| "tool_request" \| "thinking"`），`ChatMessage` 增加 `msgType`、`toolName`、`toolPayload` |
| `src/main/sessions.ts` | `SessionMessage.role` 扩展为 `string`，`getSessionMessagesAsync` 正确映射 `role`/`type`/`toolName` |
| `src/renderer/src/screens/Layout/Layout.tsx` | 新增 `toMessageRole()` 显式映射：`"assistant"` → `"agent"`，`"user"` → `"user"`，`"tool"` → `"tool"` 等 |
| `src/renderer/src/screens/Chat/MessageRow.tsx` | 重写：新增 `RoleAvatar`、`ToolRow`、`ThinkingRow`、`InlineThinkBlock`、`AgentContent`、`parseThinkBlocks` |
| `src/renderer/src/screens/Chat/MessageList.tsx` | `lastMessageIsAgent` 改为检查所有 agent 侧角色 |
| `src/renderer/src/assets/main.css` | 新增 tool/thinking/think-block 相关 CSS |

### 2.3 修复角色映射断裂

**问题：** 后端返回 `role: "assistant"`，但 `MessageRow` 只认 `role: "agent"`，导致恢复的消息不走 Markdown 渲染和 think 折叠。

**修复：** `Layout.tsx` 中 `toMessageRole()` 显式将 `"assistant"` 映射为 `"agent"`。

---

## 三、Session 列表修复

### 3.1 移除 workdir 过滤

**问题：** `listSessionsAsync` 中 `r.workdir === desktopWorkdir` 过滤导致所有 session 不显示（新 session 的 workdir 为空字符串）。

**修改文件：** `src/main/sessions.ts`

移除 `.filter((r) => r.workdir === desktopWorkdir)` 行。

---

## 四、`<think>` 思考块处理

### 4.1 内联 `<think>` 折叠

**功能：** Agent 回复中的 `<think>...</think>` 块自动解析为可折叠的思考面板（类似 DeepSeek-R1 的推理过程）。

**修改文件：** `src/renderer/src/screens/Chat/MessageRow.tsx`

- `parseThinkBlocks()` — 解析 `<think>` 标签（支持 HTML 转义 `&lt;think&gt;`、未闭合标签、属性容忍）
- `InlineThinkBlock` — 嵌入在 agent 气泡内的折叠面板，默认折叠，点击展开
- `AgentContent` — agent 内容渲染器，自动拆分 think 块和普通内容

**CSS：** `main.css` 新增 `.chat-inline-think` 样式（紫色边框、半透明背景）

---

## 五、Markdown 渲染升级

### 5.1 AgentMarkdown 组件重写

**修改文件：** `src/renderer/src/components/AgentMarkdown.tsx`

| 元素 | 改进 |
|---|---|
| 链接 | `target="_blank"` + `rel="noopener noreferrer"` + 安全协议白名单 |
| 代码块 | clipboard fallback (`execCommand`)，`<pre>` 包裹 `<code>` |
| 图片 ✨ | 响应式 `max-width:100%`，点击外部打开 |
| 表格 ✨ | `.chat-table-wrap` 滚动容器，斑马纹 |
| 引用块 | accent 色左边框 + 半透明背景 + 右侧圆角 |
| 任务列表 ✨ | `<input type="checkbox">` 样式 |
| 分割线 | 统一 `border-top` 样式 |

### 5.2 CSS 样式升级

**修改文件：** `src/renderer/src/assets/main.css`

- 去掉了重复的 `blockquote`/`hr`/`table` 声明
- 新增 `.chat-table-wrap`、`.chat-img-link`、`.chat-img`、`.chat-task-check`
- 表格偶数行斑马纹 `tr:nth-child(even)`
- 引用块 accent 色高亮

---

## 六、字体渲染修复

### 6.1 Emoji 字体

**问题：** 📁 等 emoji 显示为方框。

**根因：** 字体栈中没有 emoji 字体，Linux 无默认 color emoji fallback。

**修改文件：**

| 文件 | 变量 | 追加字体 |
|---|---|---|
| `main.css` | `--font-sans` | `"Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji"` |
| `main.css` | `--font-mono` | 同上 |
| `base.css` | `body` | 同上 |

### 6.2 中文字体

**修改文件：**

| 文件 | 变量 | 追加字体 |
|---|---|---|
| `main.css` | `--font-sans` | `"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "WenQuanYi Micro Hei", "Hiragino Sans GB"` |
| `base.css` | `body` | 同上 |

---

## 七、工具调用/结果折叠

### 7.1 ToolRow 组件折叠

**功能：** FunctionCall 和 FunctionExecutionResultMessage 默认折叠，点击展开查看详情。

**修改文件：** `src/renderer/src/screens/Chat/MessageRow.tsx`

`ToolRow` 重写为可折叠组件：

| 状态 | 显示 |
|---|---|
| 折叠（默认） | `▸ 🔧 run_bash(cmd, timeout)` 或 `▸ 📋 结果前 80 字符…` |
| 展开 | 完整 JSON pretty-print，最大高度 300px 滚动 |

**CSS：** `main.css` 新增 `.chat-tool-toggle`、`.chat-tool-toggle-icon`、`.chat-tool-toggle-label`

---

## 八、Session 自动命名

### 8.1 从第一条用户消息提取标题

**功能：** 新 Session 自动以用户的第一句话作为标题，无需手动命名。

**修改文件：** `python/packages/drsai/src/drsai/modules/agents/skills_agent/drsai_cli_assistant.py`

- 新增 `_safe_content_str()` 辅助函数
- `_thread_to_info()` 修改命名逻辑：

| 优先级 | 来源 | 示例 |
|---|---|---|
| 1 | `Thread.meta["name"]`（手动重命名） | `"项目架构讨论"` |
| 2 | 第一条用户消息的前 40 字符 ✨ | `"帮我分析一下 gateway.py"` |
| 3 | `thread_id` 前 8 字符 | `"a1b2c3d4"` |

---

## 修改文件总览

| # | 文件 | 模块 |
|---|---|---|
| 1 | `desktop/drsai-desktop/src/main/index.ts` | Gateway 启动 |
| 2 | `desktop/drsai-desktop/src/main/drsai.ts` | Gateway 启动 |
| 3 | `python/.../gateway.py` | 消息归一化 + UUID |
| 4 | `desktop/.../Chat/types.ts` | 消息类型 |
| 5 | `desktop/.../Chat/MessageRow.tsx` | 消息渲染 |
| 6 | `desktop/.../Chat/MessageList.tsx` | 消息列表 |
| 7 | `desktop/.../Chat/hooks/*.ts` | (无需修改) |
| 8 | `desktop/.../Layout/Layout.tsx` | Session 恢复 |
| 9 | `desktop/src/main/sessions.ts` | Session 列表 |
| 10 | `desktop/.../components/AgentMarkdown.tsx` | Markdown 渲染 |
| 11 | `desktop/.../assets/main.css` | 样式 |
| 12 | `desktop/.../assets/base.css` | 字体 |
| 13 | `python/.../drsai_cli_assistant.py` | Session 命名 |
