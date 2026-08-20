from __future__ import annotations

from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

import pytest

from drsai.backend.runtime.security_boundary import (
    SimulatedIsolatedSessionCrash,
    WindowsAclProjectionService,
    WindowsAppContainerProfileFactory,
    WindowsAppContainerWorkerResult,
    WindowsIsolatedExecutionSessionService,
    WindowsIsolatedSessionError,
)


class FakeProfileApi:
    def __init__(self, log: list[str]):
        self.log = log
        self.existing: set[str] = set()
        self.next_sid = 1000

    def create_profile(self, name: str) -> tuple[int, int]:
        self.log.append(f"profile.create:{name}")
        self.existing.add(name)
        self.next_sid += 1
        return 0, self.next_sid

    def delete_profile(self, name: str) -> int:
        self.log.append(f"profile.delete:{name}")
        if name not in self.existing:
            return -2147024894  # 0x80070002
        self.existing.remove(name)
        return 0

    def free_sid(self, sid: int) -> None:
        self.log.append(f"sid.free:{sid}")

    def sid_to_string(self, sid: int) -> str:
        return f"S-1-15-2-{sid}"


class FakeAclApi:
    def __init__(self, log: list[str]):
        self.log = log
        self.values: dict[str, str] = {}

    def snapshot(self, path: Path) -> str:
        return self.values.setdefault(str(path), f"original:{path.name}")

    def grant(self, path: Path, sid: str, *, writable: bool, directory: bool) -> None:
        self.log.append(f"acl.grant:{path.name}")
        self.values[str(path)] = f"grant:{sid}"

    def restore(self, path: Path, sddl: str) -> None:
        self.log.append(f"acl.restore:{path.name}")
        self.values[str(path)] = sddl

    def remove_sid(self, path: Path, sid: str) -> None:
        self.log.append(f"acl.remove:{path.name}")


class FakeWorker:
    def __init__(self, log: list[str], error: Exception | None = None, *, empty_verified: bool = True):
        self.log = log
        self.error = error
        self.calls = 0
        self.empty_verified = empty_verified
        self.job_names: list[str | None] = []

    def run(self, profile, argv, *, cwd, environment, timeout_seconds, job_name=None):
        self.calls += 1
        self.job_names.append(job_name)
        self.log.append("worker.run")
        if self.error:
            raise self.error
        return WindowsAppContainerWorkerResult(123, 0, "succeeded", self.empty_verified)


def make_service(
    tmp_path: Path, log: list[str], *, phase_hook=None, worker_error: Exception | None = None,
    profile_api: FakeProfileApi | None = None, acl_api: FakeAclApi | None = None,
    clock=lambda: 100, owner_id: str | None = None,
    empty_verified: bool = True,
    job_recovery=lambda _name: False,
    authority_revoker=None,
):
    database = tmp_path / "security.sqlite3"
    profile_api = profile_api or FakeProfileApi(log)
    acl_api = acl_api or FakeAclApi(log)
    worker = FakeWorker(log, worker_error, empty_verified=empty_verified)
    return (
        WindowsIsolatedExecutionSessionService(
            database,
            profiles=WindowsAppContainerProfileFactory(profile_api),
            projections=WindowsAclProjectionService(database, acl_api),
            workers=worker,
            clock=clock,
            phase_hook=phase_hook,
            owner_id=owner_id,
            job_recovery=job_recovery,
            authority_revoker=authority_revoker,
        ),
        profile_api,
        acl_api,
        worker,
    )


def request(root: Path) -> dict:
    return {
        "execution_id": "execution-1", "run_id": "run-1",
        "argv": ("worker.exe", "--safe"), "cwd": root,
        "environment": {"TOKEN": "secret-canary"},
        "timeout_seconds": 10, "writable": True,
    }


def test_successful_session_orders_authority_before_worker_and_revokes_before_delete(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    (root / "file.txt").write_text("content", encoding="utf-8")
    log: list[str] = []
    service, profiles, _acl, worker = make_service(tmp_path, log)
    session = service.execute(**request(root))
    assert session.state == "completed"
    assert session.worker_status == "succeeded" and session.worker_exit_code == 0
    assert worker.calls == 1 and profiles.existing == set()
    assert worker.job_names == [session.job_name]
    assert session.job_name.startswith("Local\\OpenDrSai.Job.")
    create_index = next(index for index, value in enumerate(log) if value.startswith("profile.create"))
    grant_index = next(index for index, value in enumerate(log) if value.startswith("acl.grant"))
    worker_index = log.index("worker.run")
    restore_index = next(index for index, value in enumerate(log) if value.startswith("acl.restore"))
    delete_index = next(index for index, value in enumerate(log) if value.startswith("profile.delete"))
    assert create_index < grant_index < worker_index < restore_index < delete_index
    assert service.execute(**request(root)) == session
    assert worker.calls == 1
    assert "secret-canary" not in (tmp_path / "security.sqlite3").read_bytes().decode(errors="ignore")


def test_successful_worker_revokes_runtime_authority_before_terminal_cleanup(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    log: list[str] = []
    revoked: list[tuple[str, str]] = []
    service, _profiles, _acl, _worker = make_service(
        tmp_path,
        log,
        authority_revoker=lambda run_id, reason: revoked.append((run_id, reason)) or 1,
    )
    session = service.execute(**request(root))
    assert revoked == [("run-1", "worker_terminal")]
    assert service.execute(**request(root)) == session
    assert revoked == [("run-1", "worker_terminal")]
    events = []
    with service._connect() as db:
        events = [
            (str(row["state"]), str(row["detail"]))
            for row in db.execute(
                "SELECT state,detail FROM runtime_windows_isolated_session_events "
                "WHERE session_id=? ORDER BY sequence",
                (session.session_id,),
            )
        ]
    revoke_index = events.index(("worker_starting", "authority_revoked:worker_terminal"))
    terminal_index = next(index for index, event in enumerate(events) if event[0] == "worker_terminal")
    assert revoke_index < terminal_index


def test_authority_revocation_failure_cannot_report_session_completed(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    log: list[str] = []

    def fail_revocation(_run_id: str, _reason: str) -> int:
        raise RuntimeError("database unavailable")

    service, profiles, _acl, _worker = make_service(
        tmp_path,
        log,
        authority_revoker=fail_revocation,
    )
    with pytest.raises(WindowsIsolatedSessionError) as rejected:
        service.execute(**request(root))
    assert rejected.value.code == "isolated_session_cleanup_failed"
    session = service._by_execution("execution-1")
    assert session is not None and session.state == "cleanup_failed"
    assert profiles.existing == set()
    assert service.projections.find_unrevoked_for_profile(session.profile_name) is None


@pytest.mark.parametrize(
    "phase",
    [
        "profile_prepared", "profile_created", "acl_active", "worker_starting",
        "worker_terminal", "acl_revoked", "profile_deleted",
    ],
)
def test_every_durable_phase_recovers_without_profile_or_acl_authority(tmp_path: Path, phase: str) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    (root / "file.txt").write_text("content", encoding="utf-8")
    log: list[str] = []

    def crash(current: str, _session) -> None:
        if current == phase:
            raise SimulatedIsolatedSessionCrash(current)

    service, profiles, acl, _worker = make_service(tmp_path, log, phase_hook=crash)
    with pytest.raises(SimulatedIsolatedSessionCrash):
        service.execute(**request(root))

    recovery, _, _, _ = make_service(
        tmp_path, log, profile_api=profiles, acl_api=acl, clock=lambda: 200,
    )
    sessions = recovery.recover_incomplete()
    assert len(sessions) == 1
    if phase == "worker_starting":
        assert sessions[0].state == "quarantined"
        assert sessions[0].worker_status == "outcome_unknown"
        assert profiles.existing
        assert recovery.projections.find_unrevoked_for_profile(sessions[0].profile_name) is not None
    else:
        assert sessions[0].state == "recovered"
        assert profiles.existing == set()
        assert recovery.projections.find_unrevoked_for_profile(sessions[0].profile_name) is None
    assert recovery.recover_incomplete() == []


def test_worker_failure_cleans_authority_and_is_durably_terminal(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    log: list[str] = []
    service, profiles, _acl, _worker = make_service(
        tmp_path, log, worker_error=RuntimeError("worker failed"),
    )
    with pytest.raises(RuntimeError, match="worker failed"):
        service.execute(**request(root))
    session = service._by_execution("execution-1")
    assert session is not None and session.state == "failed_cleaned"
    assert profiles.existing == set()
    assert service.recover_incomplete() == []


def test_worker_failure_and_startup_recovery_revoke_runtime_authority(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    log: list[str] = []
    revoked: list[tuple[str, str]] = []
    failed, profiles, acl, _worker = make_service(
        tmp_path,
        log,
        worker_error=RuntimeError("worker failed"),
        authority_revoker=lambda run_id, reason: revoked.append((run_id, reason)) or 1,
    )
    with pytest.raises(RuntimeError, match="worker failed"):
        failed.execute(**request(root))
    assert revoked == [("run-1", "isolated_session_failed")]

    second_root = tmp_path / "workspace-two"
    second_root.mkdir()

    def crash(phase: str, _session) -> None:
        if phase == "profile_created":
            raise SimulatedIsolatedSessionCrash()

    owner, profiles, acl, _worker = make_service(
        tmp_path,
        log,
        phase_hook=crash,
        profile_api=profiles,
        acl_api=acl,
        owner_id="crashed-owner",
        authority_revoker=lambda run_id, reason: revoked.append((run_id, reason)) or 1,
    )
    recovery_request = request(second_root)
    recovery_request["execution_id"] = "execution-recovery"
    with pytest.raises(SimulatedIsolatedSessionCrash):
        owner.execute(**recovery_request)
    recovery, _, _, _ = make_service(
        tmp_path,
        log,
        profile_api=profiles,
        acl_api=acl,
        clock=lambda: 200,
        owner_id="recovery-owner",
        authority_revoker=lambda run_id, reason: revoked.append((run_id, reason)) or 1,
    )
    assert recovery.recover_incomplete()[0].state == "recovered"
    assert revoked[-1] == ("run-1", "runtime_interrupted")


def test_unfinished_execution_rejects_retry_and_scope_reuse(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    log: list[str] = []

    def crash(phase: str, _session) -> None:
        if phase == "profile_prepared":
            raise SimulatedIsolatedSessionCrash()

    service, _profiles, _acl, _worker = make_service(tmp_path, log, phase_hook=crash)
    with pytest.raises(SimulatedIsolatedSessionCrash):
        service.execute(**request(root))
    service.phase_hook = None
    with pytest.raises(WindowsIsolatedSessionError) as in_progress:
        service.execute(**request(root))
    assert in_progress.value.code == "isolated_session_in_progress"
    changed = request(root)
    changed["argv"] = ("different.exe",)
    with pytest.raises(WindowsIsolatedSessionError) as mismatch:
        service.execute(**changed)
    assert mismatch.value.code == "isolated_session_scope_mismatch"


def test_live_lease_blocks_recovery_heartbeat_extends_it_and_expired_owner_loses_write(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    log: list[str] = []
    now = [100.0]

    def crash(phase: str, _session) -> None:
        if phase == "profile_created":
            raise SimulatedIsolatedSessionCrash()

    owner, profiles, acl, _ = make_service(
        tmp_path, log, phase_hook=crash, clock=lambda: now[0], owner_id="owner-a",
    )
    with pytest.raises(SimulatedIsolatedSessionCrash):
        owner.execute(**request(root))
    session = owner._by_execution("execution-1")
    assert session is not None and session.lease_expires_at == 130

    contender, _, _, _ = make_service(
        tmp_path, log, profile_api=profiles, acl_api=acl,
        clock=lambda: now[0], owner_id="owner-b",
    )
    assert contender.recover_incomplete() == []
    now[0] = 120
    owner.phase_hook = None
    assert owner.heartbeat(session.session_id).lease_expires_at == 150
    now[0] = 140
    assert contender.recover_incomplete() == []
    now[0] = 151
    assert contender.recover_incomplete()[0].state == "recovered"
    with pytest.raises(WindowsIsolatedSessionError) as lost:
        owner._transition(session.session_id, "stale_owner_write")
    assert lost.value.code == "isolated_session_lease_lost"


def test_two_recovery_owners_atomically_claim_expired_session_once(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    log: list[str] = []

    def crash(phase: str, _session) -> None:
        if phase == "profile_created":
            raise SimulatedIsolatedSessionCrash()

    owner, profiles, acl, _ = make_service(tmp_path, log, phase_hook=crash, owner_id="owner-a")
    with pytest.raises(SimulatedIsolatedSessionCrash):
        owner.execute(**request(root))
    contenders = [
        make_service(
            tmp_path, log, profile_api=profiles, acl_api=acl,
            clock=lambda: 200, owner_id=f"recovery-{index}",
        )[0]
        for index in range(2)
    ]
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda service: service.recover_incomplete(), contenders))
    assert sum(len(result) for result in results) == 1
    assert profiles.existing == set()


def test_acl_is_never_revoked_without_job_empty_proof(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    log: list[str] = []
    service, profiles, _acl, _ = make_service(tmp_path, log, empty_verified=False)
    with pytest.raises(WindowsIsolatedSessionError) as rejected:
        service.execute(**request(root))
    assert rejected.value.code == "isolated_job_empty_unverified"
    session = service._by_execution("execution-1")
    assert session is not None and session.state == "quarantined"
    assert profiles.existing
    assert service.projections.find_unrevoked_for_profile(session.profile_name) is not None


def test_quarantine_revokes_runtime_authority_even_while_acl_is_retained(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    log: list[str] = []
    revoked: list[tuple[str, str]] = []
    service, profiles, _acl, _worker = make_service(
        tmp_path,
        log,
        empty_verified=False,
        authority_revoker=lambda run_id, reason: revoked.append((run_id, reason)) or 1,
    )
    with pytest.raises(WindowsIsolatedSessionError) as rejected:
        service.execute(**request(root))
    assert rejected.value.code == "isolated_job_empty_unverified"
    assert revoked == [("run-1", "isolated_session_failed")]
    session = service._by_execution("execution-1")
    assert session is not None and session.state == "quarantined"
    assert profiles.existing
    assert service.projections.find_unrevoked_for_profile(session.profile_name) is not None


def test_named_job_absence_proves_crash_cleanup_and_allows_recovery(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    log: list[str] = []

    def crash(phase: str, _session) -> None:
        if phase == "worker_starting":
            raise SimulatedIsolatedSessionCrash()

    owner, profiles, acl, _ = make_service(tmp_path, log, phase_hook=crash)
    with pytest.raises(SimulatedIsolatedSessionCrash):
        owner.execute(**request(root))
    recovery, _, _, _ = make_service(
        tmp_path, log, profile_api=profiles, acl_api=acl, clock=lambda: 200,
        job_recovery=lambda _name: True,
    )
    recovered = recovery.recover_incomplete()
    assert len(recovered) == 1 and recovered[0].state == "recovered"
    assert recovered[0].job_empty_verified is True
    assert profiles.existing == set()


def test_quarantine_resolution_requires_expired_claim_and_fresh_job_empty_proof(tmp_path: Path) -> None:
    root = tmp_path / "workspace"
    root.mkdir()
    log: list[str] = []

    def crash(phase: str, _session) -> None:
        if phase == "worker_starting":
            raise SimulatedIsolatedSessionCrash()

    owner, profiles, acl, _ = make_service(tmp_path, log, phase_hook=crash)
    with pytest.raises(SimulatedIsolatedSessionCrash):
        owner.execute(**request(root))
    quarantine, _, _, _ = make_service(
        tmp_path, log, profile_api=profiles, acl_api=acl, clock=lambda: 200,
        owner_id="quarantine-owner", job_recovery=lambda _name: False,
    )
    quarantined = quarantine.recover_incomplete()[0]
    assert quarantined.state == "quarantined" and quarantined.lease_expires_at == 230
    with pytest.raises(WindowsIsolatedSessionError) as active:
        quarantine.resolve_quarantined(quarantined.session_id)
    assert active.value.code == "isolated_quarantine_claim_denied"

    still_active, _, _, _ = make_service(
        tmp_path, log, profile_api=profiles, acl_api=acl, clock=lambda: 231,
        owner_id="resolver-one", job_recovery=lambda _name: False,
    )
    retained = still_active.resolve_quarantined(quarantined.session_id)
    assert retained.state == "quarantined" and profiles.existing

    resolved, _, _, _ = make_service(
        tmp_path, log, profile_api=profiles, acl_api=acl, clock=lambda: 262,
        owner_id="resolver-two", job_recovery=lambda _name: True,
    )
    result = resolved.resolve_quarantined(quarantined.session_id)
    assert result.state == "recovered" and result.job_empty_verified is True
    assert result.worker_status == "outcome_unknown"
    assert profiles.existing == set()
    assert resolved.projections.find_unrevoked_for_profile(result.profile_name) is None
