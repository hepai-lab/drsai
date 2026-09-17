"""Bounded background work plane for history and discovery operations."""

from __future__ import annotations

import asyncio
import time
from collections import defaultdict
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Awaitable, Callable, TypeVar


T = TypeVar("T")


class BoundedWorkScheduler:
    """Limits low-priority work without delaying the Runtime control plane."""

    def __init__(self, *, global_limit: int = 2, per_key_limit: int = 1, budget_seconds: float = 30.0):
        self._global = asyncio.Semaphore(max(1, global_limit))
        self._per_key_limit = max(1, per_key_limit)
        self._per_key: dict[str, asyncio.Semaphore] = defaultdict(
            lambda: asyncio.Semaphore(self._per_key_limit)
        )
        self.budget_seconds = max(0.1, float(budget_seconds))
        self.queued = 0
        self.active = 0
        self.completed = 0
        self.cancelled = 0
        self.rejected = 0

    @asynccontextmanager
    async def slot(self, key: str, *, budget_seconds: float | None = None) -> AsyncIterator[float]:
        budget = self.budget_seconds if budget_seconds is None else max(0.1, budget_seconds)
        deadline = time.monotonic() + budget
        self.queued += 1
        acquired_global = acquired_key = False
        entered_active = False
        try:
            async with asyncio.timeout(max(0.001, deadline - time.monotonic())):
                await self._per_key[key].acquire()
                acquired_key = True
                await self._global.acquire()
                acquired_global = True
            self.queued -= 1
            self.active += 1
            entered_active = True
            yield deadline
            self.completed += 1
        except asyncio.CancelledError:
            self.cancelled += 1
            raise
        except TimeoutError:
            self.rejected += 1
            raise
        finally:
            if entered_active:
                self.active -= 1
            elif self.queued:
                self.queued -= 1
            if acquired_key:
                self._per_key[key].release()
            if acquired_global:
                self._global.release()

    async def cpu(self, operation: Callable[..., T], *args: Any) -> T:
        return await asyncio.to_thread(operation, *args)

    @staticmethod
    def checkpoint(deadline: float) -> None:
        if time.monotonic() > deadline:
            raise TimeoutError("background_work_budget_exhausted")

    def snapshot(self) -> dict[str, int | float]:
        return {
            "queued": self.queued, "active": self.active, "completed": self.completed,
            "cancelled": self.cancelled, "rejected": self.rejected,
            "budget_seconds": self.budget_seconds,
        }
