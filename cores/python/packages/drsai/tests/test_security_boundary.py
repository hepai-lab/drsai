from __future__ import annotations

import concurrent.futures
import json
import os
import sqlite3
from dataclasses import dataclass
from pathlib import Path

import pytest

from drsai.backend.runtime.security_boundary import (
    ActionProposal,
    AuthorizationGrantStore,
    CapabilityPolicyLayer,
    CapabilityPolicyResolver,
    CredentialBroker,
    CredentialBrokerError,
    EffectExecutionError,
    EffectExecutionStore,
    GrantError,
    IsolationAttestation,
    PolicyError,
    ResolvedCapabilityProfile,
    SandboxBroker,
    SandboxError,
    SandboxExecutionReceipt,
    SandboxExecutionRequest,
    SecurityAuditError,
    SecurityEventJournal,
    SecurityBoundaryStore,
    SecurityBoundaryStoreError,
    WindowsIsolationCapabilities,
    WindowsIsolationProbe,
    WindowsRestrictedProcessBackend,
    canonical_digest,
)
from drsai.backend.runtime.security_boundary.models import CanonicalizationError


def proposal(payload: dict[str, object] | None = None, *, operation: str = "shell.execute") -> ActionProposal:
    return ActionProposal.create(
        proposal_id="proposal-1",
        run_id="run-1",
        operation=operation,
        payload=payload or {"command": "echo ok", "token": "secret-a"},
        risk="sensitive",
        required_capabilities=("process.execute",),
    )


def profile(*, hard_denies: frozenset[str] = frozenset()) -> ResolvedCapabilityProfile:
    return ResolvedCapabilityProfile(
        profile_id="manual-safe:1",
        version=1,
        workspace_root="C:/workspace",
        capabilities=frozenset({"process.execute"}),
        hard_denies=hard_denies,
        trusted_workspace=True,
    )


def test_canonical_digest_is_stable_and_type_preserving() -> None:
    assert canonical_digest({"b": [1, True], "a": "值"}) == canonical_digest({"a": "值", "b": [1, True]})
    assert canonical_digest({"value": 1}) != canonical_digest({"value": "1"})
    with pytest.raises(CanonicalizationError):
        canonical_digest({"value": float("nan")})


def test_display_redaction_never_changes_authorization_identity() -> None:
    first = proposal({"command": "deploy --target alpha", "token": "secret-a"})
    second = proposal({"command": "deploy --target beta", "token": "secret-b"})
    assert first.display_payload["token"] == second.display_payload["token"] == "[REDACTED]"
    assert first.payload_digest != second.payload_digest
    assert "secret-a" not in json.dumps(first.display_payload)


def test_profile_is_immutable_and_has_a_stable_digest() -> None:
    current = profile()
    assert current.digest == profile().digest
    with pytest.raises(AttributeError):
        current.version = 2  # type: ignore[misc]


def test_policy_layers_can_only_reduce_capabilities(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    resolved = CapabilityPolicyResolver().resolve(
        profile_id="manual-safe",
        version=1,
        workspace_root=workspace,
        trusted_workspace=True,
        layers=(
            CapabilityPolicyLayer(
                "system",
                allowed_capabilities=frozenset({"file.read", "file.write", "process.execute", "network.connect"}),
                writable_roots=(str(workspace),),
                network_rules=("https://example.com:443",),
                credential_refs=frozenset({"github"}),
                hard_denies=frozenset({"host.persistence"}),
            ),
            CapabilityPolicyLayer(
                "mode",
                allowed_capabilities=frozenset({"file.read", "file.write", "process.execute"}),
                denied_capabilities=frozenset({"process.execute"}),
                writable_roots=(str(workspace / "src"),),
                network_rules=(),
                credential_refs=frozenset(),
            ),
        ),
    )
    assert resolved.capabilities == frozenset({"file.read", "file.write"})
    assert resolved.network_rules == ()
    assert resolved.credential_refs == frozenset()
    assert resolved.hard_denies == frozenset({"host.persistence"})
    assert resolved.writable_roots == (os.path.normcase(str((workspace / "src").resolve())),)


def test_policy_rejects_outside_writable_root_and_untrusted_workspace(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    resolver = CapabilityPolicyResolver()
    with pytest.raises(PolicyError, match="inside the workspace") as outside:
        resolver.resolve(
            profile_id="p",
            version=1,
            workspace_root=workspace,
            trusted_workspace=True,
            layers=(CapabilityPolicyLayer("system", frozenset({"file.write"}), writable_roots=(str(tmp_path),)),),
        )
    assert outside.value.code == "writable_root_outside_workspace"
    with pytest.raises(PolicyError) as untrusted:
        resolver.resolve(
            profile_id="p",
            version=1,
            workspace_root=workspace,
            trusted_workspace=False,
            layers=(CapabilityPolicyLayer("mode", frozenset(), requires_trusted_workspace=True),),
        )
    assert untrusted.value.code == "workspace_untrusted"


def test_hard_deny_prevents_grant_even_with_capability(tmp_path: Path) -> None:
    store = AuthorizationGrantStore(tmp_path / "security.sqlite3")
    with pytest.raises(GrantError) as denied:
        store.issue(proposal(operation="shell.execute"), profile(hard_denies=frozenset({"shell.execute"})))
    assert denied.value.code == "proposal_not_permitted"


def test_grant_is_bound_to_raw_payload_run_operation_and_profile(tmp_path: Path) -> None:
    store = AuthorizationGrantStore(tmp_path / "security.sqlite3")
    original = proposal({"command": "echo alpha", "token": "secret-a"})
    active_profile = profile()
    grant = store.issue(original, active_profile, now=100, ttl_seconds=60)

    for changed in (
        {"command": "echo beta", "token": "secret-a"},
        {"command": "echo alpha", "token": "secret-b"},
    ):
        with pytest.raises(GrantError) as mismatch:
            store.consume(grant.grant_id, original, active_profile, actual_payload=changed, now=101)
        assert mismatch.value.code == "proposal_payload_mismatch"

    wrong_run = ActionProposal.create(
        proposal_id="proposal-2", run_id="run-2", operation=original.operation,
        payload={"command": "echo alpha", "token": "secret-a"}, risk="sensitive",
        required_capabilities=("process.execute",),
    )
    with pytest.raises(GrantError) as scope:
        store.consume(
            grant.grant_id, wrong_run, active_profile,
            actual_payload={"command": "echo alpha", "token": "secret-a"}, now=101,
        )
    assert scope.value.code == "grant_scope_mismatch"


def test_grant_is_single_use_and_expires(tmp_path: Path) -> None:
    store = AuthorizationGrantStore(tmp_path / "security.sqlite3")
    action = proposal()
    active_profile = profile()
    grant = store.issue(action, active_profile, now=100, ttl_seconds=10)
    consumed = store.consume(
        grant.grant_id, action, active_profile,
        actual_payload={"command": "echo ok", "token": "secret-a"}, now=101,
    )
    assert consumed.consumed_at == 101
    with pytest.raises(GrantError) as reused:
        store.consume(
            grant.grant_id, action, active_profile,
            actual_payload={"command": "echo ok", "token": "secret-a"}, now=102,
        )
    assert reused.value.code == "grant_already_consumed"

    expired = store.issue(action, active_profile, now=200, ttl_seconds=1)
    with pytest.raises(GrantError) as expiry:
        store.consume(
            expired.grant_id, action, active_profile,
            actual_payload={"command": "echo ok", "token": "secret-a"}, now=201,
        )
    assert expiry.value.code == "grant_expired"


def test_concurrent_consumers_have_exactly_one_winner(tmp_path: Path) -> None:
    store = AuthorizationGrantStore(tmp_path / "security.sqlite3")
    action = proposal()
    active_profile = profile()
    grant = store.issue(action, active_profile, now=100, ttl_seconds=60)

    def consume() -> str:
        try:
            store.consume(
                grant.grant_id, action, active_profile,
                actual_payload={"command": "echo ok", "token": "secret-a"}, now=101,
            )
            return "consumed"
        except GrantError as error:
            return error.code

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(lambda _: consume(), range(8)))
    assert results.count("consumed") == 1
    assert results.count("grant_already_consumed") == 7


def test_security_store_survives_restart_without_persisting_raw_secrets(tmp_path: Path) -> None:
    database = tmp_path / "security.sqlite3"
    store = SecurityBoundaryStore(database)
    active_profile = profile()
    action = proposal({"command": "deploy alpha", "token": "raw-secret-canary"})
    store.save_profile(active_profile, now=100)
    store.save_proposal(action, now=100)
    store.bind_run_profile("run-1", active_profile, reason="run.created", now=100)

    restarted = SecurityBoundaryStore(database)
    assert restarted.get_profile(active_profile.digest) == active_profile
    assert restarted.get_proposal(action.proposal_id) == action
    assert restarted.active_profile("run-1") == active_profile
    assert b"raw-secret-canary" not in database.read_bytes()


def test_security_store_facts_are_immutable_and_idempotent(tmp_path: Path) -> None:
    database = tmp_path / "security.sqlite3"
    store = SecurityBoundaryStore(database)
    active_profile = profile()
    action = proposal()
    store.save_profile(active_profile)
    store.save_profile(active_profile)
    store.save_proposal(action)
    store.save_proposal(action)

    conflicting = ResolvedCapabilityProfile(
        **{**active_profile.__dict__, "capabilities": frozenset({"file.read"})},
    )
    with pytest.raises(SecurityBoundaryStoreError) as conflict:
        store.save_profile(conflicting)
    assert conflict.value.code == "profile_version_conflict"

    with sqlite3.connect(database) as db:
        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            db.execute("UPDATE runtime_action_proposals SET operation='changed'")
        with pytest.raises(sqlite3.IntegrityError, match="immutable"):
            db.execute("DELETE FROM runtime_security_profiles")


def test_run_profile_versions_are_monotonic(tmp_path: Path) -> None:
    store = SecurityBoundaryStore(tmp_path / "security.sqlite3")
    first = profile()
    second = ResolvedCapabilityProfile(**{**first.__dict__, "version": 2})
    store.bind_run_profile("run-1", first, reason="created")
    store.bind_run_profile("run-1", second, reason="policy.changed")
    assert store.active_profile("run-1").version == 2
    with pytest.raises(SecurityBoundaryStoreError) as rollback:
        store.bind_run_profile("run-1", first, reason="invalid.rollback")
    assert rollback.value.code == "profile_version_not_monotonic"


@dataclass
class FakeSandboxBackend:
    attestation: IsolationAttestation
    executions: int = 0

    def attest(self) -> IsolationAttestation:
        return self.attestation

    def execute(
        self, request: SandboxExecutionRequest, active_profile: ResolvedCapabilityProfile,
    ) -> SandboxExecutionReceipt:
        self.executions += 1
        return SandboxExecutionReceipt(
            execution_id=request.execution_id,
            backend_id=self.attestation.backend_id,
            attestation_digest=self.attestation.evidence_digest,
            exit_code=0,
            status="succeeded",
            started_at=101,
            completed_at=102,
            output_digest=canonical_digest({"stdout": "ok"}),
        )


def attestation(*, expires_at: float = 200, guarantees: frozenset[str] | None = None) -> IsolationAttestation:
    return IsolationAttestation(
        backend_id="test-isolation",
        backend_version="1",
        platform="test",
        verified_at=90,
        expires_at=expires_at,
        guarantees=guarantees or frozenset({
            "non_admin_identity", "process_tree_controlled", "filesystem_enforced", "environment_sanitized",
        }),
        evidence_digest=canonical_digest({"backend": "test-isolation", "version": 1}),
    )


def sandbox_request(action: ActionProposal, active_profile: ResolvedCapabilityProfile) -> SandboxExecutionRequest:
    return SandboxExecutionRequest.create(
        run_id=action.run_id,
        operation=action.operation,
        proposal_digest=action.payload_digest,
        profile_digest=active_profile.digest,
        argv=("approved-tool", "--safe"),
        cwd=active_profile.workspace_root,
        environment={"LANG": "en_US.UTF-8"},
        timeout_seconds=30,
    )


def test_sandbox_broker_fails_closed_before_consuming_grant(tmp_path: Path) -> None:
    grants = AuthorizationGrantStore(tmp_path / "security.sqlite3")
    action, active_profile = proposal(), profile()
    grant = grants.issue(action, active_profile, now=100, ttl_seconds=60)
    request = sandbox_request(action, active_profile)

    with pytest.raises(SandboxError) as unavailable:
        SandboxBroker(None, grants).execute(
            grant_id=grant.grant_id, proposal=action, profile=active_profile,
            actual_payload={"command": "echo ok", "token": "secret-a"}, request=request, now=101,
        )
    assert unavailable.value.code == "sandbox_backend_unavailable"
    assert grants.get(grant.grant_id).consumed_at is None

    backend = FakeSandboxBackend(attestation(expires_at=100))
    with pytest.raises(SandboxError) as expired:
        SandboxBroker(backend, grants).execute(
            grant_id=grant.grant_id, proposal=action, profile=active_profile,
            actual_payload={"command": "echo ok", "token": "secret-a"}, request=request, now=101,
        )
    assert expired.value.code == "isolation_attestation_expired"
    assert backend.executions == 0
    assert grants.get(grant.grant_id).consumed_at is None


def test_sandbox_broker_rejects_missing_guarantees_and_system_environment(tmp_path: Path) -> None:
    grants = AuthorizationGrantStore(tmp_path / "security.sqlite3")
    action, active_profile = proposal(), profile()
    grant = grants.issue(action, active_profile, now=100, ttl_seconds=60)
    weak = FakeSandboxBackend(attestation(guarantees=frozenset({"filesystem_enforced"})))
    with pytest.raises(SandboxError) as missing:
        SandboxBroker(weak, grants).execute(
            grant_id=grant.grant_id, proposal=action, profile=active_profile,
            actual_payload={"command": "echo ok", "token": "secret-a"},
            request=sandbox_request(action, active_profile), now=101,
        )
    assert missing.value.code == "isolation_guarantees_missing"

    unsafe_environment = SandboxExecutionRequest(
        **{**sandbox_request(action, active_profile).__dict__, "environment": {"PATH": "malicious"}},
    )
    with pytest.raises(SandboxError) as environment:
        SandboxBroker(weak, grants).execute(
            grant_id=grant.grant_id, proposal=action, profile=active_profile,
            actual_payload={"command": "echo ok", "token": "secret-a"},
            request=unsafe_environment, now=101,
        )
    assert environment.value.code == "sandbox_environment_forbidden"


def test_sandbox_broker_executes_once_with_bound_attestation(tmp_path: Path) -> None:
    grants = AuthorizationGrantStore(tmp_path / "security.sqlite3")
    action, active_profile = proposal(), profile()
    grant = grants.issue(action, active_profile, now=100, ttl_seconds=60)
    backend = FakeSandboxBackend(attestation())
    broker = SandboxBroker(backend, grants)
    receipt = broker.execute(
        grant_id=grant.grant_id, proposal=action, profile=active_profile,
        actual_payload={"command": "echo ok", "token": "secret-a"},
        request=sandbox_request(action, active_profile), now=101,
    )
    assert receipt.status == "succeeded"
    assert backend.executions == 1
    with pytest.raises(GrantError) as replayed:
        broker.execute(
            grant_id=grant.grant_id, proposal=action, profile=active_profile,
            actual_payload={"command": "echo ok", "token": "secret-a"},
            request=sandbox_request(action, active_profile), now=102,
        )
    assert replayed.value.code == "grant_already_consumed"
    assert backend.executions == 1


def test_effect_claim_and_grant_consumption_are_one_transaction(tmp_path: Path) -> None:
    database = tmp_path / "security.sqlite3"
    grants = AuthorizationGrantStore(database)
    effects = EffectExecutionStore(database)
    action, active_profile = proposal(), profile()
    grant = grants.issue(action, active_profile, now=100, ttl_seconds=60)
    claimed = effects.claim(
        execution_id="execution-atomic",
        grant_id=grant.grant_id,
        proposal=action,
        profile=active_profile,
        actual_payload={"command": "echo ok", "token": "secret-a"},
        attestation_digest="sha256:attestation",
        now=101,
    )
    assert claimed.status == "executing"
    assert grants.get(grant.grant_id).consumed_at == 101

    other_grant = grants.issue(action, active_profile, now=100, ttl_seconds=60)
    with pytest.raises(EffectExecutionError) as conflict:
        effects.claim(
            execution_id="execution-atomic",
            grant_id=other_grant.grant_id,
            proposal=action,
            profile=active_profile,
            actual_payload={"command": "echo ok", "token": "secret-a"},
            attestation_digest="sha256:attestation",
            now=102,
        )
    assert conflict.value.code == "effect_execution_conflict"
    assert grants.get(other_grant.grant_id).consumed_at is None


def test_interrupted_effect_becomes_outcome_unknown_and_cannot_replay(tmp_path: Path) -> None:
    database = tmp_path / "security.sqlite3"
    grants = AuthorizationGrantStore(database)
    effects = EffectExecutionStore(database)
    action, active_profile = proposal(), profile()
    grant = grants.issue(action, active_profile, now=100, ttl_seconds=60)
    effects.claim(
        execution_id="execution-interrupted",
        grant_id=grant.grant_id,
        proposal=action,
        profile=active_profile,
        actual_payload={"command": "echo ok", "token": "secret-a"},
        attestation_digest="sha256:attestation",
        now=101,
    )
    restarted = EffectExecutionStore(database)
    assert restarted.reconcile_interrupted(now=110) == 1
    recovered = restarted.get("execution-interrupted")
    assert recovered.status == "outcome_unknown"
    assert recovered.error_code == "runtime_interrupted"
    assert restarted.reconcile_interrupted(now=111) == 0
    with pytest.raises(EffectExecutionError) as completed:
        restarted.complete(
            recovered.execution_id, status="succeeded", receipt_digest="sha256:late", now=112,
        )
    assert completed.value.code == "effect_not_executing"


@dataclass
class CrashingSandboxBackend(FakeSandboxBackend):
    def execute(
        self, request: SandboxExecutionRequest, active_profile: ResolvedCapabilityProfile,
    ) -> SandboxExecutionReceipt:
        self.executions += 1
        raise RuntimeError("worker disconnected after launch")


def test_broker_records_outcome_unknown_when_backend_disconnects(tmp_path: Path) -> None:
    grants = AuthorizationGrantStore(tmp_path / "security.sqlite3")
    action, active_profile = proposal(), profile()
    grant = grants.issue(action, active_profile, now=100, ttl_seconds=60)
    backend = CrashingSandboxBackend(attestation())
    broker = SandboxBroker(backend, grants)
    request = sandbox_request(action, active_profile)
    with pytest.raises(RuntimeError, match="disconnected"):
        broker.execute(
            grant_id=grant.grant_id, proposal=action, profile=active_profile,
            actual_payload={"command": "echo ok", "token": "secret-a"}, request=request, now=101,
        )
    execution = broker.effects.get(request.execution_id)
    assert execution.status == "outcome_unknown"
    assert execution.error_code == "RuntimeError"
    assert grants.get(grant.grant_id).consumed_at == 101


def test_windows_api_presence_is_not_treated_as_an_isolation_guarantee(tmp_path: Path) -> None:
    capabilities = WindowsIsolationCapabilities(
        platform_supported=True,
        current_process_is_admin=False,
        restricted_token_api=True,
        job_object_api=True,
        appcontainer_api=True,
    )
    backend = WindowsRestrictedProcessBackend(
        WindowsIsolationProbe(lambda: capabilities), clock=lambda: 100,
    )
    proof = backend.attest()
    assert proof.platform == "windows"
    assert proof.guarantees == frozenset()

    grants = AuthorizationGrantStore(tmp_path / "security.sqlite3")
    action, active_profile = proposal(), profile()
    grant = grants.issue(action, active_profile, now=100, ttl_seconds=60)
    with pytest.raises(SandboxError) as rejected:
        SandboxBroker(backend, grants).execute(
            grant_id=grant.grant_id, proposal=action, profile=active_profile,
            actual_payload={"command": "echo ok", "token": "secret-a"},
            request=sandbox_request(action, active_profile), now=101,
        )
    assert rejected.value.code == "isolation_guarantees_missing"
    assert grants.get(grant.grant_id).consumed_at is None


def test_windows_probe_returns_auditable_host_capabilities() -> None:
    capabilities = WindowsIsolationProbe().probe()
    assert isinstance(capabilities.platform_supported, bool)
    assert isinstance(capabilities.restricted_token_api, bool)
    assert isinstance(capabilities.job_object_api, bool)
    assert isinstance(capabilities.appcontainer_api, bool)
    assert isinstance(capabilities.appcontainer_profile_operational, bool)
    if capabilities.appcontainer_api and not capabilities.appcontainer_profile_operational:
        assert isinstance(capabilities.appcontainer_profile_hresult, int)
    assert capabilities.filesystem_projection_enforced is False
    assert capabilities.network_egress_enforced is False


def test_windows_backend_reports_only_independently_verified_partial_guarantees() -> None:
    capabilities = WindowsIsolationCapabilities(True, False, True, True, True)
    backend = WindowsRestrictedProcessBackend(
        WindowsIsolationProbe(lambda: capabilities), clock=lambda: 100,
        job_launcher_verified=True, restricted_identity_verified=True,
    )
    proof = backend.attest()
    assert proof.guarantees == frozenset({"non_admin_identity", "process_tree_controlled"})
    with pytest.raises(SandboxError) as incomplete:
        proof.validate(now=101)
    assert incomplete.value.code == "isolation_guarantees_missing"
    assert "filesystem_enforced" in str(incomplete.value)


def test_security_event_chain_is_redacted_append_only_and_verifiable(tmp_path: Path) -> None:
    database = tmp_path / "security.sqlite3"
    journal = SecurityEventJournal(database)
    first = journal.append("proposal.created", "proposal-1", {
        "operation": "shell.execute",
        "token": "secret-event-canary",
    }, now=100)
    second = journal.append("grant.issued", "grant-1", {"proposal_digest": "sha256:proposal"}, now=101)
    assert first.previous_digest == journal.GENESIS_DIGEST
    assert second.previous_digest == first.event_digest
    assert "secret-event-canary" not in database.read_bytes().decode("utf-8", errors="ignore")
    journal.verify()
    with sqlite3.connect(database) as db:
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            db.execute("DELETE FROM runtime_security_events")


def test_security_event_chain_detects_offline_tampering(tmp_path: Path) -> None:
    database = tmp_path / "security.sqlite3"
    journal = SecurityEventJournal(database)
    journal.append("effect.claimed", "execution-1", {"status": "executing"}, now=100)
    journal.append("effect.terminal", "execution-1", {"status": "succeeded"}, now=101)
    with sqlite3.connect(database) as db:
        db.execute("DROP TRIGGER runtime_security_events_no_update")
        db.execute("UPDATE runtime_security_events SET payload_json='{}' WHERE sequence=1")
    with pytest.raises(SecurityAuditError) as tampered:
        journal.verify()
    assert tampered.value.code == "security_event_digest_invalid"


def test_effect_state_and_security_events_commit_together(tmp_path: Path) -> None:
    database = tmp_path / "security.sqlite3"
    grants = AuthorizationGrantStore(database)
    effects = EffectExecutionStore(database)
    action, active_profile = proposal(), profile()
    grant = grants.issue(action, active_profile, now=100, ttl_seconds=60)
    effects.claim(
        execution_id="execution-audited",
        grant_id=grant.grant_id,
        proposal=action,
        profile=active_profile,
        actual_payload={"command": "echo ok", "token": "secret-a"},
        attestation_digest="sha256:attestation",
        now=101,
    )
    effects.complete(
        "execution-audited", status="succeeded", receipt_digest="sha256:output", now=102,
    )
    events = effects.audit.list()
    assert [event.event_type for event in events] == ["effect.claimed", "effect.terminal"]
    assert [event.subject_id for event in events] == ["execution-audited", "execution-audited"]
    effects.audit.verify()


def credential_profile() -> ResolvedCapabilityProfile:
    return ResolvedCapabilityProfile(
        profile_id="credential-profile",
        version=1,
        workspace_root="C:/workspace",
        capabilities=frozenset({"network.connect", "credential.use"}),
        network_rules=("https://api.example.com:443",),
        credential_refs=frozenset({"credential-ref-1"}),
        trusted_workspace=True,
    )


def test_credential_lease_is_purpose_target_profile_and_run_bound(tmp_path: Path) -> None:
    secret = "credential-secret-canary"
    broker = CredentialBroker(tmp_path / "security.sqlite3", lambda ref: secret if ref == "credential-ref-1" else None)
    active_profile = credential_profile()
    lease = broker.issue(
        run_id="run-1", profile=active_profile, credential_ref="credential-ref-1",
        purpose="api.read", target="https://API.EXAMPLE.com", now=100, ttl_seconds=60,
    )
    assert lease.target == "https://api.example.com:443"
    for changed in (
        {"run_id": "run-2", "purpose": "api.read", "target": "https://api.example.com"},
        {"run_id": "run-1", "purpose": "api.write", "target": "https://api.example.com"},
        {"run_id": "run-1", "purpose": "api.read", "target": "https://other.example.com"},
    ):
        with pytest.raises(CredentialBrokerError) as mismatch:
            broker.consume(lease.lease_id, profile=active_profile, now=101, **changed)
        assert mismatch.value.code == "credential_lease_scope_mismatch"

    with broker.consume(
        lease.lease_id, run_id="run-1", profile=active_profile,
        purpose="api.read", target="https://api.example.com:443", now=101,
    ) as material:
        assert material.read() == secret.encode()
    with pytest.raises(CredentialBrokerError) as cleared:
        material.read()
    assert cleared.value.code == "credential_material_closed"


def test_credential_secret_never_persists_or_enters_audit(tmp_path: Path) -> None:
    database = tmp_path / "security.sqlite3"
    secret = "never-persist-this-secret"
    broker = CredentialBroker(database, lambda _ref: secret)
    lease = broker.issue(
        run_id="run-1", profile=credential_profile(), credential_ref="credential-ref-1",
        purpose="api.read", target="https://api.example.com", now=100,
    )
    material = broker.consume(
        lease.lease_id, run_id="run-1", profile=credential_profile(),
        purpose="api.read", target="https://api.example.com", now=101,
    )
    assert material.read() == secret.encode()
    assert secret.encode() not in database.read_bytes()
    assert secret not in str(broker.audit.list())
    broker.audit.verify()
    material.close()


def test_credential_lease_expiry_revoke_and_network_bounds(tmp_path: Path) -> None:
    broker = CredentialBroker(tmp_path / "security.sqlite3", lambda _ref: "secret")
    active_profile = credential_profile()
    with pytest.raises(CredentialBrokerError) as target:
        broker.issue(
            run_id="run-1", profile=active_profile, credential_ref="credential-ref-1",
            purpose="api.read", target="https://other.example.com", now=100,
        )
    assert target.value.code == "credential_target_not_permitted"
    with pytest.raises(CredentialBrokerError) as plaintext:
        broker.issue(
            run_id="run-1", profile=active_profile, credential_ref="credential-ref-1",
            purpose="api.read", target="http://api.example.com", now=100,
        )
    assert plaintext.value.code == "credential_target_invalid"

    expired = broker.issue(
        run_id="run-1", profile=active_profile, credential_ref="credential-ref-1",
        purpose="api.read", target="https://api.example.com", ttl_seconds=1, now=100,
    )
    with pytest.raises(CredentialBrokerError) as expiry:
        broker.consume(
            expired.lease_id, run_id="run-1", profile=active_profile,
            purpose="api.read", target="https://api.example.com", now=101,
        )
    assert expiry.value.code == "credential_lease_expired"
    assert broker.get(expired.lease_id).status == "expired"

    revoked = broker.issue(
        run_id="run-1", profile=active_profile, credential_ref="credential-ref-1",
        purpose="api.read", target="https://api.example.com", now=200,
    )
    assert broker.revoke(revoked.lease_id, now=201).status == "revoked"
    with pytest.raises(CredentialBrokerError) as inactive:
        broker.consume(
            revoked.lease_id, run_id="run-1", profile=active_profile,
            purpose="api.read", target="https://api.example.com", now=202,
        )
    assert inactive.value.code == "credential_lease_consumed"


def test_concurrent_credential_consumers_have_one_winner(tmp_path: Path) -> None:
    broker = CredentialBroker(tmp_path / "security.sqlite3", lambda _ref: "secret")
    active_profile = credential_profile()
    lease = broker.issue(
        run_id="run-1", profile=active_profile, credential_ref="credential-ref-1",
        purpose="api.read", target="https://api.example.com", now=100,
    )

    def consume() -> str:
        try:
            material = broker.consume(
                lease.lease_id, run_id="run-1", profile=active_profile,
                purpose="api.read", target="https://api.example.com", now=101,
            )
            material.close()
            return "consumed"
        except CredentialBrokerError as error:
            return error.code

    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as executor:
        results = list(executor.map(lambda _: consume(), range(12)))
    assert results.count("consumed") == 1
    assert results.count("credential_lease_consumed") == 11
