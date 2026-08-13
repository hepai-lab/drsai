from __future__ import annotations

import json
import subprocess
import sys
import os
import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[5]


def _readiness_module():
    path = ROOT / "scripts" / "verify_model_provider_release_readiness.py"
    spec = importlib.util.spec_from_file_location("model_provider_release_readiness", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


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


def test_real_matrix_preflight_reports_presence_without_requests_or_values(tmp_path) -> None:
    environment = {key: value for key, value in os.environ.items() if not key.startswith("DRSAI_MATRIX_")}
    for service_type in ("OPENAI", "ANTHROPIC", "DEEPSEEK", "CHAT_ONLY", "CUSTOM_PROXY"):
        environment[f"DRSAI_MATRIX_{service_type}_BASE_URL"] = f"https://secret-{service_type.lower()}.example/v1"
        environment[f"DRSAI_MATRIX_{service_type}_MODEL"] = f"secret-{service_type.lower()}-model"
        environment[f"DRSAI_MATRIX_{service_type}_API_KEY"] = f"secret-{service_type.lower()}-key"
    environment["DRSAI_MATRIX_OLLAMA_BASE_URL"] = "http://127.0.0.1:1/v1"
    environment["DRSAI_MATRIX_OLLAMA_MODEL"] = "secret-ollama-model"
    evidence = tmp_path / "preflight.json"
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "verify_model_provider_compatibility.py"), "--real-env", "--preflight", "--require-all", "--output", str(evidence)],
        cwd=ROOT,
        env=environment,
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    payload = json.loads(evidence.read_text(encoding="utf-8"))
    assert payload["passed"] is True
    assert payload["networkRequestsSent"] is False
    assert payload["missingServiceTypes"] == []
    assert all(row["configured"] for row in payload["configuration"])
    serialized = evidence.read_text(encoding="utf-8")
    assert "secret-openai.example" not in serialized
    assert "secret-openai-model" not in serialized
    assert "secret-openai-key" not in serialized


def test_real_matrix_preflight_identifies_missing_fields_without_values(tmp_path) -> None:
    environment = {key: value for key, value in os.environ.items() if not key.startswith("DRSAI_MATRIX_")}
    environment["DRSAI_MATRIX_OPENAI_BASE_URL"] = "https://private.example/v1"
    evidence = tmp_path / "preflight.json"
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "verify_model_provider_compatibility.py"), "--real-env", "--preflight", "--output", str(evidence)],
        cwd=ROOT,
        env=environment,
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )
    assert result.returncode == 2
    payload = json.loads(evidence.read_text(encoding="utf-8"))
    openai = next(row for row in payload["configuration"] if row["serviceType"] == "openai")
    assert openai["present"] == {"baseUrl": True, "model": False, "apiKey": False}
    assert openai["issues"] == ["model_missing", "api_key_missing"]
    assert "private.example" not in evidence.read_text(encoding="utf-8")


def test_release_readiness_accepts_only_complete_hepai_platform_evidence() -> None:
    readiness = _readiness_module()
    valid = {
        "schemaVersion": 3,
        "passed": True,
        "kind": "hepai-platform",
        "providerId": "hepai",
        "authentication": "oidc-safe-storage",
        "secretMaterialRecorded": False,
        "results": [{"modelId": "deepseek-v4-flash", "passed": True, "statusCode": 200, "sawData": True, "sawDone": True}],
    }
    assert readiness.valid_real_provider_evidence(valid) is True
    assert readiness.valid_real_provider_evidence({**valid, "kind": "real-environment-preflight"}) is False
    assert readiness.valid_real_provider_evidence({**valid, "authentication": "api-key"}) is False
    assert readiness.valid_real_provider_evidence({**valid, "secretMaterialRecorded": True}) is False
    assert readiness.valid_real_provider_evidence({**valid, "results": [{**valid["results"][0], "sawDone": False}]}) is False


def test_real_matrix_preflight_can_stage_one_service_without_weakening_release_evidence(tmp_path) -> None:
    environment = {key: value for key, value in os.environ.items() if not key.startswith("DRSAI_MATRIX_")}
    environment.update({
        "DRSAI_MATRIX_OPENAI_BASE_URL": "https://private-openai.example/v1",
        "DRSAI_MATRIX_OPENAI_MODEL": "private-model",
        "DRSAI_MATRIX_OPENAI_API_KEY": "private-key",
    })
    evidence = tmp_path / "openai-preflight.json"
    result = subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts" / "verify_model_provider_compatibility.py"),
            "--real-env",
            "--preflight",
            "--require-all",
            "--service-type",
            "openai",
            "--output",
            str(evidence),
        ],
        cwd=ROOT,
        env=environment,
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    payload = json.loads(evidence.read_text(encoding="utf-8"))
    assert payload["passed"] is True
    assert payload["requiredServiceTypes"] == ["openai"]
    assert payload["configuredServiceTypes"] == ["openai"]
    assert payload["missingServiceTypes"] == []
    assert [row["serviceType"] for row in payload["configuration"]] == ["openai"]
    assert _readiness_module().valid_real_provider_evidence(payload) is False
    assert "private-openai.example" not in evidence.read_text(encoding="utf-8")


def test_real_matrix_preflight_rejects_malformed_url_and_requires_key_without_network(tmp_path) -> None:
    environment = {key: value for key, value in os.environ.items() if not key.startswith("DRSAI_MATRIX_")}
    environment.update({
        "DRSAI_MATRIX_OPENAI_BASE_URL": "https://user:password@private.example/v1?token=secret#fragment",
        "DRSAI_MATRIX_OPENAI_MODEL": "private-model",
        "DRSAI_MATRIX_OPENAI_API_KEY": "private-key",
        "DRSAI_MATRIX_OPENAI_REQUIRES_KEY": "sometimes",
    })
    evidence = tmp_path / "invalid-preflight.json"
    result = subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts" / "verify_model_provider_compatibility.py"),
            "--real-env",
            "--preflight",
            "--require-all",
            "--service-type",
            "openai",
            "--output",
            str(evidence),
        ],
        cwd=ROOT,
        env=environment,
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )
    assert result.returncode == 2
    payload = json.loads(evidence.read_text(encoding="utf-8"))
    assert payload["networkRequestsSent"] is False
    assert payload["missingServiceTypes"] == ["openai"]
    row = payload["configuration"][0]
    assert row["configured"] is False
    assert row["issues"] == ["base_url_invalid", "requires_key_invalid"]
    serialized = evidence.read_text(encoding="utf-8")
    assert "private.example" not in serialized
    assert "password" not in serialized
    assert "private-model" not in serialized
    assert "private-key" not in serialized

    run_evidence = tmp_path / "invalid-run.json"
    run_result = subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts" / "verify_model_provider_compatibility.py"),
            "--real-env",
            "--service-type",
            "openai",
            "--output",
            str(run_evidence),
        ],
        cwd=ROOT,
        env=environment,
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )
    assert run_result.returncode == 1
    run_payload = json.loads(run_evidence.read_text(encoding="utf-8"))
    assert run_payload["passed"] is False
    assert run_payload["results"] == []
