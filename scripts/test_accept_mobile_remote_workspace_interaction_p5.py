from __future__ import annotations

import copy
import importlib.util
import json
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/accept_mobile_remote_workspace_interaction_p5.py"
SPEC = importlib.util.spec_from_file_location("p5_interaction", SCRIPT)
assert SPEC and SPEC.loader
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)
SOURCE_SCRIPT = ROOT / "scripts/accept_mobile_remote_workspace_local_e2e_v2.py"
SOURCE_SPEC = importlib.util.spec_from_file_location("p5_interaction_source", SOURCE_SCRIPT)
assert SOURCE_SPEC and SOURCE_SPEC.loader
source_module = importlib.util.module_from_spec(SOURCE_SPEC)
SOURCE_SPEC.loader.exec_module(source_module)


def valid_source() -> dict[str, object]:
    checks = [
        {"name": "runtime_registration_heartbeat", "status": "passed"},
        {"name": "grant_association", "status": "passed"},
        {"name": "workspace_session_browse", "status": "passed"},
        {"name": "run_approval_tool_artifact", "status": "passed"},
        {
            "name": "m08_f07_approval_branches", "status": "passed",
            "approved_status": "completed", "rejected_status": "cancelled",
            "rejected_side_effect": False, "rejected_audit": True,
        },
        {
            "name": "cross_client_transcript_hash", "status": "passed",
            "event_count": 8, "sha256": "a" * 64,
        },
        {
            "name": "m09_f01_response_loss_recovery", "status": "passed",
            "faults": {
                "run_response_dropped": True, "approval_response_dropped": True,
            },
            "run_bindings": 1, "approval_bindings": 2, "approved_events": 1,
            "tool_finished_events": 2, "artifact_events": 1,
        },
    ]
    return {
        "schema_version": 1, "serial": "hardware", "passed": True,
        "checks": checks,
    }


def test_source_report_proves_terminal_approval_and_single_response_loss_effects() -> None:
    result = module.validate_source_report(valid_source(), expected_serial="hardware")
    assert result["approval"]["denied_side_effect_count"] == 0
    assert result["response_loss"]["run_side_effect_count"] == 1
    assert result["response_loss"]["approval_decision_count"] == 1
    assert result["convergence"]["event_count"] == 8


@pytest.mark.parametrize(
    "mutation",
    [
        lambda value: value.update(passed=False),
        lambda value: value.update(serial="other"),
        lambda value: value["checks"].pop(),
        lambda value: value["checks"][4].update(rejected_side_effect=True),
        lambda value: value["checks"][5].update(sha256="invalid"),
        lambda value: value["checks"][6]["faults"].update(run_response_dropped=False),
        lambda value: value["checks"][6].update(run_bindings=2),
        lambda value: value["checks"][6].update(approval_bindings=1),
    ],
)
def test_source_report_fails_closed_on_missing_or_duplicate_effects(mutation) -> None:
    value = copy.deepcopy(valid_source())
    mutation(value)
    with pytest.raises(ValueError):
        module.validate_source_report(value, expected_serial="hardware")


def test_physical_environment_rejects_emulator_and_hashes_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    values = {
        "ro.kernel.qemu": "0", "ro.build.fingerprint": "vendor/release",
        "ro.product.manufacturer": "Vendor", "ro.product.model": "Tablet",
        "ro.build.version.sdk": "36",
    }

    def fake_adb(_path: Path, serial: str, *arguments: str) -> str:
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


def test_encrypted_ledger_gate_requires_all_seven_physical_tests(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(module, "run", lambda *_args, **_kwargs: "OK (7 tests)\n")
    assert module.run_encrypted_ledger_gate(Path("adb"), "physical") == 7

    monkeypatch.setattr(module, "run", lambda *_args, **_kwargs: "OK (6 tests)\n")
    with pytest.raises(RuntimeError, match="encrypted_ledger_gate_failed"):
        module.run_encrypted_ledger_gate(Path("adb"), "physical")


def test_process_death_gate_runs_three_new_process_phases_with_two_force_stops(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    commands: list[list[str]] = []

    def fake_run(command: list[str], **_kwargs) -> str:
        commands.append(command)
        return "OK (1 test)\n" if "instrument" in command else ""

    monkeypatch.setattr(module, "run", fake_run)
    monkeypatch.setattr(module.secrets, "token_hex", lambda _size: "a" * 32)
    assert module.run_process_death_ledger_gate(Path("adb"), "physical") == 3
    instruments = [command for command in commands if "instrument" in command]
    force_stops = [command for command in commands if "force-stop" in command]
    assert len(instruments) == 3
    assert len(force_stops) == 2
    assert [command[command.index("ledgerPhase") + 1] for command in instruments] == [
        "write", "recover", "verify-cleared",
    ]
    assert all(command[command.index("ledgerNonce") + 1] == "a" * 32 for command in instruments)


def test_transport_defaults_to_usb_reverse_without_lan_consent() -> None:
    assert module.validated_transport_arguments(
        "adb-reverse", None, allow_insecure_private_lan=False
    ) == ["--transport", "adb-reverse"]
    assert str(source_module.validated_transport_host(
        "adb-reverse", None, allow_insecure_private_lan=False
    )) == "127.0.0.1"


@pytest.mark.parametrize(
    ("transport", "host", "consent", "error"),
    [
        ("adb-reverse", "192.168.1.2", False, "host_address_requires_lan"),
        ("adb-reverse", None, True, "lan_consent_requires_lan"),
        ("lan", "192.168.1.2", False, "insecure_private_lan_consent_required"),
        ("lan", "127.0.0.1", True, "rfc1918_ipv4_required"),
        ("lan", "169.254.1.1", True, "rfc1918_ipv4_required"),
        ("lan", "100.64.1.1", True, "rfc1918_ipv4_required"),
        ("lan", "8.8.8.8", True, "rfc1918_ipv4_required"),
        ("lan", "::1", True, "rfc1918_ipv4_required"),
    ],
)
def test_transport_rejects_implicit_or_non_rfc1918_lan(
    transport: str, host: str | None, consent: bool, error: str
) -> None:
    with pytest.raises(ValueError, match=error):
        module.validated_transport_arguments(
            transport, host, allow_insecure_private_lan=consent
        )
    source_error = error.replace("p5_interaction_", "local_e2e_")
    with pytest.raises(ValueError, match=source_error):
        source_module.validated_transport_host(
            transport, host, allow_insecure_private_lan=consent
        )


@pytest.mark.parametrize("host", ["10.1.2.3", "172.16.0.1", "172.31.255.254", "192.168.3.18"])
def test_transport_allows_explicit_rfc1918_lan_consent(host: str) -> None:
    assert module.validated_transport_arguments(
        "lan", host, allow_insecure_private_lan=True
    ) == [
        "--transport", "lan", "--host-address", host,
        "--allow-insecure-private-lan",
    ]
    assert str(source_module.validated_transport_host(
        "lan", host, allow_insecure_private_lan=True
    )) == host
