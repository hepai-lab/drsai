from __future__ import annotations

import asyncio
import json
from pathlib import Path

from drsai.relay.gateway_control import GatewayRuntimeControlHandler


class GatewayFixture:
    def __init__(self) -> None:
        self.sessions: dict[str, dict] = {}
        self.runs: dict[str, dict] = {}
        self.events: dict[str, list[dict]] = {}
        self.approvals: dict[str, dict] = {}
        self.calls: list[tuple[str, str]] = []

    async def request(self, method, path, *, body=None, headers=None):
        self.calls.append((method, path))
        if path == "/v1/capabilities":
            return {"agent_backends": {"opendrsai": {"available": True}}}
        if path == "/v1/workspaces?include_closed=true":
            return {"data": [{
                "workspace_id": "workspace-one",
                "path": "/workspace-one",
                "lifecycle": "active",
                "revision": 1,
                "updated_at": "2026-07-17T00:00:00+00:00",
            }]}
        if method == "POST" and path == "/v1/sessions":
            item = {"session_id": "session-one", "workspace_id": body["workspace_id"], "title": body["title"],
                    "updated_at": "2026-07-17T00:00:00+00:00"}
            self.sessions[item["session_id"]] = item
            return item
        if method == "GET" and path.startswith("/v1/sessions?"):
            return {"data": list(self.sessions.values()), "total": len(self.sessions)}
        if method == "GET" and path.startswith("/v1/sessions/") and "/runs?" in path:
            session_id = path.split("/")[3]
            rows = [item for item in self.runs.values() if item["session_id"] == session_id]
            return {"data": rows, "total": len(rows)}
        if method == "GET" and path.startswith("/v1/sessions/") and "/conversation?" in path:
            session_id = path.split("/")[3]
            items = []
            for run in (item for item in self.runs.values() if item["session_id"] == session_id):
                for event in self.events.get(run["run_id"], []):
                    items.append({
                        "item_id": event["event_id"],
                        "sequence": len(items) + 1,
                        "kind": event["type"],
                        "timestamp": event["created_at"],
                        "payload": {**event["data"], "run_id": run["run_id"]},
                    })
            return {"data": items, "next_cursor": None}
        if method == "GET" and path.startswith("/v1/sessions/"):
            return self.sessions[path.rsplit("/", 1)[-1]]
        if method == "POST" and path.endswith("/runs"):
            item = {"run_id": "run-one", "session_id": "session-one", "workspace_id": "workspace-one",
                    "backend_id": "opendrsai", "status": "queued", "created_at": "2026-07-17T00:00:01+00:00"}
            self.runs[item["run_id"]] = item
            self.events[item["run_id"]] = [{"event_id": "event-one", "sequence": 1, "type": "run.created",
                                             "data": {}, "created_at": item["created_at"]}]
            return item
        if method == "POST" and path.endswith("/execute"):
            run_id = path.split("/")[3]
            self.runs[run_id]["status"] = "completed"
            self.events[run_id].append({"event_id": "event-two", "sequence": 2, "type": "agent.message.delta",
                                        "data": {"content": "done"}, "created_at": "2026-07-17T00:00:02+00:00"})
            return {"run": self.runs[run_id], "result": {"content": "done"}}
        if method == "GET" and "/events?after_sequence=" in path:
            return {"data": self.events[path.split("/")[3]]}
        if method == "GET" and "/v1/runs/" in path:
            return self.runs[path.rsplit("/", 1)[-1]]
        if method == "POST" and path.endswith("/cancel"):
            run_id = path.split("/")[3]
            self.runs[run_id]["status"] = "cancelled"
            return self.runs[run_id]
        if method == "GET" and path == "/v1/approvals?status=pending":
            return {"data": [
                item for item in self.approvals.values()
                if item["status"] == "pending"
            ]}
        if method == "GET" and path.startswith("/v1/approvals/"):
            return self.approvals[path.rsplit("/", 1)[-1]]
        if method == "POST" and path.startswith("/v1/approvals/") and path.endswith("/decision"):
            approval_id = path.split("/")[3]
            item = self.approvals[approval_id]
            if item["status"] == "pending":
                item["status"] = body["decision"]
                run_id = item["run_id"]
                self.runs[run_id]["status"] = (
                    "running" if body["decision"] == "approved" else "cancelled"
                )
                self.events[run_id].append({
                    "event_id": "approval-decision-event",
                    "sequence": len(self.events[run_id]) + 1,
                    "type": f"approval.{body['decision']}",
                    "data": {
                        "approval_id": approval_id,
                        **body.get("detail", {}),
                    },
                    "created_at": "2026-07-17T00:00:03+00:00",
                })
            return item
        if method == "POST" and "/approvals/" in path and path.endswith("/decision"):
            approval_id = path.split("/")[-2]
            return self.approvals[approval_id]
        if method == "POST" and path == "/v1/owop":
            return {"ok": True, "result": {"items": [{"relative_path": "README.md"}]}}
        raise AssertionError((method, path, body, headers))


def write_definition(root: Path) -> None:
    path = root / "assets" / "agents" / "mobile" / "1.json"
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps({"id": "mobile", "version": "1", "name": "Mobile", "backend": "opendrsai",
                                "instructions": "test", "permissions": ["chat"]}), encoding="utf-8")


def test_hai_workspace_proxy_normalizes_contract_before_leaving_runtime(tmp_path: Path) -> None:
    class ProxyFixture:
        async def proxy(self, method, path, *, body=None, headers=None):
            assert method == "GET"
            assert path == "/v1/workspaces?include_closed=true"
            assert headers == {"X-Correlation-ID": "correlation-one"}
            return 200, {"data": [{
                "workspace_id": "workspace-one",
                "path": r"C:\Users\owner\private-project",
                "open": True,
                "lifecycle": "active",
                "revision": 3,
                "updated_at": "2026-07-26T00:00:00+00:00",
            }]}

    async def scenario() -> None:
        handler = GatewayRuntimeControlHandler("runtime-enrollment", ProxyFixture(), tmp_path / "runtime")
        status, result = await handler.handle_http_request(
            "GET", "/v1/workspaces?include_closed=true", None, "correlation-one"
        )
        assert status == 200
        assert result == {
            "data": [{
                "runtime_id": "runtime-enrollment",
                "workspace_id": "workspace-one",
                "display_name": "private-project",
                "lifecycle": "active",
                "revision": 3,
                "updated_at": "2026-07-26T00:00:00+00:00",
            }],
            "next_cursor": None,
        }
        assert "path" not in json.dumps(result)

    asyncio.run(scenario())


def test_workspace_publication_preserves_lifecycle_revision_and_tombstone(tmp_path: Path) -> None:
    class WorkspaceFixture:
        async def request(self, method, path, *, body=None, headers=None):
            assert (method, path) == ("GET", "/v1/workspaces?include_closed=true")
            return {"data": [
                {
                    "workspace_id": "active",
                    "path": r"C:\projects\active-project",
                    "lifecycle": "active",
                    "revision": 1,
                    "updated_at": "2026-07-26T00:00:00+00:00",
                },
                {
                    "workspace_id": "archived",
                    "path": r"C:\projects\archived-project",
                    "lifecycle": "archived",
                    "revision": 2,
                    "updated_at": "2026-07-26T00:01:00+00:00",
                },
                {
                    "workspace_id": "removed",
                    "path": r"C:\projects\removed-project",
                    "lifecycle": "removed",
                    "revision": 3,
                    "updated_at": "2026-07-26T00:02:00+00:00",
                },
            ]}

    async def scenario() -> None:
        handler = GatewayRuntimeControlHandler("runtime-one", WorkspaceFixture(), tmp_path / "runtime")
        rows = await handler.published_workspaces()
        assert [row["lifecycle"] for row in rows] == ["active", "archived", "removed"]
        assert [row["revision"] for row in rows] == [1, 2, 3]
        assert [row["display_name"] for row in rows] == [
            "active-project", "archived-project", "removed-project",
        ]
        assert all(row["runtime_id"] == "runtime-one" for row in rows)
        assert "path" not in json.dumps(rows)

    asyncio.run(scenario())


def test_gateway_handler_maps_relay_to_authoritative_runtime_and_recovers_metadata(tmp_path: Path) -> None:
    async def scenario() -> None:
        write_definition(tmp_path)
        gateway = GatewayFixture()
        handler = GatewayRuntimeControlHandler("runtime-one", gateway, tmp_path / "runtime")
        definitions = await handler("list_agent_definitions", {"args": [], "kwargs": {}})
        assert definitions[0]["definition_id"] == "mobile" and definitions[0]["backend_health"] == "healthy"
        session_args = {"args": ["alice", "workspace-one"], "kwargs": {
            "title": "Remote", "definition_id": "mobile", "definition_version": "1", "idempotency_key": "session-key"}}
        session = await handler("create_session", session_args)
        assert session["runtime_id"] == "runtime-one" and session["agent_definition_id"] == "mobile"
        assert (await handler("create_session", session_args))["session_id"] == session["session_id"]
        run_args = {"args": ["alice", "workspace-one", session["session_id"]], "kwargs": {
            "message": "hello", "attachment_refs": ["attachment-one"], "idempotency_key": "run-key",
            "correlation_id": "correlation-one", "retry_of": None}}
        run = await handler("create_run", run_args)
        for _ in range(50):
            run = await handler("get_run", {"args": [run["run_id"]], "kwargs": {}})
            if run["status"] == "completed":
                break
            await asyncio.sleep(0.01)
        assert run["status"] == "completed" and run["message"] == "hello"
        assert (await handler("create_run", run_args))["run_id"] == run["run_id"]
        events, _ = await handler("list_events", {"args": [run["run_id"]], "kwargs": {}})
        assert [item["kind"] for item in events] == ["run.created", "message.delta"]
        assert events[-1]["payload"]["delta"] == "done"
        assert events[-1]["timestamp"] == "2026-07-17T00:00:02+00:00"
        owop = await handler("execute_owop", {"args": ["workspace-one", "files.list", {"path": ""}], "kwargs": {}})
        assert owop["items"][0]["relative_path"] == "README.md"

        restored = GatewayRuntimeControlHandler("runtime-one", gateway, tmp_path / "runtime")
        recovered = await restored("idempotency_result", {"args": ["alice", "run.create", "run-key"], "kwargs": {}})
        assert recovered["run_id"] == run["run_id"] and recovered["correlation_id"] == "correlation-one"

    asyncio.run(scenario())


def test_mobile_approval_resumes_authoritative_run_once_and_keeps_audit_identity(tmp_path: Path) -> None:
    async def scenario() -> None:
        write_definition(tmp_path)
        gateway = GatewayFixture()
        handler = GatewayRuntimeControlHandler("runtime-one", gateway, tmp_path / "runtime")
        session = await handler.create_session(
            "oidc-subject-one",
            "workspace-one",
            title="Approval",
            definition_id="mobile",
            definition_version="1",
            idempotency_key="approval-session-key",
        )
        run = await handler.create_run(
            "oidc-subject-one",
            "workspace-one",
            session["session_id"],
            message="requires approval",
            attachment_refs=[],
            idempotency_key="approval-run-key",
            correlation_id="approval-correlation-one",
            retry_of=None,
        )
        for _ in range(50):
            if gateway.runs[run["run_id"]]["status"] == "completed":
                break
            await asyncio.sleep(0.01)
        gateway.runs[run["run_id"]]["status"] = "waiting_approval"
        gateway.approvals["approval-one"] = {
            "approval_id": "approval-one",
            "run_id": run["run_id"],
            "status": "pending",
            "request": {"tool": "shell"},
            "decision": None,
            "created_at": "2026-07-17T00:00:02+00:00",
        }
        gateway.events[run["run_id"]].append({
            "event_id": "approval-request-event",
            "sequence": len(gateway.events[run["run_id"]]) + 1,
            "type": "approval.requested",
            "data": {"approval_id": "approval-one"},
            "created_at": "2026-07-17T00:00:02+00:00",
        })

        decision = await handler.decide_approval(
            "oidc-subject-one", "approval-one", "approve", "stable-approval-decision"
        )
        replayed = await handler.decide_approval(
            "oidc-subject-one", "approval-one", "approve", "stable-approval-decision"
        )
        restored = GatewayRuntimeControlHandler("runtime-one", gateway, tmp_path / "runtime")
        restarted_replay = await restored.decide_approval(
            "oidc-subject-one", "approval-one", "approve", "stable-approval-decision"
        )

        assert decision["status"] == "approved"
        assert replayed == decision
        assert restarted_replay == decision
        assert gateway.runs[run["run_id"]]["status"] == "running"
        assert gateway.calls.count(
            ("POST", "/v1/approvals/approval-one/decision")
        ) == 1
        decision_events = [
            event for event in gateway.events[run["run_id"]]
            if event["type"] == "approval.approved"
        ]
        assert len(decision_events) == 1
        audit = await handler.audit_entries_for_subject(
            "oidc-subject-one", "workspace-one", run["run_id"]
        )
        approved = next(item for item in audit if item["action"] == "approval.approved")
        assert approved["subject"] == "oidc-subject-one"
        assert approved["correlation_id"] == "approval-correlation-one"
        assert approved["approval_id"] == "approval-one"

    asyncio.run(scenario())


def test_gateway_lists_windows_existing_sessions_runs_and_conversation_without_relay_binding(tmp_path: Path) -> None:
    async def scenario() -> None:
        write_definition(tmp_path)
        gateway = GatewayFixture()
        gateway.sessions["windows-session"] = {
            "session_id": "windows-session",
            "workspace_id": "workspace-one",
            "title": "Created on Windows",
            "archived": False,
            "updated_at": "2026-07-17T00:00:00+00:00",
        }
        gateway.runs["windows-run"] = {
            "run_id": "windows-run",
            "session_id": "windows-session",
            "workspace_id": "workspace-one",
            "backend_id": "opendrsai",
            "status": "completed",
            "created_at": "2026-07-17T00:00:01+00:00",
            "idempotency_key": "windows-idempotency",
        }
        gateway.events["windows-run"] = [{
            "event_id": "windows-event",
            "sequence": 1,
            "type": "agent.message.delta",
            "data": {"content": "Existing response"},
            "created_at": "2026-07-17T00:00:02+00:00",
        }]
        handler = GatewayRuntimeControlHandler("runtime-one", gateway, tmp_path / "runtime")

        sessions, _ = await handler(
            "list_sessions_for_subject",
            {"args": ["mobile-user", "workspace-one"], "kwargs": {}},
        )
        assert [item["session_id"] for item in sessions] == ["windows-session"]
        assert sessions[0]["agent_definition_id"] == ""

        runs, _ = await handler(
            "list_runs_for_subject",
            {"args": ["mobile-user", "workspace-one", "windows-session"], "kwargs": {}},
        )
        assert [item["run_id"] for item in runs] == ["windows-run"]
        transcript, _ = await handler(
            "conversation_for_subject",
            {"args": ["mobile-user", "workspace-one", "windows-session"], "kwargs": {}},
        )
        assert [item["kind"] for item in transcript] == ["message.delta"]
        assert transcript[0]["payload"]["delta"] == "Existing response"

    asyncio.run(scenario())


def test_gateway_event_provider_resumes_without_duplicate_frames(tmp_path: Path) -> None:
    async def scenario() -> None:
        write_definition(tmp_path)
        gateway = GatewayFixture()
        gateway.sessions["session-one"] = {
            "session_id": "session-one",
            "workspace_id": "workspace-one",
            "title": "Live",
            "lifecycle": "active",
            "updated_at": "2026-07-17T00:00:00+00:00",
        }
        gateway.runs["run-one"] = {
            "run_id": "run-one",
            "session_id": "session-one",
            "workspace_id": "workspace-one",
            "backend_id": "opendrsai",
            "status": "running",
            "created_at": "2026-07-17T00:00:01+00:00",
        }
        gateway.events["run-one"] = [{
            "event_id": "event-one",
            "sequence": 1,
            "type": "agent.message.delta",
            "data": {"content": "one"},
            "created_at": "2026-07-17T00:00:02+00:00",
        }]
        handler = GatewayRuntimeControlHandler("runtime-one", gateway, tmp_path / "runtime")

        first = await handler.relay_events()
        assert [item["event_id"] for item in first] == ["event-one"]
        assert first[0]["kind"] == "message.delta"

        # The fixture returns all events regardless of after_sequence, so make
        # it emulate the Runtime cursor contract for the second poll.
        original_request = gateway.request

        async def cursor_aware_request(method, path, *, body=None, headers=None):
            if method == "GET" and path.endswith("after_sequence=1&limit=2000"):
                return {"data": []}
            return await original_request(method, path, body=body, headers=headers)

        gateway.request = cursor_aware_request
        assert await handler.relay_events() == []

    asyncio.run(scenario())
