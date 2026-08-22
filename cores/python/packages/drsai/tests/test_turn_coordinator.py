from __future__ import annotations

import asyncio

import pytest

from drsai.backend.runtime.agent import RuntimeExecutionError
from drsai.backend.runtime.turn_coordinator import SessionTurnCoordinator


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_one_hundred_turns_are_fifo_and_never_overlap_per_session() -> None:
    coordinator = SessionTurnCoordinator(max_queue_per_session=100)
    active = 0
    maximum = 0
    order: list[int] = []

    async def run(index: int) -> None:
        nonlocal active, maximum
        async with coordinator.turn("backend-thread", f"run-{index}"):
            active += 1
            maximum = max(maximum, active)
            order.append(index)
            await asyncio.sleep(0)
            active -= 1

    await asyncio.gather(*(run(index) for index in range(100)))
    assert maximum == 1
    assert order == list(range(100))
    assert coordinator.diagnostics() == {
        "sessions": 0, "active_turns": 0, "queued_turns": 0, "queued_bytes": 0,
        "maximum_queue_per_session": 100, "maximum_queue_bytes_per_session": 2 * 1024 * 1024,
    }


@pytest.mark.anyio
async def test_different_sessions_run_in_parallel_and_cancelled_waiter_is_removed() -> None:
    coordinator = SessionTurnCoordinator(max_queue_per_session=4)
    both_active = asyncio.Event()
    release = asyncio.Event()
    active_sessions: set[str] = set()

    async def hold(session_id: str, run_id: str) -> None:
        async with coordinator.turn(session_id, run_id):
            active_sessions.add(session_id)
            if len(active_sessions) == 2:
                both_active.set()
            await release.wait()
            active_sessions.remove(session_id)

    first = asyncio.create_task(hold("one", "one-active"))
    second = asyncio.create_task(hold("two", "two-active"))
    await asyncio.wait_for(both_active.wait(), timeout=1)
    queued = asyncio.create_task(hold("one", "one-cancelled"))
    await asyncio.sleep(0)
    assert coordinator.diagnostics()["queued_turns"] == 1
    queued.cancel()
    with pytest.raises(asyncio.CancelledError):
        await queued
    assert coordinator.diagnostics()["queued_turns"] == 0
    release.set()
    await asyncio.gather(first, second)
    assert coordinator.diagnostics()["sessions"] == 0


@pytest.mark.anyio
async def test_duplicate_and_queue_limit_fail_explicitly() -> None:
    coordinator = SessionTurnCoordinator(max_queue_per_session=1)
    release = asyncio.Event()

    async def hold(run_id: str) -> None:
        async with coordinator.turn("thread", run_id):
            await release.wait()

    active = asyncio.create_task(hold("active"))
    await asyncio.sleep(0)
    with pytest.raises(RuntimeExecutionError, match="already active"):
        async with coordinator.turn("thread", "active"):
            pass
    queued = asyncio.create_task(hold("queued"))
    await asyncio.sleep(0)
    with pytest.raises(RuntimeExecutionError) as caught:
        async with coordinator.turn("thread", "overflow"):
            pass
    assert caught.value.code == "turn_queue_full"
    queued.cancel()
    with pytest.raises(asyncio.CancelledError):
        await queued
    release.set()
    await active


@pytest.mark.anyio
async def test_queue_position_and_resume_callbacks_are_exactly_once() -> None:
    coordinator = SessionTurnCoordinator()
    release = asyncio.Event()
    observations: list[tuple[str, int | None]] = []

    async def active() -> None:
        async with coordinator.turn("thread", "active"):
            await release.wait()

    first = asyncio.create_task(active())
    await asyncio.sleep(0)

    async def queued() -> None:
        async with coordinator.turn(
            "thread", "queued",
            on_queued=lambda position: observations.append(("queued", position)),
            on_resumed=lambda: observations.append(("resumed", None)),
        ):
            observations.append(("active", None))

    second = asyncio.create_task(queued())
    await asyncio.sleep(0)
    release.set()
    await asyncio.gather(first, second)
    assert observations == [("queued", 1), ("resumed", None), ("active", None)]


@pytest.mark.anyio
async def test_queue_byte_budget_rejects_before_retaining_large_requests() -> None:
    coordinator = SessionTurnCoordinator(max_queue_per_session=10, max_queue_bytes_per_session=8)
    release = asyncio.Event()

    async def active() -> None:
        async with coordinator.turn("thread", "active"):
            await release.wait()

    task = asyncio.create_task(active())
    await asyncio.sleep(0)
    queued = asyncio.create_task(coordinator.turn("thread", "queued", request_bytes=8).__aenter__())
    await asyncio.sleep(0)
    assert coordinator.diagnostics()["queued_bytes"] == 8
    with pytest.raises(RuntimeExecutionError) as caught:
        async with coordinator.turn("thread", "overflow", request_bytes=1):
            pass
    assert caught.value.code == "turn_queue_full"
    assert coordinator.diagnostics()["queued_bytes"] == 8
    queued.cancel()
    with pytest.raises(asyncio.CancelledError):
        await queued
    release.set()
    await task


@pytest.mark.anyio
async def test_entity_locks_are_reclaimed_after_ten_thousand_keys() -> None:
    from drsai.backend.runtime.turn_coordinator import EntityLockRegistry

    registry = EntityLockRegistry()
    for index in range(10_000):
        async with registry.hold(f"entity-{index}"):
            assert registry.diagnostics()["entity_locks"] == 1
    assert registry.diagnostics() == {"entity_locks": 0, "entity_lock_references": 0}
