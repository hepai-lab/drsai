"""Bounded logical-subagent scheduling for constrained mobile hosts."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from enum import StrEnum
import hashlib
import json
from typing import Awaitable, Callable, Sequence

from .ports import LifecycleState


class SubagentStatus(StrEnum):
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    FAILED = "failed"


SUBAGENT_SCHEDULING_POLICY_VERSION = "p9-subagent-scheduling-v1"
SUBAGENT_MAX_ACTIVE = 3
SUBAGENT_FOREGROUND_MAX_PARALLEL = 2


def build_subagent_scheduling_policy(
    lifecycle: LifecycleState | str,
    *,
    advertised_max_active: int | None = None,
    advertised_max_parallel: int | None = None,
) -> dict[str, object]:
    """Return the canonical, host-verifiable mobile scheduling decision."""

    state = lifecycle if isinstance(lifecycle, LifecycleState) else LifecycleState(str(lifecycle))
    expected_parallel = SUBAGENT_FOREGROUND_MAX_PARALLEL if state is LifecycleState.FOREGROUND else 1
    if advertised_max_active is not None and advertised_max_active != SUBAGENT_MAX_ACTIVE:
        raise ValueError("subagent_max_active_mismatch")
    if advertised_max_parallel is not None and advertised_max_parallel != expected_parallel:
        raise ValueError("subagent_max_parallel_mismatch")
    value: dict[str, object] = {
        "policy_version": SUBAGENT_SCHEDULING_POLICY_VERSION,
        "lifecycle_state": state.value,
        "max_active": SUBAGENT_MAX_ACTIVE,
        "max_parallel": expected_parallel,
        "mode": "parallel" if expected_parallel == 2 else "serial",
    }
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    value["sha256"] = hashlib.sha256(encoded).hexdigest()
    return value


@dataclass(frozen=True, slots=True)
class LogicalSubagentTask:
    task_id: str
    prompt: str

    def __post_init__(self) -> None:
        if not self.task_id or len(self.task_id) > 128:
            raise ValueError("subagent_task_id_invalid")
        if not self.prompt or len(self.prompt) > 16_384:
            raise ValueError("subagent_prompt_invalid")


@dataclass(frozen=True, slots=True)
class LogicalSubagentResult:
    task_id: str
    status: SubagentStatus
    content: str = ""
    error_code: str | None = None


SubagentRunner = Callable[[LogicalSubagentTask], Awaitable[str]]


class LogicalSubagentScheduler:
    """Runs at most three logical children, with mobile-aware parallelism."""

    def __init__(self, *, max_active: int = 3, max_parallel: int = 2) -> None:
        if max_active != 3 or max_parallel != 2:
            raise ValueError("mobile_subagent_limits_fixed")
        self._max_active = max_active
        self._max_parallel = max_parallel
        self._running: dict[str, asyncio.Task[str]] = {}
        self._cancel_requested: set[str] = set()

    def cancel(self, task_id: str) -> bool:
        self._cancel_requested.add(task_id)
        running = self._running.get(task_id)
        if running is not None:
            running.cancel()
            return True
        return False

    async def run(
        self,
        tasks: Sequence[LogicalSubagentTask],
        runner: SubagentRunner,
        *,
        lifecycle: LifecycleState = LifecycleState.FOREGROUND,
    ) -> tuple[LogicalSubagentResult, ...]:
        if len(tasks) > self._max_active:
            raise ValueError("subagent_active_limit")
        if len({task.task_id for task in tasks}) != len(tasks):
            raise ValueError("subagent_task_duplicate")
        policy = build_subagent_scheduling_policy(lifecycle)
        parallel = int(policy["max_parallel"])
        semaphore = asyncio.Semaphore(parallel)

        async def execute(task: LogicalSubagentTask) -> LogicalSubagentResult:
            if task.task_id in self._cancel_requested:
                return LogicalSubagentResult(task.task_id, SubagentStatus.CANCELLED)
            try:
                async with semaphore:
                    if task.task_id in self._cancel_requested:
                        return LogicalSubagentResult(task.task_id, SubagentStatus.CANCELLED)
                    running = asyncio.create_task(runner(task), name=f"mobile-subagent:{task.task_id}")
                    self._running[task.task_id] = running
                    content = await running
                    return LogicalSubagentResult(task.task_id, SubagentStatus.COMPLETED, content)
            except asyncio.CancelledError:
                return LogicalSubagentResult(task.task_id, SubagentStatus.CANCELLED)
            except Exception as error:
                return LogicalSubagentResult(task.task_id, SubagentStatus.FAILED, error_code=type(error).__name__)
            finally:
                self._running.pop(task.task_id, None)

        try:
            results = await asyncio.gather(*(execute(task) for task in tasks))
        except asyncio.CancelledError:
            for running in tuple(self._running.values()):
                running.cancel()
            await asyncio.gather(*tuple(self._running.values()), return_exceptions=True)
            raise
        finally:
            self._cancel_requested.difference_update(task.task_id for task in tasks)
        return tuple(results)

    @staticmethod
    def summarize(results: Sequence[LogicalSubagentResult]) -> str:
        return "\n".join(
            f"[{result.task_id}] {result.status.value}: "
            f"{result.content if result.status is SubagentStatus.COMPLETED else result.error_code or result.status.value}"
            for result in results
        )
