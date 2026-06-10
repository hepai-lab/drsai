"""
DrSai TUI Application Builder

参考 hermes-agent/cli.py 的 Application + HSplit 架构：
- 单一 Application，patch_stdout 包整个 app.run() 生命周期
- HSplit 布局：spinner(顶部) → message(中段) → input(底部)
- 所有 Window content 通过 DrSaiTUIState 动态读取/更新
- 输入通过 state._pending_input queue 路由到 REPL 处理线程
"""

from __future__ import annotations

import queue
import threading
import time
from collections import deque
from pathlib import Path
from typing import TYPE_CHECKING, Callable, Optional

from prompt_toolkit.application import Application
from prompt_toolkit.buffer import Buffer
from prompt_toolkit.completion import Completer
from prompt_toolkit.key_binding import KeyBindings
from prompt_toolkit.layout import Layout, HSplit
from prompt_toolkit.styles import Style

if TYPE_CHECKING:
    from prompt_toolkit.formatted_text import FormattedText
    from drsai.backend.cli.state import ApprovalState, ClarifyState, SecretState


# === Global TUI state (injected into callbacks) ================================

_tui_state: Optional["DrSaiTUIState"] = None


def get_tui_state() -> Optional["DrSaiTUIState"]:
    return _tui_state


def set_tui_state(state: Optional["DrSaiTUIState"]):
    global _tui_state
    global _tui_state
    _tui_state = state


# === DrSaiTUIState =============================================================


class DrSaiTUIState:
    """全局 TUI 状态，所有 HSplit Window content 通过此对象读取/更新。

    设计原则（来自 hermes-agent/cli.py 的 HermesCLI 类）：
    - 每个需要动态内容的 Window 用 lambda 函数包装，闭包引用 state
    - content 变更时调用 state._invalidate() 触发 App 刷新
    - spinner 和 command_running 在独立线程（spinner_loop）中驱动
    - 输入通过 state._pending_input queue 从 keybindings 流向 REPL 线程
    """

    # Spinner frame characters (braille dots, clockwise)
    _SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"]

    def __init__(self) -> None:
        # ── Message buffer (驱动 HSplit 中段 Window) ────────────────────────
        # Stores (style, text) tuples for FormattedTextControl
        self.messages: deque[tuple[str, str]] = deque(maxlen=500)

        # ── Spinner state (驱动 HSplit 顶部 Window) ─────────────────────────
        self.spinner_text: str = ""          # e.g. "Running web_search..."
        self.spinner_visible: bool = False
        self.command_running: bool = False   # True while agent is working
        self._spinner_frame: int = 0

        # ── Session stats (驱动底部 status bar) ─────────────────────────────
        self.turns: int = 0
        self.model_label: str = "?"
        self.plan_mode: bool = False
        self.tool_enabled: bool = True

        # ── Interactive prompt states (驱动 ConditionalContainer) ────────────
        # Import state types from cli/state.py (dataclass-based)
        # approval_state: ApprovalState with command, description, choices, response_queue
        # clarify_state: ClarifyState with question, choices, is_freetext, response_queue
        self.approval_state: Optional["ApprovalState"] = None
        self.clarify_state: Optional["ClarifyState"] = None
        self.sudo_state: Optional["SecretState"] = None
        self.secret_state: Optional["SecretState"] = None

        # ── Input routing (keybindings → REPL thread) ────────────────────────
        self._pending_input: queue.Queue[any] = queue.Queue()

        # ── App reference (set after Application creation) ──────────────────
        self._app: Application | None = None

        # ── Exit flag ───────────────────────────────────────────────────────
        self.should_exit: bool = False

        # ── Last invalidate timestamp (for rate limiting) ───────────────────
        self._last_invalidate: float = 0.0

    # ── Message buffer API ───────────────────────────────────────────────────

    def append_message(self, text: str, style: str = "") -> None:
        """Append a styled text fragment to the message history."""
        from loguru import logger
        self.messages.append((style, text))
        logger.debug(f"[State] append_message: messages now has {len(self.messages)} items")
        # Don't call _invalidate() here - let the caller batch invalidate
        # to avoid rate-limit issues when adding multiple messages quickly

    def append_line(self, text: str, style: str = "") -> None:
        """Append a line (ensures newline)."""
        self.append_message(text + "\n", style)

    def clear_messages(self) -> None:
        """Clear all messages."""
        self.messages.clear()
        self._invalidate()

    # ── Spinner API ──────────────────────────────────────────────────────────

    def start_spinner(self, label: str = "") -> None:
        """Start the spinner with an optional label."""
        self.spinner_text = label
        self.spinner_visible = True
        self.command_running = True
        self._spinner_frame = 0
        self._invalidate()

    def update_spinner(self, label: str) -> None:
        """Update the spinner label text."""
        self.spinner_text = label
        self._invalidate()

    def stop_spinner(self) -> None:
        """Stop and hide the spinner."""
        self.spinner_visible = False
        self.spinner_text = ""
        self.command_running = False
        self._invalidate()

    def next_spinner_frame(self) -> str:
        """Get the next spinner frame character and advance the counter."""
        frame = self._SPINNER_FRAMES[self._spinner_frame % len(self._SPINNER_FRAMES)]
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
        """Return the height of the spinner Window (1 when visible, 0 when hidden)."""
        return 1 if self.spinner_visible else 0

    # ── Status bar API ───────────────────────────────────────────────────────

    def get_status_fragments(self) -> list[tuple[str, str]]:
        """Return FormattedText fragments for the status bar Window."""
        frags: list[tuple[str, str]] = []

        frags.append(("class:status-bar", " 新建 "))
        frags.append(("class:status-bar", " 会话 "))
        frags.append(("class:status-bar", " ↑↓ 历史 "))

        if self.tool_enabled:
            frags.append(("class:status-bar-good", " 工具 ON "))
        else:
            frags.append(("class:status-bar-dim", " 工具 OFF "))

        frags.append(("class:status-bar-dim", " · "))
        frags.append(("class:status-bar", f" {self.model_label} "))
        frags.append(("class:status-bar-dim", " · "))
        frags.append(("class:status-bar", f" {self.turns} 轮 "))

        if self.plan_mode:
            frags.append(("class:status-bar-warn", " · plan"))

        return frags

    # ── Internal ─────────────────────────────────────────────────────────────

    def _invalidate(self, min_interval: float = 0.016) -> None:
        """Trigger App repaint if enough time has passed since last repaint.

        Rate-limited: ignores calls within min_interval seconds of last call.
        This prevents flooding the render queue with updates faster than ~60 FPS.
        """
        from loguru import logger
        app = self._app
        if app is None:
            logger.debug("[State] _invalidate: app is None, skipping")
            return
        now = time.monotonic()
        if now - self._last_invalidate < min_interval:
            # Still rate-limited, but schedule a deferred invalidate
            logger.debug(f"[State] _invalidate: rate-limited (interval {now - self._last_invalidate:.3f}s < {min_interval}s)")
            return
        self._last_invalidate = now
        if app._is_running:
            logger.debug("[State] _invalidate: calling app.invalidate()")
            app.invalidate()
        else:
            logger.debug("[State] _invalidate: app not running, skipping")


# === Application Builder =======================================================


def build_drsai_app(
    state: DrSaiTUIState,
    session_label_fn: Callable[[], str],
    history_file: Path,
    completer: Completer | None,
    extra_widgets_provider: Callable[
        [list], list
    ] | None = None,
) -> Application:
    """Build the prompt_toolkit Application with HSplit layout.

    Architecture (from hermes-agent/cli.py run()):
    1. Build KeyBindings (alt-enter, enter, ctrl-c, ctrl-d, etc.)
    2. Build HSplit children via build_hsplit_children()
    3. Wrap in Layout + Application
    4. Set state._app = app (enables _invalidate())
    5. Return app; caller runs app.run() inside patch_stdout

    Args:
        state: DrSaiTUIState instance (shared by all widgets via closure)
        session_label_fn: () -> str, returns the prompt label text
        history_file: Path to the history file for FileHistory
        completer: prompt_toolkit Completer for slash commands (or None)
        extra_widgets_provider: optional (children -> children) for subclass extensions

    Returns:
        Application ready to run with app.run()
    """
    from .keybindings import build_keybindings
    from .widgets import build_hsplit_children

    kb = build_keybindings(state)

    # Build HSplit children (spinner, approval, messages, status, input, etc.)
    children = build_hsplit_children(
        state=state,
        session_label_fn=session_label_fn,
        history_file=history_file,
        completer=completer,
        extra_widgets_provider=extra_widgets_provider,
    )

    layout = Layout(HSplit(children))

    style = Style.from_dict({
        # Input area: empty style strings inherit terminal default (works on
        # both light and dark terminal color schemes)
        "input-area": "",
        "placeholder": "#888888 italic",
        "prompt": "#FFD700 bold",
        "spinner": "#FFD700 italic",
        "status-bar": "bg:#1a1a2e #C0C0C0",
        "status-bar-good": "bg:#1a1a2e #8FBC8F bold",
        "status-bar-warn": "bg:#1a1a2e #FFD700 bold",
        "status-bar-dim": "bg:#1a1a2e #8B8682",
        "input-rule": "#CD7F32",
        # Tool call / approval panel
        "approval-border": "#CD7F32",
        "approval-title": "#FFD700 bold",
        "approval-text": "#FFF8DC",
        "approval-selected": "#FFD700 bold",
        # User message echo
        "user-echo": "#6EC6FF",
        # Assistant message panel
        "assistant-panel-border": "#FFD700",
        "assistant-text": "#FFF8DC",
        # Tool calls
        "tool-prefix": "yellow",
        "tool-result": "#8FBC8F",
    })

    app = Application(
        layout=layout,
        key_bindings=kb,
        style=style,
        full_screen=False,
        mouse_support=False,
        enable_page_navigation_bindings=False,  # Disable default page nav bindings
    )

    # Inject app reference into state (enables _invalidate())
    state._app = app

    # Inject state into module global (for callbacks.py to access)
    set_tui_state(state)

    return app
