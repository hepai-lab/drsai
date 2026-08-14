from __future__ import annotations

from datetime import UTC, datetime, timedelta
from concurrent.futures import ThreadPoolExecutor

import pytest

from drsai.relay.registry import RelayRegistryError
from drsai.relay.models import ResourceLifecycle
from drsai.relay.runtime_domain import AgentDefinition, ApprovalStatus, RunStatus, RuntimeAuthority


def authority() -> RuntimeAuthority:
    runtime = RuntimeAuthority("rt-a")
    runtime.add_agent_definition(AgentDefinition("agent", "2026.07.17", "OpenDrSai", "opendrsai",
                                                "healthy", frozenset({"chat", "files.read"})))
    runtime.permissions[("alice", "ws-a")] = {"shell.execute", "files.write"}
    return runtime


def session(runtime: RuntimeAuthority):
    return runtime.create_session("alice", "ws-a", title="Research", definition_id="agent",
                                  definition_version="2026.07.17", idempotency_key="session-key-001")


def run(runtime: RuntimeAuthority):
    created = session(runtime)
    return runtime.create_run("alice", "ws-a", created.session_id, message="hello", attachment_refs=["att_123"],
                              idempotency_key="run-key-0001", correlation_id="corr-1")


def test_exact_agent_definition_session_and_idempotent_recovery() -> None:
    runtime = authority()
    first = session(runtime)
    second = runtime.create_session("alice", "ws-a", title="ignored", definition_id="missing",
                                    definition_version="latest", idempotency_key="session-key-001")
    assert second is first
    with pytest.raises(RelayRegistryError) as invalid:
        runtime.create_session("alice", "ws-a", title="Bad", definition_id="agent",
                               definition_version="latest", idempotency_key="session-key-002")
    assert invalid.value.code == "agent_definition_not_found"


def test_run_is_idempotent_scoped_and_forbids_android_local_paths() -> None:
    runtime = authority()
    created_session = session(runtime)
    first = runtime.create_run("alice", "ws-a", created_session.session_id, message="hello",
                               attachment_refs=["att_123"], idempotency_key="run-key-0001", correlation_id="corr")
    repeated = runtime.create_run("alice", "ws-a", created_session.session_id, message="different",
                                  attachment_refs=[], idempotency_key="run-key-0001", correlation_id="other")
    assert repeated is first
    assert runtime.events.after("rt-a", first.run_id, 0)[0][0].kind == "run.queued"
    with pytest.raises(RelayRegistryError) as local_path:
        runtime.create_run("alice", "ws-a", created_session.session_id, message="x",
                           attachment_refs=["file:///sdcard/photo.jpg"], idempotency_key="run-key-0002", correlation_id="c")
    assert local_path.value.code == "attachment_reference_invalid"


def test_retry_is_one_logical_run_across_clients_with_different_request_keys() -> None:
    runtime = authority()
    created_session = session(runtime)
    first = runtime.create_run(
        "alice", "ws-a", created_session.session_id,
        message="retry", attachment_refs=[], idempotency_key="android-random-key",
        correlation_id="android", retry_of="failed-run-one",
    )
    second = runtime.create_run(
        "alice", "ws-a", created_session.session_id,
        message="retry", attachment_refs=[], idempotency_key="desktop-random-key",
        correlation_id="desktop", retry_of="failed-run-one",
    )
    assert second is first
    assert len(runtime.runs) == 1


def test_many_clients_retry_same_failed_run_atomically_create_one_replacement() -> None:
    runtime = authority()
    created_session = session(runtime)

    def retry(index: int):
        return runtime.create_run(
            "alice", "ws-a", created_session.session_id,
            message="retry", attachment_refs=[], idempotency_key=f"client-key-{index}",
            correlation_id=f"client-{index}", retry_of="failed-run-one",
        )

    with ThreadPoolExecutor(max_workers=16) as pool:
        results = list(pool.map(retry, range(64)))
    assert len({item.run_id for item in results}) == 1
    assert len(runtime.runs) == 1
    assert len([item for item in runtime.audit if item.action == "run.created"]) == 1


def test_event_resume_all_kinds_runtime_terminal_authority_and_cancel_idempotency() -> None:
    runtime = authority()
    created = run(runtime)
    kinds = ["run.started", "message.delta", "tool.started", "workspace.changed", "artifact.created"]
    for kind in kinds:
        runtime.append_event(created.run_id, kind, {"status": "running"} if kind == "run.started" else {})
    resumed, _ = runtime.events.after("rt-a", created.run_id, 2)
    assert [item.kind for item in resumed] == kinds[1:]
    assert runtime.cancel_run("ws-a", created.run_id).status == RunStatus.CANCELLED
    event_count = len(runtime.events.after("rt-a", created.run_id, 0)[0])
    assert runtime.cancel_run("ws-a", created.run_id).status == RunStatus.CANCELLED
    assert len(runtime.events.after("rt-a", created.run_id, 0)[0]) == event_count


def test_many_clients_cancel_same_run_emit_one_terminal_event_and_audit() -> None:
    runtime = authority()
    created = run(runtime)
    with ThreadPoolExecutor(max_workers=16) as pool:
        results = list(pool.map(lambda _: runtime.cancel_run("ws-a", created.run_id), range(64)))
    assert {item.status for item in results} == {RunStatus.CANCELLED}
    events, _ = runtime.events.after("rt-a", created.run_id, 0)
    assert [item.kind for item in events].count("run.cancelled") == 1
    assert len([item for item in runtime.audit if item.action == "run.cancelled"]) == 1


def test_permission_denial_never_creates_approval_and_decision_is_idempotent() -> None:
    runtime = authority()
    created = run(runtime)
    with pytest.raises(RelayRegistryError) as denied:
        runtime.request_approval("bob", created.run_id, operation="shell.execute", risk_summary="rm", scope="workspace", correlation_id="c")
    assert denied.value.code == "runtime_permission_denied" and runtime.approvals == {}
    approval = runtime.request_approval("alice", created.run_id, operation="shell.execute",
                                        risk_summary="danger " * 200, scope="workspace", correlation_id="corr")
    assert len(approval.risk_summary) == 512
    first = runtime.decide_approval("alice", approval.approval_id, "deny")
    repeated = runtime.decide_approval("alice", approval.approval_id, "approve")
    assert first is repeated and repeated.status == ApprovalStatus.DENIED
    assert runtime.audit[-1].correlation_id == "corr"


def test_many_clients_decide_same_approval_emit_one_terminal_event_and_audit() -> None:
    runtime = authority()
    created = run(runtime)
    approval = runtime.request_approval(
        "alice", created.run_id, operation="shell.execute",
        risk_summary="bounded", scope="workspace", correlation_id="corr",
    )

    def decide(index: int):
        decision = "approve" if index % 2 == 0 else "deny"
        return runtime.decide_approval("alice", approval.approval_id, decision, f"device-{index}")

    with ThreadPoolExecutor(max_workers=16) as pool:
        results = list(pool.map(decide, range(64)))
    assert len({item.status for item in results}) == 1
    assert results[0].status in {ApprovalStatus.APPROVED, ApprovalStatus.DENIED}
    events, _ = runtime.events.after("rt-a", created.run_id, 0)
    assert [item.kind for item in events].count("approval.resolved") == 1
    assert len([
        item for item in runtime.audit
        if item.action in {"approval.approved", "approval.denied"}
    ]) == 1


def test_approval_decision_has_authoritative_subject_scoped_idempotency_recovery() -> None:
    runtime = authority()
    created = run(runtime)
    approval = runtime.request_approval(
        "alice", created.run_id, operation="shell.execute",
        risk_summary="bounded", scope="workspace", correlation_id="corr",
    )
    decided = runtime.decide_approval(
        "alice", approval.approval_id, "approve", "approval:one:approve"
    )

    assert runtime.idempotency_result(
        "alice", "approval.decide", "approval:one:approve"
    ) is decided
    with pytest.raises(RelayRegistryError) as other_subject:
        runtime.idempotency_result("bob", "approval.decide", "approval:one:approve")
    assert other_subject.value.code == "idempotency_result_not_found"


def test_approval_expiry_and_resume_pending_are_deterministic() -> None:
    runtime = authority()
    created = run(runtime)
    approval = runtime.request_approval("alice", created.run_id, operation="files.write",
                                        risk_summary="write", scope="one file", correlation_id="corr")
    assert runtime.pending_approvals("ws-a") == [approval]
    approval.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    assert runtime.pending_approvals("ws-a") == []
    assert approval.status == ApprovalStatus.EXPIRED


def test_two_runtime_authorities_never_share_same_ids_or_events() -> None:
    first, second = authority(), RuntimeAuthority("rt-b")
    second.add_agent_definition(AgentDefinition("agent", "2026.07.17", "OpenDrSai", "opendrsai", "healthy", frozenset()))
    first_run = run(first)
    second_session = second.create_session("alice", "ws-a", title="Same path", definition_id="agent",
                                           definition_version="2026.07.17", idempotency_key="session-key-001")
    second_run = second.create_run("alice", "ws-a", second_session.session_id, message="x", attachment_refs=[],
                                   idempotency_key="run-key-0001", correlation_id="c")
    assert first_run.run_id != second_run.run_id
    assert second.events.after("rt-b", first_run.run_id, 0)[0] == []


def test_existing_active_session_and_conversation_are_visible_after_runtime_association() -> None:
    runtime = authority()
    created = session(runtime)
    created_run = runtime.create_run(
        "windows-owner", "ws-a", created.session_id, message="created on Windows",
        attachment_refs=[], idempotency_key="windows-run", correlation_id="windows-correlation",
    )
    runtime.append_event(created_run.run_id, "message.delta", {"delta": "Windows response"})

    listed, _ = runtime.list_sessions_for_subject("mobile-user", "ws-a")
    assert [item.session_id for item in listed] == [created.session_id]
    transcript, _ = runtime.conversation_for_subject("mobile-user", "ws-a", created.session_id)
    assert [item["kind"] for item in transcript] == ["message.user", "run.queued", "message.delta"]
    assert [item["sequence"] for item in transcript] == [1, 2, 3]

    created.lifecycle = ResourceLifecycle.ARCHIVED
    assert runtime.list_sessions_for_subject("mobile-user", "ws-a")[0] == []
    with pytest.raises(RelayRegistryError) as archived:
        runtime.authorize_session("mobile-user", "ws-a", created.session_id)
    assert archived.value.code == "session_forbidden"
