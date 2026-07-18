import sqlite3
from pathlib import Path

import pytest

from drsai.backend.runtime_engine import RuntimeEngine, RuntimeEngineIdentity
from drsai.backend.runtime_migrations import LegacySessionMigrator
from drsai.backend.runtime_registry import RuntimeRegistry


def build(tmp_path: Path):
    database = tmp_path / "runtime.sqlite3"
    registry = RuntimeRegistry(database)
    engine = RuntimeEngine(database, RuntimeEngineIdentity(registry.identity.runtime_id, registry.identity.instance_id), lambda workspace_id: bool(registry.get_workspace(workspace_id)))
    return registry, engine, LegacySessionMigrator(database, registry, engine)


def test_workdir_migration_is_runtime_scoped_idempotent_and_retains_pending(tmp_path: Path):
    host_a = tmp_path / "host-a" / "home" / "vscode"
    host_a.mkdir(parents=True)
    registry_a, engine_a, migrator_a = build(tmp_path / "a")
    workspace_a = registry_a.open_workspace(str(host_a))
    rows = [
        {"session_id": "legacy-1", "workdir": str(host_a), "title": "matched"},
        {"session_id": "legacy-pending", "workdir": str(tmp_path / "missing"), "title": "pending"},
    ]
    first = migrator_a.migrate(rows)
    second = migrator_a.migrate(rows)
    assert [row["status"] for row in first] == ["migrated", "pending"]
    assert first[0]["session_id"] == second[0]["session_id"]
    assert engine_a.list_sessions(workspace_a.workspace_id)["total"] == 1
    assert migrator_a.list_pending()[0]["legacy_session_id"] == "legacy-pending"

    # A second Runtime may expose a textually similar path, but owns a distinct
    # registry and therefore creates a distinct Runtime-scoped Session identity.
    host_b = tmp_path / "host-b" / "home" / "vscode"
    host_b.mkdir(parents=True)
    registry_b, engine_b, migrator_b = build(tmp_path / "b")
    workspace_b = registry_b.open_workspace(str(host_b))
    migrated_b = migrator_b.migrate([{"session_id": "legacy-1", "workdir": str(host_b)}])[0]
    assert migrated_b["workspace_id"] == workspace_b.workspace_id
    assert migrated_b["session_id"] != first[0]["session_id"]
    assert engine_b.list_sessions(workspace_b.workspace_id)["total"] == 1


def test_migration_failure_leaves_source_and_report_unchanged_then_retries(tmp_path: Path, monkeypatch):
    root = tmp_path / "workspace"
    root.mkdir()
    registry, engine, migrator = build(tmp_path / "runtime")
    registry.open_workspace(str(root))
    source = {"session_id": "legacy-fault", "workdir": str(root), "title": "original"}
    original = dict(source)
    real_import = engine.import_session

    def fail_before_write(*_args, **_kwargs):
        raise sqlite3.OperationalError("injected migration failure")

    monkeypatch.setattr(engine, "import_session", fail_before_write)
    with pytest.raises(sqlite3.OperationalError):
        migrator.migrate([source])
    assert source == original
    assert migrator.list_pending() == []

    monkeypatch.setattr(engine, "import_session", real_import)
    first = migrator.migrate([source])[0]
    second = migrator.migrate([source])[0]
    assert first == second
    assert first["status"] == "migrated"
