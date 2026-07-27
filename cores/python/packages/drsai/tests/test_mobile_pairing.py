from __future__ import annotations

import asyncio
import json
from urllib.parse import parse_qs, urlparse
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from drsai.relay.mobile_pairing import (
    AiohttpMobilePairingTransport,
    MobilePairingError,
    MobilePairingGrant,
    MobileAssociation,
    MobilePairingService,
    build_pairing_payload,
    relay_https_from_wss,
)
from drsai.relay.runtime_client import RuntimeCredential
from drsai.relay.registry import RelayRegistry
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization
import base64


class FakeCredentialStore:
    def __init__(self, path: Path, credential: RuntimeCredential | Exception) -> None:
        self.path, self.credential = path, credential

    def load(self) -> RuntimeCredential:
        if isinstance(self.credential, Exception):
            raise self.credential
        return self.credential


class FakeTransport:
    def __init__(self, relay_url: str) -> None:
        self.relay_url = relay_url
        self.calls: list[tuple[str, str]] = []
        self.expires = datetime.now(UTC) + timedelta(seconds=120)

    async def create(self, credential: RuntimeCredential) -> MobilePairingGrant:
        self.calls.append(("create", credential.runtime_id))
        return MobilePairingGrant("ag_" + "a" * 32, "A_secure-code_123456", self.expires, "pending")

    async def read(self, credential: RuntimeCredential, grant_id: str) -> MobilePairingGrant:
        self.calls.append(("read", grant_id))
        return MobilePairingGrant(grant_id, None, self.expires, "consumed")

    async def revoke(self, credential: RuntimeCredential, grant_id: str) -> MobilePairingGrant:
        self.calls.append(("revoke", grant_id))
        return MobilePairingGrant(grant_id, None, self.expires, "revoked")

    async def list_associations(self, credential: RuntimeCredential) -> list[MobileAssociation]:
        self.calls.append(("associations", credential.runtime_id))
        return [MobileAssociation(
            "assoc_" + "b" * 32,
            "sub_" + "c" * 12,
            "dev_" + "d" * 12,
            "Samsung SM-X936C",
            "active",
            "online",
            datetime.now(UTC),
            datetime.now(UTC),
        )]

    async def revoke_association(
        self, credential: RuntimeCredential, association_id: str,
    ) -> MobileAssociation:
        self.calls.append(("revoke_association", association_id))
        return MobileAssociation(
            association_id,
            "sub_" + "c" * 12,
            "dev_" + "d" * 12,
            "Samsung SM-X936C",
            "revoked",
            "revoked",
            datetime.now(UTC),
            datetime.now(UTC),
            datetime.now(UTC),
        )

    async def revoke_enrollment(self, credential: RuntimeCredential) -> dict:
        self.calls.append(("revoke_enrollment", credential.runtime_id))
        return {
            "runtime_id": credential.runtime_id,
            "status": "revoked",
            "revoked_at": datetime.now(UTC).isoformat(),
        }

    async def inject_connection_owner_restart(
        self, credential: RuntimeCredential, ttl_seconds: int,
    ) -> dict:
        self.calls.append(("fault", f"{credential.runtime_id}:{ttl_seconds}"))
        generation = 7
        return {
            "fault_id": "fault_test-correlation",
            "runtime_id": credential.runtime_id,
            "status": "scheduled",
            "generation": generation,
            "expires_at": (datetime.now(UTC) + timedelta(seconds=ttl_seconds)).isoformat(),
            "recovery": {
                "route_available_after_ttl": True,
                "required_generation": generation + 1,
                "presence_required": True,
                "event_replay_preserved": True,
            },
        }


def configured_service(tmp_path: Path) -> tuple[MobilePairingService, FakeTransport]:
    relay = tmp_path / "runtime" / "relay"
    relay.mkdir(parents=True)
    credential_path = relay / "credential.dpapi"
    credential_path.write_bytes(b"encrypted-not-a-token")
    (relay / "relay-wss-url").write_text("wss://ai.ihep.ac.cn/api/runtime-relay/v1/runtime-connect", encoding="utf-8")
    transport = FakeTransport("https://ai.ihep.ac.cn/api/runtime-relay")
    service = MobilePairingService(
        tmp_path,
        credential_store=FakeCredentialStore(credential_path, RuntimeCredential("rt_one", "canary-runtime-token")),
        transport_factory=lambda url: transport,
    )
    return service, transport


def test_relay_url_derivation_and_pairing_payload_are_canonical() -> None:
    root = relay_https_from_wss("wss://ai.ihep.ac.cn/api/runtime-relay/v1/runtime-connect")
    assert root == "https://ai.ihep.ac.cn/api/runtime-relay"
    payload = build_pairing_payload("A_secure-code_123456", root)
    assert payload == (
        "opendrsai://associate?v=1&environment=production&"
        "issuer=https%3A%2F%2Fai.ihep.ac.cn&code=A_secure-code_123456"
    )
    for unsafe in ("ws://ai.ihep.ac.cn/v1/runtime-connect", "wss://user@ai.ihep.ac.cn/v1/runtime-connect",
                   "https://ai.ihep.ac.cn/v1/runtime-connect?token=x", "wss://127.0.0.1/v1/runtime-connect",
                   "wss://ai.ihep.ac.cn.evil.example/v1/runtime-connect", "wss://ai.ihep.ac.cn:8443/v1/runtime-connect",
                   "wss://ai.ihep.ac.cn/v1/runtime-connect#fragment", "wss://ai.ihep.ac.cn:broken/v1/runtime-connect"):
        with pytest.raises(MobilePairingError, match="configuration"):
            relay_https_from_wss(unsafe)


def test_production_pairing_payload_matches_cross_platform_fixture() -> None:
    root = Path(__file__).resolve().parents[5]
    fixtures = json.loads((root / "cores/protocol/relay/mobile-pairing-fixtures.json").read_text(encoding="utf-8"))
    production = next(item for item in fixtures["valid"] if item["name"] == "production")
    assert build_pairing_payload(production["code"], "https://ai.ihep.ac.cn/api/runtime-relay") == production["payload"]


def test_service_keeps_runtime_token_out_of_public_grant(tmp_path: Path) -> None:
    service, transport = configured_service(tmp_path)
    assert service.readiness() == {
        "state": "ready", "action": "create", "runtime_id": "rt_one", "environment": "production",
    }
    created = asyncio.run(service.create())
    public = created.public()
    assert public["status"] == "pending" and public["payload"].startswith("opendrsai://associate?")
    assert "canary-runtime-token" not in repr(public)
    assert "A_secure-code_123456" not in repr({key: value for key, value in public.items() if key != "payload"})
    assert asyncio.run(service.read(created.grant_id)).status == "consumed"
    assert asyncio.run(service.revoke(created.grant_id)).status == "revoked"
    assert [item[0] for item in transport.calls] == ["create", "read", "revoke"]


def test_service_lists_redacted_associations_and_revokes_selected_device(tmp_path: Path) -> None:
    service, transport = configured_service(tmp_path)

    listed = asyncio.run(service.associations())
    assert [item.subject_summary for item in listed] == ["sub_" + "c" * 12]
    assert "canary-runtime-token" not in repr([item.public() for item in listed])
    revoked = asyncio.run(
        service.revoke_association("assoc_" + "b" * 32)
    )
    assert revoked.status == "revoked"
    assert [item[0] for item in transport.calls] == [
        "associations", "revoke_association",
    ]


def test_service_schedules_guarded_connection_owner_restart_without_exposing_token(
    tmp_path: Path,
) -> None:
    service, transport = configured_service(tmp_path)
    result = asyncio.run(service.inject_connection_owner_restart(5))
    assert result["status"] == "scheduled"
    assert result["recovery"]["required_generation"] == result["generation"] + 1
    assert transport.calls == [("fault", "rt_one:5")]
    assert "canary-runtime-token" not in json.dumps(result)


def test_readiness_distinguishes_missing_and_broken_credentials(tmp_path: Path) -> None:
    missing = MobilePairingService(tmp_path)
    assert missing.readiness()["state"] == "not_registered"
    relay = tmp_path / "runtime" / "relay"
    relay.mkdir(parents=True, exist_ok=True)
    credential = relay / "credential.dpapi"
    credential.write_bytes(b"broken")
    (relay / "relay-wss-url").write_text("wss://ai.ihep.ac.cn/v1/runtime-connect", encoding="utf-8")
    broken = MobilePairingService(tmp_path, credential_store=FakeCredentialStore(credential, ValueError("secret")))
    assert broken.readiness() == {"state": "credential_invalid", "action": "repair_runtime"}
    with pytest.raises(MobilePairingError) as failure:
        asyncio.run(broken.create())
    assert failure.value.code == "runtime_credential_invalid" and "secret" not in str(failure.value)


def test_http_error_mapping_is_structured_and_secret_free() -> None:
    cases = {
        401: ("runtime_credential_invalid", False),
        403: ("runtime_access_forbidden", False),
        404: ("access_grant_not_found", False),
        429: ("pairing_rate_limited", True),
        503: ("relay_http_error", True),
    }
    for status, expected in cases.items():
        with pytest.raises(MobilePairingError) as failure:
            AiohttpMobilePairingTransport._raise_http(status)
        assert (failure.value.code, failure.value.retryable) == expected


def test_fault_injection_disabled_is_not_misreported_as_invalid_token() -> None:
    with pytest.raises(MobilePairingError) as failure:
        AiohttpMobilePairingTransport._raise_http(
            403,
            "correlation-safe-403",
            "fault_injection_disabled",
        )
    assert failure.value.code == "fault_injection_disabled"
    assert failure.value.action == "enable_test_faults"
    assert failure.value.correlation_id == "correlation-safe-403"


def test_relay_error_code_reads_only_valid_structured_code() -> None:
    class Response:
        def __init__(self, body):
            self.body = body

        async def json(self):
            return self.body

    assert asyncio.run(
        AiohttpMobilePairingTransport._error_code(
            Response({"detail": {"code": "fault_injection_disabled", "message": "secret"}})
        )
    ) == "fault_injection_disabled"
    assert asyncio.run(
        AiohttpMobilePairingTransport._error_code(
            Response({"detail": {"code": "INVALID TOKEN"}})
        )
    ) is None


def test_offline_readiness_is_sticky_until_a_successful_relay_call(tmp_path: Path) -> None:
    service, transport = configured_service(tmp_path)

    async def unavailable(_credential: RuntimeCredential) -> MobilePairingGrant:
        raise MobilePairingError("relay_unavailable", "Runtime Relay is unavailable.", retryable=True, action="retry")

    transport.create = unavailable  # type: ignore[method-assign]
    with pytest.raises(MobilePairingError):
        asyncio.run(service.create())
    assert service.readiness()["state"] == "offline"
    assert asyncio.run(service.read("ag_" + "a" * 32)).status == "consumed"
    assert service.readiness()["state"] == "ready"


def test_pairing_secrets_are_not_persisted_or_returned_outside_payload(tmp_path: Path) -> None:
    service, _ = configured_service(tmp_path)
    public = asyncio.run(service.create()).public()
    persisted = b"\n".join(path.read_bytes() for path in tmp_path.rglob("*") if path.is_file())
    assert b"canary-runtime-token" not in persisted
    assert b"A_secure-code_123456" not in persisted
    assert "code" not in public
    assert set(public) == {"grant_id", "expires_at", "status", "payload"}


def test_correlation_id_is_safe_and_propagated() -> None:
    with pytest.raises(MobilePairingError) as failure:
        AiohttpMobilePairingTransport._raise_http(503, "correlation-safe-123")
    assert failure.value.correlation_id == "correlation-safe-123"
    assert "token" not in failure.value.message.lower()


def test_association_decoder_requires_device_identity_fields() -> None:
    created_at = datetime.now(UTC).isoformat()
    decoded = AiohttpMobilePairingTransport._decode_association({
        "association_id": "assoc_" + "a" * 32,
        "subject_summary": "sub_" + "b" * 12,
        "device_summary": "dev_" + "c" * 12,
        "device_name": "Samsung SM-X936C",
        "status": "active",
        "access_state": "online",
        "created_at": created_at,
        "last_seen_at": created_at,
        "revoked_at": None,
    })
    assert decoded.device_summary == "dev_" + "c" * 12
    assert decoded.device_name == "Samsung SM-X936C"

    for missing in ("device_summary", "device_name", "created_at", "access_state"):
        payload = decoded.public()
        payload.pop(missing)
        with pytest.raises(MobilePairingError) as failure:
            AiohttpMobilePairingTransport._decode_association(payload)
        assert failure.value.code == "relay_response_invalid"


def test_transport_retries_once_with_correlation_and_disables_redirects() -> None:
    calls: list[dict] = []
    responses = [503, 200]

    class Response:
        def __init__(self, status: int) -> None:
            self.status = status
            self.headers = {"X-Correlation-ID": "relay-correlation"}

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        async def json(self):
            return {"grant_id": "ag_" + "b" * 32, "code": "Retry_secure_code_1",
                    "expires_at": (datetime.now(UTC) + timedelta(seconds=120)).isoformat(), "status": "pending"}

    class Session:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return False

        def request(self, method, url, **kwargs):
            calls.append({"method": method, "url": url, **kwargs})
            return Response(responses.pop(0))

    transport = AiohttpMobilePairingTransport("https://ai-dev.ihep.ac.cn/api/runtime-relay",
                                               session_factory=lambda **_kwargs: Session())
    grant = asyncio.run(transport.create(RuntimeCredential("rt_retry", "runtime-secret")))
    assert grant.status == "pending" and len(calls) == 2
    assert all(call["allow_redirects"] is False for call in calls)
    assert all(call["headers"]["X-Runtime-Token"] == "runtime-secret" for call in calls)
    assert all(call["headers"]["X-Correlation-ID"] for call in calls)


def test_runtime_payload_to_android_association_closed_loop(tmp_path: Path) -> None:
    registry = RelayRegistry()
    private = Ed25519PrivateKey.generate()
    public = base64.urlsafe_b64encode(private.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw)).rstrip(b"=").decode()
    runtime_id, token = registry.register(registry.issue_registration_code(), "Windows Desktop", "1.5.1",
                                          public, "pairing-closed-loop")

    class RegistryTransport:
        async def create(self, credential: RuntimeCredential) -> MobilePairingGrant:
            grant_id, code, expires = registry.issue_access_grant(credential.runtime_id, credential.registration_token)
            return MobilePairingGrant(grant_id, code, expires, "pending")

        async def read(self, credential: RuntimeCredential, grant_id: str) -> MobilePairingGrant:
            status, expires = registry.access_grant_status(credential.runtime_id, credential.registration_token, grant_id)
            return MobilePairingGrant(grant_id, None, expires, status)

        async def revoke(self, credential: RuntimeCredential, grant_id: str) -> MobilePairingGrant:
            status, expires = registry.revoke_access_grant(credential.runtime_id, credential.registration_token, grant_id)
            return MobilePairingGrant(grant_id, None, expires, status)

    relay = tmp_path / "runtime" / "relay"
    relay.mkdir(parents=True)
    credential_path = relay / "credential.dpapi"
    credential_path.write_bytes(b"dpapi-ciphertext")
    (relay / "relay-wss-url").write_text("wss://ai.ihep.ac.cn/api/runtime-relay/v1/runtime-connect", encoding="utf-8")
    service = MobilePairingService(tmp_path,
        credential_store=FakeCredentialStore(credential_path, RuntimeCredential(runtime_id, token)),
        transport_factory=lambda _url: RegistryTransport())

    desktop_grant = asyncio.run(service.create())
    query = parse_qs(urlparse(desktop_grant.payload or "").query)
    assert query["v"] == ["1"] and query["environment"] == ["production"]
    assert registry.associate(
        "android-hepai-subject",
        query["code"][0],
        "android.test-device",
        "Android test device",
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    ) == runtime_id
    assert asyncio.run(service.read(desktop_grant.grant_id)).status == "consumed"
    assert registry.list_runtimes("android-hepai-subject")[0][0].runtime.runtime_id == runtime_id


def test_full_runtime_exposes_authenticated_pairing_control_api(monkeypatch, tmp_path: Path) -> None:
    token = "gateway-test-token"
    monkeypatch.setenv("DRSAI_HOME", str(tmp_path))
    monkeypatch.setenv("OPENDRSAI_GATEWAY_INSTANCE_TOKEN", token)
    from drsai.backend import gateway

    gateway._WORKSPACE = tmp_path / "workspace-state"
    gateway._DATASET = gateway._WORKSPACE / "drsai"
    gateway._DATASET.mkdir(parents=True, exist_ok=True)
    gateway._DB_URI = f"sqlite:///{gateway._DATASET}/drsai.db"
    gateway._db_manager = None
    gateway._runtime_registry_instance = None
    service, _ = configured_service(tmp_path)
    gateway._mobile_pairing_service_instance = service
    headers = {"X-OpenDrSai-Gateway-Token": token}
    try:
        with TestClient(gateway.app) as client:
            active_path = tmp_path / "active-workspace"
            archived_path = tmp_path / "archived-workspace"
            removed_path = tmp_path / "removed-workspace"
            for path in (active_path, archived_path, removed_path):
                path.mkdir()
            registry = gateway._runtime_registry()
            registry.open_workspace(str(active_path))
            archived = registry.open_workspace(str(archived_path))
            removed = registry.open_workspace(str(removed_path))
            registry.close_workspace(archived.workspace_id)
            registry.remove_workspace(removed.workspace_id)
            readiness = client.get("/v1/mobile-pairing/status", headers=headers)
            assert readiness.status_code == 200 and readiness.json()["state"] == "ready"
            lifecycles = client.get(
                "/v1/mobile-pairing/diagnostics/workspace-lifecycles",
                headers=headers,
            )
            assert lifecycles.status_code == 200
            assert lifecycles.json() == {
                "counts": {"active": 1, "archived": 1, "removed": 1},
                "total": 3,
            }
            assert "path" not in lifecycles.text.lower()
            assert client.get(
                "/v1/mobile-pairing/diagnostics/workspace-lifecycles"
            ).status_code == 401
            created = client.post("/v1/mobile-pairing/grants", headers=headers)
            assert created.status_code == 200 and created.json()["payload"].startswith("opendrsai://associate?")
            grant_id = created.json()["grant_id"]
            assert client.get(f"/v1/mobile-pairing/grants/{grant_id}", headers=headers).json()["status"] == "consumed"
            assert client.delete(f"/v1/mobile-pairing/grants/{grant_id}", headers=headers).json()["status"] == "revoked"
            associations = client.get("/v1/mobile-pairing/associations", headers=headers)
            assert associations.status_code == 200
            association_id = associations.json()["items"][0]["association_id"]
            revoked = client.delete(
                f"/v1/mobile-pairing/associations/{association_id}",
                headers=headers,
            )
            assert revoked.status_code == 200 and revoked.json()["status"] == "revoked"
            fault = client.post(
                "/v1/mobile-pairing/fault-injections/connection-owner-restart",
                headers=headers,
                json={"ttl_seconds": 5},
            )
            assert fault.status_code == 202
            assert fault.json()["recovery"]["required_generation"] == 8
            assert client.post(
                "/v1/mobile-pairing/fault-injections/connection-owner-restart",
                json={"ttl_seconds": 5},
            ).status_code == 401
            enrollment = client.delete("/v1/mobile-pairing/enrollment", headers=headers)
            assert enrollment.status_code == 200 and enrollment.json()["status"] == "revoked"
            assert client.get("/v1/mobile-pairing/status", headers=headers).json()["state"] == "not_registered"
            assert client.get("/v1/mobile-pairing/status").status_code == 401
    finally:
        gateway._mobile_pairing_service_instance = None
        gateway._runtime_registry_instance = None
