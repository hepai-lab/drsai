"""
DrSai TUI Callbacks Module - Ported from Hermes-agent.

Interactive prompt callbacks for terminal_tool integration.

These bridge terminal_tool's interactive prompts (clarify, approval, secret)
into the event loop. Each function coordinates with the TUI for interactive
user input.

Features:
- clarify_callback: Interactive selection for clarifying questions
- approval_callback: Dangerous command approval (once/session/always/deny)
- prompt_for_secret: Secure API key / password input

State architecture (per the implementation plan):
  - approval_state and clarify_state live on the DrSaiTUIState singleton.
    approval_callback / clarify_callback write to it; TUI keybindings
    read from it and put() the user's response into the embedded queue.
  - Secret state stays on the legacy CallbackState so we don't have to
    touch the secret-flow implementation.
"""

from __future__ import annotations

import getpass
import queue
import threading
import time as _time
from typing import TYPE_CHECKING, Any, Callable

from drsai.backend.cli.state import (
    ApprovalState,
    ClarifyState,
    DrSaiTUIState,
    SecretState,
    get_tui_state,
)

if TYPE_CHECKING:
    from drsai.backend.cli.prompt import DrSaiPrompt

# ---------------------------------------------------------------------------
# ANSI helpers
# ---------------------------------------------------------------------------

_DIM = "\033[2m"
_RESET = "\033[0m"


def cprint(text: str, **kwargs) -> None:
    """Print with ANSI colours if available."""
    try:
        print(f"{kwargs.get('color', '')}{text}{_RESET}", **kwargs)
    except Exception:
        print(text, **kwargs)


# =========================================================================
# Legacy CallbackState (still used for secrets only)
# =========================================================================


class CallbackState:
    """Container for secret-prompt state only.

    Clarify and approval state have moved to DrSaiTUIState (see state.py).
    """

    __slots__ = (
        "_secret_state",
        "_secret_deadline",
    )

    def __init__(self) -> None:
        self._secret_state: dict | None = None
        self._secret_deadline: float = 0.0

    def reset_all(self) -> None:
        self._secret_state = None
        self._secret_deadline = 0.0


_callback_state = CallbackState()


def get_callback_state() -> CallbackState:
    """Return the legacy CallbackState (used for secret prompts only)."""
    return _callback_state


# =========================================================================
# Approval Callback
# =========================================================================

def approval_callback(
    prompt_func: Callable[[], Any] | None = None,
    command: str = "",
    description: str = "",
    choices: list[str] | None = None,
    timeout: float = 120,
) -> str:
    """Prompt the user to approve (or deny) a potentially dangerous command.

    Writes an ApprovalState object to the TUI singleton and blocks until
    the TUI keybinding puts a response into the embedded queue.

    Args:
        prompt_func: Optional TUI prompt function (for rich TUI mode).
        command: The command string to display.
        description: Human-readable description of what the command does.
        choices: Approval choices (e.g. ["approve", "deny"]).
        timeout: Seconds to wait before auto-denying (default 120).

    Returns:
        One of the strings in ``choices`` (typically "approve" or "deny").
    """
    if choices is None:
        choices = ["approve", "deny"]

    response_queue: queue.Queue[ str ] = queue.Queue()
    deadline = _time.monotonic() + timeout

    # Publish state so the TUI render loop and keybindings can see it.
    tui_state = get_tui_state()
    tui_state.approval_state = ApprovalState(
        command=command,
        description=description,
        choices=list(choices),          # copy so the dict stays stable
        deadline=deadline,
        response_queue=response_queue,
    )

    if prompt_func:
        return _approval_with_tui(prompt_func, response_queue, deadline)

    return _approval_terminal(command, description, choices, deadline)


def _approval_with_tui(
    prompt_func: Callable,
    response_queue: queue.Queue[ str ],
    deadline: float,
) -> str:
    """Block until the user responds (TUI integration)."""
    if hasattr(prompt_func, "__self__"):
        app = getattr(prompt_func.__self__, "_app", None)
        if app:
            app.invalidate()

    while True:
        try:
            response = response_queue.get(timeout=1.0)
            _clear_approval_state()
            return response
        except queue.Empty:
            if _time.monotonic() > deadline:
                break
            if hasattr(prompt_func, "__self__"):
                app = getattr(prompt_func.__self__, "_app", None)
                if app:
                    app.invalidate()

    _clear_approval_state()
    cprint(
        f"\n{_DIM}(approval timed out after {deadline} s — denying){_RESET}"
    )
    return "deny"


def _approval_terminal(
    command: str,
    description: str,
    choices: list[str],
    deadline: float,
) -> str:
    """Fallback: plain terminal read for approval."""
    print()
    if description:
        print(f"  {description}")
    print(f"  Command: {command[:100]}{'...' if len(command) > 100 else ''}")
    print()
    print("  Approve this command?")
    for i, choice in enumerate(choices):
        if choice != "view":
            print(f"    {i+1}. {choice}")
    print()

    try:
        val = input(f"  Enter choice [1-{len(choices)}]: ").strip()
        if val:
            idx = int(val) - 1
            if 0 <= idx < len(choices):
                choice = choices[idx]
                if choice == "view":
                    print(f"\n  Full command:\n  {command}\n")
                    return _approval_terminal(
                        command, description, choices, deadline
                    )
                return choice
    except (ValueError, KeyboardInterrupt, EOFError):
        pass

    return "deny"


def _clear_approval_state() -> None:
    tui_state = get_tui_state()
    tui_state.approval_state = None


def submit_approval_response(response: str) -> None:
    """Called by TUI keybindings to deliver the user's approval choice."""
    tui_state = get_tui_state()
    if tui_state.approval_state is not None:
        tui_state.approval_state.response_queue.put_nowait(response)
        tui_state.approval_state = None


# =========================================================================
# Clarify Callback
# =========================================================================

def clarify_callback(
    prompt_func: Callable[[], Any] | None = None,
    question: str = "",
    choices: list[str] | None = None,
    timeout: float = 120,
) -> str:
    """Prompt the user with a question and optional choices.

    Writes a ClarifyState object to the TUI singleton and blocks until
    the TUI keybinding puts a response into the embedded queue.

    Args:
        prompt_func: Optional TUI prompt function (for rich TUI mode).
        question: The question to ask the user.
        choices: List of choice strings, or None for free-text input.
        timeout: Seconds to wait before returning a default (default 120).

    Returns:
        The selected choice (string) or a "use best judgement" fallback.
    """
    response_queue: queue.Queue[ str ] = queue.Queue()
    deadline = _time.monotonic() + timeout
    is_freetext = not choices

    tui_state = get_tui_state()
    tui_state.clarify_state = ClarifyState(
        question=question,
        choices=list(choices) if not is_freetext else [],
        is_freetext=is_freetext,
        deadline=deadline,
        response_queue=response_queue,
    )

    if prompt_func:
        return _clarify_with_tui(prompt_func, response_queue, deadline)

    return _clarify_terminal(question, choices, deadline)


def _clarify_with_tui(
    prompt_func: Callable,
    response_queue: queue.Queue[ str ],
    deadline: float,
) -> str:
    """Block until the user responds (TUI integration)."""
    if hasattr(prompt_func, "__self__"):
        app = getattr(prompt_func.__self__, "_app", None)
        if app:
            app.invalidate()

    while True:
        try:
            response = response_queue.get(timeout=1.0)
            _clear_clarify_state()
            return response
        except queue.Empty:
            if _time.monotonic() > deadline:
                break
            if hasattr(prompt_func, "__self__"):
                app = getattr(prompt_func.__self__, "_app", None)
                if app:
                    app.invalidate()

    _clear_clarify_state()
    cprint(
        f"\n{_DIM}(clarify timed out after {deadline} s — agent will decide){_RESET}"
    )
    return (
        "The user did not provide a response within the time limit. "
        "Use your best judgement to make the choice and proceed."
    )


def _clarify_terminal(
    question: str,
    choices: list[str] | None,
    deadline: float,
) -> str:
    """Fallback: plain terminal read for clarify."""
    _ = deadline  # unused in terminal mode
    print()
    print(f"  {question}")

    if choices:
        for i, choice in enumerate(choices, 1):
            print(f"    {i}. {choice}")
        print()

        try:
            val = input(f"  Enter choice [1-{len(choices)}]: ").strip()
            if val:
                idx = int(val) - 1
                if 0 <= idx < len(choices):
                    return choices[idx]
        except (ValueError, KeyboardInterrupt, EOFError):
            pass
    else:
        try:
            val = input("  Enter response: ").strip()
            if val:
                return val
        except (KeyboardInterrupt, EOFError):
            pass

    return (
        "The user did not provide a response. "
        "Use your best judgement to make the choice and proceed."
    )


def _clear_clarify_state() -> None:
    tui_state = get_tui_state()
    tui_state.clarify_state = None


def submit_clarify_response(response: str) -> None:
    """Called by TUI keybindings to deliver the user's clarify choice."""
    tui_state = get_tui_state()
    if tui_state.clarify_state is not None:
        tui_state.clarify_state.response_queue.put_nowait(response)
        tui_state.clarify_state = None


# =========================================================================
# Secret Prompt Callback  (still uses CallbackState — no TUI integration yet)
# =========================================================================

def prompt_for_secret(
    prompt_func: Callable[[], Any] | None = None,
    var_name: str = "",
    prompt: str = "",
    metadata: dict | None = None,
    timeout: float = 120,
) -> dict:
    """Prompt for a secret value (e.g. API keys).

    Returns a dict with keys: success, stored_as, validated, skipped, message.
    The secret is stored securely and never exposed to the model.

    Args:
        prompt_func: Optional TUI prompt function (not yet wired).
        var_name: Variable name to store the secret under.
        prompt: Prompt message to display.
        metadata: Optional metadata about the secret.
        timeout: Timeout in seconds.

    Returns:
        Result dict as described above.
    """
    state = _callback_state

    if not prompt_func:
        try:
            value = getpass.getpass(f"{prompt} (ESC or empty Enter to skip): ")
        except (EOFError, KeyboardInterrupt):
            value = ""

        if not value:
            cprint(f"\n{_DIM}  ⏭ Secret entry skipped{_RESET}")
            return {
                "success": True,
                "reason": "cancelled",
                "stored_as": var_name,
                "validated": False,
                "skipped": True,
                "message": "Secret setup was skipped.",
            }

        return _store_secret(var_name, value)

    return _secret_with_tui(prompt_func, state, var_name, prompt, metadata, timeout)


def _secret_with_tui(
    prompt_func: Callable,
    state: CallbackState,
    var_name: str,
    prompt: str,
    metadata: dict | None,
    timeout: float,
) -> dict:
    """Handle secret prompt with TUI integration (legacy path)."""
    response_queue = queue.Queue()

    state._secret_state = {
        "var_name": var_name,
        "prompt": prompt,
        "metadata": metadata or {},
        "response_queue": response_queue,
    }
    state._secret_deadline = _time.monotonic() + timeout

    if hasattr(prompt_func, "__self__"):
        app = getattr(prompt_func.__self__, "_app", None)
        if app:
            try:
                app.current_buffer.reset()
            except Exception:
                pass
            app.invalidate()

    while True:
        try:
            value = response_queue.get(timeout=1.0)
            state._secret_state = None
            state._secret_deadline = 0.0

            if not value:
                cprint(f"\n{_DIM}  ⏭ Secret entry skipped{_RESET}")
                return {
                    "success": True,
                    "reason": "cancelled",
                    "stored_as": var_name,
                    "validated": False,
                    "skipped": True,
                    "message": "Secret setup was skipped.",
                }

            return _store_secret(var_name, value)
        except queue.Empty:
            if _time.monotonic() > state._secret_deadline:
                break
            if hasattr(prompt_func, "__self__"):
                app = getattr(prompt_func.__self__, "_app", None)
                if app:
                    app.invalidate()

    state._secret_state = None
    state._secret_deadline = 0.0
    cprint(f"\n{_DIM}  ⏭ Secret entry timed out{_RESET}")
    return {
        "success": False,
        "reason": "timeout",
        "stored_as": var_name,
        "validated": False,
        "skipped": False,
        "message": "Secret entry timed out.",
    }


def submit_secret_response(value: str) -> None:
    """Called by TUI event handler to submit a secret value."""
    state = _callback_state
    if state._secret_state:
        response_queue = state._secret_state.get("response_queue")
        if response_queue:
            response_queue.put(value)
        state._secret_state = None


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _store_secret(var_name: str, value: str) -> dict:
    """Store the secret value and return a result dict.

    Stub: replace with the real storage backend (keyring / env, etc.).
    """
    import os
    import tempfile

    # Minimal stub: write to a per-user file accessible only to the owner.
    # In production this would be keyring or a proper secrets manager.
    secret_dir = os.path.expanduser("~/.config/drsai/secrets")
    os.makedirs(secret_dir, mode=0o700, exist_ok=True)
    secret_file = os.path.join(secret_dir, f"{var_name}.env")
    with open(secret_file, "w") as fh:
        fh.write(f"{var_name}={value}\n")
    os.chmod(secret_file, 0o600)

    return {
        "success": True,
        "reason": "stored",
        "stored_as": var_name,
        "validated": True,
        "skipped": False,
        "message": f"Secret stored as ${var_name}.",
    }
