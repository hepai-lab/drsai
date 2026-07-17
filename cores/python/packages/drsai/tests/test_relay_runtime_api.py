from __future__ import annotations

import base64
from uuid import uuid4

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi.testclient import TestClient

from drsai.relay.api import create_relay_app
from drsai.relay.models import Workspace
from drsai.relay.registry import RelayRegistry
from drsai.relay.runtime_domain import AgentDefinition, RuntimeAuthority


def fixture():
    registry = RelayRegistry()
    key = Ed25519PrivateKey.generate()
    public = base64.urlsafe_b64encode(key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)).rstrip(b"=").decode()
    runtime_id, token = registry.register(registry.issue_registration_code(), "PC", "1", public, "registration-key")
    grant, _ = registry.issue_access_grant(runtime_id, token)
    registry.associate("alice", grant)
    second_grant, _ = registry.issue_access_grant(runtime_id, token)
    registry.associate("bob", second_grant)
    registry.publish_workspaces(runtime_id, token, [Workspace(runtime_id=runtime_id, workspace_id="ws-a", display_name="Project")])
    authority = RuntimeAuthority(runtime_id)
    authority.add_agent_definition(AgentDefinition("agent", "1.2.3", "OpenDrSai", "opendrsai", "healthy", frozenset({"chat"})))
    authority.permissions[("alice", "ws-a")] = {"shell.execute"}
    return TestClient(create_relay_app(
        registry, {runtime_id: authority},
        principal_resolver=lambda request: request.headers.get("x-subject", ""),
    )), runtime_id, authority


def control(key: str | None = None):
    body = {"request_id": str(uuid4()), "correlation_id": str(uuid4())}
    if key: body["idempotency_key"] = key
    return body


def test_android_http_session_run_event_cancel_and_approval_e2e() -> None:
    client, runtime_id, runtime = fixture()
    headers = {"x-subject": "alice"}
    definitions = client.get(f"/v1/runtimes/{runtime_id}/agent-definitions", headers=headers)
    assert definitions.status_code == 200 and definitions.json()["items"][0]["version"] == "1.2.3"
    session_body = {**control("session-idem"), "title": "Test", "agent_definition_id": "agent", "agent_definition_version": "1.2.3"}
    created_session = client.post(f"/v1/runtimes/{runtime_id}/workspaces/ws-a/sessions", headers=headers, json=session_body)
    assert created_session.status_code == 200
    session_id = created_session.json()["session_id"]
    assert client.post(f"/v1/runtimes/{runtime_id}/workspaces/ws-a/sessions", headers=headers, json=session_body).json()["session_id"] == session_id
    recovered_session = client.get(
        f"/v1/runtimes/{runtime_id}/idempotency/session.create/session-idem", headers=headers
    )
    assert recovered_session.status_code == 200
    assert recovered_session.json()["resource"]["session_id"] == session_id
    missing_result = client.get(
        f"/v1/runtimes/{runtime_id}/idempotency/session.create/unknown", headers=headers
    )
    assert missing_result.status_code == 400
    assert missing_result.json()["code"] == "idempotency_result_not_found"
    run_body = {**control("run-idem-1"), "message": "hello", "attachment_refs": ["att_1"]}
    created_run = client.post(f"/v1/runtimes/{runtime_id}/workspaces/ws-a/sessions/{session_id}/runs", headers=headers, json=run_body)
    assert created_run.status_code == 200
    run_id = created_run.json()["run_id"]
    runtime.append_event(run_id, "message.delta", {"delta": "hello"})
    events = client.get(f"/v1/runtimes/{runtime_id}/runs/{run_id}/events?after_sequence=1", headers=headers).json()["items"]
    assert [item["kind"] for item in events] == ["message.delta"]
    stream = client.get(f"/v1/runtimes/{runtime_id}/runs/{run_id}/events/stream?after_sequence=1", headers=headers)
    assert stream.headers["content-type"].startswith("text/event-stream")
    assert "id: 2\nevent: message.delta\ndata:" in stream.text
    assert "thread_id" not in stream.text and "turn_id" not in stream.text
    approval = runtime.request_approval("alice", run_id, operation="shell.execute", risk_summary="command", scope="workspace", correlation_id="corr")
    pending = client.get(f"/v1/runtimes/{runtime_id}/workspaces/ws-a/approvals", headers=headers).json()["items"]
    assert pending[0]["approval_id"] == approval.approval_id
    decision = client.post(f"/v1/runtimes/{runtime_id}/approvals/{approval.approval_id}/decision", headers=headers,
                           json={**control(), "decision": "deny"})
    assert decision.json()["status"] == "denied"
    cancelled = client.post(f"/v1/runtimes/{runtime_id}/workspaces/ws-a/runs/{run_id}/cancel", headers=headers)
    assert cancelled.json()["status"] == "cancelled"
    audit = client.get(f"/v1/runtimes/{runtime_id}/workspaces/ws-a/audit?run_id={run_id}", headers=headers)
    assert audit.status_code == 200
    assert [item["action"] for item in audit.json()["items"]] == [
        "run.created", "approval.requested", "approval.denied", "run.cancelled"
    ]
    assert all(item["correlation_id"] for item in audit.json()["items"])
    assert isinstance(runtime.audit, tuple)


def test_cross_workspace_session_and_android_path_fail_closed() -> None:
    client, runtime_id, _ = fixture()
    headers = {"x-subject": "alice"}
    session = client.post(f"/v1/runtimes/{runtime_id}/workspaces/ws-a/sessions", headers=headers, json={
        **control("session-idem"), "title": "Test", "agent_definition_id": "agent", "agent_definition_version": "1.2.3"
    }).json()
    response = client.post(f"/v1/runtimes/{runtime_id}/workspaces/ws-other/sessions/{session['session_id']}/runs",
                           headers=headers, json={**control("run-idem-x"), "message": "x", "attachment_refs": ["/sdcard/x"]})
    assert response.status_code == 403
    assert response.json()["code"] == "workspace_forbidden"


def test_two_oidc_subjects_on_same_runtime_cannot_cross_session_or_run() -> None:
    client, runtime_id, _ = fixture()
    alice, bob = {"x-subject": "alice"}, {"x-subject": "bob"}
    session = client.post(f"/v1/runtimes/{runtime_id}/workspaces/ws-a/sessions", headers=alice, json={
        **control("alice-session"), "title": "Private", "agent_definition_id": "agent",
        "agent_definition_version": "1.2.3",
    }).json()
    run = client.post(f"/v1/runtimes/{runtime_id}/workspaces/ws-a/sessions/{session['session_id']}/runs",
                      headers=alice, json={**control("alice-run"), "message": "private", "attachment_refs": []}).json()

    assert client.get(f"/v1/runtimes/{runtime_id}/workspaces/ws-a/sessions", headers=bob).json()["items"] == []
    forbidden_session = client.get(
        f"/v1/runtimes/{runtime_id}/workspaces/ws-a/sessions/{session['session_id']}", headers=bob)
    assert forbidden_session.status_code == 403 and forbidden_session.json()["code"] == "session_forbidden"
    forbidden_run = client.get(f"/v1/runtimes/{runtime_id}/runs/{run['run_id']}", headers=bob)
    assert forbidden_run.status_code == 403 and forbidden_run.json()["code"] == "run_forbidden"


def test_android_owop_binding_is_read_only_scoped_and_correlation_preserving() -> None:
    client, runtime_id, runtime = fixture()
    runtime.owop_handler = lambda workspace_id, operation, params: {
        "items": [{"token": "t", "relative_path": "README.md", "type": "file", "size": 1}],
        "workspace": workspace_id,
    }
    headers = {"x-subject": "alice"}
    body = {"version": "1.0", "request_id": "req", "correlation_id": "corr",
            "operation": "files.list", "params": {"path": ""}}
    response = client.post(f"/v1/runtimes/{runtime_id}/workspaces/ws-a/owop", headers=headers, json=body)
    assert response.status_code == 200
    assert response.json()["request_id"] == "req" and response.json()["correlation_id"] == "corr"
    assert response.json()["result"]["items"][0]["relative_path"] == "README.md"

    forbidden = client.post(f"/v1/runtimes/{runtime_id}/workspaces/ws-a/owop", headers=headers,
                            json={**body, "operation": "files.write"})
    assert forbidden.status_code == 403 and forbidden.json()["code"] == "owop_operation_forbidden"
