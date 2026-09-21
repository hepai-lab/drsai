from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from opendrsai_dsh_runtime.approval import ApprovalCoordinator
from opendrsai_dsh_runtime.client import OaepRuntimeClient, RuntimeEndpoint
from opendrsai_dsh_runtime.control import RuntimeBinding, RuntimeControlService
from opendrsai_dsh_runtime.driver import NativeRunReceipt, NativeRuntimeIdentity
from opendrsai_dsh_runtime.jsonrpc import JsonRpcNotification
from opendrsai_dsh_runtime.mapper import NativeFactProjector
from opendrsai_dsh_runtime.oaep import OaepJournal
from opendrsai_dsh_runtime.profiles import CompatibilityDecision, ProtocolProfile
from opendrsai_dsh_runtime.store import RuntimeAuthorityStore
from opendrsai_dsh_runtime.transport import AsyncioLoopbackServer, ControlHttpApplication


TOKEN = "fake-production-e2e-" + "e" * 40


class FakeProductionDriver:
    def __init__(self) -> None:
        self.message_ids: list[str] = []
        self.cancelled: list[tuple[str, str]] = []

    async def start_run(self, *, session_id: str, content_blocks):
        message_id = f"native-user-{len(self.message_ids) + 1}"
        self.message_ids.append(message_id)
        return NativeRunReceipt(session_id, message_id)

    async def cancel_run(self, *, session_id: str, message_id: str) -> None:
        self.cancelled.append((session_id, message_id))

    async def resume_session(self, *, session_id: str):
        return {"sessionId": session_id, "disposition": "resumed"}

    async def session_history(self, *, session_id: str, from_sequence: int = 0):
        return {"meta": {"id": session_id}, "events": []}

    async def close(self) -> None:
        pass


def _profile() -> ProtocolProfile:
    return ProtocolProfile.from_mapping({
        "schema_version": 1, "profile_id": "dsh-sdk/fake-production-v2",
        "server_name": "deepseek-harness-sdk-runtime", "supported_versions": ["fake-v2"],
        "source_commits": ["a" * 40], "native_contract_sha256": "c" * 64,
        "required_methods": ["initialize", "session/prompt", "session/cancel", "session/history"],
        "required_notifications": ["session.event"],
        "required_capabilities": ["run.cancel", "approval.request", "session.resume"],
        "mapping_version": "dsh-oaep/fake-production-v2", "event_disposition_sha256": "d" * 64,
        "production_ready": True, "blockers": [],
    })


def _composition(path: Path, workspace: Path, *, driver: FakeProductionDriver | None = None):
    profile = _profile()
    identity = NativeRuntimeIdentity(
        profile.server_name, "fake-v2", profile.native_contract_sha256,
        frozenset(profile.required_methods), frozenset(profile.required_notifications),
        frozenset(profile.required_capabilities),
    )
    store = RuntimeAuthorityStore(path)
    journal = OaepJournal(store)
    native_driver = driver or FakeProductionDriver()
    approvals = ApprovalCoordinator(store, journal, runtime_id="runtime-e2e", generation=1)
    service = RuntimeControlService(
        store=store, journal=journal, driver=native_driver, native_identity=identity,
        compatibility=CompatibilityDecision("production", "compatible", profile),
        binding=RuntimeBinding(
            runtime_id="runtime-e2e", generation=1, workspace_root=workspace,
            workspace_id="workspace-e2e", workspace_fingerprint="f" * 64,
            native_profile=profile.profile_id, mapping_version=profile.mapping_version,
        ),
        approvals=approvals,
    )
    projector = NativeFactProjector(store, journal, runtime_id="runtime-e2e", approvals=approvals)
    return service, store, journal, projector, approvals, native_driver


def _fact(session_id: str, sequence: int, event_type: str, data: dict) -> JsonRpcNotification:
    return JsonRpcNotification(
        "session.event",
        {"sessionId": session_id, "event": {
            "type": event_type, "seq": sequence, "time": 1_800_000_000_000 + sequence, "data": data,
        }},
        1,
    )


@pytest.mark.asyncio
async def test_fake_production_full_user_journey_and_restart_recovery(tmp_path: Path) -> None:
    database = tmp_path / "runtime.sqlite3"
    service, store, journal, projector, _approvals, driver = _composition(database, tmp_path)
    server = AsyncioLoopbackServer(ControlHttpApplication(service, bearer_token=TOKEN))
    host, port = await server.start()
    client = OaepRuntimeClient(RuntimeEndpoint(f"http://{host}:{port}", TOKEN))
    sequence = 0
    try:
        session_id = (await client.create_session(idempotency_key="e2e-session"))["session"]["id"]

        # Turn 1: streamed answer plus tool call/result.
        run1 = await client.start_run(
            session_id, idempotency_key="e2e-run-1", content_blocks=[{"type": "text", "text": "read it"}]
        )
        turn1 = [
            ("turn/start", {"turn": 1}),
            ("user/message", {"id": driver.message_ids[-1], "role": "user", "content": [{"type": "text", "text": "read it"}]}),
            ("assistant/chunk", {"turn": 1, "step": 0, "chunk": {"type": "text-delta", "index": 0, "text": "Reading "}}),
            ("tool/call", {"turn": 1, "step": 0, "callId": "call-read", "name": "read", "arguments": '{"path":"README.md"}'}),
            ("tool/result", {"turn": 1, "step": 0, "message": {"id": "result-read", "role": "user", "toolCallId": "call-read", "content": [{"type": "text", "text": "ok"}]}}),
            ("assistant/message", {"turn": 1, "step": 0, "message": {"id": "assistant-1", "role": "assistant", "content": [{"type": "text", "text": "Reading done"}]}}),
            ("turn/end", {"turn": 1, "reason": {"kind": "completed"}}),
        ]
        for event_type, data in turn1:
            projector.project(_fact(session_id, sequence, event_type, data)); sequence += 1

        # Turn 2: bridge-owned approval is answered through public Control.
        run2 = await client.start_run(
            session_id, idempotency_key="e2e-run-2", content_blocks=[{"type": "text", "text": "run command"}]
        )
        for event_type, data in [
            ("turn/start", {"turn": 2}),
            ("user/message", {"id": driver.message_ids[-1], "role": "user", "content": [{"type": "text", "text": "run command"}]}),
        ]:
            projector.project(_fact(session_id, sequence, event_type, data)); sequence += 1
        approval_task = asyncio.create_task(_approvals.handle_server_request("approval/request", {
            "sessionId": session_id, "approvalId": "approval-e2e", "toolName": "bash",
            "callId": None, "turn": 2, "reason": "Allow a bounded command?",
        }))
        await asyncio.sleep(0)
        projector.project(_fact(session_id, sequence, "approval/asked", {
            "id": "approval-e2e", "toolName": "bash", "callId": None, "reason": "Allow a bounded command?",
        })); sequence += 1
        decision = await client.respond_approval(run2["run_id"], "approval-e2e", outcome="allowed-once")
        assert decision["won"] is True
        assert await approval_task == {"outcome": "allowed-once"}
        projector.project(_fact(session_id, sequence, "approval/decided", {
            "id": "approval-e2e", "outcome": "allowed-once",
        })); sequence += 1
        projector.project(_fact(session_id, sequence, "assistant/message", {
            "turn": 2, "step": 0, "message": {"id": "assistant-2", "role": "assistant", "content": [{"type": "text", "text": "approved"}]},
        })); sequence += 1
        projector.project(_fact(session_id, sequence, "turn/end", {"turn": 2, "reason": {"kind": "completed"}})); sequence += 1

        # Turn 3: cancel command is only an acknowledgement; committed abort is terminal.
        run3 = await client.start_run(
            session_id, idempotency_key="e2e-run-3", content_blocks=[{"type": "text", "text": "stop"}]
        )
        projector.project(_fact(session_id, sequence, "turn/start", {"turn": 3})); sequence += 1
        projector.project(_fact(session_id, sequence, "user/message", {
            "id": driver.message_ids[-1], "role": "user", "content": [{"type": "text", "text": "stop"}],
        })); sequence += 1
        cancelled = await client.cancel_run(run3["run_id"])
        assert cancelled["terminal"] is False
        assert store.require_run(run3["run_id"])["status"] == "running"
        projector.project(_fact(session_id, sequence, "turn/end", {"turn": 3, "reason": {"kind": "aborted"}})); sequence += 1

        snapshot_before_restart = await client.snapshot(session_id)
        assert [run["status"] for run in snapshot_before_restart["runs"]] == ["completed", "completed", "cancelled"]
        assert {item["type"] for item in snapshot_before_restart["items"]} >= {"message", "tool_call", "interaction"}
        page = await client.events(session_id, limit=500)
        assert [event["sequence"] for event in page["data"]] == list(range(1, page["next_sequence"] + 1))
        assert sum(event["type"].startswith("event.run.") and event["type"].split(".")[-1] in {
            "completed", "failed", "cancelled"
        } for event in page["data"]) == 3
        stream = client.watch(session_id, after_sequence=0, limit=500, wait_seconds=0)
        streamed = []
        async for event in stream:
            streamed.append(event)
            if event["sequence"] == page["next_sequence"]:
                break
        await stream.aclose()
        assert [event["event_id"] for event in streamed] == [event["event_id"] for event in page["data"]]
    finally:
        await server.close()
        store.close()

    # Carrier/store restart preserves projection; expired cursor recovers from Snapshot.
    service2, store2, journal2, projector2, _approvals2, _driver2 = _composition(database, tmp_path, driver=driver)
    server2 = AsyncioLoopbackServer(ControlHttpApplication(service2, bearer_token=TOKEN))
    host2, port2 = await server2.start()
    client2 = OaepRuntimeClient(RuntimeEndpoint(f"http://{host2}:{port2}", TOKEN))
    try:
        resumed = await client2.resume_session(session_id)
        assert resumed["snapshot"] == snapshot_before_restart
        journal2.expire_through(session_id, snapshot_before_restart["snapshot_sequence"] - 1)
        recovered_stream = client2.watch(session_id, after_sequence=0, wait_seconds=1)
        next_event = asyncio.create_task(anext(recovered_stream))
        await asyncio.sleep(0.05)
        projector2.project(_fact(session_id, sequence, "session/title", {
            "title": "Recovered E2E Session", "messageSeqs": [], "source": {"kind": "fallback"},
        }))
        recovered = await asyncio.wait_for(next_event, 2)
        assert recovered["type"] == "event.session.updated"
        assert recovered["sequence"] == snapshot_before_restart["snapshot_sequence"] + 1
        await recovered_stream.aclose()
    finally:
        await server2.close()
        store2.close()
