# Hermes-Agent TUI 适配实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 drsai 的 REPL 从 `PromptSession` 升级为 hermes-agent 风格的 `Application` + `HSplit` 布局，实现统一的 spinner、消息历史、输入区和底部状态栏，单 `patch_stdout` 包整个 App 生命周期。

**Architecture:** 
- 新建 `backend/cli/tui/` 目录，包含 `app.py`（Application builder）、`widgets.py`（TUI widgets）、`keybindings.py`（keybindings）
- 重构 `run_cli.py` 的 REPL 入口，用 `app.run()` 替代 `while True + prompt()` 循环
- 重构 `renderer.py` 的渲染逻辑，将输出注入 message buffer（HSplit 中段 Window 的 content）

**Tech Stack:** prompt_toolkit (`Application`, `HSplit`, `Window`, `TextArea`, `FormattedTextControl`, `ConditionalContainer`, `Layout`, `KeyBindings`, `patch_stdout`)

---

## 文件结构

```
backend/cli/tui/           (新建)
├── __init__.py
├── app.py                 # Application builder + REPL state
├── widgets.py             # HSplit children builders
└── keybindings.py         # KeyBindings definitions

backend/cli/
├── run_cli.py             # 重写 REPL 入口（保留 dispatch/chat 逻辑）
├── prompt.py              # 删除（原 PromptSession 迁移到 tui/app.py）
├── renderer.py            # 重构 render() 方法
├── display.py             # 移除 KawaiiSpinner，保留 diff 工具
├── callbacks.py           # 修改（同步阻塞 → App overlay）
└── stats.py               # 保留，接口适配
```

---

## Task 1: 搭建 tui/ 目录骨架

**Files:**
- Create: `backend/cli/tui/__init__.py`
- Create: `backend/cli/tui/app.py`
- Create: `backend/cli/tui/widgets.py`
- Create: `backend/cli/tui/keybindings.py`

### Step 1.1: 创建 `tui/__init__.py`

```python
"""DrSai TUI - hermes-agent style Application + HSplit layout."""

from .app import build_drsai_app, DrSaiTUIState

__all__ = ["build_drsai_app", "DrSaiTUIState"]
```

### Step 1.2: 创建 `tui/app.py` — 核心 Application builder

```python
"""
DrSai TUI Application Builder

参考 hermes-agent/cli.py 的 Application + HSplit 架构。
"""

import queue
import shutil
import threading
import time
from collections import deque
from pathlib import Path
from typing import Optional, Any

from prompt_toolkit.application import Application
from prompt_toolkit.auto_suggest import AutoSuggestFromHistory
from prompt_toolkit.buffer import Buffer
from prompt_toolkit.completion import Completer
from prompt_toolkit.filters import Condition
from prompt_toolkit.history import FileHistory
from prompt_toolkit.key_binding import KeyBindings
from prompt_toolkit.layout import Layout, HSplit, Window
from prompt_toolkit.styles import Style
from prompt_toolkit.widgets import TextArea
from prompt_toolkit.layout.dimension import Dimension

# === DrSaiTUIState: 驱动所有 HSplit Window 的状态容器 ===

class DrSaiTUIState:
    """全局 TUI 状态，所有 Window content 通过此对象读取/更新。"""

    def __init__(self):
        # Message buffer (deque of (style, text) tuples for FormattedTextControl)
        self.messages: deque[tuple[str, str]] = deque(maxlen=500)

        # Spinner state
        self.spinner_text: str = ""         # e.g. "⏳ Running tool..."
        self.spinner_visible: bool = False
        self._spinner_frame: int = 0
        self._spinner_frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"]

        # Command running state (replaces KawaiiSpinner)
        self.command_running: bool = False

        # Session stats (read by status bar)
        self.turns: int = 0
        self.model_label: str = "?"
        self.plan_mode: bool = False
        self.tool_enabled: bool = True

        # Interactive prompts state (for ConditionalContainer visibility)
        self.approval_state: dict | None = None
        self.clarify_state: dict | None = None
        self.sudo_state: dict | None = None
        self.secret_state: dict | None = None

        # Pending input queue (bridges keybindings → REPL loop)
        self._pending_input: queue.Queue = queue.Queue()

        # App reference (set after Application creation)
        self._app: Optional[Application] = None

        # Exit flag
        self.should_exit: bool = False

    # --- Message buffer API ---

    def append_message(self, text: str, style: str = ""):
        """Append a styled text fragment to the message history."""
        self.messages.append((style, text))
        self._invalidate()

    def append_line(self, text: str, style: str = ""):
        """Append a line (ends with newline)."""
        self.append_message(text + "\n", style)

    def clear_messages(self):
        self.messages.clear()
        self._invalidate()

    # --- Spinner API (replaces KawaiiSpinner thread) ---

    def start_spinner(self, label: str = ""):
        """Start displaying the spinner with optional label."""
        self.spinner_text = label
        self.spinner_visible = True
        self.command_running = True
        self._spinner_frame = 0
        self._invalidate()

    def update_spinner(self, label: str):
        """Update spinner label text."""
        self.spinner_text = label
        self._invalidate()

    def stop_spinner(self):
        """Stop and hide the spinner."""
        self.spinner_visible = False
        self.spinner_text = ""
        self.command_running = False
        self._invalidate()

    def next_spinner_frame(self) -> str:
        """Get next spinner frame, cycling through frames."""
        frame = self._spinner_frames[self._spinner_frame % len(self._spinner_frames)]
        self._spinner_frame += 1
        return frame

    def get_spinner_display(self) -> list[tuple[str, str]]:
        """Return FormattedText fragments for the spinner Window."""
        if not self.spinner_visible:
            return []
        frame = self.next_spinner_frame()
        label = self.spinner_text
        if label:
            return [("class:spinner", f"  {frame} {label}")]
        return [("class:spinner", f"  {frame}")]

    def get_spinner_height(self) -> int:
        """Return the height of the spinner Window (1 or 0)."""
        return 1 if self.spinner_visible else 0

    # --- Status bar API ---

    def get_status_fragments(self) -> list[tuple[str, str]]:
        """Return FormattedText fragments for the status bar."""
        frags = [
            ("class:status-bar", " 新建 "),
            ("class:status-bar", " 会话 "),
            ("class:status-bar", " ↑↓ 历史 "),
        ]
        if self.tool_enabled:
            frags.append(("class:status-bar-good", " 工具 ON "))
        else:
            frags.append(("class:status-bar-dim", " 工具 OFF "))
        frags.extend([
            ("class:status-bar-dim", " · "),
            ("class:status-bar", f" {self.model_label} "),
            ("class:status-bar-dim", " · "),
            ("class:status-bar", f" {self.turns} 轮 "),
        ])
        if self.plan_mode:
            frags.append(("class:status-bar-warn", " · plan "))
        return frags

    # --- Internal ---

    def _invalidate(self, min_interval: float = 0.0):
        """Trigger App repaint if enough time has passed since last repaint."""
        app = getattr(self, "_app", None)
        if app is not None and app._is_running:
            app.invalidate()


# === Application Builder ===

def build_drsai_app(
    state: DrSaiTUIState,
    session_label_fn: callable,           # () -> str
    history_file: Path,
    completer: Completer,
    extra_widgets_provider: Optional[callable] = None,
) -> Application:
    """
    Build the prompt_toolkit Application with HSplit layout.
    
    Args:
        state: DrSaiTUIState instance (shared by all widgets)
        session_label_fn: () -> str, returns the prompt label text
        history_file: Path to the history file for FileHistory
        completer: prompt_toolkit Completer for slash commands
        extra_widgets_provider: optional () -> list[Window] for subclass extensions
    
    Returns:
        Application ready to run with app.run()
    """
    from .widgets import build_hsplit_children
    from .keybindings import build_keybindings

    kb = build_keybindings(state)

    # Build HSplit children (spinner, spacer, status, input, etc.)
    children = build_hsplit_children(state, session_label_fn, history_file, completer, extra_widgets_provider)

    layout = Layout(HSplit(children))

    style = Style.from_dict({
        "input-area": "",
        "placeholder": "#888888 italic",
        "prompt": "",
        "spinner": "#FFD700 italic",
        "status-bar": "bg:#1a1a2e #C0C0C0",
        "status-bar-good": "bg:#1a1a2e #8FBC8F bold",
        "status-bar-warn": "bg:#1a1a2e #FFD700 bold",
        "status-bar-dim": "bg:#1a1a2e #8B8682",
        "input-rule": "#CD7F32",
        "approval-border": "#CD7F32",
        "approval-title": "#FFD700 bold",
        "approval-text": "#FFF8DC",
        "approval-selected": "#FFD700 bold",
    })

    app = Application(
        layout=layout,
        key_bindings=kb,
        style=style,
        full_screen=False,
        mouse_support=False,
    )

    state._app = app
    return app
```

### Step 1.3: 创建 `tui/widgets.py` — HSplit children

```python
"""
TUI Widget builders for HSplit layout.

参考 hermes-agent/cli.py 中 _build_tui_layout_children() 的模式。
"""

import shutil
from pathlib import Path
from typing import Callable, Optional

from prompt_toolkit.buffer import Buffer
from prompt_toolkit.completion import Completer
from prompt_toolkit.filters import Condition
from prompt_toolkit.formatted_text import FormattedText
from prompt_toolkit.layout import HSplit, Window
from prompt_toolkit.layout.controls import FormattedTextControl
from prompt_toolkit.layout.dimension import Dimension
from prompt_toolkit.widgets import TextArea
from prompt_toolkit.auto_suggest import AutoSuggestFromHistory

from .app import DrSaiTUIState


def _get_prompt_fragments(label: str) -> FormattedText:
    """Build prompt fragments: label + › symbol."""
    return [
        ("class:prompt", f" {label} "),
        ("", "› "),
    ]


def _get_prompt_text(label: str) -> str:
    return f" {label} › "


def build_hsplit_children(
    state: DrSaiTUIState,
    session_label_fn: Callable[[], str],
    history_file: Path,
    completer: Completer,
    extra_widgets_provider: Optional[Callable[[], list]] = None,
) -> list:
    """
    Build the ordered list of HSplit children.
    
    Order (from hermes-agent pattern):
      1. Window(height=0)         -- top spacer
      2. sudo_widget              -- ConditionalContainer, hidden by default
      3. secret_widget            -- ConditionalContainer, hidden by default
      4. approval_widget          -- ConditionalContainer, hidden by default
      5. clarify_widget           -- ConditionalContainer, hidden by default
      6. spinner_widget           -- Window, height=dynamic(0 or 1)
      7. spacer                   -- DynamicWindow, message area
      8. status_bar               -- ConditionalContainer, at bottom
      9. input_rule_top           -- Window(height=1), copper rule
      10. input_area              -- TextArea (multiline)
      11. input_rule_bot          -- Window(height=1), copper rule
    """

    # ── spinner widget ───────────────────────────────────────────────────
    def get_spinner_text() -> FormattedText:
        return state.get_spinner_display()

    def get_spinner_height() -> int:
        return state.get_spinner_height()

    spinner_widget = Window(
        content=FormattedTextControl(get_spinner_text),
        height=get_spinner_height,
        wrap_lines=False,
    )

    # ── approval widget ──────────────────────────────────────────────────
    def get_approval_display() -> FormattedText:
        if not state.approval_state:
            return []
        s = state.approval_state
        tool_name = s.get("tool_name", "?")
        args_str = s.get("args_str", "")
        preview = args_str[:120] + ("..." if len(args_str) > 120 else "")
        lines = [
            ("class:approval-border", "╭─ ⚠️  Tool Approval Required ────────────────────╮\n"),
            ("class:approval-title",  f"  🔧 {tool_name}\n"),
            ("class:approval-text",   f"  Args: {preview}\n"),
            ("class:approval-border", "╰─────────────────────────────────────────────────╯\n"),
        ]
        choices = s.get("choices", [])
        if choices:
            lines.append(("class:approval-text", "  Options: "))
            for i, c in enumerate(choices):
                lines.append(("class:approval-text" if i != s.get("selected", 0) else "class:approval-selected", f"[{i+1}] {c}  "))
            lines.append(("\n", ""))
        return lines

    approval_widget = ConditionalContainer(
        Window(FormattedTextControl(get_approval_display), wrap_lines=True),
        filter=Condition(lambda: state.approval_state is not None),
    )

    # ── message spacer (message history area) ────────────────────────────
    def get_message_text() -> FormattedText:
        return list(state.messages)

    def get_message_height() -> Dimension:
        # Takes all remaining vertical space
        return Dimension(weight=1)

    message_spacer = Window(
        content=FormattedTextControl(get_message_text),
        height=get_message_height,
        wrap_lines=True,
    )

    # ── status bar ────────────────────────────────────────────────────────
    def get_status_text() -> FormattedText:
        return state.get_status_fragments()

    status_bar = Window(
        content=FormattedTextControl(get_status_text),
        height=1,
        wrap_lines=False,
    )

    # ── input area ────────────────────────────────────────────────────────
    # Multi-line via Alt+Enter (handled by keybindings in keybindings.py)
    label_fn = session_label_fn

    def get_prompt() -> FormattedText:
        return _get_prompt_fragments(label_fn())

    input_area = TextArea(
        height=Dimension(min=1, max=8, preferred=1),
        prompt=get_prompt,
        style="class:input-area",
        multiline=True,
        wrap_lines=True,
        read_only=Condition(lambda: state.command_running),
        history=FileHistory(str(history_file)),
        completer=completer,
        complete_while_typing=True,
        auto_suggest=AutoSuggestFromHistory(),
    )

    # Dynamic height: accounts for explicit newlines + visual wrapping
    def _input_height() -> int:
        try:
            from prompt_toolkit.application import get_app
            from prompt_toolkit.utils import get_cwidth
            doc = input_area.buffer.document
            prompt_width = max(2, get_cwidth(_get_prompt_text(label_fn())))
            try:
                available_width = get_app().output.get_size().columns - prompt_width
            except Exception:
                available_width = shutil.get_terminal_size((80, 24)).columns - prompt_width
            if available_width < 10:
                available_width = 40
            visual_lines = 0
            for line in doc.lines:
                line_width = get_cwidth(line) if line else 0
                if line_width <= 0:
                    visual_lines += 1
                else:
                    visual_lines += max(1, -(-line_width // available_width))
            return min(max(visual_lines, 1), 8)
        except Exception:
            return 1

    input_area.window.height = _input_height

    # ── input rule separators ─────────────────────────────────────────────
    def _rule_style() -> str:
        return "class:input-rule"

    input_rule_top = Window(height=1, char="─", style=_rule_style)
    input_rule_bot = Window(height=1, char="─", style=_rule_style)

    # ── assemble HSplit children ──────────────────────────────────────────
    children = [
        Window(height=1),       # top spacer (prevents content from touching top edge)
        approval_widget,
        spinner_widget,
        message_spacer,
        status_bar,
        input_rule_top,
        input_area,
        input_rule_bot,
    ]

    if extra_widgets_provider:
        children = extra_widgets_provider(children) + children

    return [c for c in children if c is not None]
```

### Step 1.4: 创建 `tui/keybindings.py` — KeyBindings

```python
"""
KeyBindings for DrSai TUI.

参考 hermes-agent/cli.py handle_enter() 和 Ctrl+C/D 处理模式。
"""

import queue
from prompt_toolkit.key_binding import KeyBindings
from prompt_toolkit.filters import Condition

from .app import DrSaiTUIState


def build_keybindings(state: DrSaiTUIState) -> KeyBindings:
    kb = KeyBindings()

    # ── Enter: submit input ───────────────────────────────────────────────
    @kb.add("enter", filter=~Condition(lambda: state.command_running))
    def handle_enter(event):
        """Handle Enter: route to correct handler based on active state."""
        # Approval mode: confirm selected choice
        if state.approval_state:
            selected = state.approval_state.get("selected", 0)
            choices = state.approval_state.get("choices", [])
            if 0 <= selected < len(choices):
                choice = choices[selected][0] if isinstance(choices[selected], tuple) else choices[selected]
                _submit_approval(state, choice)
            state._invalidate()
            return

        # Clarify mode
        if state.clarify_state:
            choices = state.clarify_state.get("choices") or []
            selected = state.clarify_state.get("selected", 0)
            if selected < len(choices):
                state.clarify_state["response_queue"].put(choices[selected])
            else:
                # "Other" → freetext mode
                pass
            state.clarify_state = None
            state._invalidate()
            return

        # Normal submit
        text = event.app.current_buffer.text.strip()
        if text:
            # Route to process_loop via pending_input queue
            state._pending_input.put(text)
        event.app.current_buffer.reset(append_to_history=True)
        event.app.invalidate()

    @kb.add("enter", filter=Condition(lambda: state.command_running))
    def handle_enter_while_running(event):
        """Enter while command running: interrupt."""
        text = event.app.current_buffer.text.strip()
        if text:
            # Interrupt the running command
            state._pending_input.put(("interrupt", text))
        event.app.current_buffer.reset()
        event.app.invalidate()

    # ── Alt+Enter / Esc+Enter: insert newline (multiline input) ──────────
    @kb.add("escape", "enter")
    @kb.add("alt-enter")
    def insert_newline(event):
        event.app.current_buffer.insert_text("\n")

    # ── Ctrl+C: interrupt ─────────────────────────────────────────────────
    @kb.add("c-c", eager=True)
    def handle_ctrl_c(event):
        """Ctrl+C: set interrupt flag."""
        # Don't quit — just signal interrupt and reset buffer
        event.app.current_buffer.reset()
        event.app.invalidate()

    # ── Ctrl+D: EOF / exit ────────────────────────────────────────────────
    @kb.add("c-d", eager=True)
    def handle_ctrl_d(event):
        """Ctrl+D: exit the REPL."""
        state.should_exit = True
        if event.app.is_running:
            event.app.exit()

    # ── Ctrl+L: clear screen ─────────────────────────────────────────────
    @kb.add("c-l")
    def handle_ctrl_l(event):
        """Ctrl+L: clear message history."""
        state.clear_messages()
        event.app.invalidate()

    # ── ↑/↓: history search ───────────────────────────────────────────────
    # History is handled by prompt_toolkit's FileHistory + AutoSuggestFromHistory
    # No custom bindings needed for basic ↑↓ navigation

    return kb


def _submit_approval(state: DrSaiTUIState, choice: str):
    """Submit an approval choice and close the approval panel."""
    if state.approval_state:
        rq = state.approval_state.get("response_queue")
        if rq:
            rq.put(choice)
        state.approval_state = None
```

### Step 1.5: 验证骨架能运行

测试 Application 能正常初始化：

```python
# 临时测试脚本放在 tmp/ 下
from pathlib import Path
from drsai.backend.cli.tui import build_drsai_app, DrSaiTUIState

state = DrSaiTUIState()
state.turns = 3
state.model_label = "claude-3.5"

from drsai.backend.cli.history import CLISessionStore

app = build_drsai_app(
    state=state,
    session_label_fn=lambda: "drsai",
    history_file=Path("/tmp/test_history.txt"),
    completer=None,  # can be None for basic test
)
print("App built successfully:", app)
```

---

## Task 2: 重写 run_cli.py — App.run() 主循环

**Files:**
- Modify: `backend/cli/run_cli.py` — 替换 while 循环为 app.run()

### Step 2.1: 读取现有 run_cli.py 并识别保留逻辑

需要从 `run_cli.py` 保留到新架构的内容：
- `DatabaseManager` 初始化
- `CLISessionStore` 初始化
- `SessionStats` 初始化
- `_dispatch()` 命令分发函数
- `_do_chat()` 聊天函数
- 所有 `/` 命令处理器
- `engine_uri` / user_id 解析

### Step 2.2: 重构 REPL 入口

替换现有的：

```python
while True:
    with patch_stdout():
        user_input = await prompt_reader.prompt()
    # ... dispatch/chat logic
```

改为：

```python
from drsai.backend.cli.tui import build_drsai_app, DrSaiTUIState
from drsai.backend.cli.tui.widgets import build_hsplit_children
from drsai.backend.cli.renderer import DrSaiTUIRenderer
from drsai.backend.cli.callbacks import build_approval_callback, build_clarify_callback

async def _run_repl(cfg: dict):
    db_manager = DatabaseManager(...)
    store = CLISessionStore(...)
    stats = SessionStats(...)
    
    state = DrSaiTUIState()
    state.turns = stats.turns  # sync
    
    # Build completer from session store
    from .prompt import _SlashCompleter  # reuse existing
    completer = _SlashCompleter(
        completion_hook=lambda: [s.name for s in store.list(limit=20)],
    )
    
    # Build Application
    app = build_drsai_app(
        state=state,
        session_label_fn=_current_label,
        history_file=HISTORY_PATH,
        completer=completer,
    )
    
    # Start spinner background loop (hermes-agent pattern)
    def spinner_loop():
        while not state.should_exit:
            if state._app and state.command_running:
                state._invalidate()
                time.sleep(0.1)
            else:
                time.sleep(0.2)
    
    spinner_thread = threading.Thread(target=spinner_loop, daemon=True)
    spinner_thread.start()
    
    # Process loop (background thread, like hermes-agent's process_loop)
    def process_loop():
        while not state.should_exit:
            try:
                user_input = state._pending_input.get(timeout=0.1)
            except queue.Empty:
                continue
            
            if isinstance(user_input, tuple) and user_input[0] == "interrupt":
                # Handle interrupt
                ...
                continue
            
            # Dispatch /commands
            if isinstance(user_input, str) and user_input.startswith("/"):
                # Run dispatch in sync (blocking) or async context
                # Note: need to bridge to async context
                ...
            else:
                # Run chat
                ...
    
    process_thread = threading.Thread(target=process_loop, daemon=True)
    process_thread.start()
    
    # Run the TUI
    with patch_stdout():
        app.run()
    
    # Cleanup
    state.should_exit = True
```

**关键改动：**
- `while True` 循环被 `app.run()` 替代
- 输入路由通过 `state._pending_input` queue（keybindings → process_loop → REPL）
- spinner loop 在后台线程运行，调用 `state._invalidate()` 触发 App 刷新
- process_loop 处理输入（dispatch 命令 或 启动 chat）

### Step 2.3: 适配 async dispatch/chat 到 process_loop

`process_loop` 是普通线程，不能直接 `await`。需要用 `asyncio.run_coroutine_threadsafe()` 或 `loop.call_soon_threadsafe()`：

```python
import asyncio

_loop: asyncio.AbstractEventLoop | None = None

def process_loop():
    global _loop
    try:
        _loop = asyncio.new_event_loop()
        asyncio.set_event_loop(_loop)
        _loop.run_until_complete(_process_loop_inner(_loop, state))
    except Exception as e:
        print(f"Process loop error: {e}")
    finally:
        state.should_exit = True

async def _process_loop_inner(loop, state):
    while not state.should_exit:
        try:
            user_input = await asyncio.wait_for(
                asyncio.get_event_loop().run_in_executor(None, state._pending_input.get),
                timeout=0.1
            )
        except asyncio.TimeoutError:
            continue
        
        if isinstance(user_input, tuple) and user_input[0] == "interrupt":
            # set_interrupt(True)
            continue
        
        text = user_input if isinstance(user_input, str) else user_input[0] if isinstance(user_input, tuple) else ""
        if not text:
            continue
        
        if text.startswith("/"):
            await _dispatch(text)
        else:
            # Create renderer hooked to state
            renderer = DrSaiTUIRenderer(state)
            await renderer.render(agent.run_stream(task=text), stats)
            state.turns = stats.turns
            state._invalidate()
```

---

## Task 3: 重构 renderer.py — 输出注入 message buffer

**Files:**
- Modify: `backend/cli/renderer.py` — 重构 `DrSaiCLIRenderer.render()` 为 `DrSaiTUIRenderer`

### Step 3.1: 创建新的 DrSaiTUIRenderer

替换 `DrSaiCLIRenderer` 的 `render()` 方法，将所有输出写入 `DrSaiTUIState.messages`：

```python
class DrSaiTUIRenderer:
    """
    Renders agent events into the DrSaiTUIState message buffer.
    
    All output goes through the HSplit message Window via state.messages,
    ensuring consistent rendering with the App's patch_stdout lifecycle.
    """

    def __init__(self, state: DrSaiTUIState, show_reasoning: bool = False):
        self.state = state
        self.show_reasoning = show_reasoning
        self._stream_buf = ""   # Partial line for token streaming

    async def render(self, event_stream, stats: SessionStats):
        async for event in event_stream:
            if isinstance(event, ModelClientStreamingChunkEvent):
                self._write_chunk("visible", event.content)
            elif isinstance(event, ToolCallRequestEvent):
                self._render_tool_request(event)
            elif isinstance(event, ToolCallExecutionEvent):
                self._render_tool_result(event)
            elif isinstance(event, TextMessage):
                self._render_text_message(event)
            
            self.state._invalidate()
        
        # Footer stats
        if stats and stats.show_footer:
            self._write_line(stats.format_footer(), "class:status-dim")

    def _write_chunk(self, stream: str, text: str):
        """Write a streaming chunk to the message buffer."""
        if stream == "reasoning":
            if self.show_reasoning:
                self.state.append_message(text, "class:reasoning")
        else:
            self.state.append_message(text, "")

    def _write_line(self, text: str, style: str = ""):
        """Write a complete line."""
        self.state.append_line(text, style)

    def _render_tool_request(self, event):
        """Render tool call request: 🔧 tool_name(args_preview)"""
        tool_name = getattr(event, "name", "?")
        args = getattr(event, "arguments", {})
        
        from .display import build_tool_preview
        preview = build_tool_preview(tool_name, args, max_len=80)
        if preview:
            self._write_line(f"  🔧 {preview}", "class:tool-prefix")
        else:
            self._write_line(f"  🔧 {tool_name}", "class:tool-prefix")

    def _render_tool_result(self, event):
        """Render tool result with diff if applicable."""
        tool_name = getattr(event, "name", "?")
        result = getattr(event, "result", None)
        
        # Show result summary
        if result and hasattr(result, "summary"):
            self._write_line(f"  ✅ {tool_name}: {result.summary}", "class:tool-result")
        elif result:
            summary = str(result)[:120]
            self._write_line(f"  ✅ {tool_name}: {summary}", "class:tool-result")

    def _render_text_message(self, event):
        """Render a complete text message in a bordered panel."""
        content = getattr(event, "content", "")
        role = getattr(event, "role", "assistant")
        
        if role == "user":
            self._write_line(f"\n{content}", "class:user-echo")
        else:
            border = "─" * min(len(content.split('\n')[0]) + 4, 60)
            self.state.append_line(f"╭─{border}─╮", "class:assistant-panel-border")
            for line in content.split('\n'):
                self.state.append_line(f"  {line}", "class:assistant-text")
            self.state.append_line(f"╰{'─' * (len(border) + 2)}─╯", "class:assistant-panel-border")
```

### Step 3.2: 更新 agent 调用以使用新 renderer

在 `run_cli.py` 的 `_do_chat` 替代中：

```python
renderer = DrSaiTUIRenderer(state)
await renderer.render(agent.run_stream(task=text), stats)
```

---

## Task 4: 迁移 display.py — 移除 KawaiiSpinner，保留工具

**Files:**
- Modify: `backend/cli/display.py`

### Step 4.1: 删除 KawaiiSpinner 类

删除 `class KawaiiSpinner` 和 `class KawaiiSpinnerThread`。不再需要独立线程 spinner。

### Step 4.2: 保留的工具函数

确认以下函数仍然可用（不依赖 KawaiiSpinner）：
- `build_tool_preview()`
- `LocalEditSnapshot`
- `render_edit_diff_with_delta()`
- `clear_console_lines()`

### Step 4.3: 更新 renderer.py 中的 import

从 `display.py` 移除 KawaiiSpinner 相关的所有 import 和调用：

```python
# 删除这些行：
from .display import KawaiiSpinner, KawaiiSpinnerThread, build_tool_preview, ...

# 替换为：
from .display import build_tool_preview, LocalEditSnapshot, render_edit_diff_with_delta
```

---

## Task 5: 迁移 callbacks.py — 同步阻塞改 App overlay

**Files:**
- Modify: `backend/cli/callbacks.py`

### Step 5.1: 修改 approval_callback

hermes-agent 风格：不是同步阻塞线程，而是在 keybindings 中处理（Enter 路由到 approval_state）。

新流程：
1. 工具需要 approval 时，设置 `state.approval_state = {"tool_name": ..., "args_str": ..., "choices": [...], "selected": 0, "response_queue": queue.Queue()}`
2. `app.invalidate()` 显示 approval Widget
3. 用户按 Enter → keybinding 处理 → `_submit_approval()` 从 queue 取结果
4. 工具回调等待 `response_queue.get()`

```python
# 新 approval_callback
def approval_callback(tool_name: str, args: dict, choices: list) -> str:
    """Show approval panel via App overlay, return user's choice."""
    from drsai.backend.cli.tui.app import _global_state  # injected
    
    rq = queue.Queue()
    _global_state.approval_state = {
        "tool_name": tool_name,
        "args_str": json.dumps(args, ensure_ascii=False),
        "choices": choices,
        "selected": 0,
        "response_queue": rq,
    }
    _global_state._invalidate()
    
    try:
        result = rq.get(timeout=120)
        return result
    except queue.Empty:
        return "deny"  # timeout → deny
    finally:
        _global_state.approval_state = None
        _global_state._invalidate()
```

### Step 5.2: 同理修改 clarify_callback

```python
def clarify_callback(question: str, choices: list, timeout: int = 60) -> str:
    rq = queue.Queue()
    _global_state.clarify_state = {
        "question": question,
        "choices": choices,
        "selected": 0,
        "response_queue": rq,
    }
    _global_state._invalidate()
    
    try:
        return rq.get(timeout=timeout)
    except queue.Empty:
        return ""  # timeout → empty (fallback)
    finally:
        _global_state.clarify_state = None
        _global_state._invalidate()
```

---

## Task 6: 删除废弃文件

**Files:**
- Delete: `backend/cli/prompt.py` — 完全废弃（PromptSession 迁移完成）

---

## Task 7: 回归测试 & 清理

### Step 7.1: 验证所有现有 /cmd 仍可用

手动测试：
- `/new` 新建会话
- `/sessions` 列出会话
- `/resume <id>` 恢复会话
- `/plan` 计划模式
- `/exit` 退出

### Step 7.2: 验证 spinner

1. 运行一个长时间工具调用（如 `web_search` 或文件搜索）
2. 确认 spinner 在 HSplit 顶部 Window 可见
3. 确认 spinner 正确更新工具名

### Step 7.3: 验证 streaming

1. 发送一个会产生长文本回复的问题
2. 确认 token 在 spinner 和输入区之间逐步显示（无层叠）

### Step 7.4: 验证多行输入

1. 输入 `Alt+Enter` 换行，输入多行内容
2. 按 Enter 提交
3. 确认多行内容正确作为一条消息处理

### Step 7.5: 验证 Ctrl+C 中断

1. 运行一个工具
2. 按 Ctrl+C
3. 确认工具被中断，REPL 恢复可输入状态

### Step 7.6: 验证 history

1. 按 ↑ 键
2. 确认出现历史命令
3. 搜索历史（Ctrl+R）
4. 确认补全菜单出现
