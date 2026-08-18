## 17 TUI 行为与调优

### 17.1 流式渲染策略

为了在 Windows PowerShell（特别是 Win10 的 PS 5.1 + 旧 `conhost.exe`）下保持流畅，TUI 采用了"流式期间纯文本、完成后再 Markdown"的渲染策略：

- **流式中**：[streamingAssistant.tsx](../apps/ui-tui/src/components/streamingAssistant.tsx) 把增量文本直接渲染为单个 `<Text>`，不做 Markdown 解析。这避免了 `MarkdownRenderer` 在每次 `message.delta` 时 O(n²) 重新解析整个 buffer，并且让 Ink 的 diff 只是单节点字符串更新，旧文本不会被重排——**滚动条也不会因重绘被弹回页面顶部**。
- **完成后**：turn 进入 `TranscriptPane` 的 `<Static>`，由 `MarkdownRenderer` 完整渲染**一次**，之后永不重绘，自然滚入终端的 scrollback 缓冲区。

事件合并节流由 [createGatewayEventHandler.ts](../apps/ui-tui/src/app/createGatewayEventHandler.ts) 完成：默认每 **80 ms** 把缓冲的文本批量 flush 到 store。可通过环境变量调节：

```bash
DRSAI_TUI_FLUSH_MS=120 drsai chat      # 慢终端调宽
DRSAI_TUI_FLUSH_MS=32  drsai chat      # 快终端调紧（最低 16，最高 500）
```

### 17.2 PowerShell 兼容性 (run_powershell 工具)

`run_powershell` 工具（在 `is_powershell=True` 时取代 `run_bash`）做了以下处理保证兼容旧版 PowerShell：

- **统一 UTF-8 输出**：wrapper 脚本在执行用户命令前设置 `[Console]::OutputEncoding`、`$OutputEncoding`、`$env:PYTHONIOENCODING=utf-8`、`$env:PYTHONUTF8=1`，防止 Win10 zh-CN 默认 OEM 编码（CP936）和 Python/Node 的 UTF-8 输出冲突导致解码挂起。
- **legacy PowerShell 用 EncodedCommand**：检测到 `powershell.exe`（PS 5.x）时改用 `-EncodedCommand <base64-UTF16LE>`，绕开 `-Command` 的内联 tokenizer，启动速度和稳定性都显著提升。`pwsh` 仍保持 `-Command` 便于排查。
- **解码容错**：`stdout.decode('utf-8', errors='replace')`，单字节坏数据不再导致整段输出消失。

详见 [operater_funs.py](../cores/python/packages/drsai/src/drsai/modules/agents/skills_agent/managers/operater_funs.py) 的 `_build_ps_command` 和 `_ps_args`。

### 17.3 前后端 RPC 映射

| RPC | 触发 | 用途 |
|------|------|------|
| `session.list` / `session.create` / `session.resume` / `session.history` | `/list` `/new` `/resume` `/history` | 会话管理 |
| `prompt.submit` / `prompt.cancel` | 用户提交 / Ctrl+C | 提交与中断 |
| `slash.exec` | 任何 `/foo` 命令 | 槽位命令分发；返回 `output` 或 `ui_action` |
| `complete.slash` / `complete.path` | TUI Tab 补全 | 自动补全后端 |
| `commands.catalog` | 启动时一次 | 提供给前端的命令注册表（用于补全） |
| `model.options` | `/model` 无参 | 列出可切模型（含 reasoning levels） |
| `model.save` | `ModelEditor` 提交 | 写入 / 改名 / 改字段；新增时自动切换 |
| `model.delete` | `/model rm` 或 picker `d` | 删除别名（带 fallback 保护） |
| `model.get` | `/model edit <alias>` | 取完整字段预填表单 |
| `approval.respond` / `clarify.respond` / `secret.respond` / `sudo.respond` | 交互覆盖层提交 | 工具调用授权回复 |
| `paste.collapse` | 长粘贴 | 折叠为 `[[ Pasted #N ... → /path.txt ]]` 占位符 |
| `skills.manage` | `/skills` 面板 | Skill CRUD + 热重载（`list/show/create/update/delete/reload`） |
| `gateway.shutdown` | Ctrl+D | 优雅退出：保存所有 session 状态，发出 `gateway.exit` 事件 |
| `memory.reload` (event) | `/memory reload` | gateway → UI 通知刷新 |
| `session.info` (event) | 状态变化 | 更新 StatusBar / badges |
| `gateway.exit` (event) | `gateway.shutdown` 完成后 | 通知 TUI 可安全退出 |
| **Subagent 事件流** | | |
| `subagent.spawn_requested` (event) | LLM Delegate 工具调用 | 通知 TUI 子智能体已启动（含 source + goal） |
| `subagent.start` (event) | 子智能体开始执行 | TUI StatusBar 显示 `⚡ <name>: <goal>` |
| `subagent.thinking` (event) | 子智能体流式输出 | 增量文本追加到当前 turn（与 `message.delta` 同等处理） |
| `subagent.tool` (event) | 子智能体工具调用 | TUI 可选展示子智能体的工具使用情况 |
| `subagent.progress` (event) | 子智能体阶段性进度 | 可选进度文本展示 |
| `subagent.complete` (event) | 子智能体完成 | 清除 StatusBar，未流式的最终文本一次性追加 |
| `subagent.delegate` (event) | `/delegate` 命令 | 手动委派时触发，携带 agent_type + prompt |

### 17.4 子智能体 TUI 渲染行为

子智能体（Delegate）的执行在 TUI 中有以下渲染行为：

**StatusBar 提示**：子智能体启动时，底部状态栏（StatusBar）会显示子智能体名称和任务目标（截断到 60 字符），完成后自动清除：

```
⚡ explore: Searching for config files…
```

**流式输出**：子智能体的思考/输出文本通过 `subagent.thinking` 事件流式传输，与主智能体的 `message.delta` 使用相同的缓冲刷新机制（默认每 **80 ms** flush），文本追加到当前 turn 的 buffer 中。这确保子智能体输出和普通对话输出在 TUI 中有完全一致的渲染体验。

**完成后渲染**：子智能体完成后，`subagent.complete` 事件：
1. 若子智能体已流式输出完毕 → 仅清除 StatusBar
2. 若子智能体为非流式（如某些远程 agent）→ 将最终文本作为一次性 delta 追加到 buffer
3. 缓冲区文本进入 `TranscriptPane` 的 `<Static>`，由 `MarkdownRenderer` 完整渲染一次

**事件处理代码路径**：`createGatewayEventHandler.ts:175-196` 中处理 `subagent.start`、`subagent.thinking`、`subagent.complete`、`subagent.tool`、`subagent.progress` 事件。详见 [createGatewayEventHandler.ts](../apps/ui-tui/src/app/createGatewayEventHandler.ts)。

### 17.5 命令注册表与 `cli_only` 标记

`backend/cli/commands.py` 中的 `COMMAND_REGISTRY` 是单一真相源，TUI 通过 `commands.catalog` RPC 拉取后用于 `/help` 和 Tab 补全。

从本次更新起，`cli_only=True` 标记已从 `/history` / `/save` / `/config` / `/info` / `/models` 上移除——它们的 gateway 处理器（`slash.py:cmd_history` 等）已经实现并可用，因此应该出现在 TUI 的补全列表与 `/help` 中。

---

---

