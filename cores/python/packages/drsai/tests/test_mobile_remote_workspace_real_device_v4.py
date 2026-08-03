from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[5]
sys.path.insert(0, str(ROOT / "scripts"))
SCRIPT = ROOT / "scripts/accept_mobile_remote_workspace_real_device_v4.py"
SPEC = importlib.util.spec_from_file_location("real_device_v4", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def snapshot():
    value = json.loads((ROOT / "cores/protocol/oaep/examples.json").read_text(encoding="utf-8"))
    value["snapshot_sequence"] = max(event["sequence"] for event in value["events"])
    return {key: value[key] for key in ("version", "session", "runs", "items", "snapshot_sequence")}


def test_v4_proof_requires_three_identical_native_oaep_hashes() -> None:
    value = snapshot()
    digest = MODULE.oaep_items_digest(value["items"])
    android = {
        "protocol": "oaep/1",
        "schema_hash": MODULE.OAEPProtocol().schema_hash,
        "oaep_sha256": digest,
        "snapshot_sequence": value["snapshot_sequence"],
        "duplicate_sequence_count": 0,
        "missing_sequence_count": 0,
    }
    result = MODULE.validate_oaep_proof(value, android, digest)
    assert result["runtime_sha256"] == result["windows_sha256"] == result["android_sha256"]


def test_v4_file_change_proof_requires_android_and_runtime_safe_path_agreement() -> None:
    value = snapshot()
    stats = MODULE.file_change_stats(value)
    assert stats == {
        "file_change_count": 1,
        "safe_relative_paths": True,
        "absolute_path_count": 0,
        "sensitive_field_count": 0,
    }
    result = MODULE.validate_file_change_proof(value, stats)
    assert result["name"] == "file_change_safe_paths"
    assert result["status"] == "passed"


def test_v4_file_change_proof_fails_closed_on_android_runtime_drift() -> None:
    value = snapshot()
    android = MODULE.file_change_stats(value)
    android["file_change_count"] = 0
    with pytest.raises(RuntimeError, match="v4_file_change_safe_paths_invalid"):
        MODULE.validate_file_change_proof(value, android)


def test_v4_file_change_proof_fails_closed_on_unsafe_runtime_path() -> None:
    value = snapshot()
    file_item = next(item for item in value["items"] if item["type"] == "file_change")
    file_item["content"]["changes"][0]["path"] = "C:/Users/private/secret.txt"
    android = MODULE.file_change_stats(value)
    with pytest.raises(RuntimeError, match="v4_file_change_safe_paths_invalid"):
        MODULE.validate_file_change_proof(value, android)


@pytest.mark.parametrize("field", ["protocol", "schema_hash", "oaep_sha256", "snapshot_sequence"])
def test_v4_proof_fails_closed_on_protocol_or_projection_drift(field: str) -> None:
    value = snapshot()
    digest = MODULE.oaep_items_digest(value["items"])
    android = {
        "protocol": "oaep/1",
        "schema_hash": MODULE.OAEPProtocol().schema_hash,
        "oaep_sha256": digest,
        "snapshot_sequence": value["snapshot_sequence"],
        "duplicate_sequence_count": 0,
        "missing_sequence_count": 0,
    }
    android[field] = "bad" if field != "snapshot_sequence" else -1
    with pytest.raises(RuntimeError, match="v4_oaep_convergence_invalid"):
        MODULE.validate_oaep_proof(value, android, digest)


def test_v4_parse_adb_devices_classifies_physical_and_emulator() -> None:
    devices = MODULE.parse_adb_devices(
        "List of devices attached\n"
        "R5GYB3S8ACH\tdevice product:o1s model:SM_G9910\n"
        "emulator-5554\tdevice product:sdk_gphone\n"
        "ZX1\tunauthorized\n"
    )
    assert devices == [
        {"serial": "R5GYB3S8ACH", "state": "device", "kind": "physical"},
        {"serial": "emulator-5554", "state": "device", "kind": "emulator"},
        {"serial": "ZX1", "state": "unauthorized", "kind": "physical"},
    ]


def test_v4_real_acceptor_requires_authorized_physical_device(monkeypatch) -> None:
    class Completed:
        returncode = 0
        stdout = "List of devices attached\nR5GYB3S8ACH\tdevice\n"

    monkeypatch.setattr(MODULE.shutil, "which", lambda _adb: "adb")
    monkeypatch.setattr(MODULE.subprocess, "run", lambda *_args, **_kwargs: Completed())
    assert MODULE.require_physical_android_device("adb", "R5GYB3S8ACH")["kind"] == "physical"


@pytest.mark.parametrize(
    "stdout,serial,error",
    [
        ("List of devices attached\nemulator-5554\tdevice\n", "emulator-5554", "v4_physical_android_device_required"),
        ("List of devices attached\nR5GYB3S8ACH\tunauthorized\n", "R5GYB3S8ACH", "v4_android_device_not_authorized"),
        ("List of devices attached\n", "R5GYB3S8ACH", "v4_physical_android_device_missing"),
    ],
)
def test_v4_real_acceptor_rejects_non_physical_unusable_devices(
    monkeypatch,
    stdout: str,
    serial: str,
    error: str,
) -> None:
    class Completed:
        returncode = 0

    completed = Completed()
    completed.stdout = stdout
    monkeypatch.setattr(MODULE.shutil, "which", lambda _adb: "adb")
    monkeypatch.setattr(MODULE.subprocess, "run", lambda *_args, **_kwargs: completed)
    with pytest.raises(RuntimeError, match=error):
        MODULE.require_physical_android_device("adb", serial)
