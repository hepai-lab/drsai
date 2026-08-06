import importlib
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest


def test_runtime_probe_imports_in_chaquopy_top_level_package_layout(tmp_path: Path) -> None:
    repo = Path(__file__).parents[5]
    runtime_root = repo / "cores/python/packages/drsai/src/drsai/backend/runtime"
    android_python = repo / "apps/android/app/src/main/python"
    env = {**os.environ, "PYTHONPATH": os.pathsep.join((str(runtime_root), str(android_python)))}

    completed = subprocess.run(
        [sys.executable, "-S", "-c", "import json, runtime_probe; assert json.loads(runtime_probe.health())['status'] == 'python_runtime_ready'"],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )

    assert completed.returncode == 0, completed.stderr


def test_runtime_probe_reset_drops_all_account_run_memory() -> None:
    repo = Path(__file__).parents[5]
    runtime_root = repo / "cores/python/packages/drsai/src/drsai/backend/runtime"
    android_python = repo / "apps/android/app/src/main/python"
    sys.path[:0] = [str(runtime_root), str(android_python)]
    try:
        probe = importlib.import_module("runtime_probe")
        health = json.loads(probe.health())
        assert health["agent_kernel"]["kernel_id"] == "drsai-agent-kernel"
        assert health["agent_kernel"]["kernel_version"] == "p9.1"
        assert len(health["agent_kernel"]["base_prompt_sha256"]) == 64
        assert len(health["agent_kernel"]["kernel_sha256"]) == 64
        assert health["agent_kernel"]["surface"] == "android"
        assert health["agent_kernel"]["tool_manifest_version"] == "p9-tools-v1"
        assert health["capability_manifest"]["sha256"] == health["agent_kernel"]["capability_manifest_sha256"]
        assert health["capability_manifest"]["surface"] == "android"
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
