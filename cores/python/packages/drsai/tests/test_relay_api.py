from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
import asyncio
from urllib.parse import parse_qsl, urlencode, urlsplit
from copy import deepcopy
from pathlib import Path
from uuid import uuid4

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi.testclient import TestClient

from drsai.backend.runtime.observability import ResourceCorrelation
from drsai.relay.api import create_relay_app, relay_latency_correlation
from drsai.relay.generated_contract import CAPABILITIES, PROTOCOL_VERSION
from drsai.relay.models import ResourceLifecycle, Workspace
from drsai.relay.registry import RelayRegistry, RelayRegistryError
from drsai.relay.runtime_domain import AgentDefinition, RuntimeAuthority


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


def test_latency_correlation_is_scoped_without_exposing_resource_identity() -> None:
    first = relay_latency_correlation("runtime-a", "workspace", "session", "event")
    assert first == relay_latency_correlation(
        "runtime-a", "workspace", "session", "event"
    )
    assert first != relay_latency_correlation(
        "runtime-b", "workspace", "session", "event"
    )
    assert len(first) == 64 and set(first) <= set("0123456789abcdef")
    assert all(value not in first for value in ("runtime-a", "workspace", "session", "event"))
    with pytest.raises(ValueError, match="identity"):
        relay_latency_correlation("", "workspace", "session", "event")
    with pytest.raises(ValueError, match="identity"):
        relay_latency_correlation("runtime", "workspace", "session", "e" * 501)


def test_conversation_latency_shared_database_aggregates_separate_workers(tmp_path) -> None:
    database = (tmp_path / "shared-conversation-latency.sqlite3").resolve()
    worker_a = create_relay_app(conversation_latency_database=database)
    worker_b = create_relay_app(conversation_latency_database=database)
    for index in range(20):
        scoped = relay_latency_correlation(
            "runtime", "workspace", "session", f"event-{index}"
        )
        correlation = ResourceCorrelation(scoped, scoped)
        for stage in ("journal_append", "runtime_wss_send", "relay_fanout"):
            assert worker_a.state.conversation_latency.record_conversation_latency(
                stage, 1.0 + index, correlation, {"protocol": "oaep/1"}
            )
        for stage in ("client_receive", "client_render"):
            assert worker_b.state.conversation_latency.record_conversation_latency(
                stage, 1.0 + index, correlation, {"protocol": "oaep/1"}
            )

    report = TestClient(worker_a).get("/v1/metrics/relay-latency").json()
    assert report["aggregation_scope"] == "shared"
    assert report["complete_sample_count"] == 20
    assert report["incomplete_sample_count"] == 0
    assert report["ready"] is True
    assert report["multi_worker_ready"] is True

    process_report = TestClient(create_relay_app()).get(
        "/v1/metrics/relay-latency"
    ).json()
    assert process_report["aggregation_scope"] == "process"
    assert process_report["multi_worker_ready"] is False


def test_conversation_latency_shared_database_rejects_relative_path() -> None:
    with pytest.raises(ValueError, match="absolute"):
        create_relay_app(conversation_latency_database=Path("relative.sqlite3"))


def test_conversation_latency_shared_database_can_be_configured_by_environment(
    tmp_path, monkeypatch
) -> None:
    database = (tmp_path / "configured-latency.sqlite3").resolve()
    monkeypatch.setenv("OPENDRSAI_CONVERSATION_LATENCY_DATABASE", str(database))
    app = create_relay_app()
    assert app.state.conversation_latency_shared is True
    assert app.state.conversation_latency.database == database


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


def device_proof_headers(
    private: Ed25519PrivateKey,
    device_id: str,
    method: str,
    url: str,
    access_token: str,
    *,
    body: bytes = b"",
) -> dict[str, str]:
    parsed = urlsplit(url)
    timestamp = str(int(time.time()))
    nonce = f"proof-{uuid4().hex}"
    query = urlencode(sorted(parse_qsl(parsed.query, keep_blank_values=True)))
    canonical = "\n".join((
        "hai-runtime-relay-device-v1", method.upper(), parsed.path, query,
        hashlib.sha256(body).hexdigest(), timestamp, nonce,
        hashlib.sha256(access_token.encode()).hexdigest(),
    )).encode()
    return {
        "authorization": f"Bearer {access_token}",
        "x-relay-device-id": device_id,
        "x-relay-device-timestamp": timestamp,
        "x-relay-device-nonce": nonce,
        "x-relay-device-signature": encoded(private.sign(canonical)),
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


@pytest.mark.parametrize(
    ("providers", "worker_running", "expected"),
    [
        (frozenset(), False, {"ready": False, "providers": {"fcm": False}, "worker_running": False}),
        (frozenset(), True, {"ready": False, "providers": {"fcm": False}, "worker_running": True}),
        (frozenset({"fcm"}), False, {"ready": False, "providers": {"fcm": True}, "worker_running": False}),
        (frozenset({"fcm"}), True, {"ready": True, "providers": {"fcm": True}, "worker_running": True}),
    ],
)
def test_push_readiness_is_public_exact_and_never_claims_partial_setup_ready(
    providers: frozenset[str], worker_running: bool, expected: dict[str, object],
) -> None:
    client = TestClient(create_relay_app(
        registry=RelayRegistry(supported_push_providers=providers),
        push_worker_running=worker_running,
    ))
    response = client.get("/v1/push/readiness")
    assert response.status_code == 200
    assert response.json() == expected


def test_push_readiness_rejects_non_boolean_worker_configuration() -> None:
    with pytest.raises(TypeError, match="push_worker_running must be bool"):
        create_relay_app(push_worker_running=1)  # type: ignore[arg-type]


def test_device_bound_push_registration_route_rotates_and_revokes_without_token_echo() -> None:
    registry = RelayRegistry(supported_push_providers=frozenset({"fcm"}))
    app = create_relay_app(
        registry=registry,
        principal_resolver=lambda request: request.headers.get("x-subject", ""),
    )
    client = TestClient(app)
    _, runtime_id, runtime_token = register(client)
    grant = client.post(
        f"/v1/runtimes/{runtime_id}/access-grants",
        headers={"x-runtime-token": runtime_token},
    ).json()["code"]
    private = Ed25519PrivateKey.generate()
    device_id = "android-push-route-0001"
    associated = client.post("/v1/associations", headers={"x-subject": "alice"}, json={
        **control(),
        "code": grant,
        "device_id": device_id,
        "device_name": "Android Push Test",
        "device_public_key": encoded(private.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw,
        )),
    })
    assert associated.status_code == 200

    url = f"/v1/associations/{runtime_id}/push-registration"
    access_token = "test-access-token"
    raw_token = "provider-token-" + "z" * 64
    body = json.dumps(
        {"provider": "fcm", "token": raw_token, "generation": 1},
        separators=(",", ":"),
    ).encode()
    registered_push = client.put(url, headers={
        "x-subject": "alice",
        "content-type": "application/json",
        **device_proof_headers(
            private, device_id, "PUT", url, access_token, body=body,
        ),
    }, content=body)
    assert registered_push.status_code == 200
    assert registered_push.json()["status"] == "active"
    assert registered_push.json()["generation"] == 1
    assert raw_token not in registered_push.text
    assert raw_token not in repr(registry.audit)

    revoked = client.delete(url, headers={
        "x-subject": "alice",
        **device_proof_headers(private, device_id, "DELETE", url, access_token),
    })
    assert revoked.status_code == 200
    assert revoked.json()["status"] == "revoked"
    assert raw_token not in revoked.text


def test_workspace_catalog_stream_authorizes_before_allocating_subscriber() -> None:
    app = _testing_app()
    client = TestClient(app)
    response = client.get(
        "/v1/runtimes/missing/workspaces/workspace-one/session-catalog-events/stream",
        headers={"x-subject": "alice"},
    )
    assert response.status_code in {403, 404}
    assert app.state.oaep_replay.metrics()["workspace_subscribers"] == 0


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
    access_token = oidc_token(subject, secret)
    headers = {"authorization": f"Bearer {access_token}", "x-subject": str(uuid4())}
    device_private = Ed25519PrivateKey.generate()
    device_id = "android-device-0001"
    body = {
        **control(), "code": grant, "device_id": device_id,
        "device_name": "Android Test Device",
        "device_public_key": encoded(device_private.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw,
        )),
    }
    associated = client.post("/v1/associations", headers=headers, json=body)
    assert associated.status_code == 200 and associated.json()["runtime_id"] == runtime_id
    listed = client.get("/v1/runtimes", headers={
        **headers,
        **device_proof_headers(device_private, device_id, "GET", "/v1/runtimes", access_token),
    })
    assert listed.status_code == 200 and listed.json()["items"][0]["runtime"]["runtime_id"] == runtime_id


def test_device_key_rotation_is_old_key_authorized_and_immediately_fenced() -> None:
    app = _testing_app()
    client = TestClient(app)
    _, runtime_id, runtime_token = register(client)
    grant = client.post(
        f"/v1/runtimes/{runtime_id}/access-grants",
        headers={"x-runtime-token": runtime_token},
    ).json()["code"]
    old_private = Ed25519PrivateKey.generate()
    device_id = "android-device-rotation"
    associated = client.post("/v1/associations", headers={"x-subject": "alice"}, json={
        **control(), "code": grant, "device_id": device_id,
        "device_name": "Android Rotation Device",
        "device_public_key": encoded(old_private.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw,
        )),
    })
    assert associated.status_code == 200

    access_token = "test-access-token"
    new_private = Ed25519PrivateKey.generate()
    rotation = {"new_device_public_key": encoded(new_private.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw,
    ))}
    rotation_bytes = json.dumps(rotation, separators=(",", ":")).encode()
    rotation_url = f"/v1/associations/{runtime_id}/device-key/rotate"
    rotated = client.post(
        rotation_url,
        headers={
            "x-subject": "alice", "content-type": "application/json",
            **device_proof_headers(
                old_private, device_id, "POST", rotation_url, access_token,
                body=rotation_bytes,
            ),
        },
        content=rotation_bytes,
    )
    assert rotated.status_code == 200
    assert rotated.json()["status"] == "active"

    catalog_url = "/v1/runtimes"
    rejected = client.get(catalog_url, headers={
        "x-subject": "alice",
        **device_proof_headers(old_private, device_id, "GET", catalog_url, access_token),
    })
    assert rejected.status_code == 401
    assert rejected.json()["code"] == "device_proof_invalid"
    new_headers = {
        "x-subject": "alice",
        **device_proof_headers(new_private, device_id, "GET", catalog_url, access_token),
    }
    assert client.get(catalog_url, headers=new_headers).status_code == 200
    replay = client.get(catalog_url, headers=new_headers)
    assert replay.status_code == 401
    assert replay.json()["code"] == "device_proof_replay"


def test_device_key_rotation_is_atomic_across_all_runtime_associations() -> None:
    app = _testing_app()
    client = TestClient(app)
    registrations = [register(client), register(client)]
    subject = "multi-runtime-owner"
    access_token = "test-access-token"
    device_id = "android-device-multi-runtime"
    old_private = Ed25519PrivateKey.generate()

    for _, runtime_id, runtime_token in registrations:
        grant = client.post(
            f"/v1/runtimes/{runtime_id}/access-grants",
            headers={"x-runtime-token": runtime_token},
        ).json()["code"]
        associated = client.post("/v1/associations", headers={"x-subject": subject}, json={
            **control(), "code": grant, "device_id": device_id,
            "device_name": "Android Multi Runtime Device",
            "device_public_key": encoded(old_private.public_key().public_bytes(
                serialization.Encoding.Raw, serialization.PublicFormat.Raw,
            )),
        })
        assert associated.status_code == 200

    new_private = Ed25519PrivateKey.generate()
    first_runtime_id = registrations[0][1]
    rotation_url = f"/v1/associations/{first_runtime_id}/device-key/rotate"
    rotation = {"new_device_public_key": encoded(new_private.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw,
    ))}
    rotation_bytes = json.dumps(rotation, separators=(",", ":")).encode()
    rotated = client.post(
        rotation_url,
        headers={
            "x-subject": subject,
            "content-type": "application/json",
            **device_proof_headers(
                old_private, device_id, "POST", rotation_url, access_token,
                body=rotation_bytes,
            ),
        },
        content=rotation_bytes,
    )
    assert rotated.status_code == 200

    catalog_url = "/v1/runtimes"
    old_key_response = client.get(catalog_url, headers={
        "x-subject": subject,
        **device_proof_headers(old_private, device_id, "GET", catalog_url, access_token),
    })
    assert old_key_response.status_code == 401

    new_key_response = client.get(catalog_url, headers={
        "x-subject": subject,
        **device_proof_headers(new_private, device_id, "GET", catalog_url, access_token),
    })
    assert new_key_response.status_code == 200
    assert {item["runtime"]["runtime_id"] for item in new_key_response.json()["items"]} == {
        registration[1] for registration in registrations
    }

    # Simulate Android dying after Relay committed but before it promoted the
    # persisted pending key. The same body, authenticated by the new key, is a
    # no-op success and lets the restarted client complete local promotion.
    recovery_bytes = json.dumps(rotation, separators=(",", ":")).encode()
    recovered = client.post(
        rotation_url,
        headers={
            "x-subject": subject,
            "content-type": "application/json",
            **device_proof_headers(
                new_private, device_id, "POST", rotation_url, access_token,
                body=recovery_bytes,
            ),
        },
        content=recovery_bytes,
    )
    assert recovered.status_code == 200


def test_two_device_workspace_idor_matrix_filters_catalog_and_denies_before_proxy() -> None:
    app = _testing_app()
    client = TestClient(app)
    _, runtime_id, runtime_token = register(client)
    app.state.registry.publish_workspaces(runtime_id, runtime_token, [
        Workspace.model_validate({
            "runtime_id": runtime_id, "workspace_id": "workspace-one", "display_name": "One",
        }),
        Workspace.model_validate({
            "runtime_id": runtime_id, "workspace_id": "workspace-two", "display_name": "Two",
        }),
    ])

    def pair(device_id: str, private: Ed25519PrivateKey, scope: str, ids: list[str]) -> None:
        code = client.post(
            f"/v1/runtimes/{runtime_id}/access-grants",
            headers={"x-runtime-token": runtime_token},
            json={"workspace_scope": scope, "workspace_ids": ids},
        ).json()["code"]
        response = client.post("/v1/associations", headers={"x-subject": "alice"}, json={
            **control(), "code": code, "device_id": device_id,
            "device_name": device_id,
            "device_public_key": encoded(private.public_key().public_bytes(
                serialization.Encoding.Raw, serialization.PublicFormat.Raw,
            )),
            "workspace_scope": scope,
            "workspace_ids": ids,
        })
        assert response.status_code == 200

    selected_private = Ed25519PrivateKey.generate()
    second_private = Ed25519PrivateKey.generate()
    pair("android-selected-0001", selected_private, "selected", ["workspace-one"])
    pair("android-selected-0002", second_private, "selected", ["workspace-two"])
    access_token = "test-access-token"
    catalog_url = f"/v1/runtimes/{runtime_id}/workspaces"

    selected = client.get(catalog_url, headers={
        "x-subject": "alice",
        **device_proof_headers(
            selected_private, "android-selected-0001", "GET", catalog_url, access_token,
        ),
    })
    assert selected.status_code == 200
    assert [item["workspace_id"] for item in selected.json()["items"]] == ["workspace-one"]

    forbidden_url = f"/v1/runtimes/{runtime_id}/workspaces/workspace-two/sessions"
    forbidden = client.get(forbidden_url, headers={
        "x-subject": "alice",
        **device_proof_headers(
            selected_private, "android-selected-0001", "GET", forbidden_url, access_token,
        ),
    })
    assert forbidden.status_code == 403
    assert forbidden.json()["code"] == "workspace_forbidden"

    second_catalog = client.get(catalog_url, headers={
        "x-subject": "alice",
        **device_proof_headers(
            second_private, "android-selected-0002", "GET", catalog_url, access_token,
        ),
    })
    assert second_catalog.status_code == 200
    assert [item["workspace_id"] for item in second_catalog.json()["items"]] == ["workspace-two"]

    second_forbidden_url = f"/v1/runtimes/{runtime_id}/workspaces/workspace-one/sessions"
    second_forbidden = client.get(second_forbidden_url, headers={
        "x-subject": "alice",
        **device_proof_headers(
            second_private, "android-selected-0002", "GET", second_forbidden_url, access_token,
        ),
    })
    assert second_forbidden.status_code == 403
    assert second_forbidden.json()["code"] == "workspace_forbidden"


def test_authorization_shrink_closes_stream_and_new_requests_use_reduced_permissions() -> None:
    app = _testing_app()
    client = TestClient(app)
    _, runtime_id, runtime_token = register(client)
    app.state.registry.publish_workspaces(runtime_id, runtime_token, [
        Workspace.model_validate({
            "runtime_id": runtime_id, "workspace_id": "workspace-one", "display_name": "One",
        }),
    ])
    grant = client.post(
        f"/v1/runtimes/{runtime_id}/access-grants",
        headers={"x-runtime-token": runtime_token},
    ).json()["code"]
    private = Ed25519PrivateKey.generate()
    device_id = "android-shrink-0001"
    assert client.post("/v1/associations", headers={"x-subject": "alice"}, json={
        **control(), "code": grant, "device_id": device_id, "device_name": "Android",
        "device_public_key": encoded(private.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw,
        )),
    }).status_code == 200
    association_id = app.state.registry.list_associations(runtime_id, runtime_token)[0]["association_id"]
    queue = asyncio.run(app.state.oaep_replay.subscribe(runtime_id, "session-one"))

    shrunk = client.patch(
        f"/v1/runtimes/{runtime_id}/associations/{association_id}",
        headers={"x-runtime-token": runtime_token},
        json={
            "workspace_scope": "selected", "workspace_ids": ["workspace-one"],
            "permissions": ["read"],
        },
    )
    assert shrunk.status_code == 200
    assert shrunk.json()["permissions"] == ["read"]
    assert asyncio.run(queue.get()) == {"_control": "authorization_changed"}

    create_url = f"/v1/runtimes/{runtime_id}/workspaces/workspace-one/sessions"
    create_body = {
        **control(True), "title": "Denied", "agent_definition_id": "agent",
        "agent_definition_version": "1",
    }
    create_bytes = json.dumps(create_body, separators=(",", ":")).encode()
    denied = client.post(create_url, headers={
        "x-subject": "alice", "content-type": "application/json",
        **device_proof_headers(private, device_id, "POST", create_url, "token", body=create_bytes),
    }, content=create_bytes)
    assert denied.status_code == 403
    assert denied.json()["code"] == "permission_forbidden"

    catalog_url = f"/v1/runtimes/{runtime_id}/workspaces"
    readable = client.get(catalog_url, headers={
        "x-subject": "alice",
        **device_proof_headers(private, device_id, "GET", catalog_url, "token"),
    })
    assert readable.status_code == 200
    assert [item["workspace_id"] for item in readable.json()["items"]] == ["workspace-one"]

    expansion = client.patch(
        f"/v1/runtimes/{runtime_id}/associations/{association_id}",
        headers={"x-runtime-token": runtime_token},
        json={
            "workspace_scope": "all", "workspace_ids": [],
            "permissions": ["read", "send"],
        },
    )
    assert expansion.status_code == 403
    assert expansion.json()["code"] == "authorization_expansion_forbidden"


def test_device_disconnect_closes_stream_and_preserves_other_account_access() -> None:
    app = _testing_app()
    client = TestClient(app)
    _, runtime_id, runtime_token = register(client)
    app.state.registry.publish_workspaces(runtime_id, runtime_token, [
        Workspace.model_validate({
            "runtime_id": runtime_id, "workspace_id": "workspace-one", "display_name": "One",
        }),
    ])

    devices: dict[str, tuple[str, Ed25519PrivateKey]] = {}
    for subject in ("alice", "bob"):
        device_id = f"android-{subject}-0001"
        private = Ed25519PrivateKey.generate()
        grant = client.post(
            f"/v1/runtimes/{runtime_id}/access-grants",
            headers={"x-runtime-token": runtime_token},
        ).json()["code"]
        associated = client.post("/v1/associations", headers={"x-subject": subject}, json={
            **control(), "code": grant, "device_id": device_id, "device_name": f"{subject} phone",
            "device_public_key": encoded(private.public_key().public_bytes(
                serialization.Encoding.Raw, serialization.PublicFormat.Raw,
            )),
        })
        assert associated.status_code == 200
        devices[subject] = (device_id, private)

    queue = asyncio.run(app.state.oaep_replay.subscribe(runtime_id, "session-one"))
    alice_device, alice_private = devices["alice"]
    revoke_url = f"/v1/associations/{runtime_id}"
    revoked = client.delete(revoke_url, headers={
        "x-subject": "alice",
        **device_proof_headers(alice_private, alice_device, "DELETE", revoke_url, "token"),
    })
    assert revoked.status_code == 200
    assert asyncio.run(queue.get()) == {"_control": "authorization_changed"}

    catalog_url = f"/v1/runtimes/{runtime_id}/workspaces"
    alice_denied = client.get(catalog_url, headers={
        "x-subject": "alice",
        **device_proof_headers(alice_private, alice_device, "GET", catalog_url, "token"),
    })
    assert alice_denied.status_code == 403
    assert alice_denied.json()["code"] == "association_required"

    bob_device, bob_private = devices["bob"]
    bob_allowed = client.get(catalog_url, headers={
        "x-subject": "bob",
        **device_proof_headers(bob_private, bob_device, "GET", catalog_url, "token"),
    })
    assert bob_allowed.status_code == 200
    assert [item["workspace_id"] for item in bob_allowed.json()["items"]] == ["workspace-one"]


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
    session_path = "/v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}"
    assert "patch" in schema["paths"][session_path]


def test_session_rename_archive_and_unarchive_preserve_history_and_default_visibility() -> None:
    authorities: dict[str, RuntimeAuthority] = {"placeholder": RuntimeAuthority("placeholder")}
    app = create_relay_app(runtimes=authorities, principal_resolver=lambda request: request.headers.get("x-subject", ""))
    client = TestClient(app)
    _, runtime_id, token = register(client)
    authority = RuntimeAuthority(runtime_id)
    authority.add_agent_definition(AgentDefinition(
        "opendrsai", "1.0.0", "OpenDrSai", "opendrsai", "healthy", frozenset({"chat"}),
    ))
    authorities[runtime_id] = authority
    authorities.pop("placeholder")
    app.state.registry.publish_workspaces(runtime_id, token, [Workspace.model_validate({
        "runtime_id": runtime_id, "workspace_id": "workspace-one", "display_name": "Project",
    })])
    grant = client.post(f"/v1/runtimes/{runtime_id}/access-grants", headers={"x-runtime-token": token}).json()["code"]
    assert client.post("/v1/associations", headers={"x-subject": "alice"}, json=association_body(grant)).status_code == 200
    created_response = client.post(
        f"/v1/runtimes/{runtime_id}/workspaces/workspace-one/sessions",
        headers={"x-subject": "alice"},
        json={**control(True), "title": "Original", "agent_definition_id": "opendrsai",
              "agent_definition_version": "1.0.0"},
    )
    assert created_response.status_code == 200, created_response.text
    created = created_response.json()
    path = f"/v1/runtimes/{runtime_id}/workspaces/workspace-one/sessions/{created['session_id']}"
    renamed = client.patch(path, headers={"x-subject": "alice"},
                           json={**control(), "title": "Renamed"})
    assert renamed.status_code == 200 and renamed.json()["title"] == "Renamed"
    archived = client.patch(path, headers={"x-subject": "alice"},
                            json={**control(), "lifecycle": "archived"})
    assert archived.status_code == 200 and archived.json()["lifecycle"] == "archived"
    active_page = client.get(
        f"/v1/runtimes/{runtime_id}/workspaces/workspace-one/sessions",
        headers={"x-subject": "alice"},
    ).json()
    assert active_page["items"] == []
    archived_page = client.get(
        f"/v1/runtimes/{runtime_id}/workspaces/workspace-one/sessions?lifecycle=archived",
        headers={"x-subject": "alice"},
    ).json()
    assert [item["session_id"] for item in archived_page["items"]] == [created["session_id"]]
    restored = client.patch(path, headers={"x-subject": "alice"},
                            json={**control(), "lifecycle": "active"})
    assert restored.status_code == 200 and restored.json()["title"] == "Renamed"


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


def test_runtime_oaep_event_cursor_advances_only_after_relay_ack() -> None:
    client = TestClient(_testing_app())
    private, runtime_id, token = register(client)
    nonce, instance = "oaep-ack-nonce", "oaep-ack-instance"
    signature = encoded(private.sign(f"{runtime_id}\n{instance}\n{nonce}".encode()))
    fixture = json.loads(
        (Path(__file__).resolve().parents[5] / "cores/protocol/oaep/examples.json")
        .read_text(encoding="utf-8")
    )
    event = deepcopy(fixture["events"][0])
    event["source"] = {**event["source"], "runtime_id": runtime_id}
    frame = {
        "type": "event", "protocol": "oaep/1", "scope": "session",
        "runtime_id": runtime_id, "workspace_id": "workspace-one",
        "session_id": event["session_id"], "sequence": event["sequence"],
        "event": event,
    }
    with client.websocket_connect(
        "/v1/runtime-connect", headers={"authorization": f"Runtime {token}"}
    ) as socket:
        socket.send_json({
            "type": "runtime.hello", "runtime_id": runtime_id,
            "instance_id": instance, "version": "1.6.0",
            "protocol_version": PROTOCOL_VERSION, "capabilities": sorted(CAPABILITIES),
            "backend_health": {"android-agent": "healthy"},
            "nonce": nonce, "signature": signature,
        })
        assert socket.receive_json()["type"] == "runtime.connected"
        socket.send_json(frame)
        ack = socket.receive_json()
        assert ack == {
            "type": "oaep.event.ack", "protocol": "oaep/1",
            "runtime_id": runtime_id, "session_id": event["session_id"],
            "sequence": event["sequence"],
        }
        # Exact retransmission is acknowledged again, so a reconnect can safely
        # retry everything after its last durably committed local cursor.
        socket.send_json(frame)
        assert socket.receive_json() == ack
        for stage, duration_ms in (("journal_append", 2.0), ("runtime_wss_send", 3.0)):
            socket.send_json({
                "type": "telemetry.conversation_latency",
                "runtime_id": runtime_id,
                "workspace_id": "workspace-one",
                "session_id": event["session_id"],
                "run_id": str(event.get("run_id") or ""),
                "correlation_id": event["event_id"],
                "operation_id": event["event_id"],
                "stage": stage,
                "duration_ms": duration_ms,
            })

    grant = client.post(
        f"/v1/runtimes/{runtime_id}/access-grants",
        headers={"x-runtime-token": token},
    ).json()["code"]
    assert client.post(
        "/v1/associations", headers={"x-subject": "alice"}, json=association_body(grant)
    ).status_code == 200
    client.app.state.registry.publish_workspaces(runtime_id, token, [
        Workspace.model_validate({
            "runtime_id": runtime_id,
            "workspace_id": "workspace-one",
            "display_name": "One",
        })
    ])
    latency_url = (
        f"/v1/runtimes/{runtime_id}/workspaces/workspace-one/sessions/"
        f"{event['session_id']}/events/{event['event_id']}/latency-observation"
    )
    response = client.post(latency_url, headers={"x-subject": "alice"}, json={
        "client_receive_at_ms": 1_000,
        "render_at_ms": 1_005,
    })
    assert response.status_code == 200
    assert response.json() == {
        "ready": True,
        "stages_present": [
            "client_receive", "client_render", "journal_append",
            "relay_fanout", "runtime_wss_send",
        ],
        "latencies_ms": {"client_receive_to_render": 5},
    }
    assert client.get(latency_url, headers={"x-subject": "alice"}).json() == response.json()
    report = client.get("/v1/metrics/relay-latency").json()
    assert report["complete_sample_count"] == 1
    assert {stage: values["sample_count"] for stage, values in report["stages"].items()} == {
        "journal_append": 1,
        "runtime_wss_send": 1,
        "relay_fanout": 1,
        "client_receive": 1,
        "client_render": 1,
    }
    assert event["event_id"] not in json.dumps(report)


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
