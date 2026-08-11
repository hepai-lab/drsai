"""Backend-neutral FIFO coordinator for one active Turn per Session binding."""

from __future__ import annotations

import asyncio
from collections import deque
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import AsyncIterator, Callable

from drsai.backend.runtime.agent import RuntimeExecutionError


@dataclass(slots=True)
class _Waiter:
    run_id: str
    future: asyncio.Future[None]
    request_bytes: int = 0


@dataclass(slots=True)
class _SessionState:
    active_run_id: str | None = None
    waiters: deque[_Waiter] = field(default_factory=deque)
    queued_bytes: int = 0


class SessionTurnCoordinator:
    """Serialize Turns by authoritative backend Session id with FIFO cleanup."""

    def __init__(self, *, max_queue_per_session: int = 32, max_queue_bytes_per_session: int = 2 * 1024 * 1024) -> None:
        self.max_queue_per_session = max(1, max_queue_per_session)
        self.max_queue_bytes_per_session = max(1, max_queue_bytes_per_session)
        self._states: dict[str, _SessionState] = {}
        self._guard = asyncio.Lock()

    @asynccontextmanager
    async def turn(
        self,
        session_id: str,
        run_id: str,
        *,
        request_bytes: int = 0,
        on_queued: Callable[[int], None] | None = None,
        on_resumed: Callable[[], None] | None = None,
    ) -> AsyncIterator[None]:
        if not session_id or not run_id:
            raise ValueError("session_id and run_id are required")
        waiter: _Waiter | None = None
        async with self._guard:
            state = self._states.setdefault(session_id, _SessionState())
            identities = {value.run_id for value in state.waiters}
            if state.active_run_id == run_id or run_id in identities:
                raise RuntimeExecutionError(
                    "turn_run_already_scheduled",
                    "This Run is already active or queued for the current task.",
                )
            if state.active_run_id is None:
                state.active_run_id = run_id
            else:
                request_bytes = max(0, int(request_bytes))
                if (len(state.waiters) >= self.max_queue_per_session
                        or state.queued_bytes + request_bytes > self.max_queue_bytes_per_session):
                    raise RuntimeExecutionError(
                        "turn_queue_full",
                        "This task has too many queued messages. Wait or cancel a queued message.",
                        retryable=True,
                        detail={"maximum_queue_length": self.max_queue_per_session,
                                "maximum_queue_bytes": self.max_queue_bytes_per_session},
                    )
                waiter = _Waiter(run_id, asyncio.get_running_loop().create_future(), request_bytes)
                state.waiters.append(waiter)
                state.queued_bytes += request_bytes
                if on_queued:
                    on_queued(len(state.waiters))
        if waiter is not None:
            try:
                await waiter.future
            except BaseException:
                await self._remove_waiter(session_id, waiter)
                raise
            if on_resumed:
                on_resumed()
        try:
            yield
        finally:
            await self._release(session_id, run_id)

    async def _remove_waiter(self, session_id: str, waiter: _Waiter) -> None:
        async with self._guard:
            state = self._states.get(session_id)
            if state is None:
                return
            try:
                state.waiters.remove(waiter)
                state.queued_bytes = max(0, state.queued_bytes - waiter.request_bytes)
            except ValueError:
                pass
            self._prune(session_id, state)

    async def _release(self, session_id: str, run_id: str) -> None:
        async with self._guard:
            state = self._states.get(session_id)
            if state is None or state.active_run_id != run_id:
                return
            state.active_run_id = None
            while state.waiters:
                next_waiter = state.waiters.popleft()
                state.queued_bytes = max(0, state.queued_bytes - next_waiter.request_bytes)
                if next_waiter.future.cancelled():
                    continue
                state.active_run_id = next_waiter.run_id
                next_waiter.future.set_result(None)
                break
            self._prune(session_id, state)

    def _prune(self, session_id: str, state: _SessionState) -> None:
        if state.active_run_id is None and not state.waiters:
            self._states.pop(session_id, None)

    def diagnostics(self) -> dict[str, int]:
        return {
            "sessions": len(self._states),
            "active_turns": sum(1 for state in self._states.values() if state.active_run_id),
            "queued_turns": sum(len(state.waiters) for state in self._states.values()),
            "queued_bytes": sum(state.queued_bytes for state in self._states.values()),
            "maximum_queue_per_session": self.max_queue_per_session,
            "maximum_queue_bytes_per_session": self.max_queue_bytes_per_session,
        }


@dataclass(slots=True)
class _LockEntry:
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    references: int = 0


class EntityLockRegistry:
    """Reference-counted keyed locks that disappear after the last owner/waiter."""

    def __init__(self) -> None:
        self._entries: dict[str, _LockEntry] = {}
        self._guard = asyncio.Lock()

    @asynccontextmanager
    async def hold(self, key: str) -> AsyncIterator[None]:
        async with self._guard:
            entry = self._entries.setdefault(key, _LockEntry())
            entry.references += 1
        try:
            async with entry.lock:
                yield
        finally:
            async with self._guard:
                entry.references -= 1
                if entry.references == 0 and not entry.lock.locked():
                    self._entries.pop(key, None)

    def diagnostics(self) -> dict[str, int]:
        return {"entity_locks": len(self._entries),
                "entity_lock_references": sum(entry.references for entry in self._entries.values())}
