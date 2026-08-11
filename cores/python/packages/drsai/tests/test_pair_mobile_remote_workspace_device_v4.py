from __future__ import annotations

import argparse
import asyncio
import importlib.util
import json
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[5]
SPEC = importlib.util.spec_from_file_location(
    "pair_mobile_remote_workspace_device_v4",
    ROOT / "scripts/pair_mobile_remote_workspace_device_v4.py",
)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def arguments(tmp_path: Path) -> argparse.Namespace:
    return argparse.Namespace(
        runtime_id="runtime-a",
        base_url="https://ai-dev.ihep.ac.cn/api/runtime-relay/",
        gateway_url="http://127.0.0.1:18642",
        token_path=tmp_path / "token",
        device="device-a",
        package="ai.drsai.remote.debug",
        adb="adb",
        phase_timeout_seconds=120,
        pair_timeout_seconds=120,
        output=tmp_path / "report.json",
    )


def test_collect_pairs_once_and_never_exports_grant(monkeypatch, tmp_path: Path) -> None:
    def fake_phase(args, device, name):
        if name == "device-proof":
            return {"device_proof_sha256": "a" * 64}
        if name == "pre":
            return {"target_visible": False, "catalog_count": 0}
        return {
            "target_visible": True,
            "runtime_status": "online",
            "directory_ui_visible": True,
            "session_list_ui_visible": True,
            "workspace_count": 2,
            "session_count": 3,
        }

    class Client:
        def __init__(self, *args, **kwargs):
            pass

    async def fake_pair(args, client, device):
        return "private-grant-id"

    monkeypatch.setattr(MODULE, "phase", fake_phase)
    monkeypatch.setattr(MODULE, "GatewayPairingClient", Client)
    monkeypatch.setattr(MODULE, "_pair", fake_pair)
    monkeypatch.setattr(
        MODULE,
        "capture_screenshot",
        lambda args, name: {
            "screenshot_artifact": "release/evidence.png",
            "screenshot_sha256": "b" * 64,
        },
    )
    report = asyncio.run(MODULE.collect(arguments(tmp_path)))
    assert report["passed"] is True
    assert [row["name"] for row in report["checks"]] == [
        "pre_pair_invisible",
        "pair_and_catalog",
    ]
    encoded = json.dumps(report)
    assert "private-grant-id" not in encoded
    assert len(report["grant_consumed_sha256"]) == 64


@pytest.mark.parametrize(
    "proof",
    [None, "short", "g" * 64],
)
def test_invalid_device_proof_fails_closed(proof) -> None:
    with pytest.raises(RuntimeError, match="v4_device_proof_invalid"):
        MODULE._require_proof(proof)
