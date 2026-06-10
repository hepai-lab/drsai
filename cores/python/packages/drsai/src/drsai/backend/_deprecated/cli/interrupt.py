"""
DrSai TUI Interrupt Module - Ported from Hermes-agent.

Per-thread interrupt signaling for all tools.

This is critical for gateway mode where multiple agents run concurrently
in the same process — interrupting one agent should not kill tools running
in other sessions.

Usage in tools:
    from drsai.backend.cli.tui_tmp.interrupt import is_interrupted
    if is_interrupted():
        return {"output": "[interrupted]", "returncode": 130}
"""

from __future__ import annotations

import logging
import os
import threading
from typing import Optional

logger = logging.getLogger(__name__)

# Opt-in debug tracing
_DEBUG_INTERRUPT = bool(os.getenv("DURING_DEBUG_INTERRUPT"))

if _DEBUG_INTERRUPT:
    logger.setLevel(logging.INFO)

# Thread-safe set of interrupted thread IDs
_interrupted_threads: set[int] = set()
_lock = threading.Lock()


def set_interrupt(active: bool, thread_id: int | None = None) -> None:
    """Set or clear interrupt for a specific thread.

    Args:
        active: True to signal interrupt, False to clear it
        thread_id: Target thread ident. When None, targets current thread.
    """
    tid = thread_id if thread_id is not None else threading.current_thread().ident
    with _lock:
        if active:
            _interrupted_threads.add(tid)
        else:
            _interrupted_threads.discard(tid)
        _snapshot = set(_interrupted_threads) if _DEBUG_INTERRUPT else None

    if _DEBUG_INTERRUPT:
        logger.info(
            "[interrupt-debug] set_interrupt(active=%s, target_tid=%s) "
            "called_from_tid=%s current_set=%s",
            active, tid, threading.current_thread().ident, _snapshot,
        )


def is_interrupted() -> bool:
    """Check if an interrupt has been requested for the current thread.

    Safe to call from any thread — each thread only sees its own interrupt state.
    """
    tid = threading.current_thread().ident
    with _lock:
        return tid in _interrupted_threads


def clear_interrupt(thread_id: int | None = None) -> None:
    """Clear interrupt for a specific thread.

    Args:
        thread_id: Target thread ident. When None, targets current thread.
    """
    set_interrupt(False, thread_id)


def get_current_thread_id() -> int:
    """Get the current thread's identifier."""
    return threading.current_thread().ident


# =========================================================================
# Backward-compatible _interrupt_event proxy
# =========================================================================
# Some legacy call sites may import _interrupt_event directly and call
# .is_set() / .set() / .clear(). This shim maps those calls to the
# per-thread functions above.

class _ThreadAwareEventProxy:
    """Drop-in proxy that maps threading.Event methods to per-thread state."""

    def is_set(self) -> bool:
        return is_interrupted()

    def set(self) -> None:  # noqa: A003
        set_interrupt(True)

    def clear(self) -> None:
        set_interrupt(False)

    def wait(self, timeout: float | None = None) -> bool:
        """Not truly supported — returns current state immediately."""
        return self.is_set()


# Singleton proxy for backward compatibility
_interrupt_event = _ThreadAwareEventProxy()


# =========================================================================
# Context manager for interrupt scopes
# =========================================================================
class InterruptScope:
    """Context manager for temporary interrupt scopes.

    Usage:
        with InterruptScope():
            # Code that can be interrupted
            pass
        # Interrupt is automatically cleared when exiting
    """

    def __init__(self, thread_id: int | None = None):
        self._thread_id = thread_id or threading.current_thread().ident
        self._was_interrupted = False

    def __enter__(self) -> "InterruptScope":
        with _lock:
            self._was_interrupted = self._thread_id in _interrupted_threads
            if self._was_interrupted:
                _interrupted_threads.discard(self._thread_id)
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> bool:
        if self._was_interrupted:
            with _lock:
                _interrupted_threads.add(self._thread_id)
        return False


# =========================================================================
# Helper for tools to check and handle interrupts
# =========================================================================
def check_interrupt_and_wait(poll_interval: float = 0.1) -> bool:
    """Poll for interrupt and return True if interrupted.

    Args:
        poll_interval: Time between interrupt checks (seconds)

    Returns:
        True if interrupted, False if still running
    """
    while not is_interrupted():
        time.sleep(poll_interval)
    return True


import time  # noqa: E402


def interrupt_with_message(message: str, thread_id: int | None = None) -> None:
    """Set interrupt and log a message.

    Args:
        message: Message to log about the interrupt
        thread_id: Target thread ID
    """
    tid = thread_id if thread_id is not None else threading.current_thread().ident
    logger.info("[interrupt] %s (thread %d)", message, tid)
    set_interrupt(True, tid)
