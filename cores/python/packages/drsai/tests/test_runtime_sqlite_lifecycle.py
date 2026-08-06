from __future__ import annotations

from types import SimpleNamespace

from drsai.backend.runtime.artifacts import RuntimeArtifactStore
from drsai.backend.runtime.experiment_export import _connect as connect_experiment_export
from drsai.backend.runtime.migrations import LegacySessionMigrator
from drsai.backend.runtime.observability import RuntimeObservability
from drsai.backend.runtime.security import ApprovalRegistry, AuditLog, WorkspacePermissionStore


def test_runtime_stores_release_sqlite_file_handles_after_each_operation(tmp_path) -> None:
    """The Runtime must not retain SQLite handles that block cleanup or updates on Windows."""
    database = tmp_path / "runtime.sqlite3"

    RuntimeObservability(database)
    RuntimeArtifactStore(database, lambda _workspace_id: tmp_path)
    LegacySessionMigrator(database, object(), object())
    WorkspacePermissionStore(database)
    ApprovalRegistry(database)
    AuditLog(database)
    with connect_experiment_export(SimpleNamespace(database=database)) as connection:
        connection.execute("SELECT 1").fetchone()

    database.unlink()
    assert not database.exists()
