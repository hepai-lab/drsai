from __future__ import annotations

import base64
from concurrent.futures import ThreadPoolExecutor
from dataclasses import FrozenInstanceError
import hashlib
import hmac
import json
import multiprocessing as mp
import sqlite3
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from drsai.backend.runtime.security_boundary import (
    ActionProposal,
    AuthorizationGrantStore,
    IsolationAttestation,
    IsolationAttestationLeaseStore,
    IsolatedEffectExecutionError,
    IsolatedEffectExecutionService,
    IsolatedEffectRecoveryMonitor,
    IsolatedEffectRecoveryThresholds,
    ResolvedCapabilityProfile,
    SandboxError,
    SimulatedIsolatedEffectCrash,
    SecurityEventJournal,
    SecurityMetricsCollector,
    canonical_digest,
)
from drsai.backend.runtime.security_boundary.effects import EffectExecutionError, EffectExecutionStore
from drsai.backend.runtime.security_boundary.isolated_effect_worker import execute_request
from drsai.backend.runtime.security_boundary.sandbox import REQUIRED_GUARANTEES


class FakeFilesystem:
    def __init__(self):
        self.contents: dict[str, bytes] = {}
        self.writes: list[tuple[str, bytes]] = []
        self.conflict = False

    def atomic_write(self, relative: str, content: bytes) -> None:
        self.writes.append((relative, content))
        self.contents[relative] = content

    def compare_and_swap(self, relative: str, expected: str, content: bytes) -> None:
        actual = "sha256:" + hashlib.sha256(self.contents.get(relative, b"")).hexdigest()
        if self.conflict or actual != expected:
            raise SandboxError("filesystem_edit_conflict", "File changed.")
        self.atomic_write(relative, content)


class FakeIsolatedSession:
    def __init__(self, filesystem: FakeFilesystem, *, behavior: str = "success"):
        self.filesystem = filesystem
        self.behavior = behavior
        self.calls: list[dict[str, object]] = []
        self.encrypted_requests: list[bytes] = []
        self.sessions: dict[str, SimpleNamespace] = {}

    def execute(self, **values):
        self.calls.append(values)
        argv = list(values["argv"])
        request_name = argv[argv.index("--request") + 1]
        response_name = argv[argv.index("--response") + 1]
        execution_id = argv[argv.index("--execution-id") + 1]
        key = base64.b64decode(values["environment"]["OPENDRSAI_ISOLATED_EFFECT_KEY"])
        encrypted = (values["cwd"] / request_name).read_bytes()
        self.encrypted_requests.append(encrypted)
        request = json.loads(AESGCM(key).decrypt(
            encrypted[:12], encrypted[12:], execution_id.encode("utf-8"),
        ))
        result = execute_request(request, self.filesystem)
        if self.behavior == "crash_after_mutation":
            raise RuntimeError("worker transport lost")
        body = {
            "schema_version": "isolated-effect-receipt/1",
            "execution_id": execution_id,
            "operation": request["operation"],
            "status": result["status"],
            "error_code": result.get("error_code"),
            "request_digest": canonical_digest(request),
            "result_digest": canonical_digest(result),
        }
        body["receipt_digest"] = canonical_digest(body)
        body["mac"] = hmac.new(
            key,
            json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode(),
            hashlib.sha256,
        ).hexdigest()
        if self.behavior == "tamper":
            body["status"] = "failed"
        (values["cwd"] / response_name).write_text(json.dumps(body), encoding="utf-8")
        worker_status = "succeeded" if result["status"] in {"succeeded", "failed"} else "failed"
        session = SimpleNamespace(
            session_id=f"session:{values['execution_id']}",
            execution_id=values["execution_id"], worker_status=worker_status,
            state="completed",
        )
        self.sessions[str(values["execution_id"])] = session
        return session

    def by_execution(self, execution_id: str):
        return self.sessions.get(execution_id)

    def reached_state(self, session_id: str, state: str) -> bool:
        return state == "worker_starting" and any(
            session.session_id == session_id for session in self.sessions.values()
        )

    def recover_incomplete(self):
        return []


def _process_reconcile(database, worker, digest, owner, start_event, result_queue) -> None:
    filesystem = FakeFilesystem()
    session = FakeIsolatedSession(filesystem)
    service = IsolatedEffectExecutionService(
        Path(database), IsolationAttestationLeaseStore(Path(database)), session,
        worker_argv_prefix=(worker,), expected_worker_sha256=digest,
        recovery_owner_id=owner, recovery_lease_seconds=2,
    )
    start_event.wait(10)
    try:
        result = service.reconcile_interrupted()
        result_queue.put(("ok", result.committed, result.failed, result.outcome_unknown, result.pending))
    except Exception as error:  # pragma: no cover - returned to the parent for assertion
        result_queue.put(("error", type(error).__name__, str(error)))


def _process_claim_and_hold(
    database, worker, digest, owner, lease_seconds, claimed_event, result_queue,
) -> None:
    service = IsolatedEffectExecutionService(
        Path(database), IsolationAttestationLeaseStore(Path(database)),
        FakeIsolatedSession(FakeFilesystem()), worker_argv_prefix=(worker,),
        expected_worker_sha256=digest, recovery_owner_id=owner,
        recovery_lease_seconds=lease_seconds,
    )
    row = service._claim_recovery("effect-killed-owner")
    result_queue.put((row is not None, float(row["recovery_lease_expires_at"]) if row else None))
    claimed_event.set()
    time.sleep(60)


def make_profile(root: Path) -> ResolvedCapabilityProfile:
    return ResolvedCapabilityProfile(
        "isolated-profile", 1, str(root), frozenset({"filesystem.write"}),
        writable_roots=(str(root),), trusted_workspace=True,
    )


def make_attestation(now: float) -> IsolationAttestation:
    return IsolationAttestation(
        "windows-appcontainer-effect-worker", "1", "windows", now - 1, now + 300,
        REQUIRED_GUARANTEES, "sha256:isolated-effect-attestation",
    )


def setup_service(tmp_path: Path, *, behavior: str = "success"):
    root = tmp_path / "workspace"
    root.mkdir()
    database = tmp_path / "security.sqlite3"
    profile = make_profile(root)
    now = time.time()
    attestation = make_attestation(now)
    leases = IsolationAttestationLeaseStore(database)
    leases.bind("run-1", str(root), profile, attestation, now=now)
    filesystem = FakeFilesystem()
    session = FakeIsolatedSession(filesystem, behavior=behavior)
    worker = tmp_path / "trusted-worker.exe"
    worker.write_bytes(b"packaged-isolated-effect-worker-v1")
    worker_digest = "sha256:" + hashlib.sha256(worker.read_bytes()).hexdigest()
    service = IsolatedEffectExecutionService(
        database, leases, session, worker_argv_prefix=(str(worker),),
        expected_worker_sha256=worker_digest,
    )
    return root, database, profile, attestation, filesystem, session, service


def write_proposal(profile: ResolvedCapabilityProfile, relative: str, content: bytes) -> ActionProposal:
    payload = {
        "relative_path": relative,
        "content_digest": "sha256:" + hashlib.sha256(content).hexdigest(),
        "size_bytes": len(content),
    }
    return ActionProposal.create(
        proposal_id="proposal-write", run_id="run-1", operation="file.write",
        payload=payload, risk="write", required_capabilities=("filesystem.write",),
    )


def test_isolated_write_consumes_grant_and_accepts_only_authenticated_worker_receipt(tmp_path: Path) -> None:
    root, database, profile, attestation, filesystem, session, service = setup_service(tmp_path)
    secret = b"isolated-secret-canary"
    proposal = write_proposal(profile, "notes.txt", secret)
    grants = AuthorizationGrantStore(database)
    grant = grants.issue(proposal, profile)

    receipt = service.execute_write(
        grant_id=grant.grant_id, proposal=proposal, profile=profile,
        workspace_root=root, attestation_digest=attestation.evidence_digest,
        relative_path="notes.txt", content=secret, execution_id="effect-1",
    )

    assert receipt.status == "succeeded"
    assert filesystem.writes == [("notes.txt", secret)]
    assert grants.get(grant.grant_id).consumed_at is not None
    assert EffectExecutionStore(database).get("effect-1").status == "succeeded"
    assert list(root.glob(".opendrsai-isolated-*")) == []
    assert secret not in database.read_bytes()
    call = session.calls[0]
    assert secret.decode() not in " ".join(call["argv"])
    assert set(call["environment"]) == {"OPENDRSAI_ISOLATED_EFFECT_KEY"}
    assert secret not in session.encrypted_requests[0]
    with pytest.raises(Exception) as replay:
        service.execute_write(
            grant_id=grant.grant_id, proposal=proposal, profile=profile,
            workspace_root=root, attestation_digest=attestation.evidence_digest,
            relative_path="notes.txt", content=secret, execution_id="effect-replay",
        )
    assert getattr(replay.value, "code", "") == "grant_already_consumed"
    assert filesystem.writes == [("notes.txt", secret)]


def test_scope_or_payload_mismatch_is_rejected_before_grant_consumption(tmp_path: Path) -> None:
    root, database, profile, attestation, filesystem, session, service = setup_service(tmp_path)
    proposal = write_proposal(profile, "notes.txt", b"approved")
    grant = AuthorizationGrantStore(database).issue(proposal, profile)
    with pytest.raises(Exception) as mismatch:
        service.execute_write(
            grant_id=grant.grant_id, proposal=proposal, profile=profile,
            workspace_root=root, attestation_digest=attestation.evidence_digest,
            relative_path="notes.txt", content=b"different",
        )
    assert getattr(mismatch.value, "code", "") == "proposal_payload_mismatch"
    assert AuthorizationGrantStore(database).get(grant.grant_id).consumed_at is None
    assert filesystem.writes == [] and session.calls == []


def test_revoked_isolation_lease_blocks_effect_before_grant_claim(tmp_path: Path) -> None:
    root, database, profile, attestation, filesystem, session, service = setup_service(tmp_path)
    proposal = write_proposal(profile, "notes.txt", b"content")
    grants = AuthorizationGrantStore(database)
    grant = grants.issue(proposal, profile)
    service.leases.revoke_run("run-1", reason_code="worker_lost")
    with pytest.raises(SandboxError) as revoked:
        service.execute_write(
            grant_id=grant.grant_id, proposal=proposal, profile=profile,
            workspace_root=root, attestation_digest=attestation.evidence_digest,
            relative_path="notes.txt", content=b"content",
        )
    assert revoked.value.code == "isolation_lease_revoked"
    assert grants.get(grant.grant_id).consumed_at is None
    assert filesystem.writes == [] and session.calls == []


def test_replaced_worker_binary_blocks_effect_before_grant_claim(tmp_path: Path) -> None:
    root, database, profile, attestation, filesystem, session, service = setup_service(tmp_path)
    proposal = write_proposal(profile, "notes.txt", b"content")
    grants = AuthorizationGrantStore(database)
    grant = grants.issue(proposal, profile)
    Path(service.worker_argv_prefix[0]).write_bytes(b"replaced-worker")
    with pytest.raises(IsolatedEffectExecutionError) as replaced:
        service.execute_write(
            grant_id=grant.grant_id, proposal=proposal, profile=profile,
            workspace_root=root, attestation_digest=attestation.evidence_digest,
            relative_path="notes.txt", content=b"content",
        )
    assert replaced.value.code == "isolated_effect_worker_identity_mismatch"
    assert grants.get(grant.grant_id).consumed_at is None
    assert filesystem.writes == [] and session.calls == []


def test_worker_binary_cannot_be_loaded_from_agent_writable_workspace(tmp_path: Path) -> None:
    root, database, profile, attestation, filesystem, session, service = setup_service(tmp_path)
    workspace_worker = root / "worker.exe"
    workspace_worker.write_bytes(b"workspace-controlled-worker")
    service = IsolatedEffectExecutionService(
        database, service.leases, session, worker_argv_prefix=(str(workspace_worker),),
        expected_worker_sha256="sha256:" + hashlib.sha256(workspace_worker.read_bytes()).hexdigest(),
    )
    proposal = write_proposal(profile, "notes.txt", b"content")
    grants = AuthorizationGrantStore(database)
    grant = grants.issue(proposal, profile)
    with pytest.raises(IsolatedEffectExecutionError) as denied:
        service.execute_write(
            grant_id=grant.grant_id, proposal=proposal, profile=profile,
            workspace_root=root, attestation_digest=attestation.evidence_digest,
            relative_path="notes.txt", content=b"content",
        )
    assert denied.value.code == "isolated_effect_worker_in_workspace"
    assert grants.get(grant.grant_id).consumed_at is None
    assert filesystem.writes == [] and session.calls == []


def test_effect_claim_and_durable_attempt_hook_roll_back_as_one_transaction(tmp_path: Path) -> None:
    _root, database, profile, _attestation, _filesystem, _session, service = setup_service(tmp_path)
    proposal = write_proposal(profile, "notes.txt", b"content")
    grants = AuthorizationGrantStore(database)
    grant = grants.issue(proposal, profile)

    def fail_attempt(_db) -> None:
        raise sqlite3.OperationalError("injected attempt journal failure")

    with pytest.raises(sqlite3.OperationalError, match="attempt journal failure"):
        service.effects.claim(
            execution_id="effect-atomic-hook", grant_id=grant.grant_id,
            proposal=proposal, profile=profile,
            actual_payload={
                "relative_path": "notes.txt",
                "content_digest": "sha256:" + hashlib.sha256(b"content").hexdigest(),
                "size_bytes": 7,
            },
            attestation_digest="sha256:isolated-effect-attestation",
            commit_hook=fail_attempt,
        )
    assert grants.get(grant.grant_id).consumed_at is None
    with pytest.raises(EffectExecutionError) as absent:
        service.effects.get("effect-atomic-hook")
    assert absent.value.code == "effect_execution_missing"


def test_untrusted_or_missing_worker_receipt_is_outcome_unknown_and_not_replayable(tmp_path: Path) -> None:
    root, database, profile, attestation, filesystem, _session, service = setup_service(
        tmp_path, behavior="tamper",
    )
    proposal = write_proposal(profile, "notes.txt", b"content")
    grants = AuthorizationGrantStore(database)
    grant = grants.issue(proposal, profile)
    with pytest.raises(IsolatedEffectExecutionError) as untrusted:
        service.execute_write(
            grant_id=grant.grant_id, proposal=proposal, profile=profile,
            workspace_root=root, attestation_digest=attestation.evidence_digest,
            relative_path="notes.txt", content=b"content", execution_id="effect-tampered",
        )
    assert untrusted.value.code == "isolated_effect_receipt_untrusted"
    assert filesystem.writes == [("notes.txt", b"content")]
    assert EffectExecutionStore(database).get("effect-tampered").status == "outcome_unknown"
    assert grants.get(grant.grant_id).consumed_at is not None


def test_worker_transport_loss_after_mutation_is_outcome_unknown(tmp_path: Path) -> None:
    root, database, profile, attestation, filesystem, _session, service = setup_service(
        tmp_path, behavior="crash_after_mutation",
    )
    proposal = write_proposal(profile, "notes.txt", b"content")
    grant = AuthorizationGrantStore(database).issue(proposal, profile)
    with pytest.raises(RuntimeError, match="transport lost"):
        service.execute_write(
            grant_id=grant.grant_id, proposal=proposal, profile=profile,
            workspace_root=root, attestation_digest=attestation.evidence_digest,
            relative_path="notes.txt", content=b"content", execution_id="effect-crash",
        )
    assert filesystem.writes == [("notes.txt", b"content")]
    assert EffectExecutionStore(database).get("effect-crash").status == "outcome_unknown"


def test_worker_edit_conflict_returns_deterministic_failed_effect(tmp_path: Path) -> None:
    root, database, profile, attestation, filesystem, _session, service = setup_service(tmp_path)
    source, result = b"old", b"new"
    filesystem.contents["notes.txt"] = b"changed"
    source_digest = "sha256:" + hashlib.sha256(source).hexdigest()
    payload = {
        "relative_path": "notes.txt", "source_content_digest": source_digest,
        "old_text_digest": "sha256:" + hashlib.sha256(b"old").hexdigest(),
        "new_text_digest": "sha256:" + hashlib.sha256(b"new").hexdigest(),
        "match_count": 1,
        "result_content_digest": "sha256:" + hashlib.sha256(result).hexdigest(),
        "result_size_bytes": len(result),
    }
    proposal = ActionProposal.create(
        proposal_id="proposal-edit", run_id="run-1", operation="file.edit",
        payload=payload, risk="write", required_capabilities=("filesystem.write",),
    )
    grant = AuthorizationGrantStore(database).issue(proposal, profile)
    receipt = service.execute_edit(
        grant_id=grant.grant_id, proposal=proposal, profile=profile,
        workspace_root=root, attestation_digest=attestation.evidence_digest,
        relative_path="notes.txt", source_content_digest=source_digest,
        result_content=result, actual_payload=payload, execution_id="effect-edit-conflict",
    )
    assert receipt.status == "failed" and receipt.error_code == "filesystem_edit_conflict"
    assert filesystem.writes == []


@pytest.mark.parametrize(
    ("stage", "expected_effect", "expected_reconciliation", "write_count"),
    [
        ("effect_claimed", "failed", "failed", 0),
        ("envelope_staged", "failed", "failed", 0),
        ("session_terminal", "outcome_unknown", "outcome_unknown", 1),
        ("receipt_verified", "succeeded", "committed", 1),
        ("effect_committed", "succeeded", "committed", 1),
    ],
)
def test_restart_reconciles_each_isolated_effect_crash_stage_without_replay(
    tmp_path: Path, stage: str, expected_effect: str,
    expected_reconciliation: str, write_count: int,
) -> None:
    root, database, profile, attestation, filesystem, session, service = setup_service(tmp_path)
    proposal = write_proposal(profile, "notes.txt", b"content")
    grants = AuthorizationGrantStore(database)
    grant = grants.issue(proposal, profile)
    with pytest.raises(SimulatedIsolatedEffectCrash):
        service.execute_write(
            grant_id=grant.grant_id, proposal=proposal, profile=profile,
            workspace_root=root, attestation_digest=attestation.evidence_digest,
            relative_path="notes.txt", content=b"content",
            execution_id=f"effect-crash-{stage}", fault_after=stage,
        )
    restarted = IsolatedEffectExecutionService(
        database, service.leases, session,
        worker_argv_prefix=service.worker_argv_prefix,
        expected_worker_sha256=service.expected_worker_sha256,
    )
    result = restarted.reconcile_interrupted()
    assert getattr(result, expected_reconciliation) == 1
    effect = EffectExecutionStore(database).get(f"effect-crash-{stage}")
    assert effect.status == expected_effect
    assert len(filesystem.writes) == write_count
    assert grants.get(grant.grant_id).consumed_at is not None
    assert list(root.glob(".opendrsai-isolated-*")) == []
    assert restarted.reconcile_interrupted() == type(result)(0, 0, 0, 0)


def test_two_runtime_owners_cannot_reconcile_the_same_attempt_twice(tmp_path: Path) -> None:
    root, database, profile, attestation, filesystem, session, service = setup_service(tmp_path)
    proposal = write_proposal(profile, "notes.txt", b"content")
    grant = AuthorizationGrantStore(database).issue(proposal, profile)
    with pytest.raises(SimulatedIsolatedEffectCrash):
        service.execute_write(
            grant_id=grant.grant_id, proposal=proposal, profile=profile,
            workspace_root=root, attestation_digest=attestation.evidence_digest,
            relative_path="notes.txt", content=b"content",
            execution_id="effect-owner-race", fault_after="effect_claimed",
        )
    owners = [
        IsolatedEffectExecutionService(
            database, service.leases, session,
            worker_argv_prefix=service.worker_argv_prefix,
            expected_worker_sha256=service.expected_worker_sha256,
            recovery_owner_id=f"owner-{index}",
        )
        for index in range(2)
    ]
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda owner: owner.reconcile_interrupted(), owners))
    assert sum(result.failed for result in results) == 1
    assert EffectExecutionStore(database).get("effect-owner-race").status == "failed"
    assert filesystem.writes == []


def test_expired_recovery_owner_is_fenced_and_new_owner_takes_over(tmp_path: Path) -> None:
    root, database, profile, attestation, filesystem, session, service = setup_service(tmp_path)
    proposal = write_proposal(profile, "notes.txt", b"content")
    grant = AuthorizationGrantStore(database).issue(proposal, profile)
    with pytest.raises(SimulatedIsolatedEffectCrash):
        service.execute_write(
            grant_id=grant.grant_id, proposal=proposal, profile=profile,
            workspace_root=root, attestation_digest=attestation.evidence_digest,
            relative_path="notes.txt", content=b"content",
            execution_id="effect-owner-takeover", fault_after="effect_claimed",
        )
    now = [100.0]
    old_owner = IsolatedEffectExecutionService(
        database, service.leases, session,
        worker_argv_prefix=service.worker_argv_prefix,
        expected_worker_sha256=service.expected_worker_sha256,
        recovery_owner_id="old-owner", recovery_lease_seconds=30,
        clock=lambda: now[0],
    )
    old_claim = old_owner._claim_recovery("effect-owner-takeover")
    assert old_claim is not None and old_claim["recovery_lease_expires_at"] == 130
    old_token = str(old_claim["recovery_token"])
    now[0] = 110
    assert old_owner.heartbeat_recovery("effect-owner-takeover", old_token) == 140

    new_owner = IsolatedEffectExecutionService(
        database, service.leases, session,
        worker_argv_prefix=service.worker_argv_prefix,
        expected_worker_sha256=service.expected_worker_sha256,
        recovery_owner_id="new-owner", recovery_lease_seconds=30,
        clock=lambda: now[0],
    )
    now[0] = 120
    waiting = new_owner.reconcile_interrupted()
    assert waiting.pending == 1
    assert EffectExecutionStore(database).get("effect-owner-takeover").status == "executing"
    now[0] = 141
    new_claim = new_owner._claim_recovery("effect-owner-takeover")
    assert new_claim is not None and new_claim["recovery_owner_id"] == "new-owner"

    with pytest.raises(IsolatedEffectExecutionError) as heartbeat_fenced:
        old_owner.heartbeat_recovery("effect-owner-takeover", old_token)
    assert heartbeat_fenced.value.code == "isolated_effect_recovery_fenced"

    stale_receipt = canonical_digest({"execution_id": "effect-owner-takeover", "status": "failed"})
    with pytest.raises(IsolatedEffectExecutionError) as fenced:
        old_owner.effects.complete(
            "effect-owner-takeover", status="failed", receipt_digest=stale_receipt,
            error_code="stale_owner",
            commit_hook=old_owner._owned_terminal_hook(
                "effect-owner-takeover", old_token, "failed",
                terminal_status="failed", receipt_digest=stale_receipt,
                error_code="stale_owner",
            ),
            now=now[0],
        )
    assert fenced.value.code == "isolated_effect_recovery_fenced"
    assert EffectExecutionStore(database).get("effect-owner-takeover").status == "executing"

    recovered = new_owner.reconcile_interrupted()
    assert recovered.failed == 1
    assert EffectExecutionStore(database).get("effect-owner-takeover").status == "failed"
    assert filesystem.writes == []


def test_terminal_journal_failure_rolls_back_effect_and_retry_recovers(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    root, database, profile, attestation, filesystem, session, service = setup_service(tmp_path)
    proposal = write_proposal(profile, "notes.txt", b"content")
    grant = AuthorizationGrantStore(database).issue(proposal, profile)
    with pytest.raises(SimulatedIsolatedEffectCrash):
        service.execute_write(
            grant_id=grant.grant_id, proposal=proposal, profile=profile,
            workspace_root=root, attestation_digest=attestation.evidence_digest,
            relative_path="notes.txt", content=b"content",
            execution_id="effect-terminal-journal-failure", fault_after="effect_claimed",
        )

    restarted = IsolatedEffectExecutionService(
        database, service.leases, session,
        worker_argv_prefix=service.worker_argv_prefix,
        expected_worker_sha256=service.expected_worker_sha256,
        recovery_owner_id="recovery-owner",
    )
    original_hook = restarted._owned_terminal_hook

    def failing_hook(*args, **kwargs):
        durable_hook = original_hook(*args, **kwargs)

        def inject_failure(db):
            durable_hook(db)
            raise sqlite3.OperationalError("injected attempt event write failure")

        return inject_failure

    monkeypatch.setattr(restarted, "_owned_terminal_hook", failing_hook)
    deferred = restarted.reconcile_interrupted()
    assert deferred.pending == 1
    assert EffectExecutionStore(database).get("effect-terminal-journal-failure").status == "executing"
    with sqlite3.connect(database) as db:
        row = db.execute(
            "SELECT status,recovery_failures,recovery_error_code FROM "
            "runtime_isolated_effect_attempts WHERE execution_id=?",
            ("effect-terminal-journal-failure",),
        ).fetchone()
    assert row == ("claimed", 1, "sqlite:OperationalError")
    metrics = restarted.recovery_metrics()
    assert metrics.nonterminal_attempts == 1
    assert metrics.actively_leased_attempts == 1
    assert metrics.deferred_attempts == 1
    assert metrics.total_recovery_failures == 1
    assert metrics.oldest_pending_seconds >= 0

    monkeypatch.setattr(restarted, "_owned_terminal_hook", original_hook)
    recovered = restarted.reconcile_interrupted()
    assert recovered.failed == 1
    assert EffectExecutionStore(database).get("effect-terminal-journal-failure").status == "failed"
    assert restarted.recovery_metrics().nonterminal_attempts == 0
    assert filesystem.writes == []


def test_session_recovery_exception_is_deferred_without_blocking_takeover(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    root, database, profile, attestation, filesystem, session, service = setup_service(tmp_path)
    proposal = write_proposal(profile, "notes.txt", b"content")
    grant = AuthorizationGrantStore(database).issue(proposal, profile)
    with pytest.raises(SimulatedIsolatedEffectCrash):
        service.execute_write(
            grant_id=grant.grant_id, proposal=proposal, profile=profile,
            workspace_root=root, attestation_digest=attestation.evidence_digest,
            relative_path="notes.txt", content=b"content",
            execution_id="effect-session-recovery-error", fault_after="session_terminal",
        )
    durable_session = session.sessions["isolated-session:effect-session-recovery-error"]
    durable_session.state = "worker_starting"
    restarted = IsolatedEffectExecutionService(
        database, service.leases, session,
        worker_argv_prefix=service.worker_argv_prefix,
        expected_worker_sha256=service.expected_worker_sha256,
        recovery_owner_id="session-recovery-owner",
    )

    def fail_recovery():
        raise RuntimeError("injected session recovery failure")

    monkeypatch.setattr(session, "recover_incomplete", fail_recovery)
    deferred = restarted.reconcile_interrupted()
    assert deferred.pending == 1
    assert EffectExecutionStore(database).get("effect-session-recovery-error").status == "executing"
    with sqlite3.connect(database) as db:
        row = db.execute(
            "SELECT recovery_failures,recovery_error_code FROM runtime_isolated_effect_attempts "
            "WHERE execution_id=?", ("effect-session-recovery-error",),
        ).fetchone()
    assert row == (1, "recovery:RuntimeError")

    durable_session.state = "quarantined"
    recovered = restarted.reconcile_interrupted()
    assert recovered.outcome_unknown == 1
    assert EffectExecutionStore(database).get("effect-session-recovery-error").status == "outcome_unknown"


def test_sqlite_busy_claim_stays_pending_then_recovers(tmp_path: Path) -> None:
    root, database, profile, attestation, filesystem, session, service = setup_service(tmp_path)
    proposal = write_proposal(profile, "notes.txt", b"content")
    grant = AuthorizationGrantStore(database).issue(proposal, profile)
    with pytest.raises(SimulatedIsolatedEffectCrash):
        service.execute_write(
            grant_id=grant.grant_id, proposal=proposal, profile=profile,
            workspace_root=root, attestation_digest=attestation.evidence_digest,
            relative_path="notes.txt", content=b"content",
            execution_id="effect-busy-claim", fault_after="effect_claimed",
        )
    restarted = IsolatedEffectExecutionService(
        database, service.leases, session,
        worker_argv_prefix=service.worker_argv_prefix,
        expected_worker_sha256=service.expected_worker_sha256,
        recovery_owner_id="busy-owner", database_timeout_seconds=0.01,
    )
    blocker = sqlite3.connect(database, isolation_level=None)
    try:
        blocker.execute("BEGIN IMMEDIATE")
        deferred = restarted.reconcile_interrupted()
        assert deferred.pending == 1
        assert EffectExecutionStore(database).get("effect-busy-claim").status == "executing"
    finally:
        blocker.rollback()
        blocker.close()

    recovered = restarted.reconcile_interrupted()
    assert recovered.failed == 1
    assert EffectExecutionStore(database).get("effect-busy-claim").status == "failed"
    assert filesystem.writes == []


def test_one_recovery_failure_does_not_block_later_attempts(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    root, database, profile, attestation, filesystem, session, service = setup_service(tmp_path)
    for index in range(2):
        proposal = write_proposal(profile, f"notes-{index}.txt", f"content-{index}".encode())
        grant = AuthorizationGrantStore(database).issue(proposal, profile)
        with pytest.raises(SimulatedIsolatedEffectCrash):
            service.execute_write(
                grant_id=grant.grant_id, proposal=proposal, profile=profile,
                workspace_root=root, attestation_digest=attestation.evidence_digest,
                relative_path=f"notes-{index}.txt", content=f"content-{index}".encode(),
                execution_id=f"effect-batch-{index}", fault_after="effect_claimed",
            )
    restarted = IsolatedEffectExecutionService(
        database, service.leases, session,
        worker_argv_prefix=service.worker_argv_prefix,
        expected_worker_sha256=service.expected_worker_sha256,
        recovery_owner_id="batch-owner",
    )
    original_complete = restarted.effects.complete

    def fail_first(execution_id, **kwargs):
        if execution_id == "effect-batch-0":
            raise sqlite3.OperationalError("injected first attempt failure")
        return original_complete(execution_id, **kwargs)

    monkeypatch.setattr(restarted.effects, "complete", fail_first)
    result = restarted.reconcile_interrupted()
    assert result.pending == 1
    assert result.failed == 1
    assert EffectExecutionStore(database).get("effect-batch-0").status == "executing"
    assert EffectExecutionStore(database).get("effect-batch-1").status == "failed"
    assert filesystem.writes == []


def test_spawned_processes_terminalize_effect_only_once(tmp_path: Path) -> None:
    root, database, profile, attestation, filesystem, session, service = setup_service(tmp_path)
    proposal = write_proposal(profile, "notes.txt", b"content")
    grant = AuthorizationGrantStore(database).issue(proposal, profile)
    with pytest.raises(SimulatedIsolatedEffectCrash):
        service.execute_write(
            grant_id=grant.grant_id, proposal=proposal, profile=profile,
            workspace_root=root, attestation_digest=attestation.evidence_digest,
            relative_path="notes.txt", content=b"content",
            execution_id="effect-process-race", fault_after="effect_claimed",
        )

    context = mp.get_context("spawn")
    start_event = context.Event()
    result_queue = context.Queue()
    processes = [
        context.Process(
            target=_process_reconcile,
            args=(str(database), service.worker_argv_prefix[0], service.expected_worker_sha256,
                  f"process-owner-{index}", start_event, result_queue),
        )
        for index in range(2)
    ]
    for process in processes:
        process.start()
    start_event.set()
    results = [result_queue.get(timeout=20) for _ in processes]
    for process in processes:
        process.join(timeout=20)
        assert process.exitcode == 0
    assert all(result[0] == "ok" for result in results), results
    assert sum(result[2] for result in results) == 1
    assert EffectExecutionStore(database).get("effect-process-race").status == "failed"
    assert filesystem.writes == []


def test_killed_recovery_process_is_taken_over_after_lease_expiry(tmp_path: Path) -> None:
    root, database, profile, attestation, filesystem, session, service = setup_service(tmp_path)
    proposal = write_proposal(profile, "notes.txt", b"content")
    grant = AuthorizationGrantStore(database).issue(proposal, profile)
    with pytest.raises(SimulatedIsolatedEffectCrash):
        service.execute_write(
            grant_id=grant.grant_id, proposal=proposal, profile=profile,
            workspace_root=root, attestation_digest=attestation.evidence_digest,
            relative_path="notes.txt", content=b"content",
            execution_id="effect-killed-owner", fault_after="effect_claimed",
        )

    context = mp.get_context("spawn")
    claimed_event = context.Event()
    result_queue = context.Queue()
    lease_seconds = 0.4
    holder = context.Process(
        target=_process_claim_and_hold,
        args=(str(database), service.worker_argv_prefix[0], service.expected_worker_sha256,
              "killed-owner", lease_seconds, claimed_event, result_queue),
    )
    holder.start()
    assert claimed_event.wait(timeout=20)
    claimed, expires_at = result_queue.get(timeout=5)
    assert claimed and expires_at > time.time()
    holder.terminate()
    holder.join(timeout=10)
    assert holder.exitcode is not None and holder.exitcode != 0

    successor = IsolatedEffectExecutionService(
        database, service.leases, session,
        worker_argv_prefix=service.worker_argv_prefix,
        expected_worker_sha256=service.expected_worker_sha256,
        recovery_owner_id="successor-owner", recovery_lease_seconds=lease_seconds,
    )
    before_expiry = successor.recovery_metrics()
    assert before_expiry.nonterminal_attempts == 1
    assert before_expiry.actively_leased_attempts == 1
    assert successor.reconcile_interrupted().pending == 1
    time.sleep(max(0.0, expires_at - time.time()) + 0.1)

    recovered = successor.reconcile_interrupted()
    assert recovered.failed == 1
    assert EffectExecutionStore(database).get("effect-killed-owner").status == "failed"
    assert successor.recovery_metrics().nonterminal_attempts == 0
    assert filesystem.writes == []


def test_recovery_monitor_emits_only_deduplicated_state_transitions(tmp_path: Path) -> None:
    root, database, profile, attestation, filesystem, session, service = setup_service(tmp_path)
    proposal = write_proposal(profile, "notes.txt", b"content")
    grant = AuthorizationGrantStore(database).issue(proposal, profile)
    created_at = time.time()
    with pytest.raises(SimulatedIsolatedEffectCrash):
        service.execute_write(
            grant_id=grant.grant_id, proposal=proposal, profile=profile,
            workspace_root=root, attestation_digest=attestation.evidence_digest,
            relative_path="notes.txt", content=b"content",
            execution_id="effect-alert-transition", fault_after="effect_claimed",
        )
    observed_at = created_at + 20
    service.clock = lambda: observed_at
    thresholds = IsolatedEffectRecoveryThresholds(
        max_nonterminal_attempts=1,
        max_total_recovery_failures=1,
        max_oldest_pending_seconds=10,
    )
    monitor = IsolatedEffectRecoveryMonitor(
        service, thresholds=thresholds, clock=lambda: observed_at,
    )

    raised = monitor.evaluate()
    assert raised.active_alerts == frozenset({"backlog", "stale_attempt"})
    assert [event.event_type for event in raised.emitted_events] == [
        "isolated_recovery.alert_raised", "isolated_recovery.alert_raised",
    ]
    assert monitor.evaluate().emitted_events == ()
    assert len(SecurityEventJournal(database).list()) >= 2

    recovered = service.reconcile_interrupted()
    assert recovered.failed == 1
    cleared = monitor.evaluate()
    assert cleared.active_alerts == frozenset()
    assert [event.event_type for event in cleared.emitted_events] == [
        "isolated_recovery.alert_cleared", "isolated_recovery.alert_cleared",
    ]
    assert monitor.evaluate().emitted_events == ()
    SecurityEventJournal(database).verify()

    projected = [
        (metric.name, dict(metric.labels), metric.value)
        for metric in SecurityMetricsCollector(database).snapshot(now=observed_at)
        if metric.name == "security_isolated_recovery_alert_total"
    ]
    assert len(projected) == 4
    assert all(set(labels) == {"alert", "state"} for _, labels, _ in projected)
    assert all(value == 1 for _, _, value in projected)
    with pytest.raises(FrozenInstanceError):
        thresholds.max_nonterminal_attempts = 100  # type: ignore[misc]


def test_recovery_alert_state_rolls_back_when_audit_append_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    root, database, profile, attestation, filesystem, session, service = setup_service(tmp_path)
    proposal = write_proposal(profile, "notes.txt", b"content")
    grant = AuthorizationGrantStore(database).issue(proposal, profile)
    with pytest.raises(SimulatedIsolatedEffectCrash):
        service.execute_write(
            grant_id=grant.grant_id, proposal=proposal, profile=profile,
            workspace_root=root, attestation_digest=attestation.evidence_digest,
            relative_path="notes.txt", content=b"content",
            execution_id="effect-alert-rollback", fault_after="effect_claimed",
        )
    monitor = IsolatedEffectRecoveryMonitor(
        service,
        thresholds=IsolatedEffectRecoveryThresholds(max_nonterminal_attempts=1),
    )
    original_append = monitor.journal.append_in_transaction

    def fail_append(*args, **kwargs):
        raise sqlite3.OperationalError("injected security journal failure")

    monkeypatch.setattr(monitor.journal, "append_in_transaction", fail_append)
    with pytest.raises(sqlite3.OperationalError, match="security journal failure"):
        monitor.evaluate()
    with sqlite3.connect(database) as db:
        assert db.execute(
            "SELECT COUNT(*) FROM runtime_isolated_effect_recovery_alerts",
        ).fetchone()[0] == 0

    monkeypatch.setattr(monitor.journal, "append_in_transaction", original_append)
    retried = monitor.evaluate()
    assert "backlog" in retried.active_alerts
    assert any(event.event_type == "isolated_recovery.alert_raised" for event in retried.emitted_events)
