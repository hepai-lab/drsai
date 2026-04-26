"""Hermes-inspired streaming renderer for ``drsai-cli``.

Consumes an async iterator of autogen events (ModelClientStreamingChunkEvent,
ToolCallRequestEvent, TextMessage, TaskResult, Response, …) and renders them
with:

- A dim reasoning box for ``<think>...</think>`` content that auto-closes
  when visible content begins. Controlled by :attr:`show_reasoning`.
- Token-level streaming of visible answers.
- Yellow ``🔧 tool_name`` on tool requests; gray ``╎ preview`` on results.
- A Gold-bordered Rich panel for completed text messages.
- Optional per-turn footer + terminal bell on completion.

The renderer is intentionally **I/O-only** — it updates a :class:`SessionStats`
but does not decide what to persist. The REPL owns persistence.
"""

from __future__ import annotations

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
)

from .reasoning import ReasoningStreamState, split_reasoning
from .stats import SessionStats, extract_usage, format_footer, play_bell

__all__ = ["DrSaiCLIRenderer"]


class DrSaiCLIRenderer:
    """Stateful renderer — one instance per REPL."""

    def __init__(
        self,
        *,
        console: Optional[Console] = None,
        show_reasoning: bool = False,
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

        async for message in stream:
            if isinstance(message, ModelClientStreamingChunkEvent):
                src = getattr(message, "source", "") or ""
                if src:
                    self._streaming_sources.add(src)
                self._handle_chunk(message.content or "", state)
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
            elif isinstance(message, TextMessage):
                # Capture usage metadata before any early return.
                self._capture_usage(message)
                if self._should_skip_text(message):
                    # Do NOT close the stream — an interim TextMessage with the
                    # same content we're already streaming would otherwise
                    # inject a newline mid-sentence ("Hi th\nere!" bug).
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
            print(footer)
        play_bell(stats.ring_bell)

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
                print()
                self._stream_open = False
            if not self._reason_open:
                self._open_reasoning()
            self._render_reasoning_text(text)
        else:  # visible
            if self._reason_open:
                self._close_reasoning()
            # ReasoningStreamState already quarantines partial reasoning tags;
            # streaming chunks here are raw answer text. Do NOT call
            # strip_reasoning — its ``.strip()`` eats legitimate whitespace.
            print(text, end="", flush=True)
            self._stream_open = not text.endswith("\n")
            self._streamed_visible_this_turn = True

    # ── Reasoning box ───────────────────────────────────────────────────────
    def _open_reasoning(self) -> None:
        print("\033[2m┌─ Reasoning ─\033[0m")
        self._reason_open = True
        self._reason_first_line = True

    def _render_reasoning_text(self, text: str) -> None:
        for ch in text:
            if self._reason_first_line:
                print("\033[2m│ \033[0m", end="", flush=True)
                self._reason_first_line = False
            print(f"\033[2m{ch}\033[0m", end="", flush=True)
            if ch == "\n":
                self._reason_first_line = True

    def _close_reasoning(self) -> None:
        if not self._reason_open:
            return
        if not self._reason_first_line:
            print()  # finish the last dim line
        print("\033[2m└─\033[0m")
        self._reason_open = False
        self._reason_first_line = True

    def _close_stream(self) -> None:
        if self._stream_open:
            print()
            self._stream_open = False

    # ── Tool events ─────────────────────────────────────────────────────────
    def _render_tool_request(self, message: ToolCallRequestEvent) -> None:
        calls = message.content or []
        for call in calls:
            if isinstance(call, FunctionCall):
                self.console.print(f"[yellow]🔧[/yellow] [cyan]{call.name}[/cyan]")

    def _render_tool_result(self, message: ToolCallExecutionEvent) -> None:
        results = message.content or []
        for r in results:
            content = getattr(r, "content", None)
            if not content:
                continue
            text = str(content).strip().replace("\n", " ")
            if len(text) > 200:
                text = text[:200] + "…"
            self.console.print(f"[dim]╎ {text}[/dim]")

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
        if _looks_markdown(visible):
            self.console.print(Markdown(visible))
        else:
            panel = Panel(
                visible,
                title=f"[cyan]{source}[/cyan]",
                border_style="#FFD700",
                box=ROUNDED,
                expand=False,
            )
            self.console.print(panel)

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
