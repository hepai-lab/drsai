from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from opendrsai_dsh_runtime.approval import ApprovalCoordinator, ApprovalProtocolError
from opendrsai_dsh_runtime.jsonrpc import JsonRpcNotification
from opendrsai_dsh_runtime.mapper import NativeFactProjector
from opendrsai_dsh_runtime.oaep import OaepJournal
from opendrsai_dsh_runtime.store import RuntimeAuthorityStore, RuntimeStoreError


def _coordinator(tmp_path: Path):
    store = RuntimeAuthorityStore(tmp_path / "runtime.sqlite3")
    store.create_session(
        session_id="session-1", workspace_id="workspace-1", workspace_fingerprint="f" * 64,
        native_profile="dsh-sdk/test-v2", mapping_version="dsh-oaep/1",
    )
    store.bind_native_session(
        "session-1", native_session_id="native-session-1", native_runtime_version="test-v2",
        native_contract_sha256="c" * 64, generation=1,
    )
    store.create_run("session-1", input_digest="a" * 64, run_id="run-1")
    store.transition_run("run-1", "running")
    store.bind_native_run("run-1", native_message_id="message-1", generation=1)
    store.claim_native_turn("run-1", native_turn_id="7", generation=1)
    journal = OaepJournal(store)
    return store, journal, ApprovalCoordinator(store, journal, runtime_id="runtime-1", generation=1)


def _request(approval_id: str, *, call_id: str | None = None) -> dict:
    value = {
        "sessionId": "native-session-1", "turn": 7, "approvalId": approval_id,
        "toolName": "bash", "reason": "Command may modify the workspace",
    }
    if call_id is not None:
        value["callId"] = call_id
    return value


@pytest.mark.asyncio
async def test_server_request_projects_waiting_and_first_control_answer_wins(tmp_path: Path) -> None:
    store, journal, coordinator = _coordinator(tmp_path)
    pending = asyncio.create_task(coordinator.handle_server_request("approval/request", _request("approval-1")))
    await asyncio.sleep(0)
    assert store.require_run("run-1")["status"] == "waiting"
    snapshot = journal.snapshot("session-1")
    assert snapshot["items"][0]["type"] == "interaction"
    assert snapshot["items"][0]["status"] == "waiting"
    assert snapshot["items"][0]["content"]["approval_id"] == "approval-1"

    assert coordinator.respond(approval_id="approval-1", outcome="allowed-once")["won"]
    assert await pending == {"outcome": "allowed-once"}
    assert not coordinator.respond(approval_id="approval-1", outcome="allowed-once")["won"]
    with pytest.raises(RuntimeStoreError) as loser:
        coordinator.respond(approval_id="approval-1", outcome="rejected")
    assert loser.value.code == "approval_already_answered"
    assert store.require_run("run-1")["status"] == "running"
    events = journal.event_page("session-1")["data"]
    assert [event["type"] for event in events] == [
        "event.item.created", "event.item.updated", "event.run.waiting",
        "event.item.completed", "event.run.resumed",
    ]
    store.close()


@pytest.mark.asyncio
async def test_multiple_pending_approvals_resume_only_after_last_answer(tmp_path: Path) -> None:
    store, _, coordinator = _coordinator(tmp_path)
    first = asyncio.create_task(coordinator.handle_server_request("approval/request", _request("approval-1")))
    await asyncio.sleep(0)
    second = asyncio.create_task(coordinator.handle_server_request("approval/request", _request("approval-2")))
    await asyncio.sleep(0)
    coordinator.respond(approval_id="approval-1", outcome="rejected")
    assert await first == {"outcome": "rejected"}
    assert store.require_run("run-1")["status"] == "waiting"
    coordinator.respond(approval_id="approval-2", outcome="allowed-once")
    assert await second == {"outcome": "allowed-once"}
    assert store.require_run("run-1")["status"] == "running"
    store.close()


@pytest.mark.asyncio
async def test_shutdown_fails_pending_approval_closed_and_unblocks_native_request(tmp_path: Path) -> None:
    store, journal, coordinator = _coordinator(tmp_path)
    pending = asyncio.create_task(coordinator.handle_server_request("approval/request", _request("approval-1")))
    await asyncio.sleep(0)
    await coordinator.close()
    assert await pending == {"outcome": "unavailable"}
    assert store.require_approval("approval-1")["outcome"] == "unavailable"
    assert journal.snapshot("session-1")["items"][0]["status"] == "completed"
    assert await coordinator.handle_server_request("approval/request", _request("approval-2")) == {
        "outcome": "unavailable"
    }
    store.close()


@pytest.mark.asyncio
async def test_malformed_or_cross_turn_approval_fails_closed(tmp_path: Path) -> None:
    store, _, coordinator = _coordinator(tmp_path)
    with pytest.raises(ApprovalProtocolError):
        await coordinator.handle_server_request("approval/request", {"sessionId": "native-session-1"})
    with pytest.raises(RuntimeStoreError) as wrong_turn:
        await coordinator.handle_server_request("approval/request", {**_request("approval-1"), "turn": 8})
    assert wrong_turn.value.code == "native_run_unknown"
    store.close()


@pytest.mark.asyncio
async def test_committed_audit_and_live_server_request_share_one_approval_authority(tmp_path: Path) -> None:
    store, journal, coordinator = _coordinator(tmp_path)
    projector = NativeFactProjector(
        store, journal, runtime_id="runtime-1", approvals=coordinator
    )
    asked = JsonRpcNotification("session.event", {
        "sessionId": "native-session-1",
        "event": {
            "type": "approval/asked", "seq": 0, "time": 1_700_000_000_000,
            "data": {
                "id": "approval-1", "toolName": "bash",
                "reason": "Command may modify the workspace",
            },
        },
    }, 1)
    assert projector.project(asked).disposition == "mapped"
    request = asyncio.create_task(
        coordinator.handle_server_request("approval/request", _request("approval-1"))
    )
    await asyncio.sleep(0)
    assert len(store.pending_approvals()) == 1
    coordinator.respond(approval_id="approval-1", outcome="rejected")
    assert await request == {"outcome": "rejected"}
    decided = JsonRpcNotification("session.event", {
        "sessionId": "native-session-1",
        "event": {
            "type": "approval/decided", "seq": 1, "time": 1_700_000_000_001,
            "data": {"id": "approval-1", "outcome": "rejected"},
        },
    }, 1)
    assert projector.project(decided).disposition == "mapped"
    assert sum(item["type"] == "interaction" for item in journal.snapshot("session-1")["items"]) == 1
    store.close()
