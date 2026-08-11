from __future__ import annotations

import copy
import importlib.util
import json
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/accept_mobile_remote_workspace_session_catalog_p5.py"
SPEC = importlib.util.spec_from_file_location("p5_session_catalog", SCRIPT)
assert SPEC and SPEC.loader
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


def valid_target() -> dict[str, object]:
    return {
        "phase": "target-proof",
        "runtime_id": "runtime-safe",
        "workspace_id": "workspace-safe",
        "session_id": "session-safe",
        "workspace_count": 2,
        "active_session_count": 7,
    }


def valid_monitor() -> dict[str, object]:
    return {
        "schema_version": "p5-session-catalog/1",
        "feature_id": "P5-M03-F04",
        "passed": True,
        "physical": True,
        "catalog_event_count": 4,
        "observed_transitions": ["rename", "archive", "unarchive", "rollback"],
        "manual_refresh_count": 0,
        "final_active": True,
        "title_restored": True,
        "lifecycle_restored": True,
    }


def test_target_proof_is_validated_but_not_part_of_durable_schema() -> None:
    assert module.validate_target(valid_target()) == {
        "runtime_id": "runtime-safe",
        "workspace_id": "workspace-safe",
        "session_id": "session-safe",
    }
    for key in ("runtime_id", "workspace_id", "session_id"):
        value = valid_target()
        value[key] = "unsafe\nvalue"
        with pytest.raises(ValueError, match="target_invalid"):
            module.validate_target(value)


def test_monitor_report_requires_ordered_stream_transitions_and_rollback() -> None:
    assert module.validate_monitor_report(valid_monitor()) == valid_monitor()
    mutations = (
        lambda value: value.update(physical=False),
        lambda value: value.update(catalog_event_count=3),
        lambda value: value.update(observed_transitions=["archive", "rename", "unarchive", "rollback"]),
        lambda value: value.update(manual_refresh_count=1),
        lambda value: value.update(title_restored=False),
    )
    for mutation in mutations:
        value = copy.deepcopy(valid_monitor())
        mutation(value)
        with pytest.raises(ValueError):
            module.validate_monitor_report(value)


def test_instrumentation_parser_deduplicates_status_and_stdout() -> None:
    value = valid_monitor()
    encoded = json.dumps(value, separators=(",", ":"))
    output = "\n".join((
        f"P5_SESSION_CATALOG_REPORT={encoded}",
        f"INSTRUMENTATION_STATUS: p5SessionCatalogReport={encoded}",
        "OK (1 test)",
    ))
    assert module.extract_single_json(
        output, module.MONITOR_PREFIXES, "missing"
    ) == value
    with pytest.raises(ValueError, match="missing"):
        module.extract_single_json("OK (1 test)", module.MONITOR_PREFIXES, "missing")


def test_gateway_client_accepts_only_loopback_and_rejects_header_injection() -> None:
    module.GatewayClient("http://127.0.0.1:28642", "opaque")
    for root in ("http://localhost:28642", "https://127.0.0.1:28642", "http://10.0.0.1:28642"):
        with pytest.raises(ValueError, match="gateway_url_invalid"):
            module.GatewayClient(root, "opaque")
    with pytest.raises(ValueError, match="gateway_token_invalid"):
        module.GatewayClient("http://127.0.0.1:28642", "opaque\r\nInjected: yes")


def test_physical_environment_rejects_emulator_and_hashes_serial(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    values = {
        "ro.kernel.qemu": "0",
        "ro.build.fingerprint": "vendor/device/release",
        "ro.product.manufacturer": "Vendor",
        "ro.product.model": "Tablet",
        "ro.build.version.sdk": "36",
    }

    def fake_adb(_path: Path, serial: str, *arguments: str, timeout: int = 180) -> str:
        if arguments == ("get-state",):
            return "device\n"
        return values[arguments[-1]] + "\n"

    monkeypatch.setattr(module, "adb", fake_adb)
    result = module.physical_environment(Path("adb"), "hardware-secret")
    assert result["kind"] == "physical_device"
    assert len(result["device_id_sha256"]) == 64
    assert "hardware-secret" not in json.dumps(result)
    with pytest.raises(RuntimeError, match="physical_device_required"):
        module.physical_environment(Path("adb"), "emulator-5554")
