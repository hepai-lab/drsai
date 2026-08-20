from __future__ import annotations

import asyncio
import base64
import json
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient


def _reset_gateway(gateway, home: Path) -> None:
    gateway._WORKSPACE = home / "workspace-state"
    gateway._DATASET = gateway._WORKSPACE / "drsai"
    gateway._DATASET.mkdir(parents=True, exist_ok=True)
    gateway._DB_URI = f"sqlite:///{gateway._DATASET}/drsai.db"
    gateway._db_manager = None
    gateway._runtime_registry_instance = None
    gateway._runtime_engine_instance = None
    gateway._runtime_security_instance = None
    gateway._runtime_agent_service_instance = None
    gateway._runtime_tool_dispatcher_instance = None
    gateway._runtime_artifact_store_instance = None
    gateway._owop_protocol_instance = None
    gateway._local_workspace_owop_instances.clear()
    gateway._resource_service_instances.clear()
    gateway._remote_workspaces.clear()


def test_gateway_exposes_resources_v2_with_session_binding(tmp_path: Path, monkeypatch) -> None:
    home, workspace = tmp_path / "home", tmp_path / "workspace"
    workspace.mkdir()
    content = b"Gateway Resource Service P2\n"
    (workspace / "plan.md").write_bytes(content)
    token = "gateway-resources-v2-token"
    monkeypatch.setenv("DRSAI_HOME", str(home))
    monkeypatch.setenv("OPENDRSAI_GATEWAY_INSTANCE_TOKEN", token)
    monkeypatch.setenv("OPENDRSAI_RESOURCE_AUDIT_SALT", "test-only-resource-audit-salt")

    from drsai.backend import feedback_service
    # Keep the process-wide feedback singleton isolated from this temporary
    # gateway home.  Direct assignment here would leave later gateway tests
    # pointing at a pytest directory that has already been removed.
    monkeypatch.setattr(feedback_service, "FS_DIR", str(home))
    monkeypatch.setattr(feedback_service, "_default_feedback_store", None)
    from drsai.backend import gateway
    _reset_gateway(gateway, home)
    headers = {"X-OpenDrSai-Gateway-Token": token}

    with TestClient(gateway.app) as client:
        opened = client.post("/v1/workspaces", headers=headers, json={"path": str(workspace), "display_name": "P2"})
        assert opened.status_code == 200, opened.text
        workspace_id = opened.json()["workspace_id"]
        session = gateway._runtime_engine().create_session(workspace_id, "P2 resources")
        session_id = session["session_id"]
        runtime_id = gateway._runtime_registry().identity.runtime_id
        bound = {**headers, "X-OpenDrSai-Session-ID": session_id}

        def owop(operation: str, params: dict, *, request_headers=bound) -> dict:
            response = client.post("/v1/owop", headers=request_headers, json={
                "version": "1.0", "request_id": str(uuid4()), "correlation_id": str(uuid4()),
                "workspace_id": workspace_id, "operation": operation, "params": params,
                "binding": {"kind": "local_ipc"},
            })
            assert response.status_code == 200, response.text
            return response.json()

        legacy = owop("files.register", {"path": "plan.md"})
        assert legacy["ok"] is True
        file_id = legacy["result"]["resource"]["file_id"]

        registered = owop("resources.register", {
            "authority_id": runtime_id, "resource_type": "file", "host_handle": f"file:{file_id}",
            "idempotency_key": "register-plan-p2",
        })
        assert registered["ok"] is True, registered.get("error")
        key, version = registered["result"]["resource"], registered["result"]["version"]
        assert key["authority_id"] == runtime_id and "path" not in key

        resolved = owop("resources.resolve_batch", {"observations": [{
            "association_id": "assoc-plan", "resource": key, "observed_version_id": version["version_id"],
        }]})
        descriptor = resolved["result"]["results"][0]["descriptor"]
        assert descriptor["state"] == "available"
        assert descriptor["capabilities"]["preview"] is True, descriptor
        assert "canonical_path" not in str(descriptor)

        read = owop("resources.read", {
            "resource": key, "version_id": version["version_id"], "offset": 0,
            "length": len(content), "purpose": "preview",
        })
        assert base64.b64decode(read["result"]["content_base64"]) == content

        preview = owop("resources.preview", {
            "resource": key, "version_id": version["version_id"],
            "accept_kinds": ["text"], "max_bytes": 1024,
        })
        assert base64.b64decode(preview["result"]["content_base64"]) == content

        prepared = owop("resources.download.prepare", {
            "resource": key, "version_id": version["version_id"], "suggested_name": "plan.md",
        })["result"]
        chunk = owop("resources.download.chunk", {
            "download_id": prepared["download_id"], "offset": 0, "length": 65536,
        })
        assert chunk["ok"] is True, chunk.get("error")
        assert base64.b64decode(chunk["result"]["content_base64"]) == content
        assert owop("resources.download.cancel", {"download_id": prepared["download_id"]})["result"]["cancelled"] is True
        assert owop("resources.subscribe", {"after_sequence": 0, "limit": 100})["result"]["events"]

        unbound = owop("resources.resolve_batch", {"observations": [{"resource": key}]}, request_headers=headers)
        assert unbound["ok"] is True
        assert unbound["result"]["results"][0]["error"] == {"code": "resource_not_found", "retryable": False}

        other_session = gateway._runtime_engine().create_session(workspace_id, "Other P2 session")["session_id"]
        other_headers = {**headers, "X-OpenDrSai-Session-ID": other_session}
        cross_session = owop(
            "resources.resolve_batch", {"observations": [{"resource": key}]}, request_headers=other_headers,
        )
        assert cross_session["result"]["results"][0]["error"] == {"code": "resource_not_found", "retryable": False}
        other_registration = owop("resources.register", {
            "authority_id": runtime_id, "resource_type": "file", "host_handle": f"file:{file_id}",
            "idempotency_key": "other-session-register-plan",
        }, request_headers=other_headers)
        assert other_registration["result"]["resource"] == key
        assert owop(
            "resources.resolve_batch", {"observations": [{"resource": key}]}, request_headers=other_headers,
        )["result"]["results"][0]["descriptor"]["state"] == "available"

        from drsai.backend.runtime.agent import RuntimeRunContext
        run, _ = gateway._runtime_engine().create_run(session_id, "opendrsai@1", "p2-artifact-run")
        run_context = RuntimeRunContext(
            runtime_id=runtime_id, instance_id=gateway._runtime_registry().identity.instance_id,
            workspace_id=workspace_id, workspace_path=workspace,
            session_id=session_id, run_id=run["run_id"],
            agent_definition_id="opendrsai", agent_definition_version="1",
            correlation_id="p2-artifact-correlation",
        )
        artifact_bytes = b"generated document bytes"
        before_artifact_sequence = client.get(
            f"/v1/sessions/{session_id}/oaep-snapshot", headers=headers,
        ).json()["snapshot_sequence"]
        artifact = gateway._runtime_artifact_store().publish_content(
            run_context, artifact_bytes, display_name="generated.docx",
            mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
        gateway._register_runtime_artifact_resource(run_context, artifact)
        artifact["resource_refs"] = [{
            "protocol": "owop/1", "workspace_id": workspace_id,
            "resource_type": "artifact", "resource_id": artifact["artifact_id"],
            "relation": "output_artifact", "presentation": "card",
            "digest": f"sha256:{artifact['sha256']}",
            "operation_id": "operation-generate-docx",
            "locator": {"kind": "page", "page": 1},
        }]
        gateway._runtime_engine().append_event(run["run_id"], "artifact.created", artifact)
        snapshot = client.get(f"/v1/sessions/{session_id}/oaep-snapshot", headers=headers).json()
        artifact_item = next(item for item in snapshot["items"] if item["type"] == "artifact")
        assert "resource_refs" not in artifact_item["content"]
        assert artifact_item["content"]["association_id"] == artifact_item["associations"][0]["association_id"]
        artifact_key = artifact_item["associations"][0]["resource"]
        assert artifact_item["associations"][0]["operation_id"] == "operation-generate-docx"
        assert artifact_item["associations"][0]["locator"] == {"kind": "page", "page": 1}
        assert artifact_item["associations"][0]["version_snapshot"]["digest"] == f"sha256:{artifact['sha256']}"
        assert artifact_key["resource_id"] == artifact["artifact_id"]
        artifact_resolved = owop("resources.resolve_batch", {"observations": [{
            "association_id": artifact_item["content"]["association_id"], "resource": artifact_key,
        }]})
        assert artifact_resolved["result"]["results"][0]["descriptor"]["display_name"] == "generated.docx"

        def canonical_artifact(item: dict) -> str:
            return json.dumps({
                "content": item["content"], "associations": item["associations"],
            }, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

        snapshot_canonical = canonical_artifact(artifact_item)
        replay = client.get(
            f"/v1/sessions/{session_id}/oaep-events",
            headers=headers, params={"after_sequence": before_artifact_sequence},
        ).json()
        replay_item = next(
            event["data"]["item"] for event in replay["data"]
            if isinstance(event.get("data", {}).get("item"), dict)
            and event["data"]["item"].get("type") == "artifact"
        )
        assert canonical_artifact(replay_item) == snapshot_canonical

        class ConnectedRequest:
            async def is_disconnected(self) -> bool:
                return False

        async def streamed_artifact() -> dict:
            stream = await gateway.runtime_session_oaep_event_stream(
                session_id, ConnectedRequest(), before_artifact_sequence,
            )
            async for frame in stream.body_iterator:
                if "data: " not in frame:
                    continue
                event = json.loads(frame.split("data: ", 1)[1])
                item = event.get("data", {}).get("item")
                if isinstance(item, dict) and item.get("type") == "artifact":
                    return item
            raise AssertionError("artifact_missing_from_oaep_stream")

        assert canonical_artifact(asyncio.run(streamed_artifact())) == snapshot_canonical

        # Runtime process reconstruction must not alter deterministic IDs,
        # locators, operation/version snapshots, ordering, or labels.
        _reset_gateway(gateway, home)
        restarted = client.get(f"/v1/sessions/{session_id}/oaep-snapshot", headers=headers).json()
        restarted_item = next(item for item in restarted["items"] if item["type"] == "artifact")
        assert canonical_artifact(restarted_item) == snapshot_canonical

        audit = gateway._runtime_security().audit.list()
        resource_events = [event for event in audit if event["event"] == "resource.action"]
        assert resource_events
        assert all({
            "principal_id", "session_id", "runtime_id", "workspace_id", "correlation_id",
        } <= event["context"].keys() for event in resource_events)
        assert all({
            "tenant_id", "authority_id", "resource_hash", "action", "result_code",
        } <= event["detail"].keys() for event in resource_events)
        assert all(
            "plan.md" not in str(event) and str(workspace) not in str(event) and token not in str(event)
            for event in resource_events
        )
