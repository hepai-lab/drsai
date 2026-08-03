from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
import asyncio
from pathlib import Path
from uuid import uuid4

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi.testclient import TestClient

from drsai.relay.api import create_relay_app
from drsai.relay.generated_contract import CAPABILITIES, PROTOCOL_VERSION
from drsai.relay.models import ResourceLifecycle, Workspace
from drsai.relay.registry import RelayRegistryError


def _testing_app():
    return create_relay_app(principal_resolver=lambda request: request.headers.get("x-subject", ""))


def encoded(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


def oidc_token(subject: str, secret: bytes) -> str:
    header = encoded(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = encoded(json.dumps({
        "sub": subject, "iss": "https://ai-dev.ihep.ac.cn/api", "exp": int(time.time()) + 300,
        "aud": "hai-api", "typ": "access_token", "scope": "openid hai_api",
        "organization_id": "org-test", "sid": "session-test",
    }, separators=(",", ":")).encode())
    signature = encoded(hmac.new(secret, f"{header}.{payload}".encode(), hashlib.sha256).digest())
    return f"{header}.{payload}.{signature}"


def control(idempotency: bool = False) -> dict[str, str]:
    result = {"request_id": str(uuid4()), "correlation_id": f"corr-{uuid4()}"}
    if idempotency:
        result["idempotency_key"] = f"idem-{uuid4()}"
    return result


def association_body(code: str, device_id: str = "android-device-0001") -> dict[str, str]:
    public = Ed25519PrivateKey.generate().public_key().public_bytes(
        serialization.Encoding.Raw,
        serialization.PublicFormat.Raw,
    )
    return {
        **control(),
        "code": code,
        "device_id": device_id,
        "device_name": "Android Test Device",
        "device_public_key": encoded(public),
    }


def register(client: TestClient):
    private = Ed25519PrivateKey.generate()
    public = encoded(private.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw))
    code = client.get("/v1/admin/registration-code").json()["code"]
    response = client.post("/v1/runtimes/register", headers={"x-registration-code": code}, json={
        **control(True), "display_name": "Office PC", "version": "1.4.6", "public_key": public,
    })
    assert response.status_code == 200
    return private, response.json()["runtime_id"], response.json()["registration_token"]


def test_native_oaep_replay_is_authorized_before_cache_read() -> None:
    app = _testing_app()
    client = TestClient(app)
    _, runtime_id, token = register(client)
    app.state.registry.publish_workspaces(runtime_id, token, [
        Workspace.model_validate({
            "runtime_id": runtime_id,
            "workspace_id": "workspace-one",
            "display_name": "Project",
        })
    ])
    grant = client.post(
        f"/v1/runtimes/{runtime_id}/access-grants",
        headers={"x-runtime-token": token},
    ).json()["code"]
    assert client.post(
        "/v1/associations",
        headers={"x-subject": "alice"},
        json=association_body(grant),
    ).status_code == 200

    fixture = json.loads(
        (Path(__file__).resolve().parents[5] / "cores/protocol/oaep/examples.json")
        .read_text(encoding="utf-8")
    )
    event = dict(fixture["events"][0])
    event["source"] = {**event["source"], "runtime_id": runtime_id}
    frame = {
        "type": "event",
        "protocol": "oaep/1",
        "scope": "session",
        "runtime_id": runtime_id,
        "workspace_id": "workspace-one",
        "session_id": event["session_id"],
        "sequence": event["sequence"],
        "event": event,
    }
    asyncio.run(app.state.oaep_replay.attach(runtime_id, "generation-one"))
    asyncio.run(app.state.oaep_replay.accept(runtime_id, "generation-one", frame))
    url = (
        f"/v1/runtimes/{runtime_id}/workspaces/workspace-one/sessions/"
        f"{event['session_id']}/oaep-events?after_sequence=0&limit=100"
    )
    allowed = client.get(url, headers={"x-subject": "alice"})
    assert allowed.status_code == 200
    assert allowed.json()["data"] == [event]

    # A different authenticated subject cannot infer cached Session presence.
    denied = client.get(url, headers={"x-subject": "bob"})
    assert denied.status_code == 403
    assert "event" not in denied.text


def test_oaep_metrics_are_content_free_and_expose_schema_identity() -> None:
    client = TestClient(_testing_app())
    response = client.get("/v1/metrics/oaep")
    assert response.status_code == 200
    payload = response.json()
    assert payload["protocol"] == "oaep/1"
    assert len(payload["schema_hash"]) == 64
    assert payload["counters"] == {}
    assert not ({"event", "payload", "body", "token"} & payload.keys())


def test_registration_association_heartbeat_and_discovery_flow() -> None:
    client = TestClient(_testing_app())
    private, runtime_id, token = register(client)
    grant = client.post(f"/v1/runtimes/{runtime_id}/access-grants", headers={"x-runtime-token": token}).json()["code"]
    assert client.post("/v1/associations", headers={"x-subject": "alice"}, json=association_body(grant)).status_code == 200
    instance, nonce = "boot-01", "nonce-01"
    signature = encoded(private.sign(f"{runtime_id}\n{instance}\n{nonce}".encode()))
    heartbeat = client.post(f"/v1/runtime-connections/{runtime_id}/heartbeat", headers={"x-runtime-token": token}, json={
        **control(), "instance_id": instance, "version": "1.4.6", "capabilities": sorted(CAPABILITIES),
        "backend_health": {"codex": "healthy"}, "signature": signature, "nonce": nonce,
    })
    assert heartbeat.status_code == 200
    assert heartbeat.json()["protocol_version"] == PROTOCOL_VERSION
    assert client.get("/v1/runtimes", headers={"x-subject": "alice"}).json()["items"][0]["runtime"]["runtime_id"] == runtime_id
    assert client.get(f"/v1/runtimes/{runtime_id}/capabilities", headers={"x-subject": "alice"}).status_code == 200


def test_access_grant_status_and_revoke_lifecycle() -> None:
    client = TestClient(_testing_app())
    _, runtime_id, token = register(client)
    headers = {"x-runtime-token": token}
    created = client.post(f"/v1/runtimes/{runtime_id}/access-grants", headers=headers)
    assert created.status_code == 200
    body = created.json()
    assert body["grant_id"].startswith("ag_") and body["status"] == "pending"
    status_url = f"/v1/runtimes/{runtime_id}/access-grants/{body['grant_id']}"
    assert client.get(status_url, headers=headers).json()["status"] == "pending"
    revoked = client.delete(status_url, headers=headers)
    assert revoked.status_code == 200 and revoked.json()["status"] == "revoked"
    assert client.delete(status_url, headers=headers).json()["status"] == "revoked"
    assert client.post("/v1/associations", headers={"x-subject": "alice"},
                       json=association_body(body["code"])).status_code == 400


def test_association_and_enrollment_revocation_are_scoped_and_redacted() -> None:
    client = TestClient(_testing_app())
    _, runtime_id, runtime_token = register(client)
    runtime_headers = {"x-runtime-token": runtime_token}
    grant = client.post(
        f"/v1/runtimes/{runtime_id}/access-grants", headers=runtime_headers
    ).json()
    associated = client.post(
        "/v1/associations",
        headers={"x-subject": "alice"},
        json=association_body(grant["code"]),
    )
    assert associated.status_code == 200

    consumed = client.get(
        f"/v1/runtimes/{runtime_id}/access-grants/{grant['grant_id']}",
        headers=runtime_headers,
    ).json()
    assert consumed["status"] == "consumed"
    assert consumed["subject_summary"].startswith("sub_")
    assert "alice" not in json.dumps(consumed)
    associations = client.get(
        f"/v1/runtimes/{runtime_id}/associations", headers=runtime_headers
    ).json()
    assert len(associations) == 1
    assert associations[0]["status"] == "active"
    assert associations[0]["access_state"] == "online"
    assert associations[0]["last_seen_at"]
    assert associations[0]["device_summary"].startswith("dev_")
    assert associations[0]["device_name"] == "Android Test Device"
    assert "alice" not in json.dumps(associations)

    presence = client.post(
        f"/v1/associations/{runtime_id}/presence",
        headers={
            "x-subject": "alice",
            "x-relay-device-id": "android-device-0001",
        },
        json={"accessing": True},
    )
    assert presence.status_code == 200
    assert presence.json()["access_state"] == "accessing"
    assert "android-device-0001" not in json.dumps(presence.json())

    revoked = client.delete(
        f"/v1/associations/{runtime_id}",
        headers={
            "x-subject": "alice",
            "x-relay-device-id": "android-device-0001",
        },
    )
    assert revoked.status_code == 200
    assert revoked.json()["status"] == "revoked"
    assert client.get(
        f"/v1/runtimes/{runtime_id}/runtime", headers={"x-subject": "alice"}
    ).status_code == 403

    second_grant = client.post(
        f"/v1/runtimes/{runtime_id}/access-grants", headers=runtime_headers
    ).json()
    assert second_grant["status"] == "pending"
    enrollment = client.delete(
        f"/v1/runtimes/{runtime_id}/enrollment", headers=runtime_headers
    )
    assert enrollment.status_code == 200
    assert enrollment.json()["status"] == "revoked"
    assert client.get(
        f"/v1/runtimes/{runtime_id}/access-grants/{second_grant['grant_id']}",
        headers=runtime_headers,
    ).status_code == 401


def test_same_subject_devices_have_independent_associations_and_revocation() -> None:
    client = TestClient(_testing_app())
    _, runtime_id, runtime_token = register(client)
    runtime_headers = {"x-runtime-token": runtime_token}
    for device_id in ("android-device-0001", "android-device-0002"):
        grant = client.post(
            f"/v1/runtimes/{runtime_id}/access-grants",
            headers=runtime_headers,
        ).json()["code"]
        associated = client.post(
            "/v1/associations",
            headers={"x-subject": "alice"},
            json=association_body(grant, device_id),
        )
        assert associated.status_code == 200

    before = client.get(
        f"/v1/runtimes/{runtime_id}/associations",
        headers=runtime_headers,
    ).json()
    assert len(before) == 2
    assert len({row["association_id"] for row in before}) == 2
    assert len({row["device_summary"] for row in before}) == 2

    revoked = client.delete(
        f"/v1/associations/{runtime_id}",
        headers={
            "x-subject": "alice",
            "x-relay-device-id": "android-device-0001",
        },
    )
    assert revoked.status_code == 200
    after = client.get(
        f"/v1/runtimes/{runtime_id}/associations",
        headers=runtime_headers,
    ).json()
    assert sorted(row["status"] for row in after) == ["active", "revoked"]
    assert client.get(
        f"/v1/runtimes/{runtime_id}/runtime",
        headers={"x-subject": "alice"},
    ).status_code == 200


def test_runtime_display_name_is_safe_and_associated_user_can_rename() -> None:
    client = TestClient(_testing_app())
    _, runtime_id, runtime_token = register(client)
    grant = client.post(
        f"/v1/runtimes/{runtime_id}/access-grants",
        headers={"x-runtime-token": runtime_token},
    ).json()["code"]
    assert client.post(
        "/v1/associations",
        headers={"x-subject": "alice"},
        json=association_body(grant),
    ).status_code == 200

    renamed = client.patch(
        f"/v1/runtimes/{runtime_id}",
        headers={"x-subject": "alice"},
        json={"display_name": "  Lab   Workstation  "},
    )
    assert renamed.status_code == 200
    assert renamed.json() == {
        "runtime_id": runtime_id,
        "display_name": "Lab Workstation",
    }
    assert "path" not in json.dumps(renamed.json())
    assert client.get(
        "/v1/runtimes", headers={"x-subject": "alice"}
    ).json()["items"][0]["display_name"] == "Lab Workstation"
    for unsafe in (
        "192.168.1.2",
        "2001:db8::1",
        "https://host.example",
        r"C:\Users\owner",
        "/home/owner",
    ):
        response = client.patch(
            f"/v1/runtimes/{runtime_id}",
            headers={"x-subject": "alice"},
            json={"display_name": unsafe},
        )
        assert response.status_code == 400
        assert response.json()["code"] == "runtime_display_name_invalid"


def test_production_relay_derives_principal_from_verified_oidc_and_ignores_client_subject(monkeypatch) -> None:
    secret = b"relay-oidc-test-secret"
    monkeypatch.setenv("OPENDRSAI_OIDC_HS256_SECRET", secret.decode())
    client = TestClient(create_relay_app())
    _, runtime_id, runtime_token = register(client)
    grant = client.post(f"/v1/runtimes/{runtime_id}/access-grants",
                        headers={"x-runtime-token": runtime_token}).json()["code"]
    subject = str(uuid4())
    assert client.get("/v1/runtimes").status_code == 401
    assert client.get("/v1/runtimes", headers={"x-subject": subject}).status_code == 401
    headers = {"authorization": f"Bearer {oidc_token(subject, secret)}", "x-subject": str(uuid4())}
    associated = client.post("/v1/associations", headers=headers, json=association_body(grant))
    assert associated.status_code == 200 and associated.json()["runtime_id"] == runtime_id
    listed = client.get("/v1/runtimes", headers=headers)
    assert listed.status_code == 200 and listed.json()["items"][0]["runtime"]["runtime_id"] == runtime_id


def test_error_envelope_distinguishes_relay_and_has_correlation_id() -> None:
    client = TestClient(_testing_app())
    response = client.get("/v1/runtimes/missing/runtime", headers={"x-subject": "alice", "x-correlation-id": "corr-test"})
    assert response.status_code == 404
    assert response.json() == {
        "code": "runtime_not_found", "message": "Runtime was not found", "correlation_id": "corr-test",
        "retryable": False, "details": {}, "source": "relay",
    }


def test_strict_requests_reject_client_authority_fields() -> None:
    client = TestClient(_testing_app())
    private = Ed25519PrivateKey.generate()
    public = encoded(private.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw))
    code = client.get("/v1/admin/registration-code").json()["code"]
    response = client.post("/v1/runtimes/register", headers={"x-registration-code": code}, json={
        **control(True), "display_name": "PC", "version": "1", "public_key": public,
        "canonical_path": "C:/private", "permission": "admin",
    })
    assert response.status_code == 422


def test_generated_openapi_contains_runtime_handshake_and_pagination() -> None:
    schema = create_relay_app().openapi()
    assert "/v1/runtimes/{runtime_id}/runtime" in schema["paths"]
    assert "/v1/runtimes/{runtime_id}/capabilities" in schema["paths"]
    parameters = schema["paths"]["/v1/runtimes"]["get"]["parameters"]
    assert {item["name"] for item in parameters} >= {"cursor", "limit", "query"}
    assert "/v1/associations/{runtime_id}" in schema["paths"]
    assert "/v1/runtimes/{runtime_id}/associations" in schema["paths"]
    assert "/v1/runtimes/{runtime_id}/associations/{association_id}" in schema["paths"]
    assert "/v1/runtimes/{runtime_id}/enrollment" in schema["paths"]
    assert "patch" in schema["paths"]["/v1/runtimes/{runtime_id}"]


def test_generated_openapi_contains_native_oaep_response_contracts() -> None:
    schema = create_relay_app().openapi()
    base = "/v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}"
    snapshot = schema["paths"][f"{base}/oaep-snapshot"]["get"]["responses"]["200"]
    page = schema["paths"][f"{base}/oaep-events"]["get"]["responses"]["200"]
    stream = schema["paths"][f"{base}/oaep-events/stream"]["get"]["responses"]["200"]
    assert snapshot["content"]["application/json"]["schema"]["$ref"].endswith("/OaepSnapshot")
    assert page["content"]["application/json"]["schema"]["$ref"].endswith("/OaepEventPage")
    assert stream["content"]["text/event-stream"]["schema"]["$ref"].endswith("/OaepEvent")
    assert {"OaepSnapshot", "OaepEventPage", "OaepEvent"} <= set(schema["components"]["schemas"])


def test_runtime_establishes_authenticated_outbound_websocket() -> None:
    client = TestClient(_testing_app())
    private, runtime_id, token = register(client)
    nonce, instance = "ws-nonce", "ws-instance"
    signature = encoded(private.sign(f"{runtime_id}\n{instance}\n{nonce}".encode()))
    with client.websocket_connect("/v1/runtime-connect", headers={"authorization": f"Runtime {token}"}) as socket:
        socket.send_json({
            "type": "runtime.hello", "runtime_id": runtime_id, "instance_id": instance, "version": "1.4.6",
            "protocol_version": PROTOCOL_VERSION, "capabilities": sorted(CAPABILITIES), "backend_health": {},
            "nonce": nonce, "signature": signature,
        })
        connected = socket.receive_json()
        assert connected["type"] == "runtime.connected"
        assert connected["runtime"]["instance_id"] == instance
        socket.send_json({"type": "runtime.workspaces", "workspaces": [{
            "runtime_id": runtime_id, "workspace_id": "workspace-one", "display_name": "Project",
        }]})
    _, code, _ = client.app.state.registry.issue_access_grant(runtime_id, token)
    device = association_body(code)
    client.app.state.registry.associate(
        "alice",
        code,
        device["device_id"],
        device["device_name"],
        device["device_public_key"],
    )
    workspaces, _ = client.app.state.registry.list_workspaces("alice", runtime_id)
    assert [item.workspace_id for item in workspaces] == ["workspace-one"]


def test_runtime_workspace_catalog_from_old_generation_is_ignored() -> None:
    client = TestClient(_testing_app())
    private, runtime_id, token = register(client)
    _, code, _ = client.app.state.registry.issue_access_grant(runtime_id, token)
    device = association_body(code)
    client.app.state.registry.associate(
        "alice",
        code,
        device["device_id"],
        device["device_name"],
        device["device_public_key"],
    )

    def hello(instance: str, nonce: str) -> dict[str, object]:
        return {
            "type": "runtime.hello",
            "runtime_id": runtime_id,
            "instance_id": instance,
            "version": "1.4.6",
            "protocol_version": PROTOCOL_VERSION,
            "capabilities": sorted(CAPABILITIES),
            "backend_health": {},
            "nonce": nonce,
            "signature": encoded(private.sign(f"{runtime_id}\n{instance}\n{nonce}".encode())),
        }

    with client.websocket_connect("/v1/runtime-connect", headers={"authorization": f"Runtime {token}"}) as stale:
        stale.send_json(hello("ws-stale", "nonce-stale"))
        assert stale.receive_json()["type"] == "runtime.connected"
        with client.websocket_connect("/v1/runtime-connect", headers={"authorization": f"Runtime {token}"}) as current:
            current.send_json(hello("ws-current", "nonce-current"))
            assert current.receive_json()["type"] == "runtime.connected"
            stale.send_json({"type": "runtime.workspaces", "workspaces": [{
                "runtime_id": runtime_id, "workspace_id": "stale-workspace", "display_name": "Stale",
            }]})
            current.send_json({"type": "runtime.workspaces", "workspaces": [{
                "runtime_id": runtime_id, "workspace_id": "current-workspace", "display_name": "Current",
            }]})
            deadline = time.time() + 1
            while True:
                workspaces, _ = client.app.state.registry.list_workspaces("alice", runtime_id)
                if [item.workspace_id for item in workspaces] == ["current-workspace"]:
                    break
                if time.time() > deadline:
                    assert [item.workspace_id for item in workspaces] == ["current-workspace"]
                time.sleep(0.01)


def test_runtime_workspace_catalog_sync_replaces_projection_and_filters_default_active() -> None:
    class SyncHub:
        def __init__(self) -> None:
            self.calls = 0

        async def request_http_current(self, runtime_id: str, method: str, path: str, **kwargs):
            self.calls += 1
            assert method == "GET"
            assert path == "/v1/workspaces?include_closed=true"
            return {
                "status": 200,
                "body": {
                    "data": [
                        {
                            "runtime_id": runtime_id,
                            "workspace_id": "active-workspace",
                            "display_name": "默认",
                            "lifecycle": "active",
                            "revision": 7,
                            "updated_at": "2026-07-27T19:00:00Z",
                        },
                        {
                            "runtime_id": runtime_id,
                            "workspace_id": "archived-workspace",
                            "display_name": "Archive",
                            "lifecycle": "archived",
                            "revision": 8,
                            "updated_at": "2026-07-27T19:01:00Z",
                        },
                        {
                            "runtime_id": runtime_id,
                            "workspace_id": "removed-workspace",
                            "display_name": "Removed",
                            "lifecycle": "removed",
                            "revision": 9,
                            "updated_at": "2026-07-27T19:02:00Z",
                        },
                    ],
                },
            }, "generation-one"

        async def is_current(self, runtime_id: str, generation: str) -> bool:
            return generation == "generation-one"

    hub = SyncHub()
    client = TestClient(create_relay_app(channels=hub, principal_resolver=lambda request: request.headers.get("x-subject", "")))
    _, runtime_id, token = register(client)
    _, code, _ = client.app.state.registry.issue_access_grant(runtime_id, token)
    device = association_body(code)
    client.app.state.registry.associate(
        "alice",
        code,
        device["device_id"],
        device["device_name"],
        device["device_public_key"],
    )
    client.app.state.registry.publish_workspaces(runtime_id, token, [
        Workspace.model_validate({
            "runtime_id": runtime_id,
            "workspace_id": "stale-workspace",
            "display_name": "Stale",
        })
    ])
    response = client.post(
        f"/v1/runtimes/{runtime_id}/workspaces/sync",
        headers={"x-subject": "alice"},
        json={},
    )
    assert response.status_code == 200
    assert hub.calls == 1
    body = response.json()
    assert body["catalog_revision"] == 9
    assert body["runtime_id"] == runtime_id
    assert body["synced_at"]
    assert [item["workspace_id"] for item in body["items"]] == ["active-workspace"]
    assert "path" not in json.dumps(body)
    active, _ = client.app.state.registry.list_workspaces("alice", runtime_id)
    assert [item.workspace_id for item in active] == ["active-workspace"]
    archived, _ = client.app.state.registry.list_workspaces(
        "alice",
        runtime_id,
        lifecycle=ResourceLifecycle.ARCHIVED,
    )
    assert [item.workspace_id for item in archived] == ["archived-workspace"]


def test_runtime_workspace_catalog_sync_rejects_sensitive_fields() -> None:
    class LeakyHub:
        async def request_http_current(self, runtime_id: str, method: str, path: str, **kwargs):
            return {
                "status": 200,
                "body": {
                    "data": [{
                        "runtime_id": runtime_id,
                        "workspace_id": "leaky",
                        "display_name": "Leaky",
                        "path": "C:/secret",
                    }],
                },
            }, "generation-one"

        async def is_current(self, runtime_id: str, generation: str) -> bool:
            return True

    client = TestClient(create_relay_app(channels=LeakyHub(), principal_resolver=lambda request: request.headers.get("x-subject", "")))
    _, runtime_id, token = register(client)
    _, code, _ = client.app.state.registry.issue_access_grant(runtime_id, token)
    device = association_body(code)
    client.app.state.registry.associate(
        "alice",
        code,
        device["device_id"],
        device["device_name"],
        device["device_public_key"],
    )
    response = client.post(
        f"/v1/runtimes/{runtime_id}/workspaces/sync",
        headers={"x-subject": "alice"},
        json={},
    )
    assert response.status_code == 400
    assert response.json()["code"] == "workspace_catalog_sync_invalid"


def test_runtime_workspace_catalog_sync_requires_strict_empty_body() -> None:
    client = TestClient(_testing_app())
    _, runtime_id, _ = register(client)
    response = client.post(
        f"/v1/runtimes/{runtime_id}/workspaces/sync",
        headers={"x-subject": "alice"},
        json={"request_id": "not-accepted"},
    )
    assert response.status_code == 422


def test_runtime_workspace_catalog_sync_error_contract() -> None:
    class ErrorHub:
        def __init__(self, code: str) -> None:
            self.code = code

        async def request_http_current(self, runtime_id: str, method: str, path: str, **kwargs):
            raise RelayRegistryError(self.code, self.code, retryable=True, source="runtime")

        async def is_current(self, runtime_id: str, generation: str) -> bool:
            return True

    for code, status in {
        "host_offline": 503,
        "catalog_sync_timeout": 503,
        "stale_runtime_generation": 409,
    }.items():
        client = TestClient(create_relay_app(
            channels=ErrorHub(code),
            principal_resolver=lambda request: request.headers.get("x-subject", ""),
        ))
        _, runtime_id, token = register(client)
        _, grant, _ = client.app.state.registry.issue_access_grant(runtime_id, token)
        device = association_body(grant)
        client.app.state.registry.associate(
            "alice",
            grant,
            device["device_id"],
            device["device_name"],
            device["device_public_key"],
        )
        response = client.post(
            f"/v1/runtimes/{runtime_id}/workspaces/sync",
            headers={"x-subject": "alice"},
            json={},
        )
        assert response.status_code == status
        body = response.json()
        assert body["code"] == code
        assert body["retryable"] is True


def test_public_oaep_session_routes_proxy_authoritative_runtime_projection() -> None:
    fixture = json.loads(
        (Path(__file__).resolve().parents[5] / "cores/protocol/oaep/examples.json")
        .read_text(encoding="utf-8")
    )
    fixture["session"]["id"] = "session-one"
    fixture["session"]["workspace_id"] = "workspace-one"
    for run in fixture["runs"]:
        run["session_id"] = "session-one"
    for item in fixture["items"]:
        item["session_id"] = "session-one"
    for event in fixture["events"]:
        event["session_id"] = "session-one"
    fixture["snapshot_sequence"] = max(event["sequence"] for event in fixture["events"])

    class OaepAuthority:
        def __init__(self) -> None:
            self.calls: list[tuple[str, tuple, dict]] = []
            self.runtime_id = ""

        def oaep_snapshot_for_subject(self, *args, **kwargs):
            self.calls.append(("snapshot", args, kwargs))
            return {key: fixture[key] for key in ("version", "session", "runs", "items", "snapshot_sequence")}

        def conversation_snapshot_for_subject(self, *args, **kwargs):
            self.calls.append(("legacy-snapshot", args, kwargs))
            return {"session_id": args[2], "snapshot_sequence": 1, "items": [], "next_cursor": None}

        def session_events_for_subject(self, *args, **kwargs):
            self.calls.append(("legacy-events", args, kwargs))
            return {"object": "list", "items": [], "next_sequence": kwargs.get("after_sequence", 0)}

        def oaep_events_for_subject(self, *args, **kwargs):
            self.calls.append(("events", args, kwargs))
            return {
                "version": "1.0",
                "object": "list",
                "data": [fixture["events"][2]],
                "next_sequence": fixture["events"][2]["sequence"],
                "has_more": False,
            }

    authority = OaepAuthority()
    client = TestClient(create_relay_app(principal_resolver=lambda request: request.headers.get("x-subject", "")))
    _, runtime_id, token = register(client)
    authority.runtime_id = runtime_id
    registry = client.app.state.registry
    client.app.state.registry.publish_workspaces(runtime_id, token, [
        Workspace.model_validate({
            "runtime_id": runtime_id,
            "workspace_id": "workspace-one",
            "display_name": "Project",
        })
    ])

    relay = create_relay_app(
        runtimes={runtime_id: authority},
        registry=registry,
        principal_resolver=lambda request: request.headers.get("x-subject", ""),
    )
    client = TestClient(relay)
    _, code, _ = client.app.state.registry.issue_access_grant(runtime_id, token)
    device = association_body(code)
    client.app.state.registry.associate(
        "alice",
        code,
        device["device_id"],
        device["device_name"],
        device["device_public_key"],
    )

    snapshot = client.get(
        f"/v1/runtimes/{runtime_id}/workspaces/workspace-one/sessions/session-one/oaep-snapshot",
        headers={"x-subject": "alice"},
    )
    assert snapshot.status_code == 200
    assert snapshot.json()["items"][0]["content"]["text"]

    legacy_snapshot = client.get(
        f"/v1/runtimes/{runtime_id}/workspaces/workspace-one/sessions/session-one/conversation-snapshot",
        headers={"x-subject": "alice"},
    )
    assert legacy_snapshot.status_code == 200
    assert "version" not in legacy_snapshot.json() and "session_id" in legacy_snapshot.json()

    events = client.get(
        f"/v1/runtimes/{runtime_id}/workspaces/workspace-one/sessions/session-one/oaep-events"
        "?after_sequence=7&limit=1",
        headers={"x-subject": "alice"},
    )
    assert events.status_code == 200
    assert events.json()["data"][0]["item_id"] == "reasoning-1"

    legacy_events = client.get(
        f"/v1/runtimes/{runtime_id}/workspaces/workspace-one/sessions/session-one/events",
        headers={"x-subject": "alice"},
    )
    assert legacy_events.status_code == 200
    assert "data" not in legacy_events.json() and "items" in legacy_events.json()

    encoded_oaep = json.dumps(snapshot.json()) + json.dumps(events.json())
    assert "C:/" not in encoded_oaep and "C:\\\\" not in encoded_oaep
    assert [call[0] for call in authority.calls] == [
        "snapshot", "legacy-snapshot", "events", "legacy-events",
    ]


def test_runtime_websocket_rejects_unauthenticated_client() -> None:
    client = TestClient(_testing_app())
    with pytest.raises(Exception):
        with client.websocket_connect("/v1/runtime-connect"):
            pass
