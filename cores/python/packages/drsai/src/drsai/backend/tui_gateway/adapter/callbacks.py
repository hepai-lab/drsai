"""Bridge interactive prompts (approval / clarify / secret / sudo) to gateway _block.

These callbacks replace the prompt_toolkit-coupled implementations in
``drsai.backend.cli.callbacks``. Instead of writing to a TUI singleton and
waiting on a queue, they use :func:`server._block` to emit an event to the UI
and synchronously wait for a matching ``*.respond`` RPC.

The agent backend currently does NOT call any of these directly — they're
infrastructure for tools that *would* need approval. The dispatch table here
is exposed so handlers (or future tool plugins) can install them when the
gateway-driven UI is available.

Usage::

    from drsai.backend.tui_gateway.adapter.callbacks import (
        approval_callback,
        clarify_callback,
        secret_callback,
        bind_session,
    )

    # In a tool's pre-flight check:
    response = approval_callback(
        command="rm -rf /tmp/foo",
        description="Delete foo directory",
        choices=["approve", "deny", "approve_always"],
    )
    if response == "approve":
        ...
"""

from __future__ import annotations

import contextvars
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# ContextVar binds the current session_id for callbacks called on the agent's
# asyncio loop thread. Set by AgentSession.run_turn / handlers; read here so
# we know which session a given approval prompt belongs to.
_current_session_id: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "drsai_current_session_id", default=None
)


def bind_session(session_id: str):
    """Bind *session_id* for the current context. Returns a reset token."""
    return _current_session_id.set(session_id)


def reset_session(token) -> None:
    _current_session_id.reset(token)


def _resolve_sid(explicit: Optional[str]) -> str:
    if explicit:
        return explicit
    sid = _current_session_id.get()
    if sid:
        return sid
    return ""


# ── Approval ─────────────────────────────────────────────────────────


def approval_callback(
    command: str = "",
    description: str = "",
    choices: Optional[list[str]] = None,
    timeout: int = 300,
    *,
    session_id: Optional[str] = None,
) -> str:
    """Block the calling thread until the UI responds with an approval choice.

    Returns one of *choices* (e.g. ``"approve"`` / ``"deny"``). Defaults to
    ``"deny"`` if the timeout expires or no UI is connected.
    """
    if choices is None:
        choices = ["approve", "deny"]

    sid = _resolve_sid(session_id)
    if not sid:
        logger.warning("approval_callback called without session context — denying")
        return "deny"

    # Lazy import to avoid circular dependency at module-load time.
    from .. import server

    response = server._block(
        "approval.request",
        sid,
        {
            "command": command,
            "description": description,
            "choices": list(choices),
        },
        timeout=timeout,
    )

    return response or "deny"


# ── Clarify ──────────────────────────────────────────────────────────


def clarify_callback(
    question: str = "",
    choices: Optional[list[str]] = None,
    timeout: int = 300,
    *,
    session_id: Optional[str] = None,
) -> str:
    """Ask the user a clarifying question; return their answer (string).

    If *choices* is None / empty, the UI presents a free-text input.
    """
    sid = _resolve_sid(session_id)
    if not sid:
        logger.warning("clarify_callback called without session context — using fallback")
        return (
            "The user did not provide a response. Use your best judgement to "
            "make the choice and proceed."
        )

    from .. import server

    is_freetext = not choices
    response = server._block(
        "clarify.request",
        sid,
        {
            "question": question,
            "choices": list(choices) if choices else [],
            "is_freetext": is_freetext,
        },
        timeout=timeout,
    )

    if not response:
        return (
            "The user did not provide a response within the time limit. "
            "Use your best judgement to make the choice and proceed."
        )
    return response


# ── Secret / sudo ────────────────────────────────────────────────────


def secret_callback(
    env_var: str,
    prompt: str = "",
    timeout: int = 300,
    *,
    session_id: Optional[str] = None,
) -> str:
    """Prompt the user for a secret (API key, password); return the value.

    The UI is responsible for hiding the input.
    """
    sid = _resolve_sid(session_id)
    if not sid:
        logger.warning("secret_callback called without session context")
        return ""

    from .. import server

    return server._block(
        "secret.request",
        sid,
        {"env_var": env_var, "prompt": prompt},
        timeout=timeout,
    )


def sudo_callback(timeout: int = 300, *, session_id: Optional[str] = None) -> str:
    sid = _resolve_sid(session_id)
    if not sid:
        return ""

    from .. import server

    return server._block(
        "sudo.request",
        sid,
        {},
        timeout=timeout,
    )
