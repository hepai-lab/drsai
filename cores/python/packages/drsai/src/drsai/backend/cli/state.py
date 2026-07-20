"""
OpenDrSai TUI state shared between the rendering loop and tool callbacks.

Replaces the module-level globals that were scattered across callbacks.py
and prompt.py with a single, explicitly-passed object (or thread-local
singleton when no object is explicitly injected).

This is the "new" state design described in the implementation plan:
  - approval_callback writes to  tui_state.approval_state
  - clarify_callback writes to  tui_state.clarify_state
  - keybindings read from those states and put() responses into
    the response_queue inside each state dict.
"""

from __future__ import annotations

import queue
import threading
import time as _time
from dataclasses import dataclass, field
from typing import Any


@dataclass
class ApprovalState:
    """Snapshotted state published by approval_callback."""
    command: str
    description: str
    choices: list[str]
    deadline: float = 0.0
    response_queue: queue.Queue = field(default_factory=queue.Queue)

    @property
    def timed_out(self) -> bool:
        return self.deadline > 0 and _time.monotonic() > self.deadline


@dataclass
class ClarifyState:
    """Snapshotted state published by clarify_callback."""
    question: str
    choices: list[str]
    is_freetext: bool
    deadline: float = 0.0
    response_queue: queue.Queue = field(default_factory=queue.Queue)

    @property
    def timed_out(self) -> bool:
        return self.deadline > 0 and _time.monotonic() > self.deadline


@dataclass
class SecretState:
    """Snapshotted state published by prompt_for_secret."""
    var_name: str
    prompt: str
    metadata: dict
    deadline: float = 0.0
    response_queue: queue.Queue = field(default_factory=queue.Queue)


# Note: DrSaiTUIState is now defined in cli/tui/app.py (the full TUI state class).
# This module only provides get_tui_state() / set_tui_state() to access the
# thread-local singleton, which is set by the TUI app (or by run_cli.py).

# ---------------------------------------------------------------------------
# Thread-local singleton (used when no explicit state is passed through the
# call-stack — avoids having to thread state through every internal function).
# ---------------------------------------------------------------------------

_local = threading.local()


def get_tui_state() -> "DrSaiTUIState":
    """Return the current TUI state (thread-local singleton).

    Note: Returns the full DrSaiTUIState from cli/tui/app.py, not a lightweight version.
    The state must be set via set_tui_state() before calling this function.
    """
    if not hasattr(_local, "state"):
        # Lazy import to avoid circular dependency
        from drsai.backend.cli.tui.app import DrSaiTUIState
        _local.state = DrSaiTUIState()
    return _local.state


def set_tui_state(state: "DrSaiTUIState") -> None:
    """Inject an explicit TUI state (for testing / injection)."""
    _local.state = state
