"""Reasoning / thinking tag handling for the CLI renderer.

Two responsibilities:

1. **Bulk stripping** for full messages (``strip_reasoning``) — ported almost
   verbatim from hermes-agent ``cli.py::_strip_reasoning_tags`` so the same
   menagerie of open-model tag variants is handled consistently.
2. **Streaming state** (``ReasoningStreamState``) — a small state machine that
   classifies each incoming token chunk as "reasoning" or "visible" so the
   renderer can fold think-blocks into a dim preview box.

Keep the tag tuple in sync with hermes — both projects chase the same bugs
from new models leaking `<think>` variants.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Literal, Tuple

__all__ = [
    "REASONING_TAGS",
    "strip_reasoning",
    "split_reasoning",
    "ReasoningStreamState",
    "ReasoningChunk",
]


REASONING_TAGS: tuple[str, ...] = (
    "REASONING_SCRATCHPAD",
    "think",
    "thinking",
    "reasoning",
    "thought",
)

_TOOL_CALL_TAGS: tuple[str, ...] = (
    "tool_call",
    "tool_calls",
    "tool_result",
    "function_call",
    "function_calls",
)


def strip_reasoning(text: str) -> str:
    """Remove reasoning / tool-call XML blocks from *text*.

    Ported from hermes-agent ``cli.py::_strip_reasoning_tags``.
    Handles closed pairs, unterminated open tags, and orphan close tags.
    """
    cleaned = text
    for tag in REASONING_TAGS:
        cleaned = re.sub(
            rf"<{tag}>.*?</{tag}>\s*",
            "",
            cleaned,
            flags=re.DOTALL | re.IGNORECASE,
        )
        cleaned = re.sub(
            rf"<{tag}>.*$", "", cleaned, flags=re.DOTALL | re.IGNORECASE,
        )
        cleaned = re.sub(
            rf"</{tag}>\s*", "", cleaned, flags=re.IGNORECASE,
        )
    for tc_tag in _TOOL_CALL_TAGS:
        cleaned = re.sub(
            rf"<{tc_tag}\b[^>]*>.*?</{tc_tag}>\s*",
            "",
            cleaned,
            flags=re.DOTALL | re.IGNORECASE,
        )
    cleaned = re.sub(
        r'(?:(?<=^)|(?<=[\n\r.!?:]))[ \t]*'
        r'<function\b[^>]*\bname\s*=[^>]*>'
        r'(?:(?:(?!</function>).)*)</function>\s*',
        "",
        cleaned,
        flags=re.DOTALL | re.IGNORECASE,
    )
    cleaned = re.sub(
        r'</(?:tool_call|tool_calls|tool_result|function_call|function_calls|function)>\s*',
        "",
        cleaned,
        flags=re.IGNORECASE,
    )
    return cleaned.strip()


def split_reasoning(text: str) -> Tuple[str, str]:
    """Separate *text* into ``(reasoning, visible)`` parts for display.

    Greedy — pulls every ``<think>...</think>`` / variant into the reasoning
    bucket and leaves the rest as the visible answer. Useful for rendering a
    past, fully-received message (not streaming).
    """
    reasoning_chunks: list[str] = []
    for tag in REASONING_TAGS:
        pattern = re.compile(
            rf"<{tag}>(.*?)</{tag}>",
            flags=re.DOTALL | re.IGNORECASE,
        )
        for m in pattern.finditer(text):
            reasoning_chunks.append(m.group(1).strip())
    visible = strip_reasoning(text)
    reasoning = "\n\n".join(c for c in reasoning_chunks if c)
    return reasoning, visible


# ── Streaming state machine ─────────────────────────────────────────────────

ChunkKind = Literal["reasoning", "visible"]


@dataclass
class ReasoningChunk:
    kind: ChunkKind
    text: str


@dataclass
class ReasoningStreamState:
    """Classify streaming tokens as reasoning vs visible text.

    Holds a small *prefilter* buffer so an opening tag split across two
    chunks (``"<thi"`` + ``"nk>..."``) is still detected. Call :meth:`feed`
    with each new chunk; it returns zero or more :class:`ReasoningChunk`s.

    Also exposes :attr:`in_reasoning` — the renderer uses it to decide
    whether to keep the reasoning box open between chunks.
    """

    in_reasoning: bool = False
    _prefilt: str = ""
    _open_pattern: re.Pattern = field(init=False, repr=False)
    _close_pattern: re.Pattern = field(init=False, repr=False)
    _max_prefilt: int = 32  # longer than any tag we track

    def __post_init__(self) -> None:
        opens = "|".join(REASONING_TAGS)
        self._open_pattern = re.compile(rf"<(?:{opens})>", flags=re.IGNORECASE)
        self._close_pattern = re.compile(rf"</(?:{opens})>", flags=re.IGNORECASE)

    def feed(self, chunk: str) -> list[ReasoningChunk]:
        if not chunk:
            return []
        buf = self._prefilt + chunk
        out: list[ReasoningChunk] = []
        cursor = 0
        while cursor < len(buf):
            kind: ChunkKind = "reasoning" if self.in_reasoning else "visible"
            pattern = self._close_pattern if self.in_reasoning else self._open_pattern
            marker = "</" if self.in_reasoning else "<"
            m = pattern.search(buf, cursor)
            if m:
                if m.start() > cursor:
                    out.append(ReasoningChunk(kind, buf[cursor:m.start()]))
                cursor = m.end()
                self.in_reasoning = not self.in_reasoning
                continue

            # No complete tag ahead. Only hold back chars that could be part of
            # a partial tag — look for the latest occurrence of the tag's
            # starting marker. Anything before that is safe to emit now.
            last = buf.rfind(marker, cursor)
            if last == -1:
                # No tag candidate at all; flush the tail immediately.
                out.append(ReasoningChunk(kind, buf[cursor:]))
                self._prefilt = ""
                return out
            tail_len = len(buf) - last
            if tail_len > self._max_prefilt:
                # Candidate is too old to still be a partial tag; treat it as
                # literal text and flush.
                out.append(ReasoningChunk(kind, buf[cursor:]))
                self._prefilt = ""
                return out
            if last > cursor:
                out.append(ReasoningChunk(kind, buf[cursor:last]))
            self._prefilt = buf[last:]
            return out
        self._prefilt = ""
        return out

    def flush(self) -> list[ReasoningChunk]:
        """Emit any buffered text (end-of-stream)."""
        if not self._prefilt:
            return []
        out = [ReasoningChunk(
            "reasoning" if self.in_reasoning else "visible",
            self._prefilt,
        )]
        self._prefilt = ""
        return out
