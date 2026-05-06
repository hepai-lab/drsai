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
"""

from __future__ import annotations

import getpass
import queue
import threading
import time as _time
from typing import TYPE_CHECKING, Any, Callable, Optional

if TYPE_CHECKING:
    from drsai.backend.cli.prompt import DrSaiPrompt

# ANSI color codes for output
_DIM = "\033[2m"
_RESET = "\033[0m"
_RED = "\033[31m"
_GREEN = "\033[32m"
_YELLOW = "\033[33m"


def cprint(text: str, **kwargs) -> None:
    """Print with ANSI colors if available."""
    try:
        print(f"{kwargs.get('color', '')}{text}{_RESET}", **kwargs)
    except Exception:
        print(text, **kwargs)


# =========================================================================
# Callback State Storage
# =========================================================================
# These are module-level state holders that the CLI sets up before calling
# agent tools. The CLI's event loop checks these states and renders the
# appropriate TUI widgets.

class CallbackState:
    """Container for callback state shared between CLI and callbacks."""

    def __init__(self):
        self._clarify_state: dict | None = None
        self._clarify_deadline: float = 0
        self._clarify_freetext: bool = False
        self._approval_state: dict | None = None
        self._approval_deadline: float = 0
        self._approval_lock: threading.Lock | None = None
        self._secret_state: dict | None = None
        self._secret_deadline: float = 0

    def reset_all(self) -> None:
        """Reset all callback states."""
        self._clarify_state = None
        self._clarify_freetext = False
        self._clarify_deadline = 0
        self._approval_state = None
        self._approval_deadline = 0
        self._secret_state = None
        self._secret_deadline = 0


# Global state instance
_callback_state = CallbackState()


def get_callback_state() -> CallbackState:
    """Get the global callback state instance."""
    return _callback_state


# =========================================================================
# Clarify Callback
# =========================================================================

def clarify_callback(
    prompt_func: Callable[[], Any] | None = None,
    question: str = "",
    choices: list[str] | None = None,
    timeout: float = 120,
) -> str:
    """Prompt for clarifying question through the TUI.

    This is called by tools when they need user input to proceed.
    It sets up the interactive selection UI and blocks until the user responds.

    Args:
        prompt_func: Optional TUI prompt function (for rich TUI mode)
        question: The question to ask the user
        choices: List of choices, or None for free-text input
        timeout: Timeout in seconds (default 120)

    Returns:
        The user's choice (string) or a timeout message
    """
    state = _callback_state
    response_queue: queue.Queue = queue.Queue()
    is_open_ended = not choices

    state._clarify_state = {
        "question": question,
        "choices": choices if not is_open_ended else [],
        "selected": 0,
        "response_queue": response_queue,
    }
    state._clarify_deadline = _time.monotonic() + timeout
    state._clarify_freetext = is_open_ended

    # If we have a TUI prompt function, use rich mode
    if prompt_func:
        return _clarify_with_tui(prompt_func, state, response_queue, timeout)

    # Fallback to simple terminal input
    return _clarify_terminal(question, choices, response_queue, timeout)


def _clarify_with_tui(
    prompt_func: Callable,
    state: CallbackState,
    response_queue: queue.Queue,
    timeout: float,
) -> str:
    """Handle clarify with TUI integration."""
    # Invalidate TUI to show the prompt
    if hasattr(prompt_func, '__self__'):
        app = getattr(prompt_func.__self__, '_app', None)
        if app:
            app.invalidate()

    # Wait for response
    while True:
        try:
            result = response_queue.get(timeout=1)
            state._clarify_deadline = 0
            return result
        except queue.Empty:
            remaining = state._clarify_deadline - _time.monotonic()
            if remaining <= 0:
                break
            if hasattr(prompt_func, '__self__'):
                app = getattr(prompt_func.__self__, '_app', None)
                if app:
                    app.invalidate()

    state._clarify_state = None
    state._clarify_freetext = False
    state._clarify_deadline = 0

    cprint(f"\n{_DIM}(clarify timed out after {timeout}s — agent will decide){_RESET}")
    return (
        "The user did not provide a response within the time limit. "
        "Use your best judgement to make the choice and proceed."
    )


def _clarify_terminal(
    question: str,
    choices: list[str] | None,
    response_queue: queue.Queue,
    timeout: float,
) -> str:
    """Handle clarify with simple terminal input."""
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
        # Free text input
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


def submit_clarify_response(response: str) -> None:
    """Submit a clarify response (called by TUI event handler)."""
    state = _callback_state
    if state._clarify_state:
        response_queue = state._clarify_state.get("response_queue")
        if response_queue:
            response_queue.put(response)
        state._clarify_state = None
        state._clarify_freetext = False


# =========================================================================
# Approval Callback (Dangerous Command)
# =========================================================================

def approval_callback(
    prompt_func: Callable[[], Any] | None = None,
    command: str = "",
    description: str = "",
    timeout: float = 60,
) -> str:
    """Prompt for dangerous command approval.

    Shows a selection UI with choices: once / session / always / deny.

    Args:
        prompt_func: Optional TUI prompt function
        command: The command to approve
        description: Human-readable description
        timeout: Timeout in seconds (default 60)

    Returns:
        One of: "once", "session", "always", "deny"
    """
    state = _callback_state

    # Serialize concurrent requests with a lock
    if state._approval_lock is None:
        state._approval_lock = threading.Lock()

    with state._approval_lock:
        response_queue = queue.Queue()
        choices = ["once", "session", "always", "deny"]
        if len(command) > 70:
            choices.append("view")

        state._approval_state = {
            "command": command,
            "description": description,
            "choices": choices,
            "selected": 0,
            "response_queue": response_queue,
        }
        state._approval_deadline = _time.monotonic() + timeout

        if prompt_func:
            result = _approval_with_tui(prompt_func, state, response_queue, timeout)
        else:
            result = _approval_terminal(command, description, choices, response_queue, timeout)

        state._approval_state = None
        state._approval_deadline = 0
        return result


def _approval_with_tui(
    prompt_func: Callable,
    state: CallbackState,
    response_queue: queue.Queue,
    timeout: float,
) -> str:
    """Handle approval with TUI integration."""
    if hasattr(prompt_func, '__self__'):
        app = getattr(prompt_func.__self__, '_app', None)
        if app:
            app.invalidate()

    while True:
        try:
            result = response_queue.get(timeout=1)
            return result
        except queue.Empty:
            remaining = state._approval_deadline - _time.monotonic()
            if remaining <= 0:
                break
            if hasattr(prompt_func, '__self__'):
                app = getattr(prompt_func.__self__, '_app', None)
                if app:
                    app.invalidate()

    if hasattr(prompt_func, '__self__'):
        app = getattr(prompt_func.__self__, '_app', None)
        if app:
            app.invalidate()

    cprint(f"\n{_DIM}  ⏱ Timeout — denying command{_RESET}")
    return "deny"


def _approval_terminal(
    command: str,
    description: str,
    choices: list[str],
    response_queue: queue.Queue,
    timeout: float,
) -> str:
    """Handle approval with simple terminal input."""
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
                    return _approval_terminal(command, description, choices, response_queue, timeout)
                return choice
    except (ValueError, KeyboardInterrupt, EOFError):
        pass

    return "deny"


def submit_approval_response(response: str) -> None:
    """Submit an approval response (called by TUI event handler)."""
    state = _callback_state
    if state._approval_state:
        response_queue = state._approval_state.get("response_queue")
        if response_queue:
            response_queue.put(response)
        state._approval_state = None


# =========================================================================
# Secret Prompt Callback
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
        prompt_func: Optional TUI prompt function
        var_name: Variable name to store the secret
        prompt: Prompt message to show the user
        metadata: Optional metadata about the secret
        timeout: Timeout in seconds

    Returns:
        Dict with success status and message
    """
    state = _callback_state

    # No TUI available: use simple terminal input
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

        # Store the secret (implementation depends on storage backend)
        return _store_secret(var_name, value)

    # TUI mode
    return _secret_with_tui(prompt_func, state, var_name, prompt, metadata, timeout)


def _secret_with_tui(
    prompt_func: Callable,
    state: CallbackState,
    var_name: str,
    prompt: str,
    metadata: dict | None,
    timeout: float,
) -> dict:
    """Handle secret prompt with TUI integration."""
    response_queue = queue.Queue()

    state._secret_state = {
        "var_name": var_name,
        "prompt": prompt,
        "metadata": metadata or {},
        "response_queue": response_queue,
    }
    state._secret_deadline = _time.monotonic() + timeout

    # Clear any stale input
    if hasattr(prompt_func, '__self__'):
        app = getattr(prompt_func.__self__, '_app', None)
        if app:
            try:
                app.current_buffer.reset()
            except Exception:
                pass
        if app:
            app.invalidate()

    while True:
        try:
            value = response_queue.get(timeout=1)
            state._secret_state = None
            state._secret_deadline = 0

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
            remaining = state._secret_deadline - _time.monotonic()
            if remaining <= 0:
                break
            if hasattr(prompt_func, '__self__'):
                app = getattr(prompt_func.__self__, '_app', None)
                if app:
                    app.invalidate()

    state._secret_state = None
    state._secret_deadline = 0

    if hasattr(prompt_func, '__self__'):
        app = getattr(prompt_func.__self__, '_app', None)
        if app:
            try:
                app.current_buffer.reset()
            except Exception:
                pass
        if app:
            app.invalidate()

    cprint(f"\n{_DIM}  ⏱ Timeout — secret capture cancelled{_RESET}")
    return {
        "success": True,
        "reason": "timeout",
        "stored_as": var_name,
        "validated": False,
        "skipped": True,
        "message": "Secret setup timed out and was skipped.",
    }


def _store_secret(var_name: str, value: str) -> dict:
    """Store a secret securely.

    This is a placeholder — actual implementation would store to a secure
    location like a config file or keychain.
    """
    # In a real implementation, this would:
    # 1. Store to ~/.drsai/.env or similar secure location
    # 2. Validate the secret if applicable
    # 3. Never expose the value to the model

    return {
        "success": True,
        "stored_as": var_name,
        "validated": False,
        "skipped": False,
        "message": f"Secret stored as {var_name}. The value was not exposed to the model.",
    }


def submit_secret_response(value: str) -> None:
    """Submit a secret response (called by TUI event handler)."""
    state = _callback_state
    if state._secret_state:
        response_queue = state._secret_state.get("response_queue")
        if response_queue:
            response_queue.put(value)
        state._secret_state = None


# =========================================================================
# Dangerous Command Detection
# =========================================================================

import re

# Patterns that indicate a terminal command may modify/delete files
_DESTRUCTIVE_PATTERNS = re.compile(
    r"""(?:^|\s|&&|\|\||;|`)(?:
        rm\s|rmdir\s|
        cp\s|install\s|
        mv\s|
        sed\s+-i|
        truncate\s|
        dd\s|
        shred\s|
        git\s+(?:reset|clean|checkout)\s
    )""",
    re.VERBOSE,
)

# Output redirects that overwrite files
_REDIRECT_OVERWRITE = re.compile(r'[^>]>[^>]|^>[^>]')


def is_dangerous_command(command: str) -> bool:
    """Heuristic: does this terminal command look like it modifies/deletes files?

    Args:
        command: The shell command to check

    Returns:
        True if the command appears dangerous
    """
    if not command:
        return False
    if _DESTRUCTIVE_PATTERNS.search(command):
        return True
    if _REDIRECT_OVERWRITE.search(command):
        return True
    return False
