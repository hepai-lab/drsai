"""Per-turn + session-wide statistics for the CLI REPL.

The renderer updates a :class:`SessionStats` instance after each assistant
turn; the REPL prints a dim footer summarising tokens/duration. Toggle with
``/verbose``. Bell on completion is independent, toggled via ``/bell``.
"""

from __future__ import annotations

import sys
import time
from dataclasses import dataclass, field

from .theme import ansi, ansi_reset

__all__ = [
    "SessionStats",
    "format_footer",
    "play_bell",
    "extract_usage",
]


@dataclass
class SessionStats:
    """Accumulated stats since the REPL started."""

    turns: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    last_prompt_tokens: int = 0
    last_completion_tokens: int = 0
    last_turn_seconds: float = 0.0
    last_model: str = ""
    token_limit: int = 0  # Token limit for current model
    show_footer: bool = True
    ring_bell: bool = False
    _turn_start: float = field(default=0.0, repr=False)

    # ── Lifecycle ───────────────────────────────────────────────────────────
    def start_turn(self) -> None:
        self._turn_start = time.monotonic()

    def end_turn(
        self,
        *,
        prompt_tokens: int = 0,
        completion_tokens: int = 0,
        model: str = "",
    ) -> None:
        if self._turn_start:
            self.last_turn_seconds = time.monotonic() - self._turn_start
        self._turn_start = 0.0
        self.turns += 1
        self.last_prompt_tokens = max(prompt_tokens, 0)
        self.last_completion_tokens = max(completion_tokens, 0)
        # Reset cumulative tokens to only show current turn's total
        self.prompt_tokens = self.last_prompt_tokens
        self.completion_tokens = self.last_completion_tokens
        if model:
            self.last_model = model

    # ── Properties ──────────────────────────────────────────────────────────
    @property
    def total_tokens(self) -> int:
        """Current turn's total tokens (prompt + completion)."""
        return self.prompt_tokens + self.completion_tokens


def format_footer(stats: SessionStats) -> str:
    """Return a dim one-line summary for the latest turn.

    Empty string when ``show_footer`` is off or no turn has completed yet.
    Shows: total (limit) tok format.
    """
    if not stats.show_footer or stats.turns == 0:
        return ""
    duration = _fmt_duration(stats.last_turn_seconds)
    total = _fmt_tok(stats.total_tokens)
    
    # Show token limit if configured
    if stats.token_limit > 0:
        limit = _fmt_tok(stats.token_limit)
        toks = f"{total}/{limit}"
    else:
        toks = total
    
    model = f" · {stats.last_model}" if stats.last_model else ""
    return f"{ansi('system_info')}● {duration} · {toks} tok · turn {stats.turns}{model}{ansi_reset()}"


def play_bell(enabled: bool) -> None:
    if not enabled:
        return
    try:
        sys.stdout.write("\a")
        sys.stdout.flush()
    except Exception:
        pass


# ── Usage extraction helpers ────────────────────────────────────────────────

def extract_usage(message) -> tuple[int, int, str]:
    """Pull ``(prompt_tokens, completion_tokens, model)`` from an autogen event.

    Many event shapes carry a ``RequestUsage`` or ``CompletionUsage`` payload.
    We probe a few common attribute paths and return zeros if nothing matches.
    
    Supports both:
    - message.usage (standard attribute)
    - message.models_usage (autogen AgentChat TextMessage/Response format)
    """
    # Check both "usage" and "models_usage" attributes
    # TextMessage uses "models_usage", while some other messages use "usage"
    usage = getattr(message, "usage", None)
    if usage is None:
        # Try "models_usage" which is used by autogen_agentchat TextMessage
        usage = getattr(message, "models_usage", None)
    if usage is None:
        return 0, 0, ""
    prompt = (
        getattr(usage, "prompt_tokens", None)
        or getattr(usage, "input_tokens", None)
        or 0
    )
    completion = (
        getattr(usage, "completion_tokens", None)
        or getattr(usage, "output_tokens", None)
        or 0
    )
    model = getattr(message, "model", "") or getattr(message, "source", "") or ""
    return int(prompt), int(completion), str(model)


# ── Formatting helpers ──────────────────────────────────────────────────────

def _fmt_duration(seconds: float) -> str:
    if seconds < 1:
        return f"{int(seconds * 1000)}ms"
    if seconds < 60:
        return f"{seconds:.1f}s"
    m, s = divmod(int(seconds), 60)
    return f"{m}m{s:02d}s"


def _fmt_tok(n: int) -> str:
    if n < 1000:
        return str(n)
    if n < 1_000_000:
        return f"{n / 1000:.1f}k"
    return f"{n / 1_000_000:.2f}M"
