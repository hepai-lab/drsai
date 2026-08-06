"""Single idempotent cleanup owner for every Codex Run exit."""

from __future__ import annotations

import asyncio
import time
from collections import OrderedDict
from typing import Any, Callable, Iterable, Mapping

from drsai.backend.codex_adapter.event_mapper import CodexEventMapper
from drsai.backend.runtime.agent import AgentExecutionServices, RuntimeRunContext


class CodexRunFinalizer:
    def __init__(self, mapper: CodexEventMapper, *, max_reports: int = 256):
        self.mapper = mapper
        self.max_reports = max(16, max_reports)
        self._reports: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self._locks: dict[str, asyncio.Lock] = {}

    async def finalize(
        self,
        context: RuntimeRunContext,
        services: AgentExecutionServices,
        *,
        outcome: str,
        backend_turn_id: str,
        flush_policy: str,
        tasks: Iterable[asyncio.Task[Any]] = (),
        unsubscribe: Iterable[Callable[[], None]] = (),
        approval_bridge: Any | None = None,
        release: Callable[[], None] | None = None,
    ) -> Mapping[str, Any]:
        lock = self._locks.setdefault(context.run_id, asyncio.Lock())
        async with lock:
            return await self._finalize_once(
                context, services, outcome=outcome, backend_turn_id=backend_turn_id,
                flush_policy=flush_policy, tasks=tasks, unsubscribe=unsubscribe,
                approval_bridge=approval_bridge, release=release,
            )

    async def _finalize_once(
        self,
        context: RuntimeRunContext,
        services: AgentExecutionServices,
        *,
        outcome: str,
        backend_turn_id: str,
        flush_policy: str,
        tasks: Iterable[asyncio.Task[Any]] = (),
        unsubscribe: Iterable[Callable[[], None]] = (),
        approval_bridge: Any | None = None,
        release: Callable[[], None] | None = None,
    ) -> Mapping[str, Any]:
        existing = self._reports.get(context.run_id)
        if existing is not None:
            return dict(existing)
        started = time.monotonic()
        cleanup_errors: list[str] = []
        for callback in unsubscribe:
            try:
                callback()
            except Exception as error:  # cleanup must continue to convergence
                cleanup_errors.append(type(error).__name__[:120])
        pending = list(tasks)
        for task in pending:
            task.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)
        if approval_bridge is not None:
            try:
                await approval_bridge.cancel_run(context.run_id)
            except Exception as error:
                cleanup_errors.append(type(error).__name__[:120])
        try:
            self.mapper.finalize_run(
                context,
                services,
                backend_turn_id=backend_turn_id,
                flush_policy=flush_policy,
            )
        except Exception as error:
            cleanup_errors.append(type(error).__name__[:120])
        if release is not None:
            try:
                release()
            except Exception as error:
                cleanup_errors.append(type(error).__name__[:120])
        diagnostics = self.mapper.diagnostics_snapshot()
        report = {
            "outcome": str(outcome)[:80],
            "flush_policy": flush_policy,
            "cancelled_tasks": len(pending),
            "cleanup_errors": tuple(cleanup_errors),
            "active_delta_buffers": diagnostics["active_delta_buffers"],
            "active_message_runs": diagnostics["active_message_runs"],
            "decoder_state": diagnostics["decoder_state"],
            "duration_ms": round((time.monotonic() - started) * 1000, 3),
            "content_redacted": True,
        }
        self._reports[context.run_id] = report
        self._reports.move_to_end(context.run_id)
        while len(self._reports) > self.max_reports:
            evicted_run_id, _ = self._reports.popitem(last=False)
            evicted_lock = self._locks.get(evicted_run_id)
            if evicted_lock is not None and not evicted_lock.locked():
                self._locks.pop(evicted_run_id, None)
        return dict(report)

    def diagnostics(self) -> Mapping[str, Any]:
        return {
            "retained_reports": len(self._reports),
            "max_reports": self.max_reports,
            "reports": {run_id: dict(report) for run_id, report in self._reports.items()},
            "content_redacted": True,
        }
