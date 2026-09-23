"""Exercise the real manager loop with fake providers and no database/network."""
import asyncio
import unittest
from unittest.mock import patch

from drsai.backend.desktop_gateway import _agent_manager as module


class RecoveryTests(unittest.IsolatedAsyncioTestCase):
    async def test_stuck_stream_is_quarantined_and_lock_released(self):
        manager = module.DesktopAgentManager()
        release = asyncio.Event()
        statuses = []
        saved = []

        class Agent:
            async def run_stream(self, **kwargs):
                while not release.is_set():
                    try:
                        await release.wait()
                    except asyncio.CancelledError:
                        continue
                yield "late"

            async def close(self):
                pass

        agent = Agent()
        key = manager._key("u", "s")
        manager._agents[key] = agent
        manager._aliases[key] = module.DEFAULT_CONFIG_NAME

        async def status(*args):
            statuses.append(args[-1])

        async def save(*args):
            saved.append(args)

        manager._set_status = status
        manager._save_state = save
        with patch.object(module, "effective_user_id", lambda value: value), patch.object(module, "_AGENT_TURN_IDLE_TIMEOUT_SECONDS", .02):
            with self.assertRaisesRegex(Exception, "stream idle timeout"):
                async for _ in manager.run_stream("test", session_id="s", user_id="u"):
                    self.fail("Late output must not be forwarded")
            self.assertFalse(manager._locks[key].locked())
            self.assertNotIn(key, manager._agents)
            self.assertEqual(statuses[-1], module.RunStatus.STOPPED)
            self.assertEqual(saved, [])
            with self.assertRaisesRegex(Exception, "previous execution"):
                await manager.get_or_create("s", "u")
            release.set()
            await manager._quarantined_tasks[key]
            await asyncio.sleep(.01)
        await manager.close()

    async def test_state_capture_timeout_does_not_commit_late_state(self):
        manager = module.DesktopAgentManager()
        release = asyncio.Event()
        saved = []

        class Agent:
            async def run_stream(self, **kwargs):
                yield "answer"

            async def save_state(self):
                while not release.is_set():
                    try:
                        await release.wait()
                    except asyncio.CancelledError:
                        continue
                return {"late": True}

            async def close(self):
                pass

        key = manager._key("u", "s")
        manager._agents[key] = Agent()
        manager._aliases[key] = module.DEFAULT_CONFIG_NAME

        async def status(*args):
            pass

        async def save(*args):
            saved.append(args)

        manager._set_status = status
        manager._save_state = save
        with patch.object(module, "effective_user_id", lambda value: value), patch.object(module, "_AGENT_CLOSE_TIMEOUT_SECONDS", .02):
            events = [event async for event in manager.run_stream("test", session_id="s", user_id="u")]
            self.assertEqual(events, ["answer"])
            self.assertFalse(manager._locks[key].locked())
            self.assertNotIn(key, manager._agents)
            release.set()
            await manager._quarantined_tasks[key]
            await asyncio.sleep(.01)
            self.assertEqual(saved, [])
        await manager.close()


if __name__ == "__main__":
    unittest.main()
