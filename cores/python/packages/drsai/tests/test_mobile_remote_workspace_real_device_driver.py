from __future__ import annotations

import argparse
import asyncio
import importlib.util
import json
import subprocess
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path


ROOT = Path(__file__).resolve().parents[5]
SCRIPT = ROOT / "scripts/accept_mobile_remote_workspace_real_device_v2.py"
SPEC = importlib.util.spec_from_file_location("real_device_acceptance", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def args() -> argparse.Namespace:
    return argparse.Namespace(
        adb="adb",
        device="device",
        package="ai.drsai.remote.debug",
        runtime_id="runtime-one",
        base_url="https://relay.example/",
        phase_timeout_seconds=30,
        pair_timeout_seconds=1,
        output=ROOT / "release/product-evidence/mobile-remote-workspace-v2/test-real-device.json",
    )


def test_capture_screenshot_writes_png_and_only_reports_path_and_hash(
    monkeypatch, tmp_path: Path,
) -> None:
    png = b"\x89PNG\r\n\x1a\nreal-device-proof"
    namespace = args()
    namespace.output = ROOT / "release/product-evidence/mobile-remote-workspace-v2/test-report.json"
    monkeypatch.setattr(
        MODULE.subprocess,
        "run",
        lambda *_args, **_kwargs: subprocess.CompletedProcess([], 0, png, b""),
    )
    proof = MODULE.capture_screenshot(namespace, "catalog")
    path = ROOT / proof["screenshot_artifact"]
    try:
        assert path.read_bytes() == png
        assert proof["screenshot_sha256"] == __import__("hashlib").sha256(png).hexdigest()
        assert set(proof) == {"screenshot_artifact", "screenshot_sha256"}
    finally:
        path.unlink(missing_ok=True)


def test_phase_parses_sanitized_proof_and_expected_failure(monkeypatch) -> None:
    proof = {"phase": "post", "runtime_id": "runtime-one", "target_visible": True}
    monkeypatch.setattr(
        MODULE,
        "adb",
        lambda *_args, **_kwargs: subprocess.CompletedProcess(
            [], 0,
            f"INSTRUMENTATION_STATUS: realDeviceProof={json.dumps(proof)}\nOK (1 test)\n",
            "",
        ),
    )
    assert MODULE.phase(args(), "post") == proof

    monkeypatch.setattr(
        MODULE,
        "adb",
        lambda *_args, **_kwargs: subprocess.CompletedProcess(
            [], 0, "FAILURES!!!\n", ""
        ),
    )
    assert MODULE.phase(args(), "post", expect_success=False) is None


def test_phase_passes_interaction_inputs_without_copying_them_into_proof(monkeypatch) -> None:
    captured: list[str] = []
    proof = {
        "phase": "interaction",
        "runtime_id": "runtime-one",
        "message_sha256": "a" * 64,
    }

    def fake_adb(_args, *command, **_kwargs):
        captured.extend(command)
        return subprocess.CompletedProcess(
            [], 0,
            f"OPENDRSAI_REAL_DEVICE_PROOF={json.dumps(proof)}\nOK (1 test)\n",
            "",
        )

    monkeypatch.setattr(MODULE, "adb", fake_adb)
    result = MODULE.phase(
        args(),
        "interaction",
        extras={
            "interactionWorkspaceId": "workspace-one",
            "interactionMessage": "temporary message; canary",
        },
    )
    assert result == proof
    assert "interactionWorkspaceId" in captured
    assert "workspace-one" in captured
    assert "interactionMessage" in captured
    assert "'temporary message; canary'" in captured
    assert "temporary message; canary" not in json.dumps(result)


def test_pairing_report_never_contains_payload_or_code(monkeypatch) -> None:
    secret_payload = "opendrsai://associate?code=grant-secret-canary"

    class Grant:
        grant_id = "grant-one"
        payload = secret_payload
        status = "pending"
        expires_at = datetime.now(UTC) + timedelta(minutes=5)

    consumed = Grant()
    consumed.status = "consumed"

    class Service:
        async def create(self):
            return Grant()

        async def read(self, _grant_id):
            return consumed

        async def revoke(self, _grant_id):
            raise AssertionError("successful dispatch must not revoke")

    monkeypatch.setattr(
        MODULE,
        "adb",
        lambda *_args, **_kwargs: subprocess.CompletedProcess([], 0, "ok", ""),
    )
    async def no_sleep(_seconds):
        return None
    monkeypatch.setattr(MODULE.asyncio, "sleep", no_sleep)
    report = asyncio.run(MODULE.create_and_consume_grant(args(), Service()))
    encoded = json.dumps(report)
    assert report["status"] == "consumed"
    assert "payload" not in report
    assert "code" not in report
    assert secret_payload not in encoded
    assert "grant-secret-canary" not in encoded


def test_pairing_dispatch_quotes_uri_for_remote_adb_shell(monkeypatch) -> None:
    secret_payload = (
        "opendrsai://associate?v=1&code=grant-secret-canary"
        "&relay=https%3A%2F%2Frelay.example%2F"
    )
    captured: list[str] = []

    class Grant:
        grant_id = "grant-one"
        payload = secret_payload
        status = "pending"
        expires_at = datetime.now(UTC) + timedelta(minutes=5)

    consumed = Grant()
    consumed.status = "consumed"

    class Service:
        async def create(self):
            return Grant()

        async def read(self, _grant_id):
            return consumed

        async def revoke(self, _grant_id):
            raise AssertionError("successful dispatch must not revoke")

    def fake_adb(_args, *command, **_kwargs):
        captured.extend(command)
        return subprocess.CompletedProcess([], 0, "ok", "")

    async def no_sleep(_seconds):
        return None

    monkeypatch.setattr(MODULE, "adb", fake_adb)
    monkeypatch.setattr(MODULE.asyncio, "sleep", no_sleep)
    report = asyncio.run(MODULE.create_and_consume_grant(args(), Service()))
    dispatched = captured[captured.index("-d") + 1]
    assert dispatched == f"'{secret_payload}'"
    assert report["status"] == "consumed"


def test_gateway_pairing_client_uses_authenticated_loopback_without_exposing_token(
    tmp_path: Path,
) -> None:
    token = "temporary_gateway_instance_token_1234567890"
    token_path = tmp_path / "instance-token"
    token_path.write_text(token, encoding="utf-8")
    requests: list[tuple[str, str, dict[str, str]]] = []

    class Response:
        status = 200

        def __init__(self, body):
            self.body = body

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def json(self, **_kwargs):
            return self.body

    class Session:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        def request(self, method, url, headers, **kwargs):
            requests.append((method, url, headers))
            if url.endswith("/status"):
                return Response({"state": "ready", "runtime_id": "runtime-one"})
            if url.endswith("/fault-injections/connection-owner-restart"):
                return Response({
                    "fault_id": "fault_correlation",
                    "runtime_id": "runtime-one",
                    "status": "scheduled",
                    "generation": 3,
                    "expires_at": "2026-07-26T06:00:00Z",
                    "recovery": {
                        "route_available_after_ttl": True,
                        "required_generation": 4,
                        "presence_required": True,
                        "event_replay_preserved": True,
                    },
                })
            if url.endswith("/v1/mobile-pairing/diagnostics/workspace-lifecycles"):
                return Response({
                    "counts": {"active": 2, "archived": 1, "removed": 1},
                    "total": 4,
                })
            return Response({
                "grant_id": "ag_" + "1" * 32,
                "status": "pending",
                "expires_at": "2026-07-26T06:00:00Z",
                "payload": "opendrsai://associate?v=1&code=secret",
            })

    client = MODULE.GatewayPairingClient(
        "http://127.0.0.1:18643",
        token_path,
        session_factory=lambda **_kwargs: Session(),
    )
    readiness = asyncio.run(client.readiness())
    grant = asyncio.run(client.create())
    fault = asyncio.run(client.inject_connection_owner_restart(5))
    counts = asyncio.run(client.workspace_lifecycle_counts())
    assert readiness["runtime_id"] == "runtime-one"
    assert grant.status == "pending"
    assert fault["recovery"]["required_generation"] == 4
    assert counts == {"active": 2, "archived": 1, "removed": 1}
    assert all(headers["X-OpenDrSai-Gateway-Token"] == token for _, _, headers in requests)
    assert token not in json.dumps({"readiness": readiness, "grant_id": grant.grant_id})


def test_lifecycle_evidence_provisions_only_missing_hidden_states(tmp_path: Path) -> None:
    namespace = args()
    namespace.output = tmp_path / "real-device.json"

    class Service:
        counts = {"active": 2, "archived": 0, "removed": 0}
        created: list[str] = []

        async def workspace_lifecycle_counts(self):
            return dict(self.counts)

        async def create_lifecycle_fixture(self, path: Path, lifecycle: str):
            assert path.is_dir()
            self.created.append(lifecycle)
            self.counts[lifecycle] += 1

    service = Service()
    result = asyncio.run(MODULE.ensure_lifecycle_evidence(namespace, service))
    assert result == {"active": 2, "archived": 1, "removed": 1}
    assert service.created == ["archived", "removed"]
    assert not (tmp_path / ".runtime-lifecycle-fixtures").exists()


def test_gateway_wait_observes_offline_and_recovered_states(monkeypatch) -> None:
    class Client:
        calls = 0

        async def readiness(self):
            self.calls += 1
            if self.calls == 1:
                raise OSError("runtime stopped")
            return {"state": "ready", "runtime_id": "runtime-one"}

    async def no_sleep(_seconds):
        return None

    monkeypatch.setattr(MODULE.asyncio, "sleep", no_sleep)
    client = Client()
    assert asyncio.run(MODULE.wait_gateway(
        client, expected_ready=False, timeout_seconds=1,
    )) is None
    recovered = asyncio.run(MODULE.wait_gateway(
        client, expected_ready=True, timeout_seconds=1,
    ))
    assert recovered == {"state": "ready", "runtime_id": "runtime-one"}
