from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
PROBE = ROOT / "scripts" / "probe_runtime_relay_bridge_startup.py"


def test_startup_probe_fails_content_free_when_local_configuration_is_absent(
    tmp_path: Path,
) -> None:
    environment = dict(os.environ)
    environment["PYTHONPATH"] = str(ROOT / "cores/python/packages/drsai/src")
    environment["PYTHONDONTWRITEBYTECODE"] = "1"
    result = subprocess.run(
        [
            sys.executable, str(PROBE),
            "--state-root", str(tmp_path),
            "--port", "28642",
        ],
        cwd=ROOT,
        env=environment,
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )
    assert result.returncode == 1
    payload = json.loads(result.stdout)
    assert payload == {
        "status": "failed",
        "error_code": "runtime_relay_bridge_startup_failed",
        "stage": "local_configuration",
        "error_type": "FileNotFoundError",
    }
    serialized = json.dumps(payload, sort_keys=True)
    assert str(tmp_path) not in serialized
    assert "token" not in serialized.lower()
    assert result.stderr == ""


def test_startup_probe_rejects_invalid_port_before_reading_state(tmp_path: Path) -> None:
    result = subprocess.run(
        [sys.executable, str(PROBE), "--state-root", str(tmp_path), "--port", "0"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )
    assert result.returncode != 0
    assert "runtime_relay_probe_port_invalid" in result.stderr
    assert result.stdout == ""
