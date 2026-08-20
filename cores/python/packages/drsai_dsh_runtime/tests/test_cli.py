from __future__ import annotations

import json

import opendrsai_dsh_runtime.cli as cli
from opendrsai_dsh_runtime.discovery import DshInstallationStatus


def test_status_is_machine_readable_and_does_not_claim_probe_profile_available(monkeypatch, capsys) -> None:
    monkeypatch.setattr(
        cli,
        "discover_dsh_installation",
        lambda: DshInstallationStatus(
            "installed_unverified",
            True,
            False,
            "0.1.0-rc.5",
            "0.1.0-rc.5",
            "python-runtime-wheel",
            "linux",
            "x86_64",
            "runtime_probe_required",
            "probe",
        ),
    )
    assert cli.main(["status"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["bridge"]["name"] == "opendrsai-dsh-oaep-runtime"
    assert payload["installation"]["installed"] is True
    assert payload["installation"]["available"] is False
    assert payload["protocols"]["oaep"]["profiles"] == ["oaep.session-stream/1"]
    probe = next(profile for profile in payload["profiles"] if profile["profile_id"] == "dsh-sdk/0.1.0-rc.5")
    assert probe["production_ready"] is False
