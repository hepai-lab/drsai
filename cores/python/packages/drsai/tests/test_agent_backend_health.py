from __future__ import annotations

import asyncio

import drsai.backend.runtime.agent as agent_module
from drsai.backend.runtime.agent import AgentBackendRouter


class _HealthBackend:
    def __init__(self, backend_id: str, behavior: str) -> None:
        self.backend_id = backend_id
        self.behavior = behavior

    async def health(self):
        if self.behavior == "slow":
            await asyncio.sleep(60)
        if self.behavior == "error":
            raise RuntimeError("must-not-cross-diagnostic-boundary")
        return {"backend_id": self.backend_id, "available": True, "reason": None}


def test_backend_health_is_concurrent_and_timeout_isolated(monkeypatch) -> None:
    monkeypatch.setattr(agent_module, "_AGENT_BACKEND_HEALTH_TIMEOUT_SECONDS", 0.01)
    rows = asyncio.run(AgentBackendRouter({
        "opendrsai": _HealthBackend("opendrsai", "healthy"),
        "optional": _HealthBackend("optional", "slow"),
    }).health())

    assert rows["opendrsai"]["available"] is True
    assert rows["optional"] == {
        "backend_id": "optional",
        "available": False,
        "reason": "health_timeout",
    }


def test_backend_health_exception_is_redacted_and_isolated() -> None:
    rows = asyncio.run(AgentBackendRouter({
        "opendrsai": _HealthBackend("opendrsai", "healthy"),
        "optional": _HealthBackend("optional", "error"),
    }).health())

    assert rows["opendrsai"]["available"] is True
    assert rows["optional"] == {
        "backend_id": "optional",
        "available": False,
        "reason": "health_check_failed",
    }
    assert "must-not-cross" not in repr(rows)
