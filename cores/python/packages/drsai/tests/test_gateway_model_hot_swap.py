"""Hot model swap in DesktopAgentManager: same-model policy changes must not rebuild the Agent."""
import asyncio
import unittest

from drsai.backend.desktop_gateway import _agent_manager as module


class _FakeClient:
    def __init__(self, name: str):
        self.name = name
        self.closed = False

    async def close(self):
        self.closed = True


class _HotSwappableAgent:
    """Minimal stand-in for DrSaiAgent with the switch_model surface."""

    def __init__(self, fail_on: set[str] | None = None):
        self._owns_model_client = True
        self._model_client = _FakeClient("old")
        self._fail_on = fail_on or set()
        self.switch_calls: list[str] = []
        self.closed = False
        # Mirrors the factory closure: build a fresh client per alias.
        self._set_model_client = self._make_client

    def _make_client(self, alias: str):
        if "set_fn" in self._fail_on:
            raise RuntimeError("config reload failed")
        return _FakeClient(alias)

    async def switch_model(self, new_client):
        if "switch" in self._fail_on:
            raise RuntimeError("sanitize failed")
        old = self._model_client
        self._model_client = new_client
        self.switch_calls.append(new_client.name)
        await old.close()

    async def close(self):
        self.closed = True


class ModelHotSwapTests(unittest.IsolatedAsyncioTestCase):
    def _manager_with_agent(self, agent, alias: str = "old-model"):
        manager = module.DesktopAgentManager()
        key = manager._key("u", "s")
        manager._agents[key] = agent
        manager._aliases[key] = alias
        return manager, key

    async def test_alias_change_hot_swaps_without_rebuild(self):
        agent = _HotSwappableAgent()
        manager, key = self._manager_with_agent(agent)

        builds = []

        async def fake_build(**kwargs):
            builds.append(kwargs)
            raise AssertionError("rebuild must not run for a hot-swappable agent")

        manager._build_agent = fake_build
        result = await manager.get_or_create("s", "u", model_provider="p", model_id="new-model")

        self.assertIs(result, agent)
        self.assertEqual(builds, [])
        self.assertEqual(agent.switch_calls, ["p/new-model"])
        self.assertEqual(manager._aliases[key], "p/new-model")
        self.assertIs(manager._agents[key], agent)
        self.assertFalse(agent.closed)
        await manager.close()

    async def test_same_alias_fast_path_does_not_swap(self):
        agent = _HotSwappableAgent()
        manager, key = self._manager_with_agent(agent, alias="p/m")
        result = await manager.get_or_create("s", "u", model_provider="p", model_id="m")
        self.assertIs(result, agent)
        self.assertEqual(agent.switch_calls, [])
        await manager.close()

    async def test_swap_failure_falls_back_to_rebuild(self):
        agent = _HotSwappableAgent(fail_on={"switch"})
        manager, key = self._manager_with_agent(agent)

        replacement = _HotSwappableAgent()

        async def fake_build(**kwargs):
            return replacement

        manager._build_agent = fake_build
        result = await manager.get_or_create("s", "u", model_provider="p", model_id="new-model")

        self.assertIs(result, replacement)
        self.assertIs(manager._agents[key], replacement)
        self.assertEqual(manager._aliases[key], "p/new-model")
        # The failed-swap Agent was superseded: its turn cancelled and close()
        # handed to a bounded background task.
        self.assertTrue(manager._closing_tasks)
        await asyncio.gather(*manager._closing_tasks, return_exceptions=True)
        self.assertTrue(agent.closed)
        await manager.close()

    async def test_agent_without_switch_surface_rebuilds(self):
        class PlainAgent:
            async def close(self):
                pass

        manager, key = self._manager_with_agent(PlainAgent())
        replacement = PlainAgent()

        async def fake_build(**kwargs):
            return replacement

        manager._build_agent = fake_build
        result = await manager.get_or_create("s", "u", model_provider="p", model_id="new-model")
        self.assertIs(result, replacement)
        await manager.close()

    async def test_completed_quarantine_does_not_block_hot_swap(self):
        """A finished leftover quarantine is popped at entry; the swap proceeds."""
        agent = _HotSwappableAgent()
        manager, key = self._manager_with_agent(agent)
        # Entry pops only *finished* quarantines; a finished leftover must not
        # turn into "session_recovering" and must not affect the swap.
        loop = asyncio.get_running_loop()
        leftover = loop.create_future()
        leftover.set_result(None)
        manager._quarantined_tasks[key] = leftover

        result = await manager.get_or_create("s", "u", model_provider="p", model_id="new-model")

        self.assertIs(result, agent)
        self.assertEqual(agent.switch_calls, ["p/new-model"])
        self.assertNotIn(key, manager._quarantined_tasks)
        await manager.close()


if __name__ == "__main__":
    unittest.main()
