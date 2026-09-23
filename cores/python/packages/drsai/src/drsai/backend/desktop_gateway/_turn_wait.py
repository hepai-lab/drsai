"""Bound waits without awaiting a provider's potentially unbounded cancellation."""

import asyncio
from collections.abc import Callable
from typing import Any


class TurnWaitTimeout(TimeoutError):
    def __init__(self, cancelled: bool):
        self.cancelled = cancelled
        super().__init__("cancel grace expired" if cancelled else "stream idle timeout")


async def wait_turn_event(
    task: asyncio.Task[Any],
    cancelled: Callable[[], bool],
    idle_timeout: float,
    cancel_grace: float,
    cancel_deadline: list[float | None],
) -> Any:
    """Cancellation deadline is shared across events, not reset by late output.

    On timeout the caller owns/quarantines the still-live task. asyncio.wait
    deliberately does not await cancellation acknowledgement like wait_for.
    A blocked event-loop thread still requires process-level supervision.
    """
    loop = asyncio.get_running_loop()
    idle_deadline = loop.time() + idle_timeout
    while True:
        now = loop.time()
        if cancelled() and cancel_deadline[0] is None:
            cancel_deadline[0] = now + cancel_grace
        deadline = min(idle_deadline, cancel_deadline[0] or idle_deadline)
        if now >= deadline:
            task.cancel()
            raise TurnWaitTimeout(cancel_deadline[0] is not None)
        done, _ = await asyncio.wait({task}, timeout=min(0.1, deadline - now))
        if done:
            return task.result()


async def wait_bounded(task: asyncio.Task[Any], timeout: float) -> Any:
    """Caller must retain and observe task after a timeout."""
    done, _ = await asyncio.wait({task}, timeout=timeout)
    if not done:
        task.cancel()
        raise TimeoutError("cleanup deadline expired")
    return task.result()
