"""Cancellation deadlines remain bounded even when the provider ignores cancel."""
import asyncio
import unittest

from drsai.backend.desktop_gateway._turn_wait import (
    TurnWaitTimeout, wait_bounded, wait_turn_event,
)


class TurnWaitTests(unittest.IsolatedAsyncioTestCase):
    async def test_cancel_during_existing_idle_wait(self):
        cancelled = False
        release = asyncio.Event()

        async def provider():
            while not release.is_set():
                try:
                    await release.wait()
                except asyncio.CancelledError:
                    continue
            return "late"

        task = asyncio.create_task(provider())
        waiter = asyncio.create_task(wait_turn_event(task, lambda: cancelled, 10, .03, [None]))
        await asyncio.sleep(.01)
        cancelled = True
        with self.assertRaises(TurnWaitTimeout) as error:
            await asyncio.wait_for(waiter, .5)
        self.assertTrue(error.exception.cancelled)
        self.assertFalse(task.done())
        release.set()
        await task

    async def test_cancel_deadline_does_not_reset_on_events(self):
        deadline = [None]
        for _ in range(3):
            task = asyncio.create_task(asyncio.sleep(.01, result="event"))
            self.assertEqual(await wait_turn_event(task, lambda: True, 10, .1, deadline), "event")
        first = deadline[0]
        await asyncio.sleep(.1)
        task = asyncio.create_task(asyncio.sleep(10))
        with self.assertRaises(TurnWaitTimeout):
            await wait_turn_event(task, lambda: True, 10, .1, deadline)
        self.assertEqual(deadline[0], first)
        await asyncio.gather(task, return_exceptions=True)

    async def test_idle_and_save_deadlines(self):
        task = asyncio.create_task(asyncio.sleep(10))
        with self.assertRaises(TurnWaitTimeout) as error:
            await wait_turn_event(task, lambda: False, .02, 1, [None])
        self.assertFalse(error.exception.cancelled)
        await asyncio.gather(task, return_exceptions=True)
        saving = asyncio.create_task(asyncio.sleep(10))
        with self.assertRaises(TimeoutError):
            await wait_bounded(saving, .01)
        await asyncio.gather(saving, return_exceptions=True)

    async def test_normal_events(self):
        deadline = [None]
        for i in range(10):
            task = asyncio.create_task(asyncio.sleep(.001, result=i))
            self.assertEqual(await wait_turn_event(task, lambda: False, .1, .01, deadline), i)
        self.assertIsNone(deadline[0])


if __name__ == "__main__":
    unittest.main()
