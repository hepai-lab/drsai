"""
TUI Widget builders for HSplit layout.

参考 hermes-agent/cli.py 中 _build_tui_layout_children() 的模式：
- 每个 Window 的 content 是一个 lambda/闭包函数，捕获 DrSaiTUIState
- HSplit children 顺序决定视觉从顶到底的布局
- ConditionalContainer 隐藏未激活的 overlay 面板（approval, clarify, sudo, secret）
"""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Callable, TYPE_CHECKING

from prompt_toolkit.completion import Completer
from prompt_toolkit.filters import Condition
from prompt_toolkit.formatted_text import FormattedText
from prompt_toolkit.key_binding import KeyBindings, merge_key_bindings
from prompt_toolkit.layout import HSplit, Window
from prompt_toolkit.layout.containers import ConditionalContainer
from prompt_toolkit.layout.controls import FormattedTextControl
from prompt_toolkit.layout.dimension import Dimension
from prompt_toolkit.widgets import TextArea
from prompt_toolkit.auto_suggest import AutoSuggestFromHistory
from prompt_toolkit.history import FileHistory

if TYPE_CHECKING:
    from prompt_toolkit.buffer import Buffer
    from .app import DrSaiTUIState


# ── Helper: prompt fragments ─────────────────────────────────────────────────


def _prompt_fragments(label: str) -> FormattedText:
    """Build prompt tokens: label + › symbol."""
    return [
        ("class:prompt", f" {label} "),
        ("", "› "),
    ]


def _prompt_text(label: str) -> str:
    """Plain text version of prompt (for width calculations)."""
    return f" {label} › "


# ── Approval widget ─────────────────────────────────────────────────────────


def _build_approval_widget(
    state: DrSaiTUIState,
) -> ConditionalContainer:
    """Build the ConditionalContainer for tool approval overlay."""
    def get_approval_display() -> FormattedText:
        if not state.approval_state:
            return []
        s = state.approval_state
        # Access attributes from the dataclass
        tool_name = getattr(s, 'command', '?')[:50]  # command is the tool name
        args_str = getattr(s, 'description', '')
        preview = args_str[:120] + ("..." if len(args_str) > 120 else "")
        choices = getattr(s, 'choices', [])

        lines: list[tuple[str, str]] = []
        lines.append(("class:approval-border", "╭─ ⚠️  Tool Approval Required ────────────────────╮\n"))
        lines.append(("class:approval-title", f"  🔧 {tool_name}\n"))
        lines.append(("class:approval-text", f"  Args: {preview}\n"))
        lines.append(("class:approval-border", "╰─────────────────────────────────────────────────╯\n"))

        if choices:
            lines.append(("class:approval-text", "  Options: "))
            for i, c in enumerate(choices):
                style = "class:approval-text"
                choice_text = c if isinstance(c, str) else str(c)
                lines.append((style, f"[{i + 1}] {choice_text}  "))
            lines.append(("", "\n"))
        return lines

    return ConditionalContainer(
        Window(
            FormattedTextControl(get_approval_display),
            wrap_lines=True,
        ),
        filter=Condition(lambda: state.approval_state is not None),
    )


# ── Spinner widget ───────────────────────────────────────────────────────────


def _build_spinner_widget(
    state: DrSaiTUIState,
) -> Window:
    """Build the spinner Window (top of HSplit, dynamic height 0 or 1)."""
    def get_spinner_text() -> FormattedText:
        return state.get_spinner_display()

    def get_spinner_height() -> int:
        return state.get_spinner_height()

    return Window(
        content=FormattedTextControl(get_spinner_text),
        height=get_spinner_height,
        wrap_lines=False,
    )


# ── Message / spacer widget ──────────────────────────────────────────────────


def _build_message_widget(
    state: DrSaiTUIState,
) -> Window:
    """Build the message history Window (middle of HSplit, takes all remaining space)."""
    def get_message_text() -> FormattedText:
        from loguru import logger
        msgs = list(state.messages)
        logger.debug(f"[Widget] get_message_text called, returning {len(msgs)} messages")
        return msgs

    return Window(
        content=FormattedTextControl(get_message_text),
        height=Dimension(weight=1),
        wrap_lines=True,
        always_hide_cursor=False,
    )


# ── Status bar widget ────────────────────────────────────────────────────────


def _build_status_bar(
    state: DrSaiTUIState,
) -> Window:
    """Build the status bar Window (above input area)."""
    def get_status_text() -> FormattedText:
        return state.get_status_fragments()

    return Window(
        content=FormattedTextControl(get_status_text),
        height=1,
        wrap_lines=False,
    )


# ── Input area widget ────────────────────────────────────────────────────────


def _build_input_area(
    state: DrSaiTUIState,
    session_label_fn: Callable[[], str],
    history_file: Path,
    completer: Completer | None,
) -> TextArea:
    """Build the multiline TextArea input widget.

    Key behaviors (from hermes-agent/cli.py):
    - Multiline enabled (Alt+Enter / Esc+Enter for newlines)
    - Dynamic height: accounts for explicit newlines + visual wrapping
    - read_only while command_running
    - FileHistory for ↑↓ navigation
    - Completer for slash-command completion
    """
    def get_prompt() -> FormattedText:
        return _prompt_fragments(session_label_fn())

    def _input_height() -> int:
        """Compute visual height from newlines and wrapping."""
        try:
            from prompt_toolkit.application import get_app
            from prompt_toolkit.utils import get_cwidth

            doc = input_area.buffer.document
            prompt_width = max(2, get_cwidth(_prompt_text(session_label_fn())))
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
                    # Ceil division: how many rows does this line need?
                    visual_lines += max(1, -(-line_width // available_width))

            return min(max(visual_lines, 1), 8)
        except Exception:
            return 1

    input_area = TextArea(
        height=Dimension(min=1, max=8, preferred=1),
        prompt=get_prompt,
        style="class:input-area",
        multiline=True,  # Allow multiline via Esc+Enter; Enter submits via keybinding
        wrap_lines=True,
        read_only=Condition(lambda: state.command_running),
        history=FileHistory(str(history_file)),
        completer=completer,
        complete_while_typing=True,
        auto_suggest=AutoSuggestFromHistory(),
        # Note: No accept_handler - Enter is handled by buffer keybinding below
    )

    # ── Add buffer-specific keybinding for Enter (highest priority) ─────────
    # This ensures Enter submits the input instead of inserting newline.
    # Buffer keybindings have higher priority than Application keybindings.
    buffer_kb = KeyBindings()

    @buffer_kb.add('c-m', eager=True, filter=~Condition(lambda: state.command_running))
    def _(event):
        """Submit input on Enter."""
        from loguru import logger
        text = event.current_buffer.text.strip()
        logger.debug(f"[TUI] Enter pressed, text='{text}'")
        if text:
            state._pending_input.put(text)
            logger.debug(f"[TUI] Added to queue, size={state._pending_input.qsize()}")
        event.current_buffer.reset(append_to_history=True)
        event.app.invalidate()

    # Merge with existing buffer keybindings (our binding takes priority)
    if input_area.control.key_bindings:
        input_area.control.key_bindings = merge_key_bindings([
            buffer_kb,
            input_area.control.key_bindings,
        ])
    else:
        input_area.control.key_bindings = buffer_kb

    # Override window height with dynamic computed height
    input_area.window.height = _input_height

    return input_area


# ── Input rule separators ────────────────────────────────────────────────────


def _build_input_rule(style_cls: str = "input-rule") -> Window:
    """Build a thin horizontal rule Window."""
    return Window(
        height=1,
        char="─",
        style=f"class:{style_cls}",
    )


# ── HSplit children assembler ────────────────────────────────────────────────


def build_hsplit_children(
    state: DrSaiTUIState,
    session_label_fn: Callable[[], str],
    history_file: Path,
    completer: Completer | None,
    extra_widgets_provider: Callable[[list], list] | None = None,
) -> list:
    """Assemble the ordered list of HSplit children.

    Layout order (from top to bottom):
      1. Window(height=1)          top spacer
      2. approval_widget           ConditionalContainer (hidden by default)
      3. spinner_widget            DynamicWindow (height 0 or 1)
      4. message_spacer            DynamicWindow (weight=1, takes remaining space)
      5. status_bar                Window(height=1)
      6. input_rule_top            Window(height=1)
      7. input_area                TextArea (multiline)
      8. input_rule_bot            Window(height=1)

    This matches hermes-agent/cli.py _build_tui_layout_children() exactly.
    """
    input_area = _build_input_area(
        state=state,
        session_label_fn=session_label_fn,
        history_file=history_file,
        completer=completer,
    )

    approval_widget = _build_approval_widget(state)
    spinner_widget = _build_spinner_widget(state)
    message_spacer = _build_message_widget(state)
    status_bar = _build_status_bar(state)
    input_rule_top = _build_input_rule()
    input_rule_bot = _build_input_rule()

    children: list = [
        Window(height=1),           # top spacer (prevents content from touching top edge)
        approval_widget,            # tool approval overlay
        spinner_widget,             # spinner (hidden when idle)
        message_spacer,             # message history (scrollable)
        status_bar,                 # bottom status bar
        input_rule_top,             # copper rule above input
        input_area,                 # multiline text input
        input_rule_bot,             # copper rule below input
    ]

    # Allow wrapper CLIs to inject extra widgets above or around the layout
    if extra_widgets_provider:
        children = extra_widgets_provider(children) + children

    # Filter out None entries
    return [c for c in children if c is not None]
