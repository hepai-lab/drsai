# Hermes-Agent TUI 适配设计

## 1. 背景与目标

hermes-agent 的 TUI 使用 prompt_toolkit 原生 `Application` + `HSplit` 布局，支持：
- 固定在顶部的 spinner（HSplit 顶部 Window，随 App 生命周期持续显示）
- 消息历史区（中段 Window，带自定义 content 渲染）
- 输入区（底部 BufferControl，支持 Alt+Enter 多行）
- `patch_stdout` 统一管理所有输出（streaming、spinner、消息）

drsai 当前架构：
- 使用 `PromptSession`（prompt_toolkit 封装层）处理输入
- spinner 使用 `KawaiiSpinner`（独立线程 + `cursor.hide()` + `print()`）
- renderer 通过 Rich `Console.print()` 输出（与 patch_stdout 隔离）
- 问题：spinner 和 streaming 混在一起时渲染层叠错位

**目标：** 让 drsai 的 TUI 与 hermes-agent 完全对齐——单 Application、单 patch_stdout、统一的 HSplit 布局。

---

## 2. 关键架构差异

| 特性 | drsai（现状） | hermes-agent（目标） |
|------|-------------|-------------------|
| 输入控件 | `PromptSession` | `Application` + `BufferControl` |
| spinner 渲染 | 独立线程 + print() | HSplit 顶部 `Window` widget（App 内置） |
| 消息历史 | 每次 render 直接 Console.print() | HSplit 中段 `Window` + 自定义 content |
| patch_stdout | 仅包 `prompt()` 调用 | 包整个 `app.run()` 生命周期 |
| 多行输入 | PromptSession key_bindings | `BufferControl` key_bindings |
| 底部状态栏 | PromptSession `bottom_toolbar` | HSplit 底部 `Float` + `TokenizedToolbarControl` |

---

## 3. 方案设计

### 方案 A：渐进式适配（推荐）

保留现有代码最大程度不变，将 drsai 的 `PromptSession` 升级为 `Application`，分两步走：

#### 阶段 1：Application 化 REPL 入口

将 `_run_repl()` 中的 `DrSaiPrompt` + `PromptSession` 替换为单 `Application`。

核心组件：

```
HSplit([
    DynamicWindow(spinner_provider),   # 顶部：spinner
    DynamicWindow(message_provider),   # 中段：消息历史
    DynamicWindow(input_provider),     # 底部：输入
])
```

其中每个 `DynamicWindow` 的 content 是可动态更新的：

- **spinner provider**：返回一个 `HSplit([SpinnerTokens, MessageTokens])`，spinner 在 token 层直接以 ANSI escape 渲染
- **message provider**：返回 `Box(FormattedTextControl(msg_buffer))`，msg_buffer 是追加内容的 deque
- **input provider**：返回 `BufferControl(buffer=input_buffer, key_bindings=kb)`，绑定 Alt+Enter 多行

**patch_stdout** 只包 `app.run()`：

```python
# run_cli.py
async def _run_repl(cfg):
    app = build_drsai_app(...)  # 构造 Application
    with patch_stdout():
        app.run()
```

**spinner 行为**：App 持续运行期间，spinner 始终可见（显示当前正在执行的工具名或 AI 思考状态）。spinner 通过修改 HSplit 顶部 Window 的 content 来更新，不需要独立线程。

**streaming 行为**：所有输出（streaming token、消息、diff）通过 `app.print_tokens()` 或直接修改 message Window 的 content 注入，`patch_stdout` 保证它们出现在 prompt 上方。

#### 阶段 2：迁移现有 display 组件

- `KawaiiSpinner` → 移除（功能由 HSplit 顶部 Window + Token 替代）
- `build_tool_preview` → 保留，作为 message 区内容片段
- `render_edit_diff_with_delta` → 保留，在 message 区渲染 diff
- `DrSaiCLIRenderer.render()` → 重构为更新 message Window content 的逻辑

### 方案 B：完整重构

将 drsai 的 `PromptSession`、`DrSaiPrompt`、display 组件全部丢弃，重新实现 hermes-agent 风格（hermes-agent 的代码直接抄过来适配）。

**代价：** 需要重写 `run_cli.py`（约 300 行）、`prompt.py`（约 200 行）、`renderer.py`（约 400 行）。

**收益：** 最干净的适配，与 hermes-agent 完全一致。

---

## 4. 推荐方案：A（渐进式）

理由：

1. **保持 drsai 已有功能**（session 管理、history、completion、底部状态栏）全部迁移保留
2. **spinner 和 streaming 问题一次性解决**，因为所有输出都走 App 内的 HSplit Window 渲染
3. **工程量可控**，每个组件逐一迁移，有清晰的 checkpoint
4. **hermes-agent 代码可直接参考**，`hermes_agent/tui/` 就是实现参考

---

## 5. 组件映射

### 5.1 REPL 入口（run_cli.py）

| 现有 | 迁移后 |
|------|--------|
| `while True: with patch_stdout(): user_input = await prompt.prompt()` | `app.run()`（patch_stdout 在外层） |
| `_dispatch("/cmd")` | 保留，通过 `buffer.on_text_submit` 路由 |
| `await renderer.render(event_stream, stats)` | 重构为 `app.update_messages(event_stream)` |
| `Ctrl+C/D` 中断 | 通过 App key_bindings 处理 |

### 5.2 消息缓冲区

```python
class MessageBuffer:
    """驱动 HSplit 中段 Window 的消息历史。"""
    def __init__(self, max_lines: int = 1000):
        self._lines: deque[str] = deque(maxlen=max_lines)
    
    def append(self, content: str, style: str = ""):
        self._lines.append(content)
    
    def clear(self):
        self._lines.clear()
    
    def get_formatted(self) -> FormattedText:
        # 返回 [(style, text), ...] 供 FormattedTextControl 渲染
```

### 5.3 Spinner Provider

```python
class SpinnerState:
    """驱动 HSplit 顶部 Window。"""
    active: bool = False
    label: str = ""
    frames: list[str] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"]
    
    def start(self, label: str = ""):
        self.active = True
        self.label = label
    
    def stop(self):
        self.active = False
        self.label = ""
```

`HSplit` 顶部 Window 使用 `DynamicWindow(lambda: SpinnerTokens(spinner_state))`，定时刷新（每 80ms 切换一帧）。

### 5.4 输入处理

- 保留现有 `ALT_ENTER` / `ESCAPE_ENTER` key_bindings（多行支持）
- 保留 slash 命令补全（`SlashCommandCompleter` → `Completer` 实现）
- 保留 FileHistory（`FileHistory` 可直接传入 `Buffer`）
- 底部状态栏：从 `PromptSession.bottom_toolbar` 迁移到 `HSplit` 底部的 `Float > TokenizedToolbarControl`

### 5.5 底部状态栏迁移

```python
def bottom_toolbar_tokens(label: str, stats: SessionStats) -> FormattedText:
    return [
        ("#xinzeng", " 新建 "),
        ("#sessions", f" 会话 "),
        ("#goback", " ↑↓ 历史 "),
        ("#toolmode", " 工具 ON "),
        ("#class", f" {stats.model_label} "),
        ("#turns", f" {stats.turns} 轮 "),
    ]
```

### 5.6 迁移工具执行回调

现有 `callbacks.py` 中的 `clarify_callback`/`approval_callback` 是在工具调用前同步等待用户响应。

迁移后，这些交互通过 **临时 HSplit Float overlay** 实现：

```python
def show_approval_dialog(app: Application, tool_name: str, args: str) -> str:
    """显示工具执行确认浮层，返回用户选择（approve/reject）。"""
    overlay = Float(content=ApprovalPanel(tool_name, args))
    # 暂停主 App，输入浮层捕获键盘
    # 用户确认后移除浮层，继续 App
```

---

## 6. 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `run_cli.py` | 重写 | 主循环改为 app.run()，dispatch 和 chat 逻辑迁移 |
| `prompt.py` | 删除 | PromptSession 替换为 Application builder |
| `renderer.py` | 重构 | render() 改为 message buffer 更新逻辑 |
| `display.py` | 修改 | KawaiiSpinner 移除，保留工具预览和 diff 工具 |
| `stats.py` | 保留 | 逻辑不变，接口适配 |
| `history.py` | 保留 | 无需改动 |
| `callbacks.py` | 修改 | 同步阻塞改为 App Float overlay |
| `interrupt.py` | 修改 | 适配新 App 中断机制 |
| `curses_ui.py` | 保留 | 逻辑不变 |

新建：

| 文件 | 说明 |
|------|------|
| `tui/app.py` | Application builder，HSplit 布局，message buffer，spinner state |
| `tui/widgets.py` | Spinner widget, MessageWindow widget, ApprovalPanel |
| `tui/keybindings.py` | Alt+Enter, Ctrl+C/D, Ctrl+L 等 key_bindings |

---

## 7. 实施顺序

### Step 1：搭建框架
- 新建 `tui/` 目录
- 实现 `MessageBuffer` 和 `SpinnerState`
- 实现最小 `Application`：只有 spinner（静态）+ 输入区 + 底部 toolbar
- 确保 patch_stdout 正常工作，输入循环可运行

### Step 2：迁移消息渲染
- 将 `DrSaiCLIRenderer` 的 `_write_chunk` / `_render_tool_*` 迁移到 message buffer 更新
- 确保 streaming 输出正确显示在 spinner 和输入区之间

### Step 3：迁移工具回调
- 实现 `ApprovalPanel` Float overlay
- 实现 `clarify_callback` 改写为 App Float 捕获

### Step 4：清理与回归
- 移除 `prompt.py`、废弃的 `DrSaiPrompt`、废弃的 `KawaiiSpinner`
- 确保所有现有功能（history、completion、session 管理）正常

---

## 8. 风险与缓解

| 风险 | 缓解 |
|------|------|
| Application 重构影响现有功能 | 分阶段实施，每阶段功能测试 |
| message buffer 渲染性能（大量历史消息） | max_lines 限制 + 虚拟滚动 |
| 工具回调的同步等待与 App.run() 冲突 | 使用 Float overlay + focus 切换 |
| Alt+Enter 多行与 App key_bindings 冲突 | 复用现有 key_bindings 定义 |

---

## 9. 验收标准

- [ ] REPL 启动后 spinner 持续可见，工具执行时正确显示工具名
- [ ] AI streaming token 输出在 spinner 和输入区之间正确显示，无层叠错位
- [ ] 工具预览（🔧 工具名）正确显示在消息区
- [ ] 文件编辑 diff 正确渲染在消息区
- [ ] Alt+Enter 多行输入正常工作
- [ ] Ctrl+C 中断工具执行正常工作
- [ ] 历史命令搜索（↑↓）正常工作
- [ ] 底部状态栏正确显示（model、turns、plan mode）
- [ ] 新建会话、切换会话功能正常
- [ ] 所有现有 `/cmd` 命令正常
