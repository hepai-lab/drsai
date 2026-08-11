from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]


def test_catalog_has_one_unique_p5_entry_for_every_phase() -> None:
    result = subprocess.run(
        [sys.executable, str(ROOT / "scripts/remote_workspace.py"), "accept", "--list"],
        cwd=ROOT, check=True, capture_output=True, text=True,
    )
    payload = json.loads(result.stdout)
    assert payload["schema_version"] == "p5/1"
    phases = payload["phases"]
    assert {item["phase"] for item in phases} == {
        "architecture", "local", "real-device", "session-catalog", "interaction", "two-device", "stability", "secret-scan",
        "long-session", "push-preflight", "evidence", "finalize",
    }
    assert len(phases) == len({item["driver"] for item in phases})
    assert all(item["protocol"] == "oaep/1+owop/1" for item in phases)


def test_release_automation_does_not_call_legacy_driver_directly() -> None:
    roots = [ROOT / ".github", ROOT / "package.json"]
    forbidden = (
        "mobile_remote_workspace_acceptance_v2.py", "mobile_remote_workspace_acceptance_v3.py",
        "mobile_remote_workspace_acceptance_v4.py", "finalize_mobile_remote_workspace_release_v2.py",
        "finalize_mobile_remote_workspace_release_v3.py", "finalize_mobile_remote_workspace_release_v4.py",
    )
    violations: list[str] = []
    for root in roots:
        files = [root] if root.is_file() else list(root.rglob("*")) if root.exists() else []
        for path in files:
            if not path.is_file():
                continue
            text = path.read_text(encoding="utf-8", errors="ignore")
            if any(name in text for name in forbidden):
                violations.append(str(path.relative_to(ROOT)))
    assert violations == []


def test_local_phase_runs_p5_component_gate_not_a_legacy_ledger() -> None:
    spec = importlib.util.spec_from_file_location("remote_workspace", ROOT / "scripts/remote_workspace.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.PHASES["local"][2] == "accept_remote_workspace_local_p5.py"


def test_long_session_phase_routes_to_physical_p5_gate() -> None:
    spec = importlib.util.spec_from_file_location("remote_workspace", ROOT / "scripts/remote_workspace.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.PHASES["long-session"][2] == "accept_mobile_remote_workspace_long_session_p5.py"


def test_session_catalog_phase_routes_to_authoritative_realtime_gate() -> None:
    spec = importlib.util.spec_from_file_location("remote_workspace", ROOT / "scripts/remote_workspace.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.PHASES["session-catalog"][2] == (
        "accept_mobile_remote_workspace_session_catalog_p5.py"
    )


def test_interaction_phase_routes_to_physical_response_loss_gate() -> None:
    spec = importlib.util.spec_from_file_location("remote_workspace", ROOT / "scripts/remote_workspace.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.PHASES["interaction"][2] == (
        "accept_mobile_remote_workspace_interaction_p5.py"
    )


def test_secret_scan_phase_routes_only_through_p5_operator_entry() -> None:
    spec = importlib.util.spec_from_file_location("remote_workspace", ROOT / "scripts/remote_workspace.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.PHASES["secret-scan"][2] == "accept_remote_workspace_secret_scan_p5.py"

    secret_spec = importlib.util.spec_from_file_location(
        "p5_secret_entry", ROOT / "scripts/accept_remote_workspace_secret_scan_p5.py",
    )
    assert secret_spec and secret_spec.loader
    secret_module = importlib.util.module_from_spec(secret_spec)
    secret_spec.loader.exec_module(secret_module)
    assert secret_module.OPERATIONS == {
        "android": "collect_android_secret_scan_p5.py",
        "windows": "collect_windows_secret_scan_v3.py",
        "assemble": "assemble_remote_workspace_secret_scan_p5.py",
    }
