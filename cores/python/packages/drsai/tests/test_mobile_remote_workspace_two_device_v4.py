from __future__ import annotations

import asyncio
import importlib.util
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest


ROOT = Path(__file__).resolve().parents[5]
SCRIPT = ROOT / "scripts/accept_mobile_remote_workspace_two_device_v4.py"
SPEC = importlib.util.spec_from_file_location("mobile_two_device_v4", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def inputs():
    return (
        ["a" * 64, "b" * 64],
        {"target_visible": False},
        {"target_visible": True},
        {"target_visible": True},
        {"stream_closed_immediately": True, "subsequent_status": 403},
        {"other_device_stream_open": True, "subsequent_status": 200},
        0.5,
        True,
    )


def test_two_device_report_is_minimal_and_release_compatible() -> None:
    result = MODULE.build_report(*inputs())
    assert result["passed"] is True and len(result["devices"]) == 2
    isolation, revoked = result["checks"]
    assert isolation["credential_copy_rejected"] is True
    assert revoked["close_seconds"] == 0.5
    assert all("association_id" not in row for row in result["checks"])


@pytest.mark.parametrize("index,value", [(1, {"target_visible": True}), (6, 5.0), (7, False)])
def test_two_device_report_fails_closed(index: int, value: object) -> None:
    values = list(inputs())
    values[index] = value
    with pytest.raises(RuntimeError, match="v4_two_device_isolation_invalid"):
        MODULE.build_report(*values)


def test_pairing_dispatch_quotes_secret_uri_for_remote_adb_shell(monkeypatch) -> None:
    payload = (
        "opendrsai://associate?v=1&code=grant-secret-canary"
        "&relay=https%3A%2F%2Frelay.example%2F"
    )
    captured: list[str] = []

    class Client:
        async def create(self):
            return SimpleNamespace(grant_id="grant-one", payload=payload)

        async def read(self, _grant_id):
            return SimpleNamespace(status="consumed")

        async def revoke(self, _grant_id):
            raise AssertionError("successful dispatch must not revoke")

    def fake_run(command, _timeout):
        captured.extend(command)
        return subprocess.CompletedProcess(command, 0, "", "")

    monkeypatch.setattr(MODULE, "_run", fake_run)
    grant_id = asyncio.run(
        MODULE._pair(
            SimpleNamespace(
                adb="adb",
                package="ai.drsai.remote.acceptance",
                pair_timeout_seconds=1,
            ),
            Client(),
            "device-one",
        )
    )

    assert grant_id == "grant-one"
    dispatched = captured[captured.index("-d") + 1]
    assert dispatched == f"'{payload}'"


def test_selects_the_same_named_device_whose_authenticated_watermark_advanced() -> None:
    before = {
        "items": [
            {
                "association_id": "assoc-old",
                "device_name": "samsung SM-X936C",
                "status": "active",
                "last_seen_at": "2026-08-02T10:00:00Z",
            },
            {
                "association_id": "assoc-current",
                "device_name": "samsung SM-X936C",
                "status": "active",
                "last_seen_at": "2026-08-02T10:00:00Z",
            },
        ]
    }
    after = {
        "items": [
            *before["items"][:1],
            {**before["items"][1], "last_seen_at": "2026-08-02T10:01:00Z"},
            {
                "association_id": "assoc-new-b",
                "device_name": "Google sdk_gphone64_x86_64",
                "status": "active",
                "last_seen_at": "2026-08-02T10:01:00Z",
            },
        ]
    }

    selected = MODULE._select_active_association(
        before,
        after,
        "SM-X936C",
        {"assoc-new-b"},
    )

    assert selected == "assoc-current"


def test_same_named_device_selection_fails_closed_when_watermark_is_ambiguous() -> None:
    before = {
        "items": [
            {
                "association_id": association_id,
                "device_name": "samsung SM-X936C",
                "status": "active",
                "last_seen_at": "2026-08-02T10:00:00Z",
            }
            for association_id in ("assoc-one", "assoc-two")
        ]
    }
    after = {
        "items": [
            {**row, "last_seen_at": "2026-08-02T10:01:00Z"}
            for row in before["items"]
        ]
    }

    with pytest.raises(RuntimeError, match="v4_association_identity_ambiguous"):
        MODULE._select_active_association(before, after, "SM-X936C", set())
