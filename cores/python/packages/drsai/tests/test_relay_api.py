from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from uuid import uuid4

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi.testclient import TestClient

from drsai.relay.api import create_relay_app
from drsai.relay.generated_contract import CAPABILITIES, PROTOCOL_VERSION


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


def register(client: TestClient):
    private = Ed25519PrivateKey.generate()
    public = encoded(private.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw))
    code = client.get("/v1/admin/registration-code").json()["code"]
    response = client.post("/v1/runtimes/register", headers={"x-registration-code": code}, json={
        **control(True), "display_name": "Office PC", "version": "1.4.6", "public_key": public,
    })
    assert response.status_code == 200
    return private, response.json()["runtime_id"], response.json()["registration_token"]


def test_registration_association_heartbeat_and_discovery_flow() -> None:
    client = TestClient(_testing_app())
    private, runtime_id, token = register(client)
    grant = client.post(f"/v1/runtimes/{runtime_id}/access-grants", headers={"x-runtime-token": token}).json()["code"]
    assert client.post("/v1/associations", headers={"x-subject": "alice"}, json={**control(), "code": grant}).status_code == 200
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
                       json={**control(), "code": body["code"]}).status_code == 400


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
        json={**control(), "code": grant["code"]},
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
    assert "alice" not in json.dumps(associations)

    revoked = client.delete(
        f"/v1/associations/{runtime_id}", headers={"x-subject": "alice"}
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
        json={**control(), "code": grant},
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
    associated = client.post("/v1/associations", headers=headers, json={**control(), "code": grant})
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
    client.app.state.registry.associate("alice", code)
    workspaces, _ = client.app.state.registry.list_workspaces("alice", runtime_id)
    assert [item.workspace_id for item in workspaces] == ["workspace-one"]


def test_runtime_websocket_rejects_unauthenticated_client() -> None:
    client = TestClient(_testing_app())
    with pytest.raises(Exception):
        with client.websocket_connect("/v1/runtime-connect"):
            pass
