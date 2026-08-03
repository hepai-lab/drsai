import importlib
import json
import sys
from pathlib import Path

import pytest


def test_runtime_probe_reset_drops_all_account_run_memory() -> None:
    repo = Path(__file__).parents[5]
    runtime_root = repo / "cores/python/packages/drsai/src/drsai/backend/runtime"
    android_python = repo / "apps/android/app/src/main/python"
    sys.path[:0] = [str(runtime_root), str(android_python)]
    try:
        probe = importlib.import_module("runtime_probe")
        start = {
            "protocol_version": 1,
            "message_type": "start_run",
            "request_id": "start-1",
            "run_id": "run-1",
            "session_id": "session-1",
            "sequence": 0,
            "idempotency_key": "start-key",
            "payload": {"input": "hello", "model_id": "model-1"},
        }
        assert json.loads(probe.execute(json.dumps(start)))["status"] == "python_runtime_ready"
        probe.reset()
        completed = {**start, "message_type": "model_completed", "request_id": "completed-1", "sequence": 1,
                     "idempotency_key": "completed-key", "payload": {"content": "done"}}
        with pytest.raises(ValueError, match="run_not_found"):
            probe.execute(json.dumps(completed))
    finally:
        sys.path.remove(str(runtime_root))
        sys.path.remove(str(android_python))
        sys.modules.pop("runtime_probe", None)
