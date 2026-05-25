"""Hermes-inspired streaming renderer for ``drsai-cli``.

Consumes an async iterator of autogen events (ModelClientStreamingChunkEvent,
ToolCallRequestEvent, TextMessage, TaskResult, Response, …) and renders them
with:

- A dim reasoning box for ``<think>...</think>`` content that auto-closes
  when visible content begins. Controlled by :attr:`show_reasoning`.
- Token-level streaming of visible answers.
- Improved tool feedback using Hermes-style display module:
  - Tool previews via `build_tool_preview`
  - Cute completion messages via `get_cute_tool_message`
  - Inline diff support for file edits
- A Gold-bordered Rich panel for completed text messages.
- Optional per-turn footer + terminal bell on completion.

The renderer is intentionally **I/O-only** — it updates a :class:`SessionStats`
but does not decide what to persist. The REPL owns persistence.

TUI Integration:
    Import from tui_tmp to get Hermes-style tool messages:
        from drsai.backend.cli.tui_tmp.display import (
            build_tool_preview, get_cute_tool_message, KawaiiSpinner,
            LocalEditSnapshot, capture_local_edit_snapshot, render_edit_diff_with_delta,
        )
"""

from __future__ import annotations

import sys, json
import time
from typing import Any, AsyncGenerator, Optional

from rich.box import ROUNDED
from rich.console import Console
from rich.markdown import Markdown
from rich.panel import Panel

from autogen_agentchat.base import Response, TaskResult
from autogen_agentchat.messages import (
    BaseAgentEvent,
    FunctionCall,
    ModelClientStreamingChunkEvent,
    TextMessage,
    ToolCallExecutionEvent,
    ToolCallRequestEvent,
    ToolCallSummaryMessage,
)
from drsai.modules.managers.messages.agent_messages import AgentLogEvent

from .reasoning import ReasoningStreamState, split_reasoning
from .stats import SessionStats, extract_usage, format_footer, play_bell
from .theme import ansi, ansi_reset, get_theme

__all__ = ["DrSaiCLIRenderer"]

# Try to import Hermes-style display module (optional, graceful fallback)
try:
    from .display import (
        build_tool_preview,
        get_cute_tool_message,
        KawaiiSpinner,
        LocalEditSnapshot,
        capture_local_edit_snapshot,
        render_edit_diff_with_delta,
        set_tool_preview_max_len,
        get_tool_preview_max_len,
    )
    TUI_MODULE_AVAILABLE = True
except ImportError:
    TUI_MODULE_AVAILABLE = False
    # Stub implementations for fallback
    def build_tool_preview(tool_name, args, max_len=None):  # type: ignore
        return None
    def get_cute_tool_message(tool_name, args, duration, result=None):  # type: ignore
        return f"⚡ {tool_name}"
    class KawaiiSpinner:  # type: ignore
        def __init__(self, *args, **kwargs): pass
        def start(self): pass
        def stop(self, final_message=None): pass
        def update_text(self, new_message): pass
    class LocalEditSnapshot:  # type: ignore
        def __init__(self, paths=None, before=None):
            self.paths = paths or []
            self.before = before or {}
    def capture_local_edit_snapshot(tool_name, args):  # type: ignore
        return None
    def render_edit_diff_with_delta(*args, **kwargs):  # type: ignore
        return False
    def set_tool_preview_max_len(n): pass  # type: ignore
    def get_tool_preview_max_len():  # type: ignore
        return 0


class DrSaiCLIRenderer:
    """Stateful renderer — one instance per REPL."""

    def __init__(
        self,
        *,
        console: Optional[Console] = None,
        show_reasoning: bool = False,
        tool_preview_max_len: int = 0,
    ) -> None:
        self.console = console or Console()
        self.show_reasoning = show_reasoning
        self._stream_open = False          # mid-line (visible text) flag
        self._reason_open = False          # reasoning box currently printed
        self._reason_first_line = True
        self._last_turn_model = ""
        self._last_usage: tuple[int, int] = (0, 0)
        # True once we emit a visible streaming chunk this turn — the
        # assistant's final TextMessage then duplicates the same content,
        # so we skip it. Follows dr_sai.py behaviour when stream=True.
        self._streamed_visible_this_turn = False
        self._streaming_sources: set[str] = set()
        # True right after a tool event — consume leading whitespace of the
        # next streaming chunk so we don't stack blank lines between tools.
        self._just_after_tool_event = False
        # Tool execution tracking for Hermes-style feedback
        self._current_tool_snapshot: LocalEditSnapshot | None = None
        self._tool_start_time: float | None = None
        # Store pending tool call info for result rendering
        self._pending_tool_call: tuple[str, dict] | None = None  # (tool_name, args)
        # ── Blank-line suppression ──────────────────────────────────────────
        # Track whether the last byte written to stdout was a newline, so we
        # never emit consecutive blank lines (hermes-style tight spacing).
        self._last_ended_with_newline: bool = False
        # ── Subagent context tracking ───────────────────────────────────────
        # When True, streaming chunks / text messages are rendered with a
        # distinct visual style (dim pipe prefix, cyan border) so the user
        # can easily tell which output came from a subagent.
        self._subagent_active: bool = False
        self._subagent_name: str = ""
        self._subagent_header_printed: bool = False
        # Live spinner for tool execution (from display.py KawaiiSpinner)
        self._spinner: Optional[KawaiiSpinner] = None
        if TUI_MODULE_AVAILABLE:
            set_tool_preview_max_len(tool_preview_max_len)

    def reconfigure_output(self, file=None) -> None:
        """Reconfigure the Rich Console to write through a stdout proxy.

        Called when ``patch_stdout`` is activated at the REPL level so that
        all Rich output (panels, markdown, tool messages) is routed through
        the same proxy as raw ``sys.stdout.write`` calls.  This ensures
        proper positioning of output above the prompt_toolkit input line.

        Args:
            file: File-like object to write through. Defaults to ``sys.stdout``
                  (which is the ``patch_stdout`` proxy when activated).
        """
        target = file or sys.stdout
        # Preserve the original Console's detected width — the proxy lacks
        # a real fileno(), so Rich's primary width-detection path
        # (os.get_terminal_size(proxy.fileno())) will fail.  Passing the
        # pre-detected width as an explicit override ensures correct layout
        # even if the fallback via shutil.get_terminal_size() misses.
        original_width = self.console.width
        # force_terminal=True ensures Rich emits ANSI escape codes through
        # the proxy (which otherwise looks like a non-TTY to Rich's detector).
        # legacy_windows follows the original Console's setting to avoid
        # breaking VT100 output on Windows terminals that need legacy handling.
        self.console = Console(
            file=target,
            force_terminal=True,
            legacy_windows=self.console.legacy_windows,
            width=original_width,
        )

    # ── User input echo ─────────────────────────────────────────────────────
    def echo_user_input(self, text: str) -> None:
        """Re-display the user's submitted input in a distinct colour.

        Called from the REPL's ``_do_chat`` right before the agent begins
        processing, so that the conversation history in the terminal clearly
        distinguishes "what I typed" from "what the agent replied".

        The colour is drawn from the active theme's ``user_echo`` slot, which
        defaults to a soft cyan-blue (#6EC6FF) on dark terminals — easy to
        spot against the default white agent text but not eye-searing.
        """
        theme = get_theme()
        fg = ansi("user_echo", theme)
        reset = ansi_reset()
        # Truncate very long inputs for display (full text is still sent to
        # the agent; this is purely a visual echo).
        display_text = text
        if len(display_text) > 300:
            display_text = display_text[:297] + "…"
        # Replace newlines with ↵ + continuation so the echo occupies one
        # logical block but multi-line content stays readable.
        display_text = display_text.replace("\n", f"{reset} ↵\n  {fg}")
        self._println(f"{fg}  ▸ {display_text}{reset}")

    # ── Turn separator ──────────────────────────────────────────────────────
    def print_turn_separator(self) -> None:
        """Draw a dim horizontal line between conversation turns.

        Called at the end of each assistant turn (inside ``render()``) so
        that the user's next prompt is visually isolated from the previous
        agent output.  Uses the theme's ``separator`` colour.
        """
        theme = get_theme()
        fg = ansi("separator", theme)
        reset = ansi_reset()
        self._println(f"{fg}──────────────────────────────────────────────{reset}")

    # ── Output helpers with blank-line suppression ──────────────────────────
    def _println(self, text: str = "") -> None:
        """Print *text* (default empty) with blank-line suppression.

        Routes Rich markup (``[color]...[/color]``) through Rich console;
        plain text and ANSI escapes go directly to stdout.
        """
        if not text:
            if self._last_ended_with_newline:
                return
            sys.stdout.write("\n")
            sys.stdout.flush()
            self._last_ended_with_newline = True
            return

        # Only use Rich console when text contains genuine Rich markup tags,
        # not ANSI escapes (which also use [ ] brackets).
        if _has_rich_markup(text):
            self.console.print(text)
            self._last_ended_with_newline = True
        else:
            sys.stdout.write(text + "\n")
            sys.stdout.flush()
            self._last_ended_with_newline = True

    def _soft_newline(self) -> None:
        """Emit a newline only if the last output didn't end with one."""
        if not self._last_ended_with_newline:
            sys.stdout.write("\n")
            sys.stdout.flush()
            self._last_ended_with_newline = True

    # ── Main entry ──────────────────────────────────────────────────────────
    async def render(
        self,
        stream: AsyncGenerator[Any, None],
        stats: SessionStats,
    ) -> None:
        state = ReasoningStreamState()
        self._stream_open = False
        self._reason_open = False
        self._reason_first_line = True
        self._last_turn_model = ""
        self._last_usage = (0, 0)
        self._streamed_visible_this_turn = False
        self._streaming_sources = set()
        self._just_after_tool_event = False
        self._current_tool_snapshot = None
        self._tool_start_time = None
        self._last_ended_with_newline = False
        self._subagent_active = False
        self._subagent_name = ""
        self._subagent_header_printed = False

        # Start the spinner — renders at terminal bottom via ANSI save/restore
        # cursor while patch_stdout proxies renderer output above it.
        self._spinner = KawaiiSpinner(message="running…", spinner_type="dots")
        self._spinner.start()

        async for message in stream:
            if isinstance(message, ModelClientStreamingChunkEvent):
                src = getattr(message, "source", "") or ""
                if src:
                    self._streaming_sources.add(src)
                    # Detect subagent streaming chunks by source prefix
                    if src.startswith("sub:"):
                        self._ensure_subagent_header(src)
                self._handle_chunk(message.content or "", state)
            elif isinstance(message, ToolCallRequestEvent):
                self._close_stream()
                self._close_reasoning()
                self._render_tool_request(message)
                self._just_after_tool_event = True
            elif isinstance(message, ToolCallExecutionEvent):
                self._close_stream()
                self._close_reasoning()
                self._close_subagent()
                self._render_tool_result(message)
                self._just_after_tool_event = True
            elif isinstance(message, ToolCallSummaryMessage):
                # DrSaiAgent sends ToolCallSummaryMessage instead of ToolCallExecutionEvent
                self._close_stream()
                self._close_reasoning()
                self._close_subagent()
                self._render_tool_summary(message)
                self._just_after_tool_event = True
            elif isinstance(message, TextMessage):
                # Capture usage metadata before any early return.
                self._capture_usage(message)
                # Detect subagent text messages by source prefix
                src = getattr(message, "source", "") or ""
                if src.startswith("sub:"):
                    self._ensure_subagent_header(src)
                if self._should_skip_text(message):
                    continue
                self._close_stream()
                for chunk in state.flush():
                    self._write_chunk(chunk.kind, chunk.text)
                self._close_reasoning()
                self._render_text_message(message)
            elif isinstance(message, Response):
                self._capture_usage(message)
                chat = getattr(message, "chat_message", None)
                if isinstance(chat, TextMessage) and chat.source.lower() != "user":
                    self._capture_usage(chat)
                    # Detect subagent responses by source prefix
                    chat_src = getattr(chat, "source", "") or ""
                    if chat_src.startswith("sub:"):
                        self._ensure_subagent_header(chat_src)
                    if self._should_skip_text(chat):
                        continue
                    self._close_stream()
                    self._close_reasoning()
                    self._render_text_message(chat)
            elif isinstance(message, TaskResult):
                self._close_stream()
                self._close_reasoning()
                # Sweep final messages for usage (the chunk events often lack it).
                for m in getattr(message, "messages", []) or []:
                    self._capture_usage(m)
            elif isinstance(message, AgentLogEvent):
                self._close_stream()
                self._close_reasoning()
                # Detect subagent log events by source prefix
                src = getattr(message, "source", "") or ""
                if src.startswith("sub:"):
                    self._ensure_subagent_header(src)
                self._render_agent_log(message)
            elif isinstance(message, BaseAgentEvent):
                # Unknown event kind — leave stream intact, don't print junk.
                pass

        # End-of-turn housekeeping
        for chunk in state.flush():
            self._write_chunk(chunk.kind, chunk.text)
        self._close_stream()
        self._close_reasoning()

        prompt_t, completion_t = self._last_usage
        stats.end_turn(
            prompt_tokens=prompt_t,
            completion_tokens=completion_t,
            model=self._last_turn_model,
        )
        footer = format_footer(stats)
        if footer:
            self._println(footer)
        play_bell(stats.ring_bell)

        # ── Turn separator ──────────────────────────────────────────────
        # Draw a dim horizontal line so the user's next prompt is visually
        # isolated from the agent's output.
        self.print_turn_separator()

        # Stop the spinner
        if self._spinner is not None:
            self._spinner.stop()
            self._spinner = None

    # ── Streaming chunks ────────────────────────────────────────────────────
    def _handle_chunk(self, text: str, state: ReasoningStreamState) -> None:
        if not text:
            return
        # Collapse leading whitespace that models like to emit between tool
        # rounds (e.g. "\n\n" before the next tool call). We already printed a
        # newline via _close_stream when the tool event landed.
        if self._just_after_tool_event:
            text = text.lstrip()
            if not text:
                return
            self._just_after_tool_event = False
        for chunk in state.feed(text):
            self._write_chunk(chunk.kind, chunk.text)

    def _should_skip_text(self, message: TextMessage) -> bool:
        """Return True for TextMessages that should not be rendered.

        - Internal echoes (``metadata.internal == "yes"``).
        - User messages (the REPL already showed the prompt).
        - Re-emissions of content we already streamed this turn.
        """
        source = (message.source or "")
        if source.lower() == "user":
            return True
        if (getattr(message, "metadata", None) or {}).get("internal") == "yes":
            return True
        if self._streamed_visible_this_turn and (
            not self._streaming_sources or source in self._streaming_sources
        ):
            return True
        return False

    def _write_chunk(self, kind: str, text: str) -> None:
        if not text:
            return
        if kind == "reasoning":
            if not self.show_reasoning:
                return
            if self._stream_open:
                self._soft_newline()
                self._stream_open = False
            if not self._reason_open:
                self._open_reasoning()
            self._render_reasoning_text(text)
        else:  # visible
            if self._reason_open:
                self._close_reasoning()
            if self._subagent_active:
                self._maybe_print_subagent_header()
                # Prefix each NEW line with dim pipe to visually separate subagent
                # output. Continuation chunks (mid-line) get no prefix — only the
                # start of a logical line receives the │ marker.
                lines = text.split('\n')
                for i, line in enumerate(lines):
                    if i > 0:
                        sys.stdout.write('\n')
                    at_line_start = (i > 0) or (not self._stream_open)
                    if at_line_start:
                        if line:
                            sys.stdout.write(f"{ansi('dim')}│ {ansi_reset()}{line}")
                        else:
                            sys.stdout.write(f"{ansi('dim')}│{ansi_reset()}")
                    else:
                        sys.stdout.write(line)
                sys.stdout.flush()
            else:
                # ReasoningStreamState already quarantines partial reasoning tags;
                # streaming chunks here are raw answer text. Do NOT call
                # strip_reasoning — its ``.strip()`` eats legitimate whitespace.
                sys.stdout.write(text)
                sys.stdout.flush()
            self._stream_open = not text.endswith("\n")
            self._streamed_visible_this_turn = True
            self._last_ended_with_newline = text.endswith("\n")

    # ── Reasoning box ───────────────────────────────────────────────────────
    def _open_reasoning(self) -> None:
        self._println(f"{ansi('system_info')}┌─ Reasoning ─{ansi_reset()}")
        self._reason_open = True
        self._reason_first_line = True

    def _render_reasoning_text(self, text: str) -> None:
        for ch in text:
            if self._reason_first_line:
                sys.stdout.write(f"{ansi('system_info')}│ {ansi_reset()}")
                self._reason_first_line = False
                self._last_ended_with_newline = False
            sys.stdout.write(f"{ansi('system_info')}{ch}{ansi_reset()}")
            if ch == "\n":
                self._reason_first_line = True
                self._last_ended_with_newline = True
            else:
                self._last_ended_with_newline = False
        sys.stdout.flush()

    def _close_reasoning(self) -> None:
        if not self._reason_open:
            return
        if not self._reason_first_line:
            sys.stdout.write("\n")
            sys.stdout.flush()
            self._last_ended_with_newline = True
        self._println(f"{ansi('system_info')}└─{ansi_reset()}")
        self._reason_open = False
        self._reason_first_line = True

    def _close_stream(self) -> None:
        if self._stream_open:
            sys.stdout.write("\n")
            sys.stdout.flush()
            self._stream_open = False
            self._last_ended_with_newline = True

    # ── Tool events ─────────────────────────────────────────────────────────
    def _render_tool_request(self, message: ToolCallRequestEvent) -> None:
        """Render tool call request with Hermes-style compact preview."""
        calls = message.content or []
        for call in calls:
            if isinstance(call, FunctionCall):
                tool_name = call.name
                raw_args = getattr(call, "arguments", {}) or {}
                # Parse JSON string arguments
                if isinstance(raw_args, str):
                    import json as _json
                    try:
                        args = _json.loads(raw_args)
                    except (json.JSONDecodeError, ValueError):
                        args = {}
                else:
                    args = raw_args if isinstance(raw_args, dict) else {}

                # Save for result rendering
                self._pending_tool_call = (tool_name, args)

                # Capture snapshot for diff preview (Hermes-style)
                if TUI_MODULE_AVAILABLE:
                    self._current_tool_snapshot = capture_local_edit_snapshot(tool_name, args)
                    self._tool_start_time = time.time()

                if TUI_MODULE_AVAILABLE:
                    # Use Hermes-style compact preview — one line, no extra spacing
                    preview = build_tool_preview(tool_name, args)
                    if preview:
                        self._println(f"[yellow]🔧[/yellow] [cyan]{tool_name}[/cyan] {preview}")
                    else:
                        self._println(f"[yellow]🔧[/yellow] [cyan]{tool_name}[/cyan]")
                else:
                    self._println(f"[yellow]🔧[/yellow] [cyan]{call.name}[/cyan]")

    def _render_tool_result(self, message: ToolCallExecutionEvent) -> None:
        """Render tool result with Hermes-style compact completion line."""
        results = message.content or []
        result_str: str | None = None
        duration: float = 0.0

        # Get stored tool info
        tool_name, args = self._pending_tool_call if self._pending_tool_call else ("tool", {})
        self._pending_tool_call = None

        # Track the tool execution for Hermes-style feedback
        if self._tool_start_time:
            duration = time.time() - self._tool_start_time
            self._tool_start_time = None

        for r in results:
            content = getattr(r, "content", None)
            if content:
                result_str = str(content)
                tool_name = getattr(r, "name", tool_name)

        # Generate Hermes-style compact completion message (single line)
        if TUI_MODULE_AVAILABLE:
            cute_msg = get_cute_tool_message(tool_name, args, duration, result_str)
            self._println(cute_msg)

            # Try to render diff for file edits (compact, below the tool line)
            if self._current_tool_snapshot:
                render_edit_diff_with_delta(
                    tool_name, result_str,
                    function_args=args,
                    snapshot=self._current_tool_snapshot,
                    print_fn=self._println,
                )
                self._current_tool_snapshot = None
        else:
            # Fallback: one-line truncated preview
            if result_str:
                text = result_str.strip().replace("\n", " ")
                if len(text) > 200:
                    text = text[:200] + "…"
                self._println(f"[dim]╎ {text}[/dim]")

    def _render_tool_summary(self, message: ToolCallSummaryMessage) -> None:
        """Render ToolCallSummaryMessage with Hermes-style compact completion.

        DrSaiAgent sends ToolCallSummaryMessage instead of ToolCallExecutionEvent.
        """
        content = getattr(message, "content", "") or ""
        duration: float = 0.0

        # Get stored tool info
        tool_name, args = self._pending_tool_call if self._pending_tool_call else ("tool", {})
        self._pending_tool_call = None

        if self._tool_start_time:
            duration = time.time() - self._tool_start_time
            self._tool_start_time = None

        is_error = False
        content_lower = content.lower()
        error_patterns = ["error", "failed", "permission denied", "no such file", "cannot"]
        if any(p in content_lower for p in error_patterns):
            is_error = True

        if TUI_MODULE_AVAILABLE:
            result_str = str(content) if is_error else None
            cute_msg = get_cute_tool_message(tool_name, args, duration, result_str)
            self._println(cute_msg)

            if self._current_tool_snapshot:
                render_edit_diff_with_delta(
                    tool_name, str(content),
                    function_args=args,
                    snapshot=self._current_tool_snapshot,
                    print_fn=self._println,
                )
                self._current_tool_snapshot = None
        else:
            text = content.strip().replace("\n", " ")
            if len(text) > 200:
                text = text[:200] + "…"
            self._println(f"[dim]╎ {text}[/dim]")

    # ── Subagent progress event ────────────────────────────────────────────
    def _render_agent_log(self, message: AgentLogEvent) -> None:
        """Render subagent progress event as a single dim line.

        Subagent messages are tagged with source="sub:{name}" in the
        SubagentRunner, making each line visually traceable to its origin.
        """
        title = message.title or ""
        if not title:
            return
        source = message.source or ""
        is_sub = source.startswith("sub:")
        if source:
            if is_sub:
                self._println(f"  [cyan]{source}[/cyan] {title}")
            else:
                self._println(f"  [dim]{source}[/dim] {title}")
        else:
            self._println(f"  [dim]{title}[/dim]")

    # ── Subagent visual framing ────────────────────────────────────────────
    def _ensure_subagent_header(self, source: str) -> None:
        """Print subagent header and activate subagent mode if not already.

        Called when the renderer encounters a message whose ``source``
        starts with ``"sub:"`` (e.g. ``"sub:explore"``).
        """
        if self._subagent_active:
            return
        self._subagent_active = True
        self._subagent_name = source
        self._subagent_header_printed = False
        # Print header line
        self._println(f"  {ansi('system_info')}┌─ {source} ─{ansi_reset()}")

    def _maybe_print_subagent_header(self) -> None:
        """Print the subagent prefix marker once per subagent section."""
        if not self._subagent_active or self._subagent_header_printed:
            return
        self._subagent_header_printed = True

    def _close_subagent(self) -> None:
        """Close the subagent visual section if active."""
        if not self._subagent_active:
            return
        self._subagent_active = False
        self._subagent_name = ""
        self._subagent_header_printed = False
        self._println(f"  {ansi('system_info')}└─{ansi_reset()}")

    # ── Complete text messages ──────────────────────────────────────────────
    def _render_text_message(self, message: TextMessage) -> None:
        # ``_should_skip_text`` has already filtered dup / internal / user
        # messages by the time we're here.
        source = (message.source or "")
        content = (message.content or "").strip()
        if not content:
            return
        reasoning, visible = split_reasoning(content)
        if reasoning and self.show_reasoning:
            self._open_reasoning()
            self._render_reasoning_text(reasoning)
            self._close_reasoning()
        if not visible:
            return

        # Determine if this is a subagent message
        is_sub = source.startswith("sub:")
        meta = getattr(message, "metadata", None) or {}
        is_subagent_result = bool(meta.get("subagent_result"))

        if is_subagent_result:
            # Final subagent result — use a distinct teal/cyan panel with
            # bold border and clear label so it stands out from streamed output.
            theme = get_theme()
            panel = Panel(
                visible,
                title=f"[cyan bold]◆ {source}[/cyan bold]",
                border_style="cyan",
                box=ROUNDED,
                expand=False,
            )
            self.console.print(panel)
        elif is_sub:
            # Subagent text — use cyan border to distinguish from main agent (gold)
            theme = get_theme()
            panel = Panel(
                visible,
                title=f"[cyan]{source}[/cyan]",
                border_style="cyan",
                box=ROUNDED,
                expand=False,
            )
            self.console.print(panel)
        elif _looks_markdown(visible):
            self.console.print(Markdown(visible))
        else:
            theme = get_theme()
            panel = Panel(
                visible,
                title=f"[{theme.assistant_panel_border}]{source}[/{theme.assistant_panel_border}]",
                border_style=theme.assistant_panel_border,
                box=ROUNDED,
                expand=False,
            )
            self.console.print(panel)
        self._last_ended_with_newline = True  # Rich adds trailing newline

    # ── Usage capture ───────────────────────────────────────────────────────
    def _capture_usage(self, message: Any) -> None:
        prompt, completion, model = extract_usage(message)
        if prompt or completion:
            # Prefer the largest observed usage for the turn (streaming events
            # may emit deltas of varying granularity).
            prev_p, prev_c = self._last_usage
            self._last_usage = (max(prev_p, prompt), max(prev_c, completion))
        if model:
            self._last_turn_model = model


# ── Small helpers ───────────────────────────────────────────────────────────

def _looks_markdown(text: str) -> bool:
    patterns = ("```", "**", "__", "##", "- ", "* ", "1. ", "[")
    return any(p in text for p in patterns)


def _has_rich_markup(text: str) -> bool:
    """Return True if *text* contains Rich-style ``[tag]...[/tag]`` markup
    rather than ANSI escapes (``\\033[...m``)."""
    return ("[/" in text and "[" in text and "\033" not in text)


# Export TUI module availability for external use
def is_tui_module_available() -> bool:
    """Check if the Hermes-style TUI module is available."""
    return TUI_MODULE_AVAILABLE


# ── TUI-aware renderer (writes to DrSaiTUIState.message buffer) ─────────────
# Re-uses DrSaiCLIRenderer logic but routes ALL output (streaming, tool
# messages, panels) into state.messages for display in the HSplit message
# Window. The HSplit top Window handles the spinner via state.spinner_*.
# KawaiiSpinner is NOT used — spinner is driven by state._invalidate() from
# the background spinner_loop thread.


class DrSaiTUIRenderer(DrSaiCLIRenderer):
    """TUI-aware renderer — routes all output to DrSaiTUIState.message buffer.

    Subclass of DrSaiCLIRenderer that:
    - Writes all output to ``state.messages`` instead of ``sys.stdout``
    - Strips ANSI/Rich markup when storing (message Window uses FormattedText)
    - Calls ``state._invalidate()`` after each render iteration
    - Removes KawaiiSpinner (replaced by HSplit top Window via state.spinner_*)
    - Removes ``patch_stdout`` dependency for output (App already handles that)
    """

    def __init__(
        self,
        state: "DrSaiTUIState",
        console: Optional[Console] = None,
        show_reasoning: bool = False,
        tool_preview_max_len: int = 0,
    ) -> None:
        # Use a StringIO-backed Console to capture Rich output
        from io import StringIO
        self._string_capture = StringIO()
        capture_console = Console(file=self._string_capture, force_terminal=False)
        super().__init__(console=capture_console, show_reasoning=show_reasoning,
                         tool_preview_max_len=tool_preview_max_len)
        self.state = state
        self._buffer: list[tuple[str, str]] = []  # (style, text) buffer

    # ── Output routing: write to state.messages ─────────────────────────────

    def _tui_append(self, text: str, style: str = "") -> None:
        """Append styled text to the message buffer."""
        if not text:
            return
        from loguru import logger
        logger.debug(f"[TUI Renderer] Appending to state.messages: '{text[:100]}'")
        self.state.append_message(text, style)
        logger.debug(f"[TUI Renderer] state.messages now has {len(self.state.messages)} items")

    def _tui_flush(self) -> None:
        """Flush captured Rich StringIO content to message buffer."""
        captured = self._string_capture.getvalue()
        self._string_capture.seek(0)
        self._string_capture.truncate()
        if captured:
            self._tui_append(captured, "")

    def _println(self, text: str = "") -> None:
        """Override: route to state.messages (strip markup)."""
        if not text:
            self._tui_append("\n", "")
            return
        # Strip Rich markup tags like [yellow]...[/yellow] → just text
        import re
        stripped = re.sub(r'\[/?[^]]+\]', '', text)
        self._tui_append(stripped, "")
        self._last_ended_with_newline = True

    def _soft_newline(self) -> None:
        """Override: route to state.messages."""
        if not self._last_ended_with_newline:
            self._tui_append("\n", "")

    # ── Streaming output ────────────────────────────────────────────────────

    def _handle_chunk(self, text: str, state) -> None:
        """Override parent's _handle_chunk to route all output to state.messages."""
        if not text:
            return
        # Collapse leading whitespace after tool events
        if self._just_after_tool_event:
            text = text.lstrip()
            if not text:
                return
            self._just_after_tool_event = False

        # Feed text through reasoning state parser (state is ReasoningStreamState instance)
        for chunk in state.feed(text):
            self._write_chunk_tui(chunk.kind, chunk.text)

    def _write_chunk_tui(self, kind: str, text: str) -> None:
        """Route streaming chunks to state.messages (replaces parent's _write_chunk)."""
        if not text:
            return
        # Strip ANSI escapes for storage in message buffer
        import re
        stripped = re.sub(r'\x1b\[[0-9;]*[a-zA-Z]', '', text)
        if kind == "reasoning":
            if not self.show_reasoning:
                return
            self._tui_append(stripped, "class:reasoning")
        else:
            self._tui_append(stripped, "")

    def _close_stream(self) -> None:
        if self._stream_open:
            self._tui_append("\n", "")
            self._stream_open = False
            self._last_ended_with_newline = True

    def _close_reasoning(self) -> None:
        if self._reason_open:
            if not self._reason_first_line:
                self._tui_append("\n", "class:reasoning")
            self._reason_open = False
            self._reason_first_line = True

    def _open_reasoning(self) -> None:
        self._tui_append("┌─ Reasoning ─", "class:reasoning")
        self._reason_open = True
        self._reason_first_line = True

    def _render_reasoning_text(self, text: str) -> None:
        import re
        stripped = re.sub(r'\x1b\[[0-9;]*[a-zA-Z]', '', text)
        self._tui_append(stripped, "class:reasoning")

    # ── Tool events ─────────────────────────────────────────────────────────

    def _render_tool_request(self, message: ToolCallRequestEvent) -> None:
        calls = message.content or []
        for call in calls:
            if isinstance(call, FunctionCall):
                tool_name = call.name
                raw_args = getattr(call, "arguments", {}) or {}
                if isinstance(raw_args, str):
                    try:
                        import json as _json
                        args = _json.loads(raw_args)
                    except (json.JSONDecodeError, ValueError):
                        args = {}
                else:
                    args = raw_args if isinstance(raw_args, dict) else {}
                self._pending_tool_call = (tool_name, args)
                if TUI_MODULE_AVAILABLE:
                    import re as _re
                    preview = build_tool_preview(tool_name, args)
                    if preview:
                        self._tui_append(f"  🔧 {tool_name} {preview}", "class:tool-prefix")
                    else:
                        self._tui_append(f"  🔧 {tool_name}", "class:tool-prefix")
                else:
                    self._tui_append(f"  🔧 {tool_name}", "class:tool-prefix")
        self._just_after_tool_event = True
        self.state._invalidate()

    def _render_tool_result(self, message: ToolCallExecutionEvent) -> None:
        tool_name = getattr(message, "name", "?")
        content = getattr(message, "content", None)
        duration = None
        if self._tool_start_time:
            duration = time.time() - self._tool_start_time
            self._tool_start_time = None

        # Render diff if applicable
        if TUI_MODULE_AVAILABLE and self._current_tool_snapshot:
            render_edit_diff_with_delta(self._current_tool_snapshot, tool_name,
                                         getattr(message, "arguments", None))
            self._current_tool_snapshot = None

        # Cute completion message
        if TUI_MODULE_AVAILABLE:
            if duration is not None:
                msg = get_cute_tool_message(tool_name, None, duration)
            else:
                msg = f"  ✅ {tool_name}"
        else:
            msg = f"  ✅ {tool_name}"
        self._tui_append(msg, "class:tool-result")
        self._just_after_tool_event = True
        self.state._invalidate()

    def _render_tool_summary(self, message: ToolCallSummaryMessage) -> None:
        content = getattr(message, "content", None)
        if content:
            self._tui_append(f"  ✅ {content}", "class:tool-result")
        self.state._invalidate()

    # ── Text message ────────────────────────────────────────────────────────

    def _render_text_message(self, message: TextMessage) -> None:
        source = (message.source or "")
        content = (message.content or "").strip()
        if not content:
            return
        reasoning, visible = split_reasoning(content)

        if reasoning and self.show_reasoning:
            self._tui_append("┌─ Reasoning ─", "class:reasoning")
            import re
            stripped = re.sub(r'\x1b\[[0-9;]*[a-zA-Z]', '', reasoning)
            for line in stripped.split('\n'):
                self._tui_append(f"│ {line}", "class:reasoning")
            self._tui_append("└─", "class:reasoning")

        if not visible:
            return

        import re
        visible_stripped = re.sub(r'\x1b\[[0-9;]*[a-zA-Z]', '', visible)
        self._tui_append(f"\n{visible_stripped}\n", "class:assistant-text")
        self._last_ended_with_newline = True
        self.state._invalidate()

    # ── Main entry ──────────────────────────────────────────────────────────

    async def render(
        self,
        stream: AsyncGenerator[Any, None],
        stats: SessionStats,
    ) -> None:
        state = ReasoningStreamState()
        self._stream_open = False
        self._reason_open = False
        self._reason_first_line = True
        self._last_turn_model = ""
        self._last_usage = (0, 0)
        self._streamed_visible_this_turn = False
        self._streaming_sources = set()
        self._just_after_tool_event = False
        self._current_tool_snapshot = None
        self._tool_start_time = None
        self._last_ended_with_newline = False
        self._subagent_active = False
        self._subagent_name = ""
        self._subagent_header_printed = False

        # Signal spinner start via TUIState (not KawaiiSpinner thread)
        self.state.start_spinner("thinking…")

        async for message in stream:
            from loguru import logger
            logger.debug(f"[TUI Renderer] Got event: {type(message).__name__}")
            if isinstance(message, ModelClientStreamingChunkEvent):
                src = getattr(message, "source", "") or ""
                if src:
                    self._streaming_sources.add(src)
                content = message.content or ""
                logger.debug(f"[TUI Renderer] Chunk content: '{content[:50]}'")
                self._handle_chunk(content, state)
            elif isinstance(message, ToolCallRequestEvent):
                self._close_stream()
                self._close_reasoning()
                self._render_tool_request(message)
                self._just_after_tool_event = True
            elif isinstance(message, ToolCallExecutionEvent):
                self._close_stream()
                self._close_reasoning()
                self._render_tool_summary(message)
                self._just_after_tool_event = True
            elif isinstance(message, ToolCallSummaryMessage):
                self._close_stream()
                self._close_reasoning()
                self._render_tool_summary(message)
                self._just_after_tool_event = True
            elif isinstance(message, TextMessage):
                self._capture_usage(message)
                if self._should_skip_text(message):
                    continue
                self._close_stream()
                for chunk in state.flush():
                    self._write_chunk_tui(chunk.kind, chunk.text)
                self._close_reasoning()
                self._render_text_message(message)
            elif isinstance(message, Response):
                self._capture_usage(message)
                chat = getattr(message, "chat_message", None)
                if isinstance(chat, TextMessage):
                    self._capture_usage(chat)
                self._close_stream()
                for chunk in state.flush():
                    self._write_chunk_tui(chunk.kind, chunk.text)
                self._close_reasoning()

            # Refresh the App display after each event
            self.state._invalidate()

        self._close_stream()
        self._close_reasoning()

        # Signal spinner stop
        self.state.stop_spinner()

        # Footer stats
        if stats and stats.show_footer:
            footer_text = format_footer(stats)
            if footer_text:
                import re
                stripped = re.sub(r'\x1b\[[0-9;]*[a-zA-Z]', '', footer_text)
                self._tui_append(f"\n{stripped}\n", "class:status-dim")

        self.state._invalidate()
