import asyncio

import pytest

from drsai.backend.runtime.mobile_core import (
    LifecycleState,
    LogicalSubagentScheduler,
    LogicalSubagentTask,
    SubagentStatus,
)


def test_two_children_run_in_parallel_one_can_be_cancelled_and_other_is_summarized() -> None:
    async def scenario() -> None:
        scheduler = LogicalSubagentScheduler()
        both_started = asyncio.Event()
        release = asyncio.Event()
        active = 0
        peak = 0

        async def runner(task: LogicalSubagentTask) -> str:
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            if active == 2:
                both_started.set()
            try:
                await release.wait()
                return f"result:{task.task_id}"
            finally:
                active -= 1

        pending = asyncio.create_task(
            scheduler.run(
                [LogicalSubagentTask("child-a", "research A"), LogicalSubagentTask("child-b", "research B")],
                runner,
            )
        )
        await asyncio.wait_for(both_started.wait(), timeout=1)
        assert scheduler.cancel("child-a") is True
        release.set()
        results = await pending

        assert peak == 2
        assert [result.status for result in results] == [SubagentStatus.CANCELLED, SubagentStatus.COMPLETED]
        assert LogicalSubagentScheduler.summarize(results).splitlines() == [
            "[child-a] cancelled: cancelled",
            "[child-b] completed: result:child-b",
        ]

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "lifecycle",
    [LifecycleState.BACKGROUND, LifecycleState.LOW_MEMORY, LifecycleState.THERMAL_LIMITED],
)
def test_constrained_lifecycle_reduces_parallelism_to_one(lifecycle: LifecycleState) -> None:
    async def scenario() -> None:
        scheduler = LogicalSubagentScheduler()
        active = 0
        peak = 0

        async def runner(task: LogicalSubagentTask) -> str:
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            await asyncio.sleep(0)
            active -= 1
            return task.task_id

        results = await scheduler.run(
            [LogicalSubagentTask("a", "A"), LogicalSubagentTask("b", "B")], runner, lifecycle=lifecycle,
        )
        assert peak == 1
        assert all(result.status is SubagentStatus.COMPLETED for result in results)

    asyncio.run(scenario())


def test_mobile_active_limit_is_fixed_at_three() -> None:
    async def runner(task: LogicalSubagentTask) -> str:
        return task.task_id

    with pytest.raises(ValueError, match="subagent_active_limit"):
        asyncio.run(
            LogicalSubagentScheduler().run(
                [LogicalSubagentTask(str(index), "task") for index in range(4)], runner,
            )
        )
