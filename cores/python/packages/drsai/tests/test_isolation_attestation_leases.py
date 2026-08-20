from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from drsai.backend.runtime.security_boundary import (
    IsolationAttestation,
    IsolationAttestationLeaseStore,
    ResolvedCapabilityProfile,
    SandboxError,
)


BASE_GUARANTEES = frozenset({
    "non_admin_identity", "process_tree_controlled",
    "filesystem_enforced", "environment_sanitized",
})


def profile(root: Path, *, network_rules=(), credential_refs=frozenset()):
    return ResolvedCapabilityProfile(
        "isolated-profile", 1, str(root),
        frozenset({"filesystem.write", "network.connect", "credential.use"}),
        writable_roots=(str(root),), network_rules=tuple(network_rules),
        credential_refs=frozenset(credential_refs), trusted_workspace=True,
    )


def attestation(*, expires_at=200.0, guarantees=BASE_GUARANTEES):
    return IsolationAttestation(
        "windows-appcontainer-session", "1", "windows", 100, expires_at,
        frozenset(guarantees), "sha256:isolation-evidence",
    )


def test_scoped_lease_rejects_wrong_run_workspace_profile_and_expiry(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    other = tmp_path / "other"
    root.mkdir()
    other.mkdir()
    store = IsolationAttestationLeaseStore(tmp_path / "runtime.sqlite3")
    active = profile(root)
    lease = store.bind("run-1", str(root), active, attestation(), now=101)
    assert lease.status == "active"

    for changes, code in [
        ({"run_id": "run-2"}, "isolation_lease_missing"),
        ({"workspace_root": str(other)}, "isolation_lease_workspace_mismatch"),
        ({"profile_digest": "sha256:other"}, "isolation_lease_missing"),
        ({"attestation_digest": "sha256:other"}, "isolation_lease_missing"),
        ({"now": 200}, "isolation_attestation_expired"),
    ]:
        values = {
            "run_id": "run-1", "workspace_root": str(root),
            "profile_digest": active.digest,
            "attestation_digest": "sha256:isolation-evidence", "now": 102,
        }
        values.update(changes)
        with pytest.raises(SandboxError) as rejected:
            store.assert_active(**values)
        assert rejected.value.code == code


def test_revoke_is_append_only_and_lease_cannot_be_reactivated(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    database = tmp_path / "runtime.sqlite3"
    store = IsolationAttestationLeaseStore(database)
    active = profile(root)
    store.bind("run-1", str(root), active, attestation(), now=101)
    assert store.revoke_run("run-1", reason_code="mode_changed", now=102) == 1
    assert store.revoke_run("run-1", reason_code="retry", now=103) == 0
    with pytest.raises(SandboxError) as revoked:
        store.assert_active(
            "run-1", workspace_root=str(root), profile_digest=active.digest,
            attestation_digest="sha256:isolation-evidence", now=104,
        )
    assert revoked.value.code == "isolation_lease_revoked"
    with pytest.raises(SandboxError) as reactivated:
        store.bind("run-1", str(root), active, attestation(), now=104)
    assert reactivated.value.code == "isolation_lease_revoked"
    with sqlite3.connect(database) as db:
        with pytest.raises(sqlite3.IntegrityError, match="append-only"):
            db.execute("DELETE FROM runtime_isolation_attestation_events")


def test_network_and_credential_scope_require_corresponding_os_guarantees(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    store = IsolationAttestationLeaseStore(tmp_path / "runtime.sqlite3")
    with pytest.raises(SandboxError) as network:
        store.bind(
            "run-network", str(root), profile(root, network_rules=("https://api.example:443",)),
            attestation(), now=101,
        )
    assert network.value.code == "isolation_network_guarantee_missing"
    with pytest.raises(SandboxError) as credential:
        store.bind(
            "run-credential", str(root), profile(root, credential_refs={"credential:api"}),
            attestation(), now=101,
        )
    assert credential.value.code == "isolation_credential_guarantee_missing"

    complete = attestation(guarantees=BASE_GUARANTEES | {
        "network_egress_enforced", "credential_isolated",
    })
    assert store.bind(
        "run-complete", str(root),
        profile(
            root, network_rules=("https://api.example:443",),
            credential_refs={"credential:api"},
        ),
        complete, now=101,
    ).status == "active"


def test_active_full_access_kill_switch_invalidates_liveness_even_before_cleanup(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    database = tmp_path / "runtime.sqlite3"
    store = IsolationAttestationLeaseStore(database)
    active = profile(root)
    store.bind("run-1", str(root), active, attestation(), now=101)
    with sqlite3.connect(database) as db:
        db.execute("""
            CREATE TABLE runtime_permission_kill_switch_events(
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT,switch_name TEXT,
                active INTEGER,reason_code TEXT,actor_kind TEXT,created_at REAL
            )
        """)
        db.execute(
            "INSERT INTO runtime_permission_kill_switch_events(event_id,switch_name,active,reason_code,actor_kind,created_at) "
            "VALUES('kill','isolated_full_access',1,'incident','administrator',102)",
        )
    with pytest.raises(SandboxError) as killed:
        store.assert_active(
            "run-1", workspace_root=str(root), profile_digest=active.digest,
            attestation_digest="sha256:isolation-evidence", now=103,
        )
    assert killed.value.code == "permission_kill_switch_active"


def test_transactional_lease_stage_rolls_back_with_caller_mode_commit(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    database = tmp_path / "runtime.sqlite3"
    store = IsolationAttestationLeaseStore(database)
    active = profile(root)
    with store._connect() as db:
        db.execute("BEGIN IMMEDIATE")
        store.bind_in_transaction(
            db, "run-1", str(root), active, attestation(), now=101,
        )
        assert db.execute(
            "SELECT COUNT(*) FROM runtime_isolation_attestation_leases",
        ).fetchone()[0] == 1
        db.rollback()
    with sqlite3.connect(database) as db:
        assert db.execute(
            "SELECT COUNT(*) FROM runtime_isolation_attestation_leases",
        ).fetchone()[0] == 0
        assert db.execute(
            "SELECT COUNT(*) FROM runtime_isolation_attestation_events",
        ).fetchone()[0] == 0
    assert store.bind("run-1", str(root), active, attestation(), now=101).status == "active"
