from __future__ import annotations

import asyncio
import json
import sqlite3
from pathlib import Path

import pytest

from drsai.relay.gateway_control import GatewayControlError, GatewayRuntimeControlHandler


class GatewayFixture:
    def __init__(self) -> None:
        self.sessions: dict[str, dict] = {}
        self.runs: dict[str, dict] = {}
        self.events: dict[str, list[dict]] = {}
        self.approvals: dict[str, dict] = {}
        self.calls: list[tuple[str, str]] = []
        self.requests: list[dict] = []

    async def request(self, method, path, *, body=None, headers=None):
        self.calls.append((method, path))
        self.requests.append(
            {"method": method, "path": path, "body": body, "headers": headers}
        )
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
        if (
            method == "GET"
            and path.split("?", 1)[0].endswith("/conversation-snapshot")
        ):
            session_id = path.split("/")[3]
            return {
                "session_id": session_id,
                "snapshot_sequence": 0,
                "items": [],
                "next_cursor": None,
            }
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
                    "data": {"approval_id": approval_id, **body.get("detail", {})},
                    "created_at": "2026-07-17T00:00:03+00:00",
                })
            return item
        if method == "POST" and path == "/v1/owop":
            return {"ok": True, "result": {"items": [{"relative_path": "README.md"}]}}
        raise AssertionError((method, path, body, headers))


class SessionJournalGatewayFixture(GatewayFixture):
    def __init__(self) -> None:
        super().__init__()
        self.sessions["session-one"] = {
            "session_id": "session-one",
            "workspace_id": "workspace-one",
            "title": "Session one",
            "updated_at": "2026-07-27T00:00:00+00:00",
        }
        self.session_events = [{
            "event_id": "session-event-one",
            "runtime_id": "runtime-one",
            "workspace_id": "workspace-one",
            "session_id": "session-one",
            "run_id": None,
            "session_sequence": 1,
            "kind": "session.updated",
            "timestamp": "2026-07-27T00:00:00+00:00",
            "payload": {"title": "Session one"},
        }]

    async def request(self, method, path, *, body=None, headers=None):
        if method == "GET" and "/oaep-events?after_sequence=" in path and path.startswith("/v1/sessions/"):
            self.calls.append((method, path))
            after = int(path.split("after_sequence=", 1)[1].split("&", 1)[0])
            rows = [
                {
                    "version": "1.0",
                    "event_id": row["event_id"],
                    "session_id": row["session_id"],
                    "sequence": row["session_sequence"],
                    "type": "event.session.updated",
                    "timestamp": row["timestamp"],
                    "dedupe_key": row["event_id"],
                    "source": {"backend": "runtime", "runtime_id": "runtime-local"},
                    "data": row["payload"],
                }
                for row in self.session_events
                if row["session_sequence"] > after
            ]
            return {"version": "1.0", "object": "list", "data": rows, "next_sequence": rows[-1]["sequence"] if rows else after}
        if (
            method == "GET"
            and path.split("?", 1)[0].endswith("/oaep-snapshot")
        ):
            self.calls.append((method, path))
            return {
                "version": "1.0",
                "session": {
                    "id": "session-one",
                    "workspace_id": "workspace-one",
                    "title": "Session one",
                    "status": "active",
                    "backend": "opendrsai",
                    "created_at": "2026-07-27T00:00:00+00:00",
                    "updated_at": "2026-07-27T00:00:00+00:00",
                },
                "runs": [],
                "items": [],
                "snapshot_sequence": 1,
            }
        if method == "GET" and "/events?after_sequence=" in path and path.startswith("/v1/sessions/"):
            after = int(path.split("after_sequence=", 1)[1].split("&", 1)[0])
            rows = [row for row in self.session_events if row["session_sequence"] > after]
            return {"object": "list", "data": rows, "next_sequence": rows[-1]["session_sequence"] if rows else after}
        if (
            method == "GET"
            and path.split("?", 1)[0].endswith("/conversation-snapshot")
        ):
            self.calls.append((method, path))
            return {
                "session_id": "session-one",
                "snapshot_sequence": 1,
                "items": [],
                "next_cursor": None,
            }
        return await super().request(method, path, body=body, headers=headers)


def write_definition_asset(root: Path, definition_id: str, backend: str) -> None:
    path = root / "assets" / "agents" / definition_id / "1.json"
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps({"id": definition_id, "version": "1", "name": definition_id, "backend": backend,
                                "instructions": "test", "permissions": ["chat"]}), encoding="utf-8")


def test_existing_runtime_waterlines_avoid_idle_loopback_catalog_scans(
    tmp_path: Path,
) -> None:
    state_dir = tmp_path / "runtime"
    state_dir.mkdir(parents=True)
    with sqlite3.connect(state_dir / "engine.sqlite3") as db:
        db.executescript(
            "CREATE TABLE runtime_session_sequences("
            "session_id TEXT PRIMARY KEY,last_sequence INTEGER NOT NULL);"
            "CREATE TABLE runtime_session_journal("
            "event_id TEXT PRIMARY KEY,session_id TEXT,session_sequence INTEGER);"
            "CREATE TABLE runtime_oaep_events("
            "event_id TEXT PRIMARY KEY,session_id TEXT,session_sequence INTEGER);"
            "CREATE TABLE runtime_runs("
            "run_id TEXT PRIMARY KEY,session_id TEXT,workspace_id TEXT,backend_id TEXT,"
            "status TEXT,created_at TEXT);"
            "CREATE TABLE runtime_events("
            "event_id TEXT PRIMARY KEY,run_id TEXT,sequence INTEGER);"
        )
        db.execute("INSERT INTO runtime_session_sequences VALUES('session-old',1)")
        db.execute("INSERT INTO runtime_session_journal VALUES('legacy-old','session-old',1)")
        db.execute("INSERT INTO runtime_oaep_events VALUES('oaep-old','session-old',1)")
        db.execute(
            "INSERT INTO runtime_runs VALUES("
            "'run-old','session-old','workspace-one','opendrsai','completed','2026-01-01T00:00:00Z')"
        )
        db.execute("INSERT INTO runtime_events VALUES('run-event-old','run-old',1)")

    async def scenario() -> None:
        gateway = GatewayFixture()
        handler = GatewayRuntimeControlHandler("runtime-one", gateway, state_dir)
        gateway.calls.clear()
        assert await handler.relay_events() == []
        assert await handler.relay_session_events() == []
        assert await handler.relay_oaep_events() == []
        assert gateway.calls == []

    asyncio.run(scenario())


def test_local_runtime_delta_forwarding_never_calls_gateway_loopback(
    tmp_path: Path,
) -> None:
    state_dir = tmp_path / "runtime"
    state_dir.mkdir(parents=True)
    with sqlite3.connect(state_dir / "runtime.sqlite3") as registry:
        registry.execute(
            "CREATE TABLE workspaces("
            "workspace_id TEXT PRIMARY KEY,canonical_path TEXT,display_name TEXT,"
            "lifecycle TEXT,revision INTEGER,updated_at TEXT,last_opened_at TEXT,created_at TEXT)"
        )
        registry.execute(
            "INSERT INTO workspaces VALUES(?,?,?,?,?,?,?,?)",
            (
                "workspace-one", str(tmp_path), "Local", "active", 3,
                "2026-08-04T00:00:00Z", "2026-08-04T00:00:00Z",
                "2026-08-01T00:00:00Z",
            ),
        )
    with sqlite3.connect(state_dir / "engine.sqlite3") as db:
        db.executescript(
            "CREATE TABLE runtime_sessions("
            "session_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL);"
            "CREATE TABLE runtime_session_sequences("
            "session_id TEXT PRIMARY KEY,last_sequence INTEGER NOT NULL,"
            "earliest_retained_sequence INTEGER NOT NULL DEFAULT 1);"
            "CREATE TABLE runtime_session_journal("
            "event_id TEXT PRIMARY KEY,runtime_id TEXT,workspace_id TEXT,session_id TEXT,"
            "run_id TEXT,session_sequence INTEGER,event_kind TEXT,item_id TEXT,"
            "item_revision INTEGER,dedupe_key TEXT,payload_json TEXT,created_at TEXT);"
            "CREATE TABLE runtime_oaep_events("
            "event_id TEXT PRIMARY KEY,session_id TEXT,session_sequence INTEGER,envelope_json TEXT);"
            "CREATE TABLE runtime_runs("
            "run_id TEXT PRIMARY KEY,session_id TEXT,workspace_id TEXT,backend_id TEXT,"
            "status TEXT,created_at TEXT);"
            "CREATE TABLE runtime_events("
            "event_id TEXT PRIMARY KEY,run_id TEXT,sequence INTEGER,event_type TEXT,"
            "data_json TEXT,created_at TEXT,backend_event_key TEXT);"
        )
        db.execute("INSERT INTO runtime_sessions VALUES('session-one','workspace-one')")
        db.execute("INSERT INTO runtime_session_sequences VALUES('session-one',0,1)")
        db.execute(
            "INSERT INTO runtime_runs VALUES("
            "'run-one','session-one','workspace-one','opendrsai','running','2026-08-04T00:00:00Z')"
        )

    async def scenario() -> None:
        gateway = GatewayFixture()
        handler = GatewayRuntimeControlHandler("runtime-one", gateway, state_dir)
        with sqlite3.connect(state_dir / "engine.sqlite3") as db:
            db.execute(
                "INSERT INTO runtime_events VALUES(?,?,?,?,?,?,?)",
                (
                    "run-event-one", "run-one", 1, "message.delta",
                    json.dumps({"delta": "hello"}), "2026-08-04T00:00:01Z", None,
                ),
            )
            db.execute(
                "INSERT INTO runtime_session_journal VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    "session-event-one", "runtime-one", "workspace-one", "session-one",
                    "run-one", 1, "conversation.item.delta", "item-one", 1, None,
                    json.dumps({"delta": "hello"}), "2026-08-04T00:00:01Z",
                ),
            )
            db.execute(
                "UPDATE runtime_session_sequences SET last_sequence=1 WHERE session_id='session-one'"
            )
        gateway.calls.clear()
        workspaces = await handler.published_workspaces()
        run_events = await handler.relay_events()
        session_events = await handler.relay_session_events()
        assert workspaces[0]["workspace_id"] == "workspace-one"
        assert [event["sequence"] for event in run_events] == [1]
        assert [event["session_sequence"] for event in session_events] == [1]
        assert gateway.calls == []

    asyncio.run(scenario())


def test_unpublished_workspace_backlog_is_baselined_without_spin(
    tmp_path: Path,
) -> None:
    state_dir = tmp_path / "runtime"
    state_dir.mkdir(parents=True)
    with sqlite3.connect(state_dir / "engine.sqlite3") as db:
        db.executescript(
            "CREATE TABLE runtime_sessions("
            "session_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL);"
            "CREATE TABLE runtime_session_sequences("
            "session_id TEXT PRIMARY KEY,last_sequence INTEGER NOT NULL,"
            "earliest_retained_sequence INTEGER NOT NULL DEFAULT 1);"
            "CREATE TABLE runtime_session_journal("
            "event_id TEXT PRIMARY KEY,session_id TEXT,session_sequence INTEGER);"
            "CREATE TABLE runtime_oaep_events("
            "event_id TEXT PRIMARY KEY,session_id TEXT,session_sequence INTEGER,"
            "envelope_json TEXT NOT NULL);"
            "CREATE TABLE runtime_runs("
            "run_id TEXT PRIMARY KEY,status TEXT NOT NULL);"
            "CREATE TABLE runtime_events("
            "event_id TEXT PRIMARY KEY,run_id TEXT,sequence INTEGER);"
        )
        db.execute("INSERT INTO runtime_sessions VALUES('historical','workspace-closed')")
        db.execute("INSERT INTO runtime_session_sequences VALUES('historical',31018,1)")
        db.execute("INSERT INTO runtime_session_journal VALUES('legacy','historical',31018)")
        db.execute("INSERT INTO runtime_oaep_events VALUES('oaep','historical',31018,'{}')")
    with sqlite3.connect(state_dir / "relay-control.sqlite3") as db:
        db.executescript(
            "CREATE TABLE relay_session_event_cursors("
            "session_id TEXT PRIMARY KEY,after_sequence INTEGER NOT NULL);"
            "CREATE TABLE relay_oaep_event_cursors("
            "session_id TEXT PRIMARY KEY,after_sequence INTEGER NOT NULL);"
        )
        db.execute("INSERT INTO relay_session_event_cursors VALUES('historical',100)")
        db.execute("INSERT INTO relay_oaep_event_cursors VALUES('historical',100)")

    async def scenario() -> None:
        gateway = GatewayFixture()  # workspace-closed is outside Relay publication
        handler = GatewayRuntimeControlHandler("runtime-one", gateway, state_dir)
        assert await handler.relay_session_events() == []
        assert await handler.relay_oaep_events() == []
        assert handler._relay_session_event_cursors["historical"] == 31018
        assert handler._relay_oaep_event_cursors["historical"] == 31018
        gateway.calls.clear()
        assert await handler.relay_session_events() == []
        assert await handler.relay_oaep_events() == []
        assert not any("/events?" in path for _, path in gateway.calls)

    asyncio.run(scenario())


def test_reconstructed_oaep_prefix_is_baselined_but_new_event_is_forwarded(
    tmp_path: Path,
) -> None:
    state_dir = tmp_path / "runtime"
    state_dir.mkdir(parents=True)
    with sqlite3.connect(state_dir / "engine.sqlite3") as db:
        db.executescript(
            "CREATE TABLE runtime_sessions("
            "session_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL);"
            "CREATE TABLE runtime_session_sequences("
            "session_id TEXT PRIMARY KEY,last_sequence INTEGER NOT NULL,"
            "earliest_retained_sequence INTEGER NOT NULL DEFAULT 1);"
            "CREATE TABLE runtime_session_journal("
            "event_id TEXT PRIMARY KEY,session_id TEXT,session_sequence INTEGER,"
            "dedupe_key TEXT,payload_json TEXT);"
            "CREATE TABLE runtime_oaep_events("
            "event_id TEXT PRIMARY KEY,session_id TEXT,session_sequence INTEGER,"
            "envelope_json TEXT NOT NULL);"
            "CREATE TABLE runtime_runs(run_id TEXT PRIMARY KEY,status TEXT NOT NULL);"
            "CREATE TABLE runtime_events("
            "event_id TEXT PRIMARY KEY,run_id TEXT,sequence INTEGER);"
        )
        db.execute("INSERT INTO runtime_sessions VALUES('session-one','workspace-one')")
        db.execute("INSERT INTO runtime_session_sequences VALUES('session-one',3,1)")
        for sequence in (2, 3):
            source_id = f"source-{sequence}"
            db.execute(
                "INSERT INTO runtime_events VALUES(?,?,?)",
                (source_id, "legacy-run", sequence),
            )
            db.execute(
                "INSERT INTO runtime_session_journal VALUES(?,?,?,?,?)",
                (
                    f"rebuilt-{sequence}", "session-one", sequence,
                    f"runtime-event:{source_id}", '{"migrated":true}',
                ),
            )
            db.execute(
                "INSERT INTO runtime_oaep_events VALUES(?,?,?,?)",
                (f"rebuilt-{sequence}", "session-one", sequence, '{}'),
            )
    with sqlite3.connect(state_dir / "relay-control.sqlite3") as db:
        db.execute(
            "CREATE TABLE relay_oaep_event_cursors("
            "session_id TEXT PRIMARY KEY,after_sequence INTEGER NOT NULL)"
        )
        db.execute("INSERT INTO relay_oaep_event_cursors VALUES('session-one',1)")

    async def scenario() -> None:
        handler = GatewayRuntimeControlHandler("runtime-one", GatewayFixture(), state_dir)
        assert await handler.relay_oaep_events() == []
        assert handler._relay_oaep_event_cursors["session-one"] == 3

        event = {
            "version": "1.0", "event_id": "genuine-4", "session_id": "session-one",
            "sequence": 4, "type": "event.message.delta",
            "timestamp": "2026-08-04T00:00:00Z", "dedupe_key": "genuine-4",
            "source": {"backend": "runtime", "runtime_id": "runtime-one"},
            "data": {"delta": "new"},
        }
        with sqlite3.connect(state_dir / "engine.sqlite3") as db:
            db.execute(
                "INSERT INTO runtime_session_journal VALUES(?,?,?,?,?)",
                ("genuine-4", "session-one", 4, "genuine-4", '{}'),
            )
            db.execute(
                "INSERT INTO runtime_oaep_events VALUES(?,?,?,?)",
                ("genuine-4", "session-one", 4, json.dumps(event)),
            )
            db.execute(
                "UPDATE runtime_session_sequences SET last_sequence=4 "
                "WHERE session_id='session-one'"
            )
        frames = await handler.relay_oaep_events()
        assert [frame["sequence"] for frame in frames] == [4]

    asyncio.run(scenario())


def test_oaep_upgrade_reconciles_zero_cursor_once_and_reads_bounded_local_delta(
    tmp_path: Path,
) -> None:
    state_dir = tmp_path / "runtime"
    state_dir.mkdir(parents=True)
    database = state_dir / "engine.sqlite3"
    with sqlite3.connect(database) as db:
        db.executescript(
            "CREATE TABLE runtime_sessions("
            "session_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL);"
            "CREATE TABLE runtime_session_sequences("
            "session_id TEXT PRIMARY KEY,last_sequence INTEGER NOT NULL,"
            "earliest_retained_sequence INTEGER NOT NULL DEFAULT 1);"
            "CREATE TABLE runtime_session_journal("
            "event_id TEXT PRIMARY KEY,session_id TEXT,session_sequence INTEGER);"
            "CREATE TABLE runtime_oaep_events("
            "event_id TEXT PRIMARY KEY,session_id TEXT,session_sequence INTEGER,"
            "envelope_json TEXT NOT NULL);"
            "CREATE TABLE runtime_runs("
            "run_id TEXT PRIMARY KEY,session_id TEXT,workspace_id TEXT,backend_id TEXT,"
            "status TEXT,created_at TEXT);"
            "CREATE TABLE runtime_events("
            "event_id TEXT PRIMARY KEY,run_id TEXT,sequence INTEGER);"
        )
        db.execute("INSERT INTO runtime_sessions VALUES('session-old','workspace-one')")
        db.execute("INSERT INTO runtime_session_sequences VALUES('session-old',3,1)")
        for sequence in range(1, 4):
            event = {
                "version": "1.0", "event_id": f"old-{sequence}",
                "session_id": "session-old", "sequence": sequence,
                "type": "event.session.updated", "timestamp": "2026-07-20T00:00:00Z",
                "dedupe_key": f"old-{sequence}",
                "source": {"backend": "runtime", "runtime_id": "runtime-one"},
                "data": {"historical": True},
            }
            db.execute(
                "INSERT INTO runtime_oaep_events VALUES(?,?,?,?)",
                (f"old-{sequence}", "session-old", sequence, json.dumps(event)),
            )
    # Reproduce the upgrade state that caused WRRO-001: an earlier release
    # persisted zero, so ON CONFLICT DO NOTHING could not establish a snapshot.
    with sqlite3.connect(state_dir / "relay-control.sqlite3") as db:
        db.execute(
            "CREATE TABLE relay_oaep_event_cursors("
            "session_id TEXT PRIMARY KEY,after_sequence INTEGER NOT NULL)"
        )
        db.execute("INSERT INTO relay_oaep_event_cursors VALUES('session-old',0)")

    async def scenario() -> None:
        gateway = GatewayFixture()
        handler = GatewayRuntimeControlHandler("runtime-one", gateway, state_dir)
        assert handler._relay_oaep_event_cursors["session-old"] == 3
        gateway.calls.clear()
        assert await handler.relay_oaep_events() == []
        assert gateway.calls == []

        payload = "x" * 8192
        with sqlite3.connect(database) as db:
            for sequence in range(4, 154):
                event = {
                    "version": "1.0", "event_id": f"new-{sequence}",
                    "session_id": "session-old", "sequence": sequence,
                    "type": "event.message.delta", "timestamp": "2026-08-04T00:00:00Z",
                    "dedupe_key": f"new-{sequence}",
                    "source": {"backend": "runtime", "runtime_id": "runtime-local"},
                    "data": {"delta": payload},
                }
                db.execute(
                    "INSERT INTO runtime_oaep_events VALUES(?,?,?,?)",
                    (f"new-{sequence}", "session-old", sequence, json.dumps(event)),
                )
            db.execute(
                "UPDATE runtime_session_sequences SET last_sequence=153 "
                "WHERE session_id='session-old'"
            )

        frames = await handler.relay_oaep_events()
        assert 1 <= len(frames) <= 100
        assert sum(len(json.dumps(frame["event"]).encode()) for frame in frames) <= 600_000
        assert [frame["sequence"] for frame in frames] == list(
            range(4, 4 + len(frames))
        )
        assert all(
            frame["event"]["source"]["runtime_id"] == "runtime-one"
            for frame in frames
        )
        assert not any("/oaep-events" in path for _, path in gateway.calls)
        await handler.ack_relay_oaep_events({"session-old": frames[-1]["sequence"]})

        restarted = GatewayRuntimeControlHandler("runtime-one", gateway, state_dir)
        assert restarted._relay_oaep_event_cursors["session-old"] == frames[-1]["sequence"]
        replay = await restarted.relay_oaep_events()
        assert replay and replay[0]["sequence"] == frames[-1]["sequence"] + 1

    asyncio.run(scenario())


def test_session_journal_snapshot_replay_and_relay_cursor(tmp_path: Path) -> None:
    async def scenario():
        gateway = SessionJournalGatewayFixture()
        state_dir = tmp_path / "runtime"
        handler = GatewayRuntimeControlHandler(
            "runtime-one", gateway, state_dir
        )
        # Existing Windows history establishes the initial waterline instead
        # of flooding the Relay every time the Gateway starts.
        assert await handler.relay_session_events() == []
        gateway.session_events.append({
            **gateway.session_events[0],
            "event_id": "session-event-two",
            "session_sequence": 2,
        })
        second = await handler.relay_session_events()
        assert [event["session_sequence"] for event in second] == [2]

        # A new process resumes from the durable cursor and forwards only
        # events committed while it was offline.
        restarted = GatewayRuntimeControlHandler("runtime-one", gateway, state_dir)
        gateway.session_events.append({
            **gateway.session_events[0],
            "event_id": "session-event-three",
            "session_sequence": 3,
        })
        third = await restarted.relay_session_events()
        assert [event["session_sequence"] for event in third] == [3]

        snapshot = await restarted.conversation_snapshot_for_subject(
            "alice", "workspace-one", "session-one", limit=37
        )
        assert snapshot["snapshot_sequence"] == 1
        assert gateway.calls[-1] == (
            "GET",
            "/v1/sessions/session-one/conversation-snapshot?limit=37",
        )
        page = await restarted.session_events_for_subject(
            "alice", "workspace-one", "session-one", after_sequence=0
        )
        assert [event["session_sequence"] for event in page["data"]] == [1, 2, 3]

    asyncio.run(scenario())


def test_gateway_handler_authorizes_and_proxies_oaep_snapshot_and_events(
    tmp_path: Path,
) -> None:
    async def scenario():
        gateway = SessionJournalGatewayFixture()
        handler = GatewayRuntimeControlHandler(
            "runtime-one", gateway, tmp_path / "runtime"
        )
        snapshot = await handler.oaep_snapshot_for_subject(
            "alice", "workspace-one", "session-one"
        )
        assert snapshot["version"] == "1.0"
        assert snapshot["session"]["id"] == "session-one"
        assert gateway.calls[-1] == (
            "GET",
            "/v1/sessions/session-one/oaep-snapshot",
        )
        await handler.oaep_snapshot_for_subject(
            "alice", "workspace-one", "session-one",
            cursor="enc:v1:page/+", limit=37,
        )
        assert gateway.calls[-1] == (
            "GET",
            "/v1/sessions/session-one/oaep-snapshot?limit=37&cursor=enc%3Av1%3Apage%2F%2B",
        )
        page = await handler.oaep_events_for_subject(
            "alice", "workspace-one", "session-one", after_sequence=0, limit=9999
        )
        assert page["version"] == "1.0"
        assert [event["sequence"] for event in page["data"]] == [1]
        assert gateway.calls[-1] == (
            "GET",
            "/v1/sessions/session-one/oaep-events?after_sequence=0&limit=2000",
        )

        assert (
            "GET",
            "/v1/sessions/session-one",
        ) in gateway.calls

    asyncio.run(scenario())


def test_gateway_handler_oaep_bridge_has_independent_durable_cursor(
    tmp_path: Path,
) -> None:
    async def scenario() -> None:
        gateway = SessionJournalGatewayFixture()
        state_dir = tmp_path / "runtime"
        handler = GatewayRuntimeControlHandler("runtime-one", gateway, state_dir)

        # First observation establishes an OAEP waterline independently of the
        # legacy Session Event bridge.
        assert await handler.relay_oaep_events() == []
        assert handler._relay_oaep_event_cursors == {"session-one": 1}
        assert handler._relay_session_event_cursors == {}

        gateway.session_events.append({
            **gateway.session_events[0],
            "event_id": "session-event-two",
            "session_sequence": 2,
        })
        frames = await handler.relay_oaep_events()
        assert len(frames) == 1
        assert frames[0] == {
            "runtime_id": "runtime-one",
            "workspace_id": "workspace-one",
            "session_id": "session-one",
            "sequence": 2,
            "event": frames[0]["event"],
        }
        assert frames[0]["event"]["sequence"] == 2
        handler.ack_relay_oaep_event("session-one", 2)

        # A new process resumes after the committed OAEP sequence and backfills
        # only the event produced while the WSS owner was offline.
        restarted = GatewayRuntimeControlHandler("runtime-one", gateway, state_dir)
        gateway.session_events.append({
            **gateway.session_events[0],
            "event_id": "session-event-three",
            "session_sequence": 3,
        })
        replay = await restarted.relay_oaep_events()
        assert [frame["sequence"] for frame in replay] == [3]

    asyncio.run(scenario())


def test_session_journal_cold_start_bootstraps_sessions_concurrently(
    tmp_path: Path,
) -> None:
    class ConcurrentSnapshotFixture(GatewayFixture):
        def __init__(self) -> None:
            super().__init__()
            self.inflight = 0
            self.max_inflight = 0
            for index in range(40):
                session_id = f"session-{index}"
                self.sessions[session_id] = {
                    "session_id": session_id,
                    "workspace_id": "workspace-one",
                    "title": session_id,
                    "updated_at": "2026-07-27T00:00:00+00:00",
                }

        async def request(self, method, path, *, body=None, headers=None):
            if method == "GET" and path.endswith("/conversation-snapshot"):
                self.inflight += 1
                self.max_inflight = max(self.max_inflight, self.inflight)
                try:
                    await asyncio.sleep(0.02)
                    session_id = path.split("/")[3]
                    return {
                        "session_id": session_id,
                        "snapshot_sequence": 0,
                        "items": [],
                        "next_cursor": None,
                    }
                finally:
                    self.inflight -= 1
            return await super().request(method, path, body=body, headers=headers)

    async def scenario() -> None:
        gateway = ConcurrentSnapshotFixture()
        state_dir = tmp_path / "runtime"
        handler = GatewayRuntimeControlHandler("runtime-one", gateway, state_dir)

        assert await handler.relay_session_events() == []
        assert gateway.max_inflight > 1
        restored = GatewayRuntimeControlHandler("runtime-one", gateway, state_dir)
        assert len(restored._relay_session_event_cursors) == 40

    asyncio.run(scenario())


def test_session_journal_prioritizes_hot_sessions_and_rotates_cold_sessions(
    tmp_path: Path,
) -> None:
    class RotatingFixture(GatewayFixture):
        def __init__(self) -> None:
            super().__init__()
            self.session_events: dict[str, list[dict]] = {}
            for index in range(12):
                session_id = f"session-{index}"
                self.sessions[session_id] = {
                    "session_id": session_id,
                    "workspace_id": "workspace-one",
                    "title": session_id,
                    "updated_at": f"2026-07-27T00:00:{59 - index:02d}+00:00",
                }
                self.session_events[session_id] = []

        async def request(self, method, path, *, body=None, headers=None):
            if method == "GET" and path.endswith("/conversation-snapshot"):
                session_id = path.split("/")[3]
                return {
                    "session_id": session_id,
                    "snapshot_sequence": 0,
                    "items": [],
                    "next_cursor": None,
                }
            if method == "GET" and "/events?after_sequence=" in path:
                session_id = path.split("/")[3]
                after = int(path.split("after_sequence=", 1)[1].split("&", 1)[0])
                rows = [
                    event
                    for event in self.session_events[session_id]
                    if event["session_sequence"] > after
                ]
                return {"data": rows}
            return await super().request(method, path, body=body, headers=headers)

    def event(session_id: str) -> dict:
        return {
            "event_id": f"event-{session_id}",
            "runtime_id": "runtime-one",
            "workspace_id": "workspace-one",
            "session_id": session_id,
            "run_id": None,
            "session_sequence": 1,
            "kind": "session.updated",
            "timestamp": "2026-07-27T00:00:00+00:00",
            "payload": {},
        }

    async def scenario() -> None:
        gateway = RotatingFixture()
        handler = GatewayRuntimeControlHandler(
            "runtime-one", gateway, tmp_path / "runtime"
        )
        assert await handler.relay_session_events() == []

        gateway.session_events["session-0"].append(event("session-0"))
        gateway.session_events["session-4"].append(event("session-4"))
        with sqlite3.connect(handler.journal_database) as db:
            db.execute(
                "CREATE TABLE runtime_session_sequences("
                "session_id TEXT PRIMARY KEY,last_sequence INTEGER NOT NULL)"
            )
            db.execute(
                "CREATE TABLE runtime_session_journal("
                "session_id TEXT NOT NULL,session_sequence INTEGER NOT NULL)"
            )
            db.execute(
                "INSERT INTO runtime_session_sequences VALUES(?,?)",
                ("session-4", 1),
            )
            db.execute(
                "INSERT INTO runtime_session_journal VALUES(?,?)",
                ("session-4", 1),
            )
        gateway.calls.clear()
        first = await handler.relay_session_events()
        assert {item["session_id"] for item in first} == {"session-0", "session-4"}
        event_calls = [path for method, path in gateway.calls if "/events?" in path]
        assert len(event_calls) <= 9

        gateway.session_events["session-8"].append(event("session-8"))
        second = await handler.relay_session_events()
        assert second == []
        third = await handler.relay_session_events()
        assert [item["session_id"] for item in third] == ["session-8"]

    asyncio.run(scenario())


def write_definition(root: Path) -> None:
    write_definition_asset(root, "mobile", "opendrsai")


def test_legacy_windows_session_uses_its_unique_healthy_backend_definition(tmp_path: Path) -> None:
    class MultiBackendGateway(GatewayFixture):
        async def request(self, method, path, *, body=None, headers=None):
            if path == "/v1/capabilities":
                return {
                    "agent_backends": {
                        "opendrsai": {"available": True},
                        "codex": {"available": True},
                    }
                }
            return await super().request(method, path, body=body, headers=headers)

    async def scenario() -> None:
        write_definition_asset(tmp_path, "mobile", "opendrsai")
        write_definition_asset(tmp_path, "codex", "codex")
        gateway = MultiBackendGateway()
        gateway.sessions["legacy-session"] = {
            "session_id": "legacy-session",
            "workspace_id": "workspace-one",
            "title": "Windows legacy session",
            "backend_id": "opendrsai",
            "updated_at": "2026-07-17T00:00:00+00:00",
        }
        handler = GatewayRuntimeControlHandler("runtime-one", gateway, tmp_path / "runtime")

        await handler.create_run(
            "alice",
            "workspace-one",
            "legacy-session",
            message="hello",
            attachment_refs=[],
            idempotency_key="legacy-run-key",
            correlation_id="legacy-correlation",
        )

        migrated = await handler.get_session("workspace-one", "legacy-session")
        assert migrated["agent_definition_id"] == "mobile"
        assert migrated["agent_definition_version"] == "1"
        assert migrated["backend_id"] == "opendrsai"

    asyncio.run(scenario())


def test_legacy_windows_session_fails_closed_when_backend_definition_is_ambiguous(tmp_path: Path) -> None:
    async def scenario() -> None:
        write_definition_asset(tmp_path, "mobile-a", "opendrsai")
        write_definition_asset(tmp_path, "mobile-b", "opendrsai")
        gateway = GatewayFixture()
        gateway.sessions["legacy-session"] = {
            "session_id": "legacy-session",
            "workspace_id": "workspace-one",
            "title": "Ambiguous legacy session",
            "backend_id": "opendrsai",
            "updated_at": "2026-07-17T00:00:00+00:00",
        }
        handler = GatewayRuntimeControlHandler("runtime-one", gateway, tmp_path / "runtime")

        with pytest.raises(GatewayControlError, match="unambiguous healthy Agent Definition") as error:
            await handler.create_run(
                "alice",
                "workspace-one",
                "legacy-session",
                message="hello",
                attachment_refs=[],
                idempotency_key="ambiguous-run-key",
                correlation_id="ambiguous-correlation",
            )
        assert error.value.code == "session_agent_definition_required"

    asyncio.run(scenario())


def test_hai_workspace_proxy_normalizes_contract_before_leaving_runtime(tmp_path: Path) -> None:
    class ProxyFixture:
        async def proxy(self, method, path, *, body=None, headers=None):
            assert method == "GET"
            assert path == "/v1/workspaces?include_closed=true"
            assert headers == {"X-Correlation-ID": "correlation-one"}
            return 200, {"data": [{
                "workspace_id": "workspace-one",
                "display_name": "默认",
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
                "display_name": "默认",
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
                    "display_name": "默认",
                    "path": r"C:\projects\active-project",
                    "pid": 4242,
                    "lifecycle": "active",
                    "revision": 1,
                    "updated_at": "2026-07-26T00:00:00+00:00",
                },
                {
                    "workspace_id": "archived",
                    "display_name": "Archive Label",
                    "path": r"C:\projects\archived-project",
                    "internal_port": 18642,
                    "lifecycle": "archived",
                    "revision": 2,
                    "updated_at": "2026-07-26T00:01:00+00:00",
                },
                {
                    "workspace_id": "removed",
                    "display_name": "Removed Label",
                    "path": r"C:\projects\removed-project",
                    "credential": "secret",
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
            "默认", "Archive Label", "Removed Label",
        ]
        assert all(row["runtime_id"] == "runtime-one" for row in rows)
        assert "path" not in json.dumps(rows)
        assert "4242" not in json.dumps(rows)
        assert "secret" not in json.dumps(rows)

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
            "correlation_id": "correlation-one", "retry_of": None,
            "source_message_id": "android-message-one"}}
        run = await handler("create_run", run_args)
        for _ in range(50):
            run = await handler("get_run", {"args": [run["run_id"]], "kwargs": {}})
            if run["status"] == "completed":
                break
            await asyncio.sleep(0.01)
        assert run["status"] == "completed" and run["message"] == "hello"
        execute_request = next(
            request
            for request in gateway.requests
            if request["path"] == f"/v1/runs/{run['run_id']}/execute"
        )
        assert execute_request["body"]["metadata"]["source_client"] == "android"
        assert (
            execute_request["body"]["metadata"]["source_message_id"]
            == "android-message-one"
        )
        assert execute_request["body"]["metadata"]["attachment_refs"] == [
            "attachment-one"
        ]
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
        recovered = await restored.idempotency_result(
            "oidc-subject-one", "approval.decide", "stable-approval-decision"
        )

        assert decision["status"] == "approved"
        assert replayed == decision
        assert restarted_replay == decision
        assert recovered == decision
        assert gateway.runs[run["run_id"]]["status"] == "running"
        assert gateway.calls.count(
            ("POST", f"/v1/runs/{run['run_id']}/approvals/approval-one/decision")
        ) == 1
        assert (
            "POST", "/v1/approvals/approval-one/decision"
        ) not in gateway.calls
        decision_events = [
            event for event in gateway.events[run["run_id"]]
            if event["type"] == "approval.approved"
        ]
        assert len(decision_events) == 1
        audit = await handler.audit_entries_for_subject(
            "oidc-subject-one", "workspace-one", run["run_id"]
        )
        approved = next(item for item in audit if item["action"] == "approval.approved")
        assert approved["actor_label"] == "已授权设备"
        assert "subject" not in approved
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
