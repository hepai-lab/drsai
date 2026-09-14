"""Shared event layer — agent output to protocol event translation.

This package holds backend-agnostic event translation that is shared by
*all* gateway surfaces (desktop, TUI, remote worker, codex, ...).  It exists
so that no gateway has to import another gateway:

- ``agent_event_translator`` — converts autogen events
  (:class:`ModelClientStreamingChunkEvent`, :class:`ToolCallRequestEvent`,
  :class:`ToolCallExecutionEvent`, :class:`TextMessage`, :class:`Response`,
  :class:`TaskResult`, :class:`ThoughtEvent`, ...) into gateway semantic
  events (``message.delta`` / ``tool.start`` / ``tool.complete`` /
  ``message.complete`` / ``thinking.delta`` / ``status.update``).

Historically this lived in ``tui_gateway/adapter/event_translator.py`` even
though the Desktop gateway imported it too, which forced a bogus
``desktop_gateway -> tui_gateway`` dependency.  It is a pure module (no I/O,
no transport), so it belongs to the shared event layer rather than to any
single gateway's adapter package.
"""

from .agent_event_translator import (
    TurnState,
    finalize,
    translate,
)

__all__ = ["TurnState", "finalize", "translate"]
