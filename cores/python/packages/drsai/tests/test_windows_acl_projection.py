from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest

from drsai.backend.runtime.security_boundary import (
    NativeWindowsAclApi,
    WindowsAclProjectionError,
    WindowsAclProjectionService,
)


class FakeAclApi:
    def __init__(self):
        self.values: dict[str, str] = {}
        self.grants: list[str] = []
        self.restores: list[str] = []
        self.fail_restore: set[str] = set()
        self.removals: list[str] = []

    @staticmethod
    def key(path: Path) -> str:
        return str(path)

    def snapshot(self, path: Path) -> str:
        return self.values.setdefault(self.key(path), f"original:{path.name}")

    def grant(self, path: Path, sid: str, *, writable: bool, directory: bool) -> None:
        key = self.key(path)
        self.values[key] = f"grant:{sid}:{writable}:{directory}"
        self.grants.append(key)

    def restore(self, path: Path, sddl: str) -> None:
        key = self.key(path)
        if key in self.fail_restore:
            raise OSError("injected restore failure")
        self.values[key] = sddl
        self.restores.append(key)

    def remove_sid(self, path: Path, sid: str) -> None:
        key = self.key(path)
        self.values[key] = f"sid-removed:{sid}"
        self.removals.append(key)


def workspace(tmp_path: Path) -> Path:
    root = tmp_path / "workspace"
    (root / "nested").mkdir(parents=True)
    (root / "nested" / "file.txt").write_text("content", encoding="utf-8")
    return root


def test_projection_journals_every_object_and_revoke_restores_in_reverse(tmp_path: Path) -> None:
    root, api = workspace(tmp_path), FakeAclApi()
    service = WindowsAclProjectionService(tmp_path / "security.sqlite3", api, clock=lambda: 100)
    projection = service.create(
        run_id="run-1", profile_name="profile-1", sid="S-1-15-2-123", root=root, writable=True,
    )
    assert projection.status == "active"
    assert projection.item_count == projection.applied_count == 3
    assert len(api.grants) == 3

    revoked = service.revoke(projection.projection_id)
    assert revoked.status == "revoked"
    assert revoked.restored_count == 3
    assert api.restores == api.grants
    assert service.revoke(projection.projection_id) == revoked


def test_fault_after_os_grant_restores_prepared_item_and_prior_items(tmp_path: Path) -> None:
    root, api = workspace(tmp_path), FakeAclApi()
    service = WindowsAclProjectionService(tmp_path / "security.sqlite3", api)
    with pytest.raises(RuntimeError, match="injected_acl_projection_fault"):
        service.create(
            run_id="run-fault", profile_name="profile-fault", sid="S-1-15-2-456",
            root=root, writable=False, fault_after_apply=2,
        )
    with service._connect() as database:
        row = database.execute("SELECT projection_id FROM runtime_acl_projections").fetchone()
    recovered = service.get(str(row["projection_id"]))
    assert recovered.status == "revoked"
    assert recovered.item_count == recovered.restored_count == 3
    assert len(api.grants) == 2 and len(api.restores) == 3


def test_restore_failure_is_durable_and_retryable_after_restart(tmp_path: Path) -> None:
    root, api = workspace(tmp_path), FakeAclApi()
    database = tmp_path / "security.sqlite3"
    service = WindowsAclProjectionService(database, api)
    projection = service.create(
        run_id="run-retry", profile_name="profile-retry", sid="S-1-15-2-789", root=root, writable=True,
    )
    failing = api.grants[0]
    api.fail_restore.add(failing)
    with pytest.raises(WindowsAclProjectionError) as rejected:
        service.revoke(projection.projection_id)
    assert rejected.value.code == "acl_restore_failed"
    assert service.get(projection.projection_id).status == "rollback_failed"

    api.fail_restore.clear()
    recovered = WindowsAclProjectionService(database, api).recover_incomplete()
    assert len(recovered) == 1 and recovered[0].status == "revoked"
    assert recovered[0].restored_count == recovered[0].item_count


def test_changed_object_identity_is_not_overwritten_with_stale_acl(tmp_path: Path) -> None:
    root, api = workspace(tmp_path), FakeAclApi()
    service = WindowsAclProjectionService(tmp_path / "security.sqlite3", api)
    projection = service.create(
        run_id="run-swap", profile_name="profile-swap", sid="S-1-15-2-100", root=root, writable=True,
    )
    target = root / "nested" / "file.txt"
    target.unlink()
    target.write_text("replacement", encoding="utf-8")
    with pytest.raises(WindowsAclProjectionError) as rejected:
        service.revoke(projection.projection_id)
    assert rejected.value.code == "acl_restore_failed"
    assert str(target) not in api.restores
    assert service.get(projection.projection_id).status == "rollback_failed"


def test_objects_created_during_projection_have_unique_sid_removed_and_journaled(tmp_path: Path) -> None:
    root, api = workspace(tmp_path), FakeAclApi()
    service = WindowsAclProjectionService(tmp_path / "security.sqlite3", api)
    projection = service.create(
        run_id="run-new", profile_name="profile-new", sid="S-1-15-2-200", root=root, writable=True,
    )
    created = root / "created-by-worker.txt"
    created.write_text("new", encoding="utf-8")
    revoked = service.revoke(projection.projection_id)
    assert revoked.status == "revoked"
    assert str(created) in api.removals
    assert revoked.item_count == revoked.restored_count == 4


def test_conflict_entry_limit_and_reparse_are_fail_closed(tmp_path: Path) -> None:
    root, api = workspace(tmp_path), FakeAclApi()
    service = WindowsAclProjectionService(tmp_path / "security.sqlite3", api)
    projection = service.create(
        run_id="run-1", profile_name="profile-1", sid="S-1-15-2-1", root=root, writable=True,
    )
    with pytest.raises(WindowsAclProjectionError) as conflict:
        service.create(run_id="run-2", profile_name="profile-2", sid="S-1-15-2-2", root=root, writable=True)
    assert conflict.value.code == "acl_projection_conflict"
    service.revoke(projection.projection_id)

    with pytest.raises(WindowsAclProjectionError) as too_large:
        WindowsAclProjectionService(tmp_path / "small.sqlite3", api, max_entries=2).create(
            run_id="run-3", profile_name="profile-3", sid="S-1-15-2-3", root=root, writable=True,
        )
    assert too_large.value.code == "acl_projection_too_large"

    outside, link = tmp_path / "outside", root / "escape"
    outside.mkdir()
    try:
        link.symlink_to(outside, target_is_directory=True)
    except OSError:
        created = subprocess.run(
            ["cmd.exe", "/d", "/c", "mklink", "/J", str(link), str(outside)],
            capture_output=True,
            check=False,
        )
        if created.returncode:
            pytest.skip("neither symlink nor junction creation is available")
    with pytest.raises(WindowsAclProjectionError) as reparse:
        WindowsAclProjectionService(tmp_path / "reparse.sqlite3", api).create(
            run_id="run-4", profile_name="profile-4", sid="S-1-15-2-4", root=root, writable=True,
        )
    assert reparse.value.code == "acl_reparse_point_denied"


@pytest.mark.skipif(os.name != "nt", reason="real ACL test requires Windows")
def test_native_acl_grant_and_exact_sddl_restore(tmp_path: Path) -> None:
    import win32api
    import win32security

    root = tmp_path / "workspace"
    root.mkdir()
    target = root / "file.txt"
    target.write_text("content", encoding="utf-8")
    account = win32api.GetUserNameEx(2)
    sid, _domain, _kind = win32security.LookupAccountName(None, account)
    sid_string = win32security.ConvertSidToStringSid(sid)
    api = NativeWindowsAclApi()
    originals = {str(path): api.snapshot(path) for path in (root, target)}
    service = WindowsAclProjectionService(tmp_path / "security.sqlite3", api)

    projection = service.create(
        run_id="run-real", profile_name="profile-real", sid=sid_string, root=root, writable=True,
    )
    assert sid_string in api.snapshot(root)
    service.revoke(projection.projection_id)
    assert {str(path): api.snapshot(path) for path in (root, target)} == originals


@pytest.mark.skipif(os.name != "nt", reason="real ACL test requires Windows")
def test_native_acl_revoke_removes_sid_from_files_created_while_active(tmp_path: Path) -> None:
    import win32api
    import win32security

    root = tmp_path / "workspace"
    root.mkdir()
    account = win32api.GetUserNameEx(2)
    sid, _domain, _kind = win32security.LookupAccountName(None, account)
    sid_string = win32security.ConvertSidToStringSid(sid)
    api = NativeWindowsAclApi()
    service = WindowsAclProjectionService(tmp_path / "security.sqlite3", api)
    projection = service.create(
        run_id="run-new-real", profile_name="profile-new-real", sid=sid_string, root=root, writable=True,
    )
    created = root / "created.txt"
    created.write_text("content", encoding="utf-8")
    service.revoke(projection.projection_id)
    # The current-user SID may already exist in inherited host ACLs, so verify
    # the journal and idempotent removal path rather than claiming global SID absence.
    with service._connect() as database:
        row = database.execute(
            "SELECT state,original_sddl FROM runtime_acl_projection_items WHERE projection_id=? AND relative_path='created.txt'",
            (projection.projection_id,),
        ).fetchone()
    assert tuple(row) == ("restored", "")
