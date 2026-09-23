"""Smoke test for RuntimeEngine backend-delta buffering (no pytest).

Verifies, with buffering enabled:
 1. buffered deltas reach the DB (flushed on read or on interval)
 2. event ordering: a tool.started committed after buffered deltas still
    follows them in sequence
 3. backend-key idempotency still holds across buffer flushes
 4. OAEP read paths observe flushed deltas
"""
import os
import tempfile
import time
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity

os.environ.setdefault("OPENDRSAI_BACKEND_DELTA_BUFFER_SECONDS", "0.05")

tmp = Path(tempfile.mkdtemp())
engine = RuntimeEngine(tmp / "rt.db", RuntimeEngineIdentity("r1", "i1"), lambda wid: True)
session = engine.create_session("ws1", "s")
run, created = engine.create_run(session["session_id"], "opendrsai@1", "key-1", "opendrsai")
run_id = run["run_id"]

# 1. buffer several deltas without forcing a flush (interval 50ms; emit fast)
for i in range(5):
    engine.append_backend_event(run_id, "agent.message.delta", {"text": f"tok{i} "}, f"k{i}")
time.sleep(0.2)  # exceed interval on next append -> flush
engine.append_backend_event(run_id, "agent.message.delta", {"text": "tok5 "}, "k5")
# force via read path
events = engine.list_events(run_id)
deltas = [e for e in events if e["type"] == "agent.message.delta"]
assert len(deltas) == 6, f"expected 6 delta events, got {len(deltas)}: {events}"
text = "".join(e["data"].get("text", "") for e in deltas)
assert text == "tok0 tok1 tok2 tok3 tok4 tok5 ", f"unexpected text: {text!r}"

# 2. ordering: buffered delta then a non-delta event
engine.append_backend_event(run_id, "agent.message.delta", {"text": "tail "}, "kd")
engine.append_event(run_id, "tool.started", {"call_id": "c1"})
all_events = engine.list_events(run_id)
seqs = [(e["type"], e["sequence"]) for e in all_events]
last_delta_seq = max(s for t, s in seqs if t == "agent.message.delta")
tool_seq = min(s for t, s in seqs if t == "tool.started")
assert last_delta_seq < tool_seq, f"delta after tool event: {seqs}"

# 3. idempotency: replay a buffered key after flush
again = engine.append_backend_event(run_id, "agent.message.delta", {"text": "ignored "}, "k5")
time.sleep(0.1)
events = engine.list_events(run_id)
deltas = [e for e in events if e["type"] == "agent.message.delta"]
assert len(deltas) == 7, f"expected 7 delta events after idempotent replay, got {len(deltas)}"

# 4. OAEP read sees the deltas
oaep = engine.list_oaep_events(session["session_id"], after_sequence=0, limit=500)
assert any(str(e.get("type", "")).endswith("item.delta") for e in oaep), [e.get("type") for e in oaep]

# 5. transition flushes remaining buffer
engine.transition_run(run_id, "running")
engine.append_backend_event(run_id, "agent.message.delta", {"text": "final "}, "kf")
engine.transition_run(run_id, "completed")
final_events = engine.list_events(run_id)
assert any(e["type"] == "agent.message.delta" and e["data"].get("text") == "final " for e in final_events)
assert engine.get_run(run_id)["status"] == "completed"

# 6. Reading session A must not break batching for session B.
session_b = engine.create_session("ws1", "other")
run_b, _ = engine.create_run(session_b["session_id"], "opendrsai@1", "key-b", "opendrsai")
bid = run_b["run_id"]
engine.append_backend_event(bid, "agent.message.delta", {"text": "isolated"}, "b1")
engine.list_oaep_events(session["session_id"])
assert bid in engine._backend_delta_buffer

# 7. A failed atomic write retains its buffer for an idempotent retry.
original = engine.append_backend_events
def fail_write(*args, **kwargs):
    raise OSError("simulated disk failure")
engine.append_backend_events = fail_write
try:
    engine.list_events(bid)
except OSError:
    pass
else:
    raise AssertionError("expected write failure")
assert len(engine._backend_delta_buffer[bid]) == 1
engine.append_backend_events = original
snapshot = engine.conversation_snapshot(session_b["session_id"])
assert bid not in engine._backend_delta_buffer
assert bid not in engine._backend_delta_last_flush
assert len([e for e in engine.list_events(bid) if e["type"] == "agent.message.delta" and e["data"].get("text") == "isolated"]) == 1

# 8. A fast batch performs one projection write, not one per token.
count = [0]
record = engine._record_runtime_event_item_in_transaction
def counted(*args, **kwargs):
    count[0] += 1
    return record(*args, **kwargs)
engine._record_runtime_event_item_in_transaction = counted
engine.append_backend_events(bid, [("agent.message.delta", {"text": "x"}, f"batch-{i}") for i in range(200)])
assert count[0] == 1, count
print("SMOKE_OK (session isolation, failed-write retry, snapshot visibility, 200 deltas / 1 projection)")
