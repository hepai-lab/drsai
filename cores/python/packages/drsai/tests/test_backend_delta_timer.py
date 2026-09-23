"""Observe durable storage directly: no read-triggered flush can hide a missing timer."""
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from drsai.backend.runtime import engine as module


class DeltaTimerTests(unittest.TestCase):
    def test_tail_flush_and_shutdown(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(module, "_BACKEND_DELTA_BUFFER_SECONDS", .03):
                engine = module.RuntimeEngine(Path(directory) / "runtime.db", module.RuntimeEngineIdentity("r", "i"), lambda _: True)
                try:
                    session = engine.create_session("ws", "test")
                    run, _ = engine.create_run(session["session_id"], "opendrsai@1", "key", "opendrsai")
                    rid = run["run_id"]
                    engine.append_backend_event(rid, "agent.message.delta", {"text": "tail"}, "tail")
                    deadline = time.monotonic() + 2
                    count = 0
                    while time.monotonic() < deadline:
                        with engine._connect() as db:
                            count = db.execute("SELECT COUNT(*) FROM runtime_events WHERE backend_event_key='tail'").fetchone()[0]
                        if count:
                            break
                        time.sleep(.01)
                    self.assertEqual(count, 1)
                    engine.append_backend_event(rid, "agent.message.delta", {"text": "end"}, "end")
                    engine.close()
                    with engine._connect() as db:
                        self.assertEqual(db.execute("SELECT COUNT(*) FROM runtime_events WHERE backend_event_key='end'").fetchone()[0], 1)
                    self.assertIsNone(engine._backend_delta_timer)
                    with self.assertRaisesRegex(RuntimeError, "closed"):
                        engine.append_backend_event(rid, "agent.message.delta", {"text": "late"}, "late")
                finally:
                    engine.close()


if __name__ == "__main__":
    unittest.main()
