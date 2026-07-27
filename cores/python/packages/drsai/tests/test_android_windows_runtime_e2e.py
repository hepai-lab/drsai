from __future__ import annotations

import asyncio
import base64
import json
import os
import sys
import threading
from pathlib import Path
from uuid import uuid4

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi.testclient import TestClient

from drsai.relay.api import create_relay_app
from drsai.relay.gateway_control import GatewayControlError, GatewayRuntimeControlHandler
from drsai.relay.models import Workspace
from drsai.relay.registry import RelayRegistry


class GatewayTestTransport:
    def __init__(self, client: TestClient, token: str) -> None:
        self.client, self.token = client, token

    async def request(self, method, path, *, body=None, headers=None):
        response = await asyncio.to_thread(self.client.request, method, path, json=body, headers={
            "X-OpenDrSai-Gateway-Token": self.token, **(headers or {}),
        })
        result = response.json()
        if response.status_code >= 400:
            detail = result.get("detail", result)
            if not isinstance(detail, dict):
                detail = {"message": str(detail)}
            raise GatewayControlError(str(detail.get("code") or f"runtime_http_{response.status_code}"),
                                      str(detail.get("message") or detail), retryable=response.status_code >= 500)
        return result


class DirectRuntimeChannel:
    """Deterministic in-process equivalent of the separately tested outbound WSS transport."""

    def __init__(self, handler: GatewayRuntimeControlHandler) -> None:
        self.handler = handler
        self.loop = asyncio.new_event_loop()
        self.thread = threading.Thread(target=self.loop.run_forever, daemon=True)
        self.thread.start()

    async def request(self, runtime_id, operation, arguments):
        assert runtime_id == self.handler.runtime_id
        future = asyncio.run_coroutine_threadsafe(self.handler(operation, arguments), self.loop)
        return await asyncio.wrap_future(future)

    async def attach(self, *_): return "direct"
    async def detach(self, *_): return None
    def accept_response(self, *_): return None

    def close(self):
        self.loop.call_soon_threadsafe(self.loop.stop)
        self.thread.join(timeout=5)


class DirtyCatalogProbe:
    def __init__(self) -> None:
        self.calls = 0

    def mark_workspaces_dirty(self) -> None:
        self.calls += 1


def relay_registry(workspace_id: str):
    registry = RelayRegistry()
    key = Ed25519PrivateKey.generate()
    public = base64.urlsafe_b64encode(key.public_key().public_bytes(
        serialization.Encoding.Raw, serialization.PublicFormat.Raw)).rstrip(b"=").decode()
    runtime_id, token = registry.register(registry.issue_registration_code(), "Windows OpenDrSai", "1.4.7",
                                          public, "windows-e2e-registration")
    _, grant, _ = registry.issue_access_grant(runtime_id, token)
    registry.associate(
        "alice",
        grant,
        "android-e2e-device",
        "Android E2E",
        public,
    )
    registry.publish_workspaces(runtime_id, token, [Workspace(
        runtime_id=runtime_id, workspace_id=workspace_id, display_name="Windows E2E")])
    return registry, runtime_id


def control(key: str | None = None):
    result = {"request_id": str(uuid4()), "correlation_id": str(uuid4())}
    if key:
        result["idempotency_key"] = key
    return result


def test_windows_workspace_mutations_mark_relay_catalog_dirty_after_commit(tmp_path: Path, monkeypatch) -> None:
    home, workspace = tmp_path / "home", tmp_path / "workspace"
    workspace.mkdir()
    token = "workspace-catalog-dirty-token"
    monkeypatch.setenv("DRSAI_HOME", str(home))
    monkeypatch.setenv("OPENDRSAI_GATEWAY_INSTANCE_TOKEN", token)

    from drsai.backend import gateway
    gateway._WORKSPACE = home / "workspace-state"
    gateway._DATASET = gateway._WORKSPACE / "drsai"
    gateway._DATASET.mkdir(parents=True, exist_ok=True)
    gateway._DB_URI = f"sqlite:///{gateway._DATASET}/drsai.db"
    gateway._db_manager = None
    gateway._runtime_registry_instance = None
    gateway._runtime_engine_instance = None
    gateway._runtime_agent_service_instance = None
    gateway._runtime_tool_dispatcher_instance = None
    gateway._remote_workspaces.clear()
    probe = DirtyCatalogProbe()
    monkeypatch.setattr(gateway, "_runtime_relay_connector", probe)

    with TestClient(gateway.app) as windows:
        opened = windows.post(
            "/v1/workspaces",
            headers={"X-OpenDrSai-Gateway-Token": token},
            json={"path": str(workspace), "display_name": "Temporary Catalog Workspace"},
        )
        assert opened.status_code == 200, opened.text
        workspace_id = opened.json()["workspace_id"]
        assert probe.calls == 1

        renamed = windows.put(
            f"/v1/workspaces/{workspace_id}/display-name",
            headers={"X-OpenDrSai-Gateway-Token": token},
            json={"display_name": "Renamed Catalog Workspace"},
        )
        assert renamed.status_code == 200, renamed.text
        assert renamed.json()["workspace_id"] == workspace_id
        assert probe.calls == 2

        closed = windows.delete(
            f"/v1/workspaces/{workspace_id}",
            headers={"X-OpenDrSai-Gateway-Token": token},
        )
        assert closed.status_code == 200, closed.text
        assert closed.json()["lifecycle"] == "archived"
        assert probe.calls == 3


def test_android_relay_uses_real_windows_full_runtime_opendrsai_backend(tmp_path: Path, monkeypatch) -> None:
    home, workspace = tmp_path / "home", tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "README.md").write_text("windows runtime e2e", encoding="utf-8")
    definition = home / "assets" / "agents" / "android-e2e" / "1.json"
    definition.parent.mkdir(parents=True)
    definition.write_text(json.dumps({
        "id": "android-e2e", "version": "1", "name": "Android E2E", "backend": "opendrsai",
        "instructions": "controlled Windows Runtime acceptance", "permissions": ["shell:python", "tool:artifact.publish"],
        "controlled_plan": {"calls": [{"kind": "approval", "name": "shell:python", "arguments": {
            "risk_summary": "Allow controlled Windows operation", "scope": "workspace", "timeout_seconds": 10,
        }}, {"kind": "shell", "name": "python", "arguments": {"command": [
            sys.executable, "-c", "from pathlib import Path; Path('artifact.txt').write_text('android artifact', encoding='utf-8')",
        ]}}, {"kind": "tool", "name": "artifact.publish", "arguments": {
            "path": "artifact.txt", "display_name": "Android Artifact", "mime_type": "text/plain",
        }}], "content": "windows-runtime-complete"},
    }), encoding="utf-8")
    token = "windows-runtime-e2e-instance-token"
    monkeypatch.setenv("DRSAI_HOME", str(home))
    monkeypatch.setenv("OPENDRSAI_GATEWAY_INSTANCE_TOKEN", token)
    monkeypatch.setenv("DRSAI_RUNTIME_CONTROLLED_MODEL", "1")

    # This is the same Full Runtime module launched by apps/desktop/windows/src/main/gateway.ts.
    from drsai.backend import gateway
    gateway._WORKSPACE = home / "workspace-state"
    gateway._DATASET = gateway._WORKSPACE / "drsai"
    gateway._DATASET.mkdir(parents=True, exist_ok=True)
    gateway._DB_URI = f"sqlite:///{gateway._DATASET}/drsai.db"
    gateway._db_manager = None
    gateway._runtime_registry_instance = None
    gateway._runtime_engine_instance = None
    gateway._runtime_agent_service_instance = None
    gateway._runtime_tool_dispatcher_instance = None

    with TestClient(gateway.app) as windows:
        opened = windows.post("/v1/workspaces", headers={"X-OpenDrSai-Gateway-Token": token},
                              json={"path": str(workspace)})
        assert opened.status_code == 200, opened.text
        workspace_id = opened.json()["workspace_id"]
        registry, runtime_id = relay_registry(workspace_id)
        handler = GatewayRuntimeControlHandler(runtime_id, GatewayTestTransport(windows, token), home / "runtime")
        published = asyncio.run(handler.published_workspaces())
        assert len(published) == 1
        assert {
            "runtime_id": published[0]["runtime_id"],
            "workspace_id": published[0]["workspace_id"],
            "display_name": published[0]["display_name"],
            "lifecycle": published[0]["lifecycle"],
            "revision": published[0]["revision"],
        } == {
            "runtime_id": runtime_id,
            "workspace_id": workspace_id,
            "display_name": workspace.name,
            "lifecycle": "active",
            "revision": 1,
        }
        assert published[0]["updated_at"]
        local_definitions = windows.get(
            "/v1/agent-definitions",
            headers={"X-OpenDrSai-Gateway-Token": token},
        )
        assert local_definitions.status_code == 200
        assert local_definitions.json()["items"]
        assert any(
            item["definition_id"] == "mobile-acceptance"
            and item["backend_id"] == "opendrsai"
            and item["backend_health"] == "healthy"
            for item in local_definitions.json()["items"]
        )
        assert set(local_definitions.json()["items"][0]) == {
            "definition_id",
            "version",
            "display_name",
            "backend_id",
            "backend_health",
            "capabilities",
        }
        local_approvals = windows.get(
            f"/v1/workspaces/{workspace_id}/approvals",
            headers={"X-OpenDrSai-Gateway-Token": token},
        )
        assert local_approvals.status_code == 200
        assert local_approvals.json() == {"items": []}
        assert windows.get(
            "/v1/workspaces/workspace-not-found/approvals",
            headers={"X-OpenDrSai-Gateway-Token": token},
        ).status_code == 404
        channel = DirectRuntimeChannel(handler)
        relay = TestClient(create_relay_app(
            registry, channels=channel,
            principal_resolver=lambda request: request.headers.get("x-subject", ""),
        ))  # type: ignore[arg-type]
        headers = {"x-subject": "alice"}

        definitions = relay.get(f"/v1/runtimes/{runtime_id}/agent-definitions", headers=headers)
        assert definitions.status_code == 200 and definitions.json()["items"][0]["backend_id"] == "opendrsai"
        session = relay.post(f"/v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions", headers=headers, json={
            **control("session-e2e"), "title": "Android Windows E2E",
            "agent_definition_id": "android-e2e", "agent_definition_version": "1",
        })
        assert session.status_code == 200, session.text
        session_id = session.json()["session_id"]
        run = relay.post(f"/v1/runtimes/{runtime_id}/workspaces/{workspace_id}/sessions/{session_id}/runs",
                         headers=headers, json={**control("run-e2e"), "message": "execute", "attachment_refs": []})
        assert run.status_code == 200, run.text
        run_id = run.json()["run_id"]

        approval = None
        for _ in range(200):
            page = relay.get(f"/v1/runtimes/{runtime_id}/workspaces/{workspace_id}/approvals", headers=headers)
            if page.status_code == 200 and page.json()["items"]:
                approval = page.json()["items"][0]
                break
            __import__("time").sleep(0.01)
        diagnostics = {
            "approval_page": page.json(),
            "run": relay.get(f"/v1/runtimes/{runtime_id}/runs/{run_id}", headers=headers).json(),
            "events": relay.get(
                f"/v1/runtimes/{runtime_id}/runs/{run_id}/events?after_sequence=0",
                headers=headers,
            ).json(),
            "execution_failures": handler.execution_failures,
        }
        assert approval and approval["operation"] == "shell:python", json.dumps(diagnostics, indent=2)
        decided = relay.post(f"/v1/runtimes/{runtime_id}/approvals/{approval['approval_id']}/decision",
                             headers=headers, json={**control(), "decision": "approve"})
        assert decided.status_code == 200 and decided.json()["status"] == "approved"

        terminal = None
        for _ in range(200):
            terminal = relay.get(f"/v1/runtimes/{runtime_id}/runs/{run_id}", headers=headers).json()
            if terminal["status"] == "completed":
                break
            __import__("time").sleep(0.01)
        assert terminal["status"] == "completed"
        events = relay.get(f"/v1/runtimes/{runtime_id}/runs/{run_id}/events", headers=headers).json()["items"]
        assert any(item["kind"] == "message.delta" and item["payload"]["delta"] == "windows-runtime-complete"
                   for item in events)
        assert any(item["kind"] == "tool.finished" and item["payload"]["name"] == "python" for item in events)
        artifact = next(item["payload"] for item in events if item["kind"] == "artifact.created")
        files = relay.post(f"/v1/runtimes/{runtime_id}/workspaces/{workspace_id}/owop", headers=headers, json={
            "version": "1.0", "request_id": "owop-e2e", "correlation_id": "correlation-owop-e2e",
            "operation": "files.list", "params": {"path": ".", "limit": 20},
        })
        assert files.status_code == 200, files.text
        assert any(item["relative_path"] == "README.md" for item in files.json()["result"]["items"])
        metadata = relay.post(f"/v1/runtimes/{runtime_id}/workspaces/{workspace_id}/owop", headers=headers, json={
            "version": "1.0", "request_id": "artifact-meta", "correlation_id": "correlation-artifact-meta",
            "operation": "artifact.metadata", "params": {"artifact_id": artifact["artifact_id"]},
        })
        assert metadata.status_code == 200 and metadata.json()["result"]["sha256"] == artifact["sha256"]
        chunk = relay.post(f"/v1/runtimes/{runtime_id}/workspaces/{workspace_id}/owop", headers=headers, json={
            "version": "1.0", "request_id": "artifact-chunk", "correlation_id": "correlation-artifact-chunk",
            "operation": "artifact.chunk", "params": {"artifact_id": artifact["artifact_id"], "offset": 0, "length": 1024},
        })
        assert base64.b64decode(chunk.json()["result"]["content_base64"]) == b"android artifact"

        restored = GatewayRuntimeControlHandler(runtime_id, GatewayTestTransport(windows, token), home / "runtime")
        recovered = asyncio.run(restored.idempotency_result("alice", "run.create", "run-e2e"))
        assert recovered["run_id"] == run_id and recovered["status"] == "completed"
        first_identity = windows.get("/v1/runtime", headers={"X-OpenDrSai-Gateway-Token": token}).json()
        channel.close()

    # Recreate the exact Full Runtime process-owned services against the same
    # apps/desktop/windows state directory and prove authoritative recovery.
    gateway._runtime_registry_instance = None
    gateway._runtime_engine_instance = None
    gateway._runtime_agent_service_instance = None
    gateway._runtime_tool_dispatcher_instance = None
    gateway._runtime_artifact_store_instance = None
    gateway._local_workspace_owop_instances.clear()
    with TestClient(gateway.app) as restarted_windows:
        second_identity = restarted_windows.get(
            "/v1/runtime", headers={"X-OpenDrSai-Gateway-Token": token}).json()
        assert second_identity["runtime_id"] == first_identity["runtime_id"]
        assert second_identity["instance_id"] != first_identity["instance_id"]
        restarted = GatewayRuntimeControlHandler(
            runtime_id, GatewayTestTransport(restarted_windows, token), home / "runtime")
        recovered = asyncio.run(restarted.idempotency_result("alice", "run.create", "run-e2e"))
        assert recovered["run_id"] == run_id and recovered["status"] == "completed"
        recovered_events, _ = asyncio.run(restarted.list_events(run_id))
        assert any(item["kind"] == "artifact.created" for item in recovered_events)
        recovered_artifact = asyncio.run(restarted.execute_owop(
            workspace_id, "artifact.metadata", {"artifact_id": artifact["artifact_id"]}))
        assert recovered_artifact["sha256"] == artifact["sha256"]
