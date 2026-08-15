from __future__ import annotations

import asyncio
import time

import pytest

from drsai.backend.runtime.work_scheduler import BoundedWorkScheduler


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_scheduler_bounds_global_and_per_workspace_concurrency():
    scheduler = BoundedWorkScheduler(global_limit=2, per_key_limit=1, budget_seconds=1)
    active_global = active_a = peak_global = peak_a = 0
    release = asyncio.Event()

    async def job(key: str):
        nonlocal active_global, active_a, peak_global, peak_a
        async with scheduler.slot(key):
            active_global += 1
            if key == "a":
                active_a += 1
            peak_global = max(peak_global, active_global)
            peak_a = max(peak_a, active_a)
            await release.wait()
            active_global -= 1
            if key == "a":
                active_a -= 1

    tasks = [asyncio.create_task(job(key)) for key in ("a", "a", "b", "c")]
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    assert peak_global == 2
    assert peak_a == 1
    assert scheduler.snapshot()["queued"] == 2
    release.set()
    await asyncio.gather(*tasks)
    assert scheduler.snapshot() == {
        "queued": 0, "active": 0, "completed": 4, "cancelled": 0,
        "rejected": 0, "budget_seconds": 1.0,
    }


@pytest.mark.anyio
async def test_scheduler_cancellation_and_cpu_work_keep_event_loop_responsive():
    scheduler = BoundedWorkScheduler(global_limit=1, budget_seconds=1)
    holder = asyncio.Event()

    async def occupied():
        async with scheduler.slot("workspace"):
            await holder.wait()

    first = asyncio.create_task(occupied())
    await asyncio.sleep(0)
    waiting = asyncio.create_task(occupied())
    await asyncio.sleep(0)
    waiting.cancel()
    with pytest.raises(asyncio.CancelledError):
        await waiting

    ticks = 0
    running = True

    async def ticker():
        nonlocal ticks
        while running:
            ticks += 1
            await asyncio.sleep(0)

    ticker_task = asyncio.create_task(ticker())
    result = await scheduler.cpu(lambda: sum(range(2_000_000)))
    running = False
    await ticker_task
    assert result > 0 and ticks > 1
    holder.set()
    await first
    assert scheduler.snapshot()["cancelled"] == 1


@pytest.mark.anyio
async def test_scheduler_rejects_budget_exhaustion_without_leaking_slots():
    scheduler = BoundedWorkScheduler(global_limit=1, budget_seconds=0.1)
    async with scheduler.slot("held"):
        started = time.monotonic()
        with pytest.raises(TimeoutError):
            async with scheduler.slot("other"):
                raise AssertionError("unreachable")
        assert time.monotonic() - started < 0.5
        assert scheduler.snapshot()["active"] == 1
    snapshot = scheduler.snapshot()
    assert snapshot["active"] == 0 and snapshot["queued"] == 0 and snapshot["rejected"] == 1
