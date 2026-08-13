from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys

import pytest

import finalize_remote_workspace_p6_product_acceptance as finalizer


def _fixture(tmp_path: Path) -> dict:
    tmp_path.mkdir(parents=True, exist_ok=True)
    device_proofs = ["a" * 64, "b" * 64]
    build_sha256s = ["1" * 64, "2" * 64, "3" * 64]
    start = datetime(2026, 8, 12, 8, tzinfo=timezone.utc)
    journeys = []
    for index, (name, invariants) in enumerate(finalizer.JOURNEY_INVARIANTS.items()):
        relative = f"proofs/{index:02d}-{name}.bin"
        path = tmp_path / relative
        path.parent.mkdir(exist_ok=True)
        path.write_bytes(f"authoritative product proof {index}".encode())
        raw = path.read_bytes()
        sequenced = name in finalizer.SEQUENCED
        journeys.append({
            "name": name,
            "status": "passed",
            "started_at": (start + timedelta(seconds=index * 2)).isoformat(),
            "completed_at": (start + timedelta(seconds=index * 2 + 1)).isoformat(),
            "elapsed_ms": 1000,
            "threshold_ms": 2000 if name != "runtime_relay_restart_recovery" else 30000,
            "device_proof_sha256s": (
                device_proofs if name == "targeted_device_revoke"
                else [device_proofs[index % 2]]
            ),
            "windows_observed": True, "android_observed": True, "relay_observed": True,
            "sequence_start": index * 10 if sequenced else None,
            "sequence_end": index * 10 + 2 if sequenced else None,
            "invariants": sorted(invariants),
            "proof_artifacts": [{"artifact": relative, "bytes": len(raw),
                                 "sha256": hashlib.sha256(raw).hexdigest()}],
        })
    return {
        "schema_version": "p6-product-acceptance/1",
        "environment_id": "p6-product-test",
        "source_revision": "4" * 40,
        "build_sha256s": build_sha256s,
        "device_proof_sha256s": device_proofs,
        "test_variant": "release",
        "app_package": "ai.drsai.remote",
        "desktop_product": "OpenDrSaiDesktop",
        "relay_service": "opendrsai-runtime-relay",
        "journeys": journeys,
        "accessibility_checks": sorted(finalizer.ACCESSIBILITY),
        "accessibility_violations": 0,
        "open_p0_count": 0,
        "open_p1_count": 0,
        "raw_sensitive_content_exported": False,
        "human_confirmed": True,
        "passed": True,
    }


def test_all_ten_release_product_journeys_pass_with_two_devices_and_raw_proofs(tmp_path: Path) -> None:
    value = _fixture(tmp_path)
    assert finalizer.finalize(value, tmp_path) == {
        "schema_version": "p6-product-finalization/1", "status": "passed",
        "journeys": 10, "errors": [],
    }


@pytest.mark.parametrize(
    ("mutate", "code"),
    [
        (lambda value: value["journeys"].pop(), "p6_product_schema_validation_failed"),
        (lambda value: value["journeys"][1].__setitem__("name", value["journeys"][0]["name"]),
         "p6_product_journey_set_invalid"),
        (lambda value: value.__setitem__("test_variant", "debug"), "p6_product_schema_validation_failed"),
        (lambda value: value.__setitem__("open_p0_count", 1), "p6_product_schema_validation_failed"),
        (lambda value: value.__setitem__("raw_sensitive_content_exported", True),
         "p6_product_schema_validation_failed"),
        (lambda value: value["journeys"][3]["invariants"].pop(),
         "p6_product_journey_invariants_invalid"),
        (lambda value: value["journeys"][3].__setitem__("sequence_end", 0),
         "p6_product_journey_sequence_invalid"),
        (lambda value: value["journeys"][0].__setitem__("elapsed_ms", 3000),
         "p6_product_journey_latency_invalid"),
        (lambda value: value["journeys"][-1].__setitem__(
            "device_proof_sha256s", [value["device_proof_sha256s"][0]]
        ), "p6_product_journey_device_binding_invalid"),
    ],
)
def test_missing_debug_failed_invariant_sequence_latency_or_device_fails_closed(
    tmp_path: Path, mutate, code: str,
) -> None:
    value = _fixture(tmp_path)
    mutate(value)
    assert code in finalizer.finalize(value, tmp_path)["errors"]


def test_tampered_or_reused_proof_and_naive_timestamp_fail_closed(tmp_path: Path) -> None:
    value = _fixture(tmp_path)
    proof = value["journeys"][0]["proof_artifacts"][0]
    (tmp_path / proof["artifact"]).write_bytes(b"tampered")
    assert "p6_product_proof_attestation_invalid" in finalizer.finalize(value, tmp_path)["errors"]

    root = tmp_path / "reuse"
    value = _fixture(root)
    value["journeys"][1]["proof_artifacts"] = deepcopy(value["journeys"][0]["proof_artifacts"])
    assert "p6_product_proof_reused" in finalizer.finalize(value, root)["errors"]

    root = tmp_path / "time"
    value = _fixture(root)
    value["journeys"][0]["started_at"] = "2026-08-12T08:00:00"
    assert "p6_product_timestamp_timezone_required" in finalizer.finalize(value, root)["errors"]


def test_cli_and_duplicate_json_key_fail_closed(tmp_path: Path) -> None:
    value = _fixture(tmp_path)
    report = tmp_path / "report.json"
    report.write_text(json.dumps(value), encoding="utf-8")
    result = subprocess.run([
        sys.executable, str(Path(__file__).with_name(
            "finalize_remote_workspace_p6_product_acceptance.py"
        )), str(report), "--artifact-root", str(tmp_path),
    ], capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["journeys"] == 10
    report.write_text('{"schema_version":"p6-product-acceptance/1","schema_version":"x"}',
                      encoding="utf-8")
    result = subprocess.run([
        sys.executable, str(Path(__file__).with_name(
            "finalize_remote_workspace_p6_product_acceptance.py"
        )), str(report), "--artifact-root", str(tmp_path),
    ], capture_output=True, text=True, check=False)
    assert result.returncode == 1
    assert "p6_duplicate_json_key" in result.stdout
