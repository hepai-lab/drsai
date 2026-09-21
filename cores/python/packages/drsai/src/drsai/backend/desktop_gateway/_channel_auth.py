"""Process-memory platform-auth broker for long-lived channel workers.

A channel worker (the WeChat polling task) is created once and lives for the
lifetime of the process, so it cannot inherit the per-request task-local auth
scope that ``_auth.install`` establishes.  The middleware hands the verified
context here on every authenticated request, and the channel bridge re-installs
it around each Agent Run.

Only the **verified** ``PlatformAuthContext`` is kept, in process memory.  The
raw bearer token never leaves the middleware, and nothing is persisted, so a
gateway restart simply means the newest authenticated request re-primes this.
"""

from __future__ import annotations

from drsai.platform_auth import PlatformAuthContext

_context: PlatformAuthContext | None = None


def capture(context: PlatformAuthContext | None) -> None:
    """Remember the newest verified context; ``None`` is ignored, not stored."""
    global _context
    if context is not None:
        _context = context


def current() -> PlatformAuthContext | None:
    """Return the newest verified context, or ``None`` before any request."""
    return _context


def reset() -> None:
    """Drop the captured context (tests, and logout of a paired instance)."""
    global _context
    _context = None
