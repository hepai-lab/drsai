from __future__ import annotations

import json
import subprocess
import sys
import os
from pathlib import Path


ROOT = Path(__file__).resolve().parents[5]


def test_local_provider_compatibility_matrix_is_complete_and_redacted(tmp_path) -> None:
    evidence = tmp_path / "matrix.json"
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "verify_model_provider_compatibility.py"), "--local", "--require-all", "--output", str(evidence)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    payload = json.loads(evidence.read_text(encoding="utf-8"))
    assert payload["passed"] is True
    assert payload["missingServiceTypes"] == []
    assert set(payload["configuredServiceTypes"]) == {"openai", "anthropic", "deepseek", "ollama", "chat_only", "custom_proxy"}
    assert len(payload["results"]) == 15
    assert all(row["passed"] for row in payload["results"])
    serialized = evidence.read_text(encoding="utf-8")
    assert "local-openai-secret" not in serialized
    assert "local-anthropic-secret" not in serialized
    assert "base_url" not in serialized.lower()


def test_real_matrix_require_all_fails_closed_without_configuration(tmp_path) -> None:
    environment = {key: value for key, value in os.environ.items() if not key.startswith("DRSAI_MATRIX_")}
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "verify_model_provider_compatibility.py"), "--real-env", "--require-all", "--output", str(tmp_path / "real.json")],
        cwd=ROOT,
        env=environment,
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )
    assert result.returncode == 2
    assert "Missing required real Provider matrix configuration" in result.stderr
    assert not (tmp_path / "real.json").exists()
