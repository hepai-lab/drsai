"""Live per-session SSE subscriber tracking.

The gateway keeps detached ``execute()`` tasks running past the HTTP request
that started them (``routes/runs.py``). That is the right design for a stream
consumer, but it means a run whose only watcher is gone — the desktop window
closed, the renderer OOM-crashed mid-turn — keeps burning the turn lock and
model tokens forever. The turn-loop idle bound in ``_agent_manager`` covers a
*silent* stream; this module covers a *silent room*: it answers "does anyone
still listen to this session?" so the orphan-run reaper can cancel runs nobody
will ever read.

Counting is per-process and single-event-loop; plain dict mutation is atomic
enough and needs no lock.
"""

from __future__ import annotations

import time
from typing import Dict

# session_id -> live SSE connection count
_counts: Dict[str, int] = {}
# session_id -> monotonic time when the count last dropped to zero
_idle_since: Dict[str, float] = {}


def enter(session_id: str) -> None:
    """Register one live subscriber for the session."""
    _counts[session_id] = _counts.get(session_id, 0) + 1
    _idle_since.pop(session_id, None)


def leave(session_id: str) -> None:
    """Drop one subscriber; record when the session became unwatched."""
    count = _counts.get(session_id, 0) - 1
    if count > 0:
        _counts[session_id] = count
        return
    _counts.pop(session_id, None)
    _idle_since.setdefault(session_id, time.monotonic())


def has_watchers(session_id: str) -> bool:
    return _counts.get(session_id, 0) > 0


def unwatched_seconds(session_id: str) -> float | None:
    """Seconds since the last subscriber left, or None if never watched.

    A session that never had a subscriber returns ``None`` so callers can apply
    their own policy (e.g. fall back to the run's own age) instead of treating
    "never watched" as "watched forever".
    """
    since = _idle_since.get(session_id)
    return None if since is None else time.monotonic() - since


def snapshot() -> dict[str, int]:
    """Diagnostics view: live subscriber counts per session."""
    return dict(_counts)
