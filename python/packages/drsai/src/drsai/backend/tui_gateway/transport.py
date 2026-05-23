"""Transport abstraction for the DrSai TUI gateway.

Ported from ``hermes-agent/tui_gateway/transport.py``. Decouples the I/O sink
from RPC handler logic so the same dispatcher can be driven over stdio
(``drsai.backend.tui_gateway.entry``) or WebSocket (``ws.py``).

A :class:`Transport` accepts a JSON-serialisable dict and forwards it to its
peer. The active transport for the current request is tracked in a
:class:`contextvars.ContextVar` so handlers — including those dispatched onto
the worker pool — route their writes to the right peer.

Backward compatibility: ``server.write_json`` still works without any transport
bound. When nothing is on the contextvar and no session-level transport is
found, it falls back to the module-level stdio transport.
"""

from __future__ import annotations

import contextvars
import errno
import json
import logging
import os
import threading
from typing import Any, Callable, Optional, Protocol, runtime_checkable

# Errno values that mean "the peer is gone" rather than "the host has a
# real I/O problem". Anything outside this set re-raises so it surfaces
# in the crash log instead of looking like a clean disconnect.
_PEER_GONE_ERRNOS = frozenset({
    errno.EPIPE,        # write to closed pipe (POSIX)
    errno.ECONNRESET,   # peer reset the connection
    errno.EBADF,        # fd closed under us
    errno.ESHUTDOWN,    # transport endpoint shut down
    getattr(errno, "WSAECONNRESET", -1),  # win32 mapping (no-op on POSIX)
    getattr(errno, "WSAESHUTDOWN", -1),
} - {-1})

logger = logging.getLogger(__name__)

# When true, StdioTransport does not call ``stream.flush`` after writing.
# Useful when a half-closed pipe makes flush block long enough to starve
# the worker pool. Default off so the existing flush-after-write behaviour
# is unchanged. Requires PYTHONUNBUFFERED=1 or ``python -u`` to work right.
_DISABLE_FLUSH = (os.environ.get("DRSAI_TUI_GATEWAY_NO_FLUSH", "") or "").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}


@runtime_checkable
class Transport(Protocol):
    """Minimal interface every transport implements."""

    def write(self, obj: dict) -> bool:
        """Emit one JSON frame. Return ``False`` when the peer is gone."""

    def close(self) -> None:
        """Release any resources owned by this transport."""


_current_transport: contextvars.ContextVar[Optional[Transport]] = (
    contextvars.ContextVar("drsai_gateway_transport", default=None)
)


def current_transport() -> Optional[Transport]:
    """Return the transport bound for the current request, if any."""
    return _current_transport.get()


def bind_transport(transport: Optional[Transport]):
    """Bind *transport* for the current context. Returns a reset token."""
    return _current_transport.set(transport)


def reset_transport(token) -> None:
    """Restore the transport binding captured by :func:`bind_transport`."""
    _current_transport.reset(token)


class StdioTransport:
    """Writes JSON frames to a stream (usually ``sys.stdout``).

    The stream is resolved via a callable so runtime monkey-patches of the
    underlying stream continue to work — used by the test suite.
    """

    __slots__ = ("_stream_getter", "_lock")

    def __init__(self, stream_getter: Callable[[], Any], lock: threading.Lock) -> None:
        self._stream_getter = stream_getter
        self._lock = lock

    def write(self, obj: dict) -> bool:
        """Return ``True`` on success, ``False`` ONLY when the peer is gone.

        Returning ``False`` is the dispatcher's "broken stdout pipe" signal.
        Programming errors (non-JSON payload, encoding misconfig, ENOSPC) MUST
        re-raise so the crash log captures them instead of silently exiting.
        """
        # Serialization outside the lock so a large payload can't block
        # other threads emitting their own frames. ``default=str`` coerces
        # PosixPath / dataclasses / datetime etc to strings rather than
        # exploding the entire response — drsai's agent metadata frequently
        # contains Path objects. Anything still unserialisable (cycles, raw
        # bytes) re-raises so the crash log captures it.
        try:
            line = json.dumps(obj, ensure_ascii=False, default=str) + "\n"
        except TypeError as exc:
            # Last-resort: emit a stub error frame so the UI sees *something*.
            logger.error("StdioTransport: payload not JSON-serialisable: %s", exc)
            line = json.dumps({
                "jsonrpc": "2.0",
                "id": obj.get("id"),
                "error": {"code": -32603, "message": f"serialization error: {exc}"},
            }) + "\n"

        with self._lock:
            stream = self._stream_getter()
            try:
                stream.write(line)
            except BrokenPipeError:
                return False
            except ValueError as e:
                if isinstance(e, UnicodeEncodeError) or "closed file" not in str(e):
                    raise
                return False
            except OSError as e:
                if e.errno not in _PEER_GONE_ERRNOS:
                    raise
                logger.debug("StdioTransport write peer gone: %s", e)
                return False

            if not _DISABLE_FLUSH:
                try:
                    stream.flush()
                except BrokenPipeError:
                    return False
                except ValueError as e:
                    if isinstance(e, UnicodeEncodeError) or "closed file" not in str(e):
                        raise
                    return False
                except OSError as e:
                    if e.errno not in _PEER_GONE_ERRNOS:
                        raise
                    logger.debug("StdioTransport flush peer gone: %s", e)
                    return False

        return True

    def close(self) -> None:
        return None


class TeeTransport:
    """Mirrors writes to one primary plus N best-effort secondaries.

    The primary's return value (and exceptions) determine the result —
    secondaries swallow failures so a wedged sidecar never stalls the main
    IO path.
    """

    __slots__ = ("_primary", "_secondaries")

    def __init__(self, primary: "Transport", *secondaries: "Transport") -> None:
        self._primary = primary
        self._secondaries = secondaries

    def write(self, obj: dict) -> bool:
        ok = self._primary.write(obj)
        for sec in self._secondaries:
            try:
                sec.write(obj)
            except Exception:
                pass
        return ok

    def close(self) -> None:
        try:
            self._primary.close()
        finally:
            for sec in self._secondaries:
                try:
                    sec.close()
                except Exception:
                    pass
