"""Regression tests for the services.emit path and the flush/write lock boundary."""
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from drsai.backend.runtime import engine as module
from drsai.backend.runtime.agent import AgentExecutionServices, RuntimeRunContext
from drsai.backend.runtime.normalized_events import (
    BackendBinding, NormalizedAgentEvent, NormalizedEventKind, NormalizedItemType,
)


class DeltaIngressTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.enterContext(patch.object(module, "_BACKEND_DELTA_BUFFERING_ENABLED", True))
        self.enterContext(patch.object(module, "_BACKEND_DELTA_BUFFER_SECONDS", 60))
        self.engine = module.RuntimeEngine(Path(tmp.name) / "runtime.db", module.RuntimeEngineIdentity("r", "i"), lambda _: True)
        self.addCleanup(self.engine.close)
        self.session = self.engine.create_session("ws", "test")
        run, _ = self.engine.create_run(self.session["session_id"], "opendrsai@1", "key", "opendrsai")
        self.rid = run["run_id"]
        self.context = RuntimeRunContext("r", "i", "ws", Path(tmp.name), self.session["session_id"], self.rid, "opendrsai", "1")
        self.services = AgentExecutionServices(self.engine, None, None)

    def stored(self):
        # No public reads: they flush and can mask an ingress/timer regression.
        with self.engine._connect() as db:
            return db.execute("SELECT event_type,data_json,backend_event_key FROM runtime_events WHERE run_id=? ORDER BY sequence", (self.rid,)).fetchall()

    def emit(self, text):
        return self.services.emit(self.context, "agent.message.delta", {"text": text})

    def test_services_emit_batches_and_preserves_identical_chunks(self):
        with patch.object(self.engine, "_record_runtime_event_item_in_transaction", wraps=self.engine._record_runtime_event_item_in_transaction) as record:
            for _ in range(200):
                self.assertTrue(self.emit("x").get("buffered"))
            self.assertFalse(any(row[0] == "agent.message.delta" for row in self.stored()))
            marker = self.services.emit(self.context, "tool.started", {"call_id": "c"})
            self.assertIsInstance(marker["sequence"], int)
            deltas = [e for e in self.engine.list_events(self.rid) if e["type"] == "agent.message.delta"]
            self.assertEqual(len(deltas), 200)
            self.assertEqual(len({e["backend_event_key"] for e in deltas}), 200)
            self.assertLess(deltas[-1]["sequence"], marker["sequence"])
            self.assertEqual(record.call_count, 2)  # one coalesced delta + marker

    def test_flush_failure_retains_payload_chars_and_order(self):
        self.emit("first")
        before = list(self.engine._backend_delta_buffer.get(self.rid, []))
        self.assertEqual(len(before), 1)
        chars = self.engine._backend_delta_buffer_chars[self.rid]
        with patch.object(self.engine, "append_backend_events", side_effect=OSError("disk failure")):
            with self.assertRaises(OSError):
                self.services.emit(self.context, "tool.started", {"call_id": "c"})
        self.assertEqual(self.engine._backend_delta_buffer[self.rid], before)
        self.assertEqual(self.engine._backend_delta_buffer_chars[self.rid], chars)
        self.emit("second")
        self.services.emit(self.context, "tool.started", {"call_id": "c"})
        events = self.engine.list_events(self.rid)
        self.assertEqual([e["data"]["text"] for e in events if e["type"] == "agent.message.delta"], ["first", "second"])
        self.assertNotIn(self.rid, self.engine._backend_delta_buffer_chars)
        self.assertNotIn(self.rid, self.engine._backend_delta_last_flush)

    def test_flush_and_marker_are_one_locked_operation(self):
        # Pause immediately after a marker's flush. An accepted competing delta
        # must precede that marker, or be blocked until the marker commits.
        for writer in ("append_event", "append_backend_event", "append_backend_events", "append_normalized_event", "mark_cancel_requested", "transition_run", "cancel_run", "request_approval"):
            with self.subTest(writer=writer):
                run, _ = self.engine.create_run(self.session["session_id"], "opendrsai@1", writer, "opendrsai")
                rid = run["run_id"]
                self.engine.transition_run(rid, "running")
                self.engine.append_backend_event(rid, "agent.message.delta", {"text": "seed"}, "seed")
                flushed, accepted = threading.Event(), threading.Event()
                accepted_in_gap = []
                errors = []
                original = self.engine._flush_backend_delta_buffer
                local = threading.local()

                def observed_flush(run_id):
                    nested = getattr(local, "inside", False)
                    local.inside = True
                    try:
                        original(run_id)
                    finally:
                        local.inside = nested
                    if threading.current_thread().name == "marker-writer" and not nested:
                        flushed.set()
                        accepted_in_gap.append(accepted.wait(.1))

                def marker():
                    try:
                        if writer == "append_event":
                            self.engine.append_event(rid, "notice", {})
                        elif writer == "append_backend_event":
                            self.engine.append_backend_event(rid, "notice", {}, "marker")
                        elif writer == "append_backend_events":
                            self.engine.append_backend_events(rid, [("notice", {}, "marker")])
                        elif writer == "append_normalized_event":
                            self.engine.append_normalized_event(rid, NormalizedAgentEvent(
                                kind=NormalizedEventKind.ITEM_STARTED,
                                backend="opendrsai",
                                binding=BackendBinding("backend-session", rid, "notice"),
                                dedupe_key="marker", item_type=NormalizedItemType.NOTICE,
                                payload={"text": "marker"},
                            ))
                        elif writer == "transition_run":
                            self.engine.transition_run(rid, "completed")
                        elif writer == "request_approval":
                            self.engine.request_approval(rid, {"tool_name": "test"})
                        else:
                            getattr(self.engine, writer)(rid)
                    except BaseException as exc:
                        errors.append(exc)

                def delta():
                    try:
                        if not flushed.wait(2):
                            raise AssertionError("writer never flushed")
                        with self.engine._lock:
                            # Model a producer stopping after a terminal Run.
                            if self.engine.get_run(rid)["status"] not in {"completed", "cancelled", "failed"}:
                                self.engine.append_backend_event(rid, "agent.message.delta", {"text": "raced"}, "raced")
                            accepted.set()
                    except BaseException as exc:
                        errors.append(exc)

                with patch.object(self.engine, "_flush_backend_delta_buffer", side_effect=observed_flush):
                    threads = [threading.Thread(target=marker, name="marker-writer"), threading.Thread(target=delta)]
                    for thread in threads:
                        thread.start()
                    for thread in threads:
                        thread.join(4)
                    self.assertTrue(all(not t.is_alive() for t in threads))
                self.assertEqual(errors, [])
                self.assertEqual(accepted_in_gap, [False], "delta was accepted between flush and marker commit")
                events = self.engine.list_events(rid)
                seed = next(e["sequence"] for e in events if e.get("backend_event_key") == "seed")
                if writer not in {"transition_run", "cancel_run"}:
                    raced = next(e["sequence"] for e in events if e.get("backend_event_key") == "raced")
                    self.assertGreater(raced, seed + 1)
                else:
                    self.assertGreater(events[-1]["sequence"], seed)

    def test_plain_message_delta_uses_same_buffer(self):
        event = self.services.emit(self.context, "message.delta", {"content": "plain"})
        self.assertTrue(event["buffered"])
        self.assertFalse(any(row[0] == "message.delta" for row in self.stored()))
        self.engine.close()
        self.assertEqual(sum(row[0] == "message.delta" for row in self.stored()), 1)

    def test_disabled_buffering_keeps_synchronous_identity(self):
        with patch.object(module, "_BACKEND_DELTA_BUFFERING_ENABLED", False):
            event = self.emit("direct")
            self.assertTrue(event["event_id"])
            self.assertIsInstance(event["sequence"], int)
            self.assertNotIn("buffered", event)
            self.assertTrue(any(row[0] == "agent.message.delta" for row in self.stored()))

    def test_services_tail_timer_retries_failed_transaction(self):
        # Fail after runtime_events insertion, inside the real transaction.
        original = self.engine._record_runtime_event_item_in_transaction
        failed = threading.Event()

        def fail_once(*args, **kwargs):
            if not failed.is_set():
                failed.set()
                raise OSError("transient failure")
            return original(*args, **kwargs)

        with patch.object(module, "_BACKEND_DELTA_BUFFER_SECONDS", .03), patch.object(self.engine, "_record_runtime_event_item_in_transaction", side_effect=fail_once), self.assertLogs(module.__name__, level="ERROR"):
            self.emit("tail")
            deadline = time.monotonic() + 2
            while time.monotonic() < deadline:
                if any(row[0] == "agent.message.delta" for row in self.stored()):
                    break
                time.sleep(.01)
            self.assertTrue(failed.is_set())
            self.assertEqual(sum(row[0] == "agent.message.delta" for row in self.stored()), 1)
        self.engine.close()
        with self.assertRaisesRegex(RuntimeError, "closed"):
            self.emit("late")


if __name__ == "__main__":
    unittest.main()
