from __future__ import annotations

import importlib.util
import subprocess
import sys
import types
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest


BACKEND_ROOT = Path(__file__).resolve().parents[1] / "src" / "drsai" / "backend"
for package_name, package_path in (("drsai", BACKEND_ROOT.parent), ("drsai.backend", BACKEND_ROOT)):
    package = types.ModuleType(package_name)
    package.__path__ = [str(package_path)]
    sys.modules.setdefault(package_name, package)


def load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, BACKEND_ROOT / filename)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


registry_module = load("drsai.backend.runtime_registry", "runtime_registry.py")
service_module = load("drsai.backend.git_worktree_service", "git_worktree_service.py")

RuntimeRegistry = registry_module.RuntimeRegistry
GitWorktreeService = service_module.GitWorktreeService


def git(cwd: Path, *args: str) -> str:
    completed = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True)
    return completed.stdout.strip()


def repository(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir()
    git(repo, "init")
    git(repo, "config", "user.email", "tests@opendrsai.local")
    git(repo, "config", "user.name", "OpenDrSai Tests")
    (repo / "README.md").write_text("base\n", encoding="utf-8")
    git(repo, "add", "README.md")
    git(repo, "commit", "-m", "base")
    return repo


def test_create_real_worktree_is_idempotent_and_registers_execution_workspace(tmp_path: Path) -> None:
    repo = repository(tmp_path)
    registry = RuntimeRegistry(tmp_path / "runtime.sqlite3")
    source = registry.open_workspace(str(repo))
    service = GitWorktreeService(registry, tmp_path / "managed-worktrees")
    created = service.create(source_workspace_id=source.workspace_id, idempotency_key="task-one", intent="Task One")
    repeated = service.create(source_workspace_id=source.workspace_id, idempotency_key="task-one", intent="Task One")
    assert created == repeated
    assert created.status == "active"
    assert created.workspace_id and created.workspace_id != source.workspace_id
    assert Path(created.canonical_path).is_dir()
    assert git(Path(created.canonical_path), "branch", "--show-current") == created.branch
    assert registry.get_workspace(created.workspace_id).path == created.canonical_path


def test_create_records_dirty_source_without_copying_dirty_files(tmp_path: Path) -> None:
    repo = repository(tmp_path)
    (repo / "README.md").write_text("dirty\n", encoding="utf-8")
    registry = RuntimeRegistry(tmp_path / "runtime.sqlite3")
    source = registry.open_workspace(str(repo))
    service = GitWorktreeService(registry, tmp_path / "managed-worktrees")
    created = service.create(source_workspace_id=source.workspace_id, idempotency_key="dirty", intent="dirty source")
    assert created.source_dirty is True
    assert "README.md" in (created.source_status_summary or "")
    assert (Path(created.canonical_path) / "README.md").read_text(encoding="utf-8") == "base\n"


def test_concurrent_create_returns_one_worktree(tmp_path: Path) -> None:
    repo = repository(tmp_path)
    registry = RuntimeRegistry(tmp_path / "runtime.sqlite3")
    source = registry.open_workspace(str(repo))
    service = GitWorktreeService(registry, tmp_path / "managed-worktrees")

    def create(_index: int):
        return service.create(source_workspace_id=source.workspace_id, idempotency_key="concurrent", intent="Concurrent")

    with ThreadPoolExecutor(max_workers=8) as pool:
        records = list(pool.map(create, range(20)))
    assert len({record.worktree_id for record in records}) == 1
    assert len(registry.list_worktrees()) == 1


def test_reconcile_recovers_response_lost_and_reports_missing_orphaned(tmp_path: Path) -> None:
    repo = repository(tmp_path)
    registry = RuntimeRegistry(tmp_path / "runtime.sqlite3")
    source = registry.open_workspace(str(repo))
    root = tmp_path / "managed-worktrees"
    service = GitWorktreeService(registry, root)
    reserved = registry.reserve_worktree(
        source_workspace_id=source.workspace_id,
        idempotency_key="lost-response",
        repo_root=str(repo),
        canonical_path=str(root / "lost-response"),
        branch="opendrsai/worktree/lost-response",
        base_commit=git(repo, "rev-parse", "HEAD"),
        location="local",
    )
    root.mkdir()
    git(repo, "worktree", "add", "-b", reserved.branch, reserved.canonical_path, reserved.base_commit)
    orphan = root / "orphan"
    git(repo, "worktree", "add", "-b", "opendrsai/worktree/orphan", str(orphan), reserved.base_commit)
    report = service.reconcile(source_workspace_id=source.workspace_id)
    assert report.recovered == (reserved.worktree_id,)
    assert str(orphan.resolve()) in report.orphaned_paths
    assert registry.get_worktree(reserved.worktree_id).status == "active"

    subprocess.run(["git", "worktree", "remove", "--force", reserved.canonical_path], cwd=repo, check=True)
    report = service.reconcile(source_workspace_id=source.workspace_id)
    assert reserved.worktree_id in report.missing
    assert registry.get_worktree(reserved.worktree_id).last_error_code == "worktree_missing"


def test_preflight_rejects_non_git_and_existing_target(tmp_path: Path) -> None:
    plain = tmp_path / "plain"
    plain.mkdir()
    registry = RuntimeRegistry(tmp_path / "runtime.sqlite3")
    source = registry.open_workspace(str(plain))
    service = GitWorktreeService(registry, tmp_path / "managed-worktrees")
    with pytest.raises(service_module.GitWorktreeError) as caught:
        service.create(source_workspace_id=source.workspace_id, idempotency_key="plain", intent="plain")
    assert caught.value.code == "workspace_not_git"


def test_merge_and_remove_merged_worktree_are_safe(tmp_path: Path) -> None:
    repo = repository(tmp_path)
    registry = RuntimeRegistry(tmp_path / "runtime.sqlite3")
    source = registry.open_workspace(str(repo))
    service = GitWorktreeService(registry, tmp_path / "managed-worktrees")
    created = service.create(source_workspace_id=source.workspace_id, idempotency_key="merge", intent="merge")
    derived = Path(created.canonical_path)
    (derived / "feature.txt").write_text("feature\n", encoding="utf-8")
    git(derived, "add", "feature.txt")
    git(derived, "commit", "-m", "feature")
    head = git(derived, "rev-parse", "HEAD")
    merged = service.merge(source.workspace_id, created.worktree_id, expected_head=head)
    assert service.merge(source.workspace_id, created.worktree_id, expected_head=head).status == "merged"
    assert merged.status == "merged"
    assert (repo / "feature.txt").read_text(encoding="utf-8") == "feature\n"
    removed = service.remove(source.workspace_id, merged.worktree_id, expected_status="merged")
    assert service.remove(source.workspace_id, merged.worktree_id, expected_status="merged").status == "removed"
    assert removed.status == "removed"
    assert not derived.exists()
    assert registry.get_workspace(created.workspace_id) is None
    branches = git(repo, "branch", "--format=%(refname:short)").splitlines()
    assert created.branch not in branches


def test_archive_preserves_unmerged_branch_after_worktree_removal(tmp_path: Path) -> None:
    repo = repository(tmp_path)
    registry = RuntimeRegistry(tmp_path / "runtime.sqlite3")
    source = registry.open_workspace(str(repo))
    service = GitWorktreeService(registry, tmp_path / "managed-worktrees")
    created = service.create(source_workspace_id=source.workspace_id, idempotency_key="archive", intent="archive")
    derived = Path(created.canonical_path)
    (derived / "unmerged.txt").write_text("retain\n", encoding="utf-8")
    git(derived, "add", "unmerged.txt")
    git(derived, "commit", "-m", "retain unmerged")
    archived = service.archive(source.workspace_id, created.worktree_id)
    assert service.archive(source.workspace_id, created.worktree_id).status == "archived"
    assert archived.status == "archived"
    assert archived.branch.startswith("opendrsai/archive/")
    removed = service.remove(source.workspace_id, archived.worktree_id, expected_status="archived")
    assert removed.status == "removed"
    assert not derived.exists()
    assert archived.branch in git(repo, "branch", "--format=%(refname:short)").splitlines()


def test_projection_reports_git_divergence_dirty_and_active_resource_counts(tmp_path: Path) -> None:
    repo = repository(tmp_path)
    registry = RuntimeRegistry(tmp_path / "runtime.sqlite3")
    source = registry.open_workspace(str(repo))
    resources = [
        {"kind": "session", "id": "session-1"},
        {"kind": "run", "id": "run-1"},
        {"kind": "terminal", "id": "terminal-1"},
    ]
    service = GitWorktreeService(
        registry, tmp_path / "managed-worktrees", active_resource_probe=lambda _workspace_id: resources,
    )
    created = service.create(source_workspace_id=source.workspace_id, idempotency_key="projection", intent="projection")
    derived = Path(created.canonical_path)
    (derived / "feature.txt").write_text("feature\n", encoding="utf-8")
    git(derived, "add", "feature.txt")
    git(derived, "commit", "-m", "feature")
    (derived / "dirty.txt").write_text("dirty\n", encoding="utf-8")
    projected = service.project(created)
    assert projected["head_commit"] == git(derived, "rev-parse", "HEAD")
    assert projected["dirty"] is True
    assert projected["ahead"] == 1 and projected["behind"] == 0
    assert projected["activity"] == {"sessions": 1, "runs": 1, "terminals": 1, "total": 3}


def test_lifecycle_emits_deduplicated_workspace_events(tmp_path: Path) -> None:
    class Journal:
        def __init__(self):
            self.events = {}
        def append(self, workspace_id, event_type, data, *, dedupe_key=None):
            self.events.setdefault(dedupe_key, (workspace_id, event_type, data))
            return self.events[dedupe_key]

    repo = repository(tmp_path)
    registry = RuntimeRegistry(tmp_path / "runtime.sqlite3")
    source = registry.open_workspace(str(repo))
    journal = Journal()
    service = GitWorktreeService(registry, tmp_path / "managed-worktrees", event_journal=journal)
    created = service.create(source_workspace_id=source.workspace_id, idempotency_key="events", intent="events")
    repeated = service.create(source_workspace_id=source.workspace_id, idempotency_key="events", intent="events")
    assert repeated.worktree_id == created.worktree_id
    assert [event[1] for event in journal.events.values()] == ["worktree.created"]
    archived = service.archive(source.workspace_id, created.worktree_id)
    service.archive(source.workspace_id, created.worktree_id)
    assert archived.status == "archived"
    assert [event[1] for event in journal.events.values()] == [
        "worktree.created", "worktree.archived", "worktree.status_changed",
    ]


def test_adopt_legacy_worktree_is_idempotent_and_failure_preserves_unregistered_path(tmp_path: Path) -> None:
    repo = repository(tmp_path)
    legacy = tmp_path / "legacy-worktree"
    git(repo, "worktree", "add", "-b", "drsai/fork/legacy", str(legacy), "HEAD")
    registry = RuntimeRegistry(tmp_path / "runtime.sqlite3")
    source = registry.open_workspace(str(repo))
    service = GitWorktreeService(registry, tmp_path / "managed-worktrees")
    with pytest.raises(service_module.GitWorktreeError) as mismatch:
        service.adopt(
            source_workspace_id=source.workspace_id, idempotency_key="legacy-thread", canonical_path=str(legacy),
            branch="drsai/fork/wrong", base_ref="HEAD", location="local",
        )
    assert mismatch.value.code == "legacy_worktree_branch_mismatch"
    assert registry.list_worktrees() == [] and legacy.is_dir()
    adopted = service.adopt(
        source_workspace_id=source.workspace_id, idempotency_key="legacy-thread", canonical_path=str(legacy),
        branch="drsai/fork/legacy", base_ref="HEAD", location="local",
    )
    repeated = service.adopt(
        source_workspace_id=source.workspace_id, idempotency_key="legacy-thread", canonical_path=str(legacy),
        branch="drsai/fork/legacy", base_ref="HEAD", location="local",
    )
    assert repeated.worktree_id == adopted.worktree_id
    assert adopted.workspace_id and registry.get_worktree_by_workspace(adopted.workspace_id) == adopted


def test_merge_conflict_is_aborted_and_persisted_as_recoverable_state(tmp_path: Path) -> None:
    repo = repository(tmp_path)
    registry = RuntimeRegistry(tmp_path / "runtime.sqlite3")
    source = registry.open_workspace(str(repo))
    service = GitWorktreeService(registry, tmp_path / "managed-worktrees")
    created = service.create(source_workspace_id=source.workspace_id, idempotency_key="conflict", intent="conflict")
    derived = Path(created.canonical_path)
    (derived / "README.md").write_text("derived\n", encoding="utf-8")
    git(derived, "add", "README.md")
    git(derived, "commit", "-m", "derived change")
    (repo / "README.md").write_text("source\n", encoding="utf-8")
    git(repo, "add", "README.md")
    git(repo, "commit", "-m", "source change")
    pending = service.merge(source.workspace_id, created.worktree_id)
    assert pending.status == "merge_pending"
    assert pending.last_error_code == "worktree_merge_conflict"
    assert git(repo, "status", "--porcelain=v1") == ""
    assert (repo / "README.md").read_text(encoding="utf-8") == "source\n"


def test_remove_rejects_status_change_and_dirty_worktree(tmp_path: Path) -> None:
    repo = repository(tmp_path)
    registry = RuntimeRegistry(tmp_path / "runtime.sqlite3")
    source = registry.open_workspace(str(repo))
    service = GitWorktreeService(registry, tmp_path / "managed-worktrees")
    created = service.create(source_workspace_id=source.workspace_id, idempotency_key="unsafe", intent="unsafe")
    with pytest.raises(service_module.GitWorktreeError) as caught:
        service.remove(source.workspace_id, created.worktree_id, expected_status="merged")
    assert caught.value.code == "worktree_state_conflict"
    (Path(created.canonical_path) / "dirty.txt").write_text("dirty", encoding="utf-8")
    archived = registry.transition_worktree(created.worktree_id, "archived")
    with pytest.raises(service_module.GitWorktreeError) as caught:
        service.remove(source.workspace_id, archived.worktree_id, expected_status="archived")
    assert caught.value.code == "derived_worktree_dirty"


def test_remove_rejects_active_runtime_resources_before_git_side_effect(tmp_path: Path) -> None:
    repo = repository(tmp_path)
    registry = RuntimeRegistry(tmp_path / "runtime.sqlite3")
    source = registry.open_workspace(str(repo))
    active = [{"kind": "run", "id": "run-active"}]
    service = GitWorktreeService(
        registry, tmp_path / "managed-worktrees", active_resource_probe=lambda _workspace_id: active,
    )
    created = service.create(source_workspace_id=source.workspace_id, idempotency_key="active", intent="active")
    archived = service.archive(source.workspace_id, created.worktree_id)
    with pytest.raises(service_module.GitWorktreeError) as caught:
        service.remove(source.workspace_id, archived.worktree_id, expected_status="archived")
    assert caught.value.code == "worktree_active_resources"
    assert caught.value.detail == {"resources": active}
    assert Path(created.canonical_path).is_dir()
    assert registry.get_worktree(created.worktree_id).status == "archived"
    assert registry.get_workspace(created.workspace_id) is None
