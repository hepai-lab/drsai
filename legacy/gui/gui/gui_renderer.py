"""GUI streaming renderer — adapts agent.run_stream() events to tkinter Text widget.

Consumes the same async event stream as ``DrSaiCLIRenderer`` but instead of
writing to stdout, it writes to a tkinter ``ScrolledText`` widget via
``root.after()`` calls for thread-safe updates.

Supported events:
- ModelClientStreamingChunkEvent → token-level streaming (visible text)
- ThoughtEvent → reasoning box (optional)
- ToolCallRequestEvent → tool call indicator
- ToolCallExecutionEvent → tool result indicator
- ToolCallSummaryMessage → tool summary
- TextMessage → completed message (final text)
- Response → final response
- TaskResult → end of turn

The renderer is intentionally lightweight — no Rich/ANSI, just plain text
with simple emoji prefixes for visual distinction.
"""

from __future__ import annotations

import time
from typing import Any, AsyncGenerator, Callable, Optional

from loguru import logger

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

from drsai.modules.managers.messages import ThoughtEvent

from drsai.backend.cli.reasoning import ReasoningStreamState, split_reasoning
from drsai.backend.cli.stats import extract_usage


class DrSaiGUIRenderer:
    """Stateful renderer that writes agent streaming events to a tkinter Text widget.

    Usage:
        renderer = DrSaiGUIRenderer(
            append_fn=chat_window.append_text,  # thread-safe callable
            show_reasoning=True,
        )
        # Then in an async context:
        await renderer.render(agent.run_stream(task=user_input))
    """

    def __init__(
        self,
        *,
        append_fn: Callable[[str, str], None],
        show_reasoning: bool = False,
    ) -> None:
        """
        Args:
            append_fn: Thread-safe callable that takes (text, tag) and appends
                       to the tkinter Text widget. Must be safe to call from any
                       thread (typically via root.after()).
            show_reasoning: Whether to display reasoning/thinking content.
        """
        self._append_fn = append_fn
        self.show_reasoning = show_reasoning

        # ── Internal state (reset per turn) ──────────────────────────────
        self._stream_open = False
        self._reason_open = False
        self._reason_first_line = True
        self._streamed_visible_this_turn = False
        self._streaming_sources: set[str] = set()
        self._just_after_tool_event = False
        self._last_turn_model = ""
        self._last_usage: tuple[int, int] = (0, 0)
        self._tool_start_time: float | None = None
        self._pending_tool_call: tuple[str, dict] | None = None

    # ── Main entry ──────────────────────────────────────────────────────────
    async def render(
        self,
        stream: AsyncGenerator[Any, None],
    ) -> dict[str, Any]:
        """Consume the agent stream and render all events to the GUI.

        Returns a stats dict with token usage info for the caller to display.
        """
        state = ReasoningStreamState()
        self._reset_turn_state()

        stats_info = {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "model": "",
            "duration_seconds": 0.0,
        }
        start_time = time.time()

        async for message in stream:
            if isinstance(message, ModelClientStreamingChunkEvent):
                src = getattr(message, "source", "") or ""
                if src:
                    self._streaming_sources.add(src)
                self._handle_chunk(message.content or "", state)

            elif isinstance(message, ThoughtEvent):
                # Thought/reasoning event from agent
                content = getattr(message, "content", "") or ""
                if content and self.show_reasoning:
                    self._append("💭 ", "reasoning_tag")
                    self._append(content + "\n", "reasoning")

            elif isinstance(message, ToolCallRequestEvent):
                self._close_stream()
                self._close_reasoning()
                self._render_tool_request(message)
                self._just_after_tool_event = True

            elif isinstance(message, ToolCallExecutionEvent):
                self._close_stream()
                self._close_reasoning()
                self._render_tool_result(message)
                self._just_after_tool_event = True

            elif isinstance(message, ToolCallSummaryMessage):
                self._close_stream()
                self._close_reasoning()
                self._render_tool_summary(message)
                self._just_after_tool_event = True

            elif isinstance(message, TextMessage):
                self._capture_usage(message, stats_info)
                if self._should_skip_text(message):
                    continue
                self._close_stream()
                for chunk in state.flush():
                    self._write_chunk(chunk.kind, chunk.text)
                self._close_reasoning()
                # For GUI, we skip the full TextMessage rendering since
                # we already streamed the content via chunks.
                # Only render if we haven't streamed anything this turn.
                if not self._streamed_visible_this_turn:
                    self._render_text_message(message)

            elif isinstance(message, Response):
                self._capture_usage(message, stats_info)
                chat = getattr(message, "chat_message", None)
                if isinstance(chat, TextMessage) and chat.source.lower() != "user":
                    self._capture_usage(chat, stats_info)
                    if self._should_skip_text(chat):
                        continue
                    self._close_stream()
                    self._close_reasoning()
                    if not self._streamed_visible_this_turn:
                        self._render_text_message(chat)

            elif isinstance(message, TaskResult):
                self._close_stream()
                self._close_reasoning()
                for m in getattr(message, "messages", []) or []:
                    self._capture_usage(m, stats_info)

            elif isinstance(message, BaseAgentEvent):
                pass  # Unknown event — ignore

        # End-of-turn: flush remaining buffered content
        for chunk in state.flush():
            self._write_chunk(chunk.kind, chunk.text)
        self._close_stream()
        self._close_reasoning()

        stats_info["duration_seconds"] = time.time() - start_time

        return stats_info

    # ── State management ────────────────────────────────────────────────────
    def _reset_turn_state(self) -> None:
        self._stream_open = False
        self._reason_open = False
        self._reason_first_line = True
        self._streamed_visible_this_turn = False
        self._streaming_sources = set()
        self._just_after_tool_event = False
        self._last_turn_model = ""
        self._last_usage = (0, 0)
        self._tool_start_time = None
        self._pending_tool_call = None

    # ── Streaming chunks ────────────────────────────────────────────────────
    def _handle_chunk(self, text: str, state: ReasoningStreamState) -> None:
        if not text:
            return
        if self._just_after_tool_event:
            text = text.lstrip()
            if not text:
                return
            self._just_after_tool_event = False
        for chunk in state.feed(text):
            self._write_chunk(chunk.kind, chunk.text)

    def _write_chunk(self, kind: str, text: str) -> None:
        if not text:
            return
        if kind == "reasoning":
            if not self.show_reasoning:
                return
            if self._stream_open:
                self._append("\n", "reasoning")
                self._stream_open = False
            if not self._reason_open:
                self._open_reasoning()
            self._append(text, "reasoning")
        else:  # visible text
            if self._reason_open:
                self._close_reasoning()
            self._append(text, "assistant")
            self._stream_open = not text.endswith("\n")
            self._streamed_visible_this_turn = True

    # ── Reasoning box ───────────────────────────────────────────────────────
    def _open_reasoning(self) -> None:
        self._append("┌─ Reasoning ─\n", "reasoning_tag")
        self._reason_open = True
        self._reason_first_line = True

    def _close_reasoning(self) -> None:
        if not self._reason_open:
            return
        if not self._reason_first_line:
            self._append("\n", "reasoning")
        self._append("└─\n", "reasoning_tag")
        self._reason_open = False
        self._reason_first_line = True

    def _close_stream(self) -> None:
        if self._stream_open:
            self._append("\n", "assistant")
            self._stream_open = False

    # ── Tool events ─────────────────────────────────────────────────────────
    def _render_tool_request(self, message: ToolCallRequestEvent) -> None:
        calls = message.content or []
        for call in calls:
            if isinstance(call, FunctionCall):
                tool_name = call.name
                raw_args = getattr(call, "arguments", {}) or {}
                if isinstance(raw_args, str):
                    try:
                        import json
                        args = json.loads(raw_args)
                    except (json.JSONDecodeError, ValueError):
                        args = {}
                else:
                    args = raw_args if isinstance(raw_args, dict) else {}

                self._pending_tool_call = (tool_name, args)
                self._tool_start_time = time.time()

                # Build a compact preview line
                preview = self._build_tool_preview(tool_name, args)
                self._append(f"🔧 {tool_name}", "tool_name")
                if preview:
                    self._append(f" {preview}", "tool_preview")
                self._append("\n", "tool_name")

    def _render_tool_result(self, message: ToolCallExecutionEvent) -> None:
        results = message.content or []
        tool_name, args = self._pending_tool_call or ("tool", {})
        self._pending_tool_call = None

        duration = 0.0
        if self._tool_start_time:
            duration = time.time() - self._tool_start_time
            self._tool_start_time = None

        result_str = None
        for r in results:
            content = getattr(r, "content", None)
            if content:
                result_str = str(content)
                tool_name = getattr(r, "name", tool_name)

        # Compact completion line
        duration_str = f"{duration:.1f}s" if duration > 0 else ""
        self._append(f"  ✓ {tool_name}", "tool_result")
        if duration_str:
            self._append(f" ({duration_str})", "tool_result")
        self._append("\n", "tool_result")

        # Show truncated result preview
        if result_str:
            text = result_str.strip().replace("\n", " ")
            if len(text) > 200:
                text = text[:200] + "…"
            self._append(f"    {text}\n", "tool_preview")

    def _render_tool_summary(self, message: ToolCallSummaryMessage) -> None:
        content = getattr(message, "content", "") or ""
        tool_name, args = self._pending_tool_call or ("tool", {})
        self._pending_tool_call = None

        duration = 0.0
        if self._tool_start_time:
            duration = time.time() - self._tool_start_time
            self._tool_start_time = None

        is_error = any(
            p in content.lower()
            for p in ["error", "failed", "permission denied", "no such file"]
        )

        icon = "✓" if not is_error else "✗"
        duration_str = f" ({duration:.1f}s)" if duration > 0 else ""
        self._append(f"  {icon} {tool_name}{duration_str}\n", "tool_result")

        # Truncated preview
        text = content.strip().replace("\n", " ")
        if len(text) > 200:
            text = text[:200] + "…"
        if text:
            self._append(f"    {text}\n", "tool_preview")

    # ── Complete text messages ──────────────────────────────────────────────
    def _render_text_message(self, message: TextMessage) -> None:
        source = (message.source or "")
        content = (message.content or "").strip()
        if not content:
            return

        reasoning, visible = split_reasoning(content)
        if reasoning and self.show_reasoning:
            self._append("💭 ", "reasoning_tag")
            self._append(reasoning + "\n", "reasoning")
        if visible:
            self._append(visible + "\n", "assistant")

    # ── Usage capture ───────────────────────────────────────────────────────
    def _capture_usage(self, message: Any, stats_info: dict) -> None:
        """Extract token usage from message metadata/attributes.

        Uses the same ``extract_usage`` helper as the CLI renderer for
        consistent token counting across both interfaces.
        """
        try:
            prompt, completion, model = extract_usage(message)
            if prompt or completion:
                # Keep the largest observed usage for the turn
                stats_info["prompt_tokens"] = max(stats_info["prompt_tokens"], prompt)
                stats_info["completion_tokens"] = max(stats_info["completion_tokens"], completion)
            if model:
                stats_info["model"] = model
        except Exception:
            pass  # Usage capture is non-critical

    # ── Filtering ───────────────────────────────────────────────────────────
    def _should_skip_text(self, message: TextMessage) -> bool:
        """Return True for TextMessages that should not be rendered."""
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

    # ── Output helper ──────────────────────────────────────────────────────
    def _append(self, text: str, tag: str = "") -> None:
        """Thread-safe append to the GUI text widget."""
        try:
            self._append_fn(text, tag)
        except Exception as e:
            logger.debug(f"GUI append error (non-critical): {e}")

    # ── Tool preview builder ──────────────────────────────────────────────
    def _build_tool_preview(self, tool_name: str, args: dict) -> str:
        """Build a one-line compact preview of tool arguments."""
        # Show the most relevant argument (file path, command, query, etc.)
        preview_keys = [
            "path", "file_path", "command", "cmd", "query", "question",
            "pattern", "url", "content", "text", "code",
        ]
        for key in preview_keys:
            val = args.get(key)
            if val:
                s = str(val)
                if len(s) > 80:
                    s = s[:77] + "…"
                return s
        # Fallback: first argument value
        for key, val in args.items():
            if key not in ("timeout", "maxlimit", "minilimit"):
                s = str(val)
                if len(s) > 80:
                    s = s[:77] + "…"
                return s
        return ""