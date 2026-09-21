import base64
import hashlib
import hmac
import json
import os
import shutil
import socket
import subprocess
import time
from pathlib import Path


HOME = Path("/tmp/opendrsai-runtime-security")
WORKSPACE = Path("/home/vscode/workspace")
WORKSPACE_TWO = Path("/home/vscode/workspace-two")
TOKEN = "temporary-m09-runtime-token"
OIDC_SECRET = "temporary-m09-oidc-signing-secret"
os.environ.update({
    "DRSAI_HOME": str(HOME),
    "OPENDRSAI_GATEWAY_INSTANCE_TOKEN": TOKEN,
    "OPENDRSAI_GATEWAY_INSTANCE_TOKEN_EXPIRES_AT": str(time.time() + 1800),
    "OPENDRSAI_OIDC_HS256_SECRET": OIDC_SECRET,
    "OPENDRSAI_ENFORCE_WORKSPACE_PERMISSIONS": "1",
    "DRSAI_RUNTIME_CONTROLLED_MODEL": "1",
})
shutil.rmtree(HOME, ignore_errors=True)


def encode(value):
    return base64.urlsafe_b64encode(json.dumps(value, separators=(",", ":")).encode()).decode().rstrip("=")


def jwt(subject, *, organization="org-m09", session=None, expires=600, audience="hai-api", secret=OIDC_SECRET):
    header = encode({"alg": "HS256", "typ": "JWT"})
    claims = {"sub": subject, "iss": "https://ai-dev.ihep.ac.cn/api", "exp": int(time.time()) + expires, "aud": audience}
    if organization is not None:
        claims["org_id"] = organization
    if session is not None:
        claims["sid"] = session
    payload = encode(claims)
    signature = base64.urlsafe_b64encode(hmac.new(secret.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest()).decode().rstrip("=")
    return f"{header}.{payload}.{signature}"


def write_definition():
    path = HOME / "assets" / "agents" / "security" / "1.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({
        "id": "security", "version": "1", "backend": "opendrsai", "permissions": [],
        "controlled_plan": {"content": "security-run-complete"},
    }), encoding="utf-8")


write_definition()

from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from drsai.backend import gateway
from drsai.backend.runtime.security import SecureWorkspaceFS, SecurityError
from drsai.platform_auth import revoke_gateway_instance_token


def identity_headers(subject, token=None, **extra):
    result = {
        "X-OpenDrSai-Gateway-Token": TOKEN,
        "Authorization": f"Bearer {token or jwt(subject, session=f'oidc-{subject}')}",
        "X-OpenDrSai-Principal": subject,
        "X-OpenDrSai-Session-ID": extra.pop("session_id", f"session-{subject}"),
        "X-OpenDrSai-Run-ID": extra.pop("run_id", f"run-{subject}"),
        "X-OpenDrSai-Tool-ID": extra.pop("tool_id", f"tool-{subject}"),
        "X-Correlation-ID": extra.pop("correlation_id", f"correlation-{subject}"),
    }
    result.update(extra)
    return result


def request(client, method, path, expected=200, headers=None, **kwargs):
    response = client.request(method, path, headers=headers if headers is not None else {"X-OpenDrSai-Gateway-Token": TOKEN}, **kwargs)
    assert response.status_code == expected, (path, response.status_code, response.text)
    return response.json()


def approval_id(failure):
    assert failure["error"]["code"] == "approval_required", failure
    return failure["error"]["detail"]["approval_id"]


def approve(client, subject, approval):
    result = request(client, "POST", f"/v1/security/approvals/{approval}/decision", headers=identity_headers(subject), json={"decision": "approved"})
    assert result["decision"] == "approved"


with TestClient(gateway.app) as client:
    # F02 Runtime instance Token: missing, incorrect and expired are rejected.
    request(client, "GET", "/v1/runtime", expected=401, headers={})
    request(client, "GET", "/v1/runtime", expected=401, headers={"X-OpenDrSai-Gateway-Token": "wrong"})
    os.environ["OPENDRSAI_GATEWAY_INSTANCE_TOKEN_EXPIRES_AT"] = str(time.time() - 1)
    request(client, "GET", "/v1/runtime", expected=401, headers={"X-OpenDrSai-Gateway-Token": TOKEN})
    os.environ["OPENDRSAI_GATEWAY_INSTANCE_TOKEN_EXPIRES_AT"] = str(time.time() + 1800)

    # F03 forged, expired and incomplete OIDC identities fail before Workspace creation.
    forged = jwt("forged", session="oidc-forged", secret="wrong-secret")
    request(client, "POST", "/v1/workspaces", expected=401, headers=identity_headers("forged", forged), json={"path": str(WORKSPACE)})
    expired = jwt("expired", session="oidc-expired", expires=-1)
    request(client, "POST", "/v1/workspaces", expected=401, headers=identity_headers("expired", expired), json={"path": str(WORKSPACE)})
    incomplete = jwt("incomplete", organization=None, session=None)
    request(client, "POST", "/v1/workspaces", expected=401, headers=identity_headers("incomplete", incomplete), json={"path": str(WORKSPACE)})

    owner_headers = identity_headers("owner")
    workspace = request(client, "POST", "/v1/workspaces", headers=owner_headers, json={"path": str(WORKSPACE)})
    wid = workspace["workspace_id"]
    second = request(client, "POST", "/v1/workspaces", headers=owner_headers, json={"path": str(WORKSPACE_TWO)})
    for subject, role in (("editor", "editor"), ("viewer", "viewer"), ("blocked", "denied")):
        request(client, "PUT", f"/v1/workspaces/{wid}/permissions", headers=owner_headers, json={"principal_id": subject, "role": role})

    target = WORKSPACE / "m09.txt"
    target.write_text("before", encoding="utf-8")
    # F04 role matrix: viewer reads but cannot write; denied cannot read.
    assert request(client, "GET", f"/v1/workspaces/{wid}/file?path=m09.txt", headers=identity_headers("viewer"))["content"] == "before"
    before_approval_count = gateway._runtime_security().approvals.request_count
    denied_write = request(client, "PUT", f"/v1/workspaces/{wid}/file", expected=403, headers=identity_headers("viewer"), json={"path": "m09.txt", "content_base64": base64.b64encode(b"viewer").decode()})
    assert denied_write["error"]["code"] == "permission_denied"
    assert gateway._runtime_security().approvals.request_count == before_approval_count
    denied_read = request(client, "GET", f"/v1/workspaces/{wid}/file?path=m09.txt", expected=403, headers=identity_headers("blocked"))
    assert denied_read["error"]["code"] == "permission_denied"

    # F07/F08 file write requires permission first, then a scoped one-time Approval.
    editor_headers = identity_headers("editor")
    body = {"path": "m09.txt", "content_base64": base64.b64encode(b"editor-approved").decode()}
    pending = request(client, "PUT", f"/v1/workspaces/{wid}/file", expected=428, headers=editor_headers, json=body)
    file_approval = approval_id(pending); approve(client, "editor", file_approval)
    approved_headers = {**editor_headers, "X-OpenDrSai-Approval-ID": file_approval}
    request(client, "PUT", f"/v1/workspaces/{wid}/file", headers=approved_headers, json=body)
    assert target.read_text() == "editor-approved"
    reused = request(client, "PUT", f"/v1/workspaces/{wid}/file", expected=403, headers=approved_headers, json=body)
    assert reused["error"]["code"] == "approval_not_approved"

    # F04 Run permissions: editor completes, viewer is rejected before execution.
    session = request(client, "POST", "/v1/sessions", headers=owner_headers, json={"workspace_id": wid, "title": "M09"})
    editor_run = request(client, "POST", f"/v1/sessions/{session['session_id']}/runs", expected=201, headers={**owner_headers, "Idempotency-Key": "m09-editor"}, json={"agent_definition": "security@1"})
    executed = request(client, "POST", f"/v1/runs/{editor_run['run_id']}/execute", headers={**editor_headers, "X-OpenDrSai-Run-ID": editor_run["run_id"], "X-OpenDrSai-Auth-Mode": "oidc"}, json={"prompt": "secure", "user_id": "editor"})
    assert executed["run"]["status"] == "completed"
    viewer_run = request(client, "POST", f"/v1/sessions/{session['session_id']}/runs", expected=201, headers={**owner_headers, "Idempotency-Key": "m09-viewer"}, json={"agent_definition": "security@1"})
    rejected = request(client, "POST", f"/v1/runs/{viewer_run['run_id']}/execute", expected=403, headers={**identity_headers("viewer"), "X-OpenDrSai-Run-ID": viewer_run["run_id"], "X-OpenDrSai-Auth-Mode": "oidc"}, json={"prompt": "denied", "user_id": "viewer"})
    assert rejected["error"]["code"] == "permission_denied"

    # F05 descriptor-relative path handling rejects traversal, symlinks and a deterministic swap race.
    outside = Path("/tmp/m09-outside"); shutil.rmtree(outside, ignore_errors=True); outside.mkdir()
    (outside / "outside.txt").write_text("outside", encoding="utf-8")
    link = WORKSPACE / "m09-link"
    link.symlink_to(outside, target_is_directory=True)
    escaped = request(client, "GET", f"/v1/workspaces/{wid}/file?path=m09-link/outside.txt", expected=403, headers=owner_headers)
    filesystem = SecureWorkspaceFS(WORKSPACE)
    race = WORKSPACE / "m09-race"; race.mkdir(); moved = WORKSPACE / "m09-race-original"
    def swap():
        race.rename(moved); race.symlink_to(outside, target_is_directory=True)
    filesystem.atomic_write("m09-race/result.txt", b"inside", before_replace=swap)
    assert (moved / "result.txt").read_bytes() == b"inside" and not (outside / "result.txt").exists()

    # F06 Runtime authorization cannot bypass the remote OS user permissions.
    os_denied = WORKSPACE / "m09-os-denied"; os_denied.mkdir(); os_denied.chmod(0)
    try:
        try:
            filesystem.atomic_write("m09-os-denied/nope.txt", b"nope")
            raise AssertionError("OS denied directory unexpectedly accepted a write")
        except SecurityError as exc:
            assert exc.code == "workspace_write_denied"
    finally:
        os_denied.chmod(0o700)

    # F07 Git push Approval is scoped to remote/refspec.
    bare = Path("/tmp/m09-bare.git"); shutil.rmtree(bare, ignore_errors=True)
    subprocess.run(["git", "init", "--bare", str(bare)], check=True, capture_output=True)
    subprocess.run(["git", "-C", str(WORKSPACE), "remote", "remove", "m09"], capture_output=True)
    subprocess.run(["git", "-C", str(WORKSPACE), "remote", "add", "m09", str(bare)], check=True)
    push_body = {"remote": "m09", "refspec": "HEAD:refs/heads/main"}
    pending = request(client, "POST", f"/v1/workspaces/{wid}/git/push", expected=428, headers=editor_headers, json=push_body)
    push_approval = approval_id(pending); approve(client, "editor", push_approval)
    pushed = request(client, "POST", f"/v1/workspaces/{wid}/git/push", headers={**editor_headers, "X-OpenDrSai-Approval-ID": push_approval}, json=push_body)
    assert pushed["pushed"]

    # F07 Workspace restore Approval.
    target.write_text("checkpoint", encoding="utf-8")
    subprocess.run(["git", "-C", str(WORKSPACE), "add", "m09.txt"], check=True)
    checkpoint = request(client, "POST", f"/v1/workspaces/{wid}/checkpoints", headers=owner_headers, json={"label": "M09 approval"})
    target.write_text("after-checkpoint", encoding="utf-8")
    restore_body = {"checkpointId": checkpoint["id"]}
    pending = request(client, "POST", f"/v1/workspaces/{wid}/checkpoints/restore", expected=428, headers=editor_headers, json=restore_body)
    restore_approval = approval_id(pending); approve(client, "editor", restore_approval)
    request(client, "POST", f"/v1/workspaces/{wid}/checkpoints/restore", headers={**editor_headers, "X-OpenDrSai-Approval-ID": restore_approval}, json=restore_body)
    assert target.read_text() == "checkpoint"

    # F07 PTY shell Approval and approved scope.
    pty_auth = {
        "type": "auth", "token": TOKEN, "authorization": f"Bearer {jwt('editor', session='oidc-editor')}",
        "principal_id": "editor", "workspace_id": wid, "session_id": "session-editor", "run_id": "run-editor",
        "tool_id": "pty-shell", "correlation_id": "correlation-pty", "cwd": ".", "shell": "/bin/bash",
    }
    with client.websocket_connect("/v1/pty") as websocket:
        websocket.send_json(pty_auth)
        message = websocket.receive_json()
        assert message["type"] == "approval_required"
        pty_approval = message["approval_id"]
    approve(client, "editor", pty_approval)
    with client.websocket_connect("/v1/pty") as websocket:
        websocket.send_json({**pty_auth, "approval_id": pty_approval})
        websocket.send_json({"type": "create", "workspaceId": wid, "cwd": ".", "shell": "/bin/bash", "cols": 80, "rows": 24})
        created = websocket.receive_json(); assert created["type"] == "created"
        pty_id = created["id"]
        websocket.send_json({"type": "write", "id": pty_id, "data": "hostname\n"})
        output = ""
        for _ in range(20):
            message = websocket.receive_json(); output += message.get("data", "")
            if socket.gethostname() in output: break
        assert socket.gethostname() in output
        websocket.send_json({"type": "kill", "id": pty_id})
        while websocket.receive_json().get("type") != "killed": pass

    # F09 every sensitive audit record has the complete correlation chain.
    audit = request(client, "GET", f"/v1/security/audit?workspace_id={wid}", headers=owner_headers)["data"]
    sensitive = [row for row in audit if row["event"] in {"approval.requested", "approval.consumed", "operation.authorized"}]
    assert sensitive
    for row in sensitive:
        for key in ("principal_id", "runtime_id", "workspace_id", "session_id", "run_id", "tool_id", "correlation_id"):
            assert row["context"][key]

    # F10 secrets in content and nested audit detail never enter state, Events or audit output.
    secret_body = b"Bearer secret-bearer-canary\n-----BEGIN PRIVATE KEY-----\nprivate-key-canary\n-----END PRIVATE KEY-----"
    pending = request(client, "PUT", f"/v1/workspaces/{wid}/file", expected=428, headers=editor_headers, json={"path": "secret-source.txt", "content_base64": base64.b64encode(secret_body).decode()})
    secret_approval = approval_id(pending); approve(client, "editor", secret_approval)
    request(client, "PUT", f"/v1/workspaces/{wid}/file", headers={**editor_headers, "X-OpenDrSai-Approval-ID": secret_approval}, json={"path": "secret-source.txt", "content_base64": base64.b64encode(secret_body).decode()})
    state_text = ""
    for candidate in HOME.rglob("*"):
        if candidate.is_file() and candidate.stat().st_size < 5_000_000:
            state_text += candidate.read_bytes().decode("utf-8", "ignore")
    event_text = json.dumps(gateway._runtime_engine().list_events(editor_run["run_id"]))
    audit_text = json.dumps(gateway._runtime_security().audit.list())
    for canary in ("secret-bearer-canary", "private-key-canary", OIDC_SECRET, TOKEN):
        assert canary not in state_text and canary not in event_text and canary not in audit_text

    # F02 revoked Token fails both HTTP and WebSocket after all authorized work is complete.
    revoke_gateway_instance_token(TOKEN)
    request(client, "GET", "/v1/runtime", expected=401, headers={"X-OpenDrSai-Gateway-Token": TOKEN})
    try:
        with client.websocket_connect("/v1/pty") as websocket:
            websocket.send_json({"type": "auth", "token": TOKEN})
            websocket.receive_json()
        raise AssertionError("revoked Runtime token unexpectedly opened a WebSocket")
    except WebSocketDisconnect as exc:
        assert exc.code == 4401

print(json.dumps({
    "marker": "Real Runtime Security API verification passed.",
    "remote_hostname": socket.gethostname(),
    "workspace_id": wid,
    "audit_records": len(audit),
}))
