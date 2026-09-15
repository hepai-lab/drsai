"""Caching and rebuild behaviour of the Desktop Agent manager.

Regression coverage for a hang where one Agent rebuild froze every session:

* ``get_or_create`` ran inside a single process-wide lock *and* awaited
  ``previous.close()`` there **without a timeout**, so a slow or stuck model
  client blocked the gateway: the spinner never stopped, other sessions were
  frozen too, and ``/v1/runtime/shutdown`` could not return.
* ``evict_user`` / ``evict_all`` (skill and tool toggles) held the same lock
  across ``close()``.

The fix keeps the global lock for cache bookkeeping only, moves Agent
construction and close out of it, and bounds every wait.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from drsai.backend.desktop_gateway import _agent_manager as manager_module
from drsai.backend.desktop_gateway._agent_manager import DesktopAgentManager
from drsai.backend.runtime.agent import RuntimeExecutionError

pytestmark = pytest.mark.asyncio


class FakeCancellationToken:
    def __init__(self) -> None:
        self.cancelled = False

    def cancel(self) -> None:
        self.cancelled = True


class FakeAgent:
    """Stands in for a DrSaiAssistant; only the surface the manager touches."""

    def __init__(self, *, close_delay: float = 0.0) -> None:
        self._cancellation_token = FakeCancellationToken()
        self.close_delay = close_delay
        self.closed = False
        self.loaded_state: dict[str, Any] | None = None
        self.create_kwargs: dict[str, Any] = {}

    async def close(self) -> None:
        if self.close_delay:
            await asyncio.sleep(self.close_delay)
        self.closed = True

    async def load_state(self, state: dict[str, Any]) -> None:
        self.loaded_state = state


class BuildSpy:
    """Records what ``create_agent`` was called with and how close behaves."""

    def __init__(self) -> None:
        self.created: list[FakeAgent] = []
        self.close_delay = 0.0


@pytest.fixture
def manager(monkeypatch: pytest.MonkeyPatch) -> tuple[DesktopAgentManager, BuildSpy]:
    spy = BuildSpy()
    monkeypatch.setattr(manager_module, "_database", lambda: object())

    def fake_create_agent(**kwargs: Any) -> FakeAgent:
        agent = FakeAgent(close_delay=spy.close_delay)
        agent.create_kwargs = kwargs
        spy.created.append(agent)
        return agent

    monkeypatch.setattr(manager_module, "create_agent", fake_create_agent)

    instance = DesktopAgentManager()

    async def no_state(session_id: str, user_id: str) -> None:
        return None

    async def no_thread(session_id: str, user_id: str, work_dir: str | None) -> None:
        return None

    monkeypatch.setattr(instance, "_load_state", no_state)
    monkeypatch.setattr(instance, "_ensure_thread", no_thread)
    return instance, spy


async def drain_closes(mgr: DesktopAgentManager) -> None:
    """Wait for the detached ``close()`` tasks the manager keeps referenced."""
    for _ in range(50):
        pending = set(mgr._closing_tasks)
        if not pending:
            return
        await asyncio.gather(*pending, return_exceptions=True)
    raise AssertionError("detached close() tasks did not settle")


async def test_same_alias_reuses_the_cached_agent(
    manager: tuple[DesktopAgentManager, BuildSpy],
) -> None:
    mgr, spy = manager

    first = await mgr.get_or_create("s1", "u1", model_alias="m1")
    second = await mgr.get_or_create("s1", "u1", model_alias="m1")

    assert first is second
    assert len(spy.created) == 1


async def test_alias_change_rebuilds_and_supersedes_the_previous_agent(
    manager: tuple[DesktopAgentManager, BuildSpy],
) -> None:
    mgr, spy = manager

    first = await mgr.get_or_create("s1", "u1", model_alias="m1")
    second = await mgr.get_or_create("s1", "u1", model_alias="m2")

    assert second is not first
    assert len(spy.created) == 2
    await drain_closes(mgr)
    # The old Agent is stopped at once and then closed in the background.
    assert first._cancellation_token.cancelled is True
    assert first.closed is True
    assert mgr._agents["u1::s1"] is second


async def test_structured_provider_and_model_id_drive_the_alias(
    manager: tuple[DesktopAgentManager, BuildSpy],
) -> None:
    mgr, spy = manager

    await mgr.get_or_create("s1", "u1", model_provider="hepai", model_id="m1")
    await mgr.get_or_create("s1", "u1", model_provider="hepai", model_id="m1")

    assert len(spy.created) == 1
    assert spy.created[0].create_kwargs["defult_config_name"] == "hepai/m1"
    assert spy.created[0].create_kwargs["model_provider"] == "hepai"


async def test_stuck_previous_close_does_not_block_the_rebuild(
    manager: tuple[DesktopAgentManager, BuildSpy],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mgr, spy = manager
    monkeypatch.setattr(manager_module, "_AGENT_CLOSE_TIMEOUT_SECONDS", 0.05)

    spy.close_delay = 30.0  # closing the old Agent hangs
    first = await mgr.get_or_create("s1", "u1", model_alias="m1")

    spy.close_delay = 0.0  # the replacement Agent is healthy
    second = await asyncio.wait_for(
        mgr.get_or_create("s1", "u1", model_alias="m2"), timeout=2
    )

    assert second is not first
    assert mgr._agents["u1::s1"] is second
    await drain_closes(mgr)
    # Abandoned after the bound instead of being awaited forever.
    assert first.closed is False


async def test_slow_rebuild_does_not_block_other_sessions(
    manager: tuple[DesktopAgentManager, BuildSpy],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mgr, _spy = manager
    cached = await mgr.get_or_create("s-hit", "u1", model_alias="m1")

    gate = asyncio.Event()

    async def slow_create_agent(**kwargs: Any) -> FakeAgent:
        await gate.wait()
        return FakeAgent()

    monkeypatch.setattr(manager_module, "create_agent", slow_create_agent)

    rebuild = asyncio.create_task(mgr.get_or_create("s-miss", "u1", model_alias="m1"))
    await asyncio.sleep(0.01)  # let the rebuild take the lock

    assert not rebuild.done()
    served = await asyncio.wait_for(
        mgr.get_or_create("s-hit", "u1", model_alias="m1"), timeout=0.2
    )
    assert served is cached

    gate.set()
    await asyncio.wait_for(rebuild, timeout=1)
    assert mgr._agents["u1::s-hit"] is cached


async def test_slow_build_surfaces_a_retryable_error(
    manager: tuple[DesktopAgentManager, BuildSpy],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mgr, _spy = manager
    monkeypatch.setattr(manager_module, "_AGENT_CREATE_TIMEOUT_SECONDS", 0.05)

    async def hanging_create_agent(**kwargs: Any) -> FakeAgent:
        await asyncio.sleep(30)

    monkeypatch.setattr(manager_module, "create_agent", hanging_create_agent)

    with pytest.raises(RuntimeExecutionError) as excinfo:
        await mgr.get_or_create("s1", "u1", model_alias="m1")

    assert excinfo.value.code == "agent_create_timeout"
    assert excinfo.value.retryable is True
    # A failed build must not leave a half-initialised Agent in the cache.
    assert mgr._agents == {}
    assert mgr._aliases == {}
    assert not mgr._rebuild_lock.locked()


async def test_rebuild_lock_wait_is_bounded(
    manager: tuple[DesktopAgentManager, BuildSpy],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mgr, _spy = manager
    monkeypatch.setattr(manager_module, "_AGENT_REBUILD_WAIT_TIMEOUT_SECONDS", 0.05)

    await mgr._rebuild_lock.acquire()  # simulate another session mid-rebuild
    try:
        with pytest.raises(RuntimeExecutionError) as excinfo:
            await mgr.get_or_create("s1", "u1", model_alias="m1")
        assert excinfo.value.code == "agent_rebuild_busy"
        assert excinfo.value.retryable is True
    finally:
        mgr._rebuild_lock.release()


async def test_evict_user_does_not_block_on_a_stuck_close(
    manager: tuple[DesktopAgentManager, BuildSpy],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mgr, spy = manager
    monkeypatch.setattr(manager_module, "_AGENT_CLOSE_TIMEOUT_SECONDS", 0.05)

    spy.close_delay = 30.0
    agent = await mgr.get_or_create("s1", "u1", model_alias="m1")
    await mgr.get_or_create("s2", "u1", model_alias="m1")

    await asyncio.wait_for(mgr.evict_user("u1"), timeout=2)

    assert mgr._agents == {}
    assert mgr._aliases == {}
    await drain_closes(mgr)
    assert agent.closed is False


async def test_shutdown_close_is_bounded_when_an_agent_hangs(
    manager: tuple[DesktopAgentManager, BuildSpy],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mgr, spy = manager
    monkeypatch.setattr(manager_module, "_AGENT_CLOSE_TIMEOUT_SECONDS", 0.05)

    spy.close_delay = 30.0
    await mgr.get_or_create("s1", "u1", model_alias="m1")
    await mgr.get_or_create("s2", "u2", model_alias="m1")

    # Teardown used to await every Agent's close() sequentially and unbounded,
    # so a stuck model client made /v1/runtime/shutdown never return.
    await asyncio.wait_for(mgr.close(), timeout=2)

    assert mgr._agents == {}
    assert mgr._aliases == {}


async def test_evict_all_clears_every_user(
    manager: tuple[DesktopAgentManager, BuildSpy],
) -> None:
    mgr, spy = manager

    await mgr.get_or_create("s1", "u1", model_alias="m1")
    await mgr.get_or_create("s1", "u2", model_alias="m1")

    await mgr.evict_all()

    assert mgr._agents == {}
    assert mgr._aliases == {}
    await drain_closes(mgr)
    assert all(agent.closed for agent in spy.created)
