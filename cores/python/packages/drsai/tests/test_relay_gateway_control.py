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
        self.calls: list[tuple[str, str]] = []

    async def request(self, method, path, *, body=None, headers=None):
        self.calls.append((method, path))
        if path == "/v1/capabilities":
            return {"agent_backends": {"opendrsai": {"available": True}}}
        if method == "POST" and path == "/v1/sessions":
            item = {"session_id": "session-one", "workspace_id": body["workspace_id"], "title": body["title"],
                    "updated_at": "2026-07-17T00:00:00+00:00"}
            self.sessions[item["session_id"]] = item
            return item
        if method == "GET" and path.startswith("/v1/sessions?"):
            return {"data": list(self.sessions.values()), "total": len(self.sessions)}
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
        if method == "GET" and path.endswith("/events?after_sequence=0&limit=500"):
            return {"data": self.events[path.split("/")[3]]}
        if method == "GET" and "/v1/runs/" in path:
            return self.runs[path.rsplit("/", 1)[-1]]
        if method == "POST" and path.endswith("/cancel"):
            run_id = path.split("/")[3]
            self.runs[run_id]["status"] = "cancelled"
            return self.runs[run_id]
        if method == "GET" and path == "/v1/approvals?status=pending":
            return {"data": []}
        if method == "POST" and path == "/v1/owop":
            return {"ok": True, "result": {"items": [{"relative_path": "README.md"}]}}
        raise AssertionError((method, path, body, headers))


def write_definition(root: Path) -> None:
    path = root / "assets" / "agents" / "mobile" / "1.json"
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps({"id": "mobile", "version": "1", "name": "Mobile", "backend": "opendrsai",
                                "instructions": "test", "permissions": ["chat"]}), encoding="utf-8")


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
