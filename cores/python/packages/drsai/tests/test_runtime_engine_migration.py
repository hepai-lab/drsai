"""Regression: legacy runtime_sessions schema (pre remote_worker_id) must auto-migrate.

Guards against migration-order bugs where a CREATE INDEX referencing new columns
runs before the ALTER TABLE ADD COLUMN migration on existing databases.
"""

import sqlite3

import pytest

from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity

LEGACY_TABLE = """
CREATE TABLE runtime_sessions (
  session_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, worktree_id TEXT, title TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0, lifecycle TEXT NOT NULL DEFAULT 'active',
  revision INTEGER NOT NULL DEFAULT 1, agent_definition TEXT, backend_id TEXT,
  model TEXT, reasoning_effort TEXT, plan_mode INTEGER,
  removed_at TEXT, origin_kind TEXT, origin_provider TEXT, origin_binding_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_runtime_sessions_workspace ON runtime_sessions(workspace_id, updated_at DESC);
"""


@pytest.fixture()
def legacy_db(tmp_path):
    db_path = tmp_path / "legacy-engine.sqlite3"
    db = sqlite3.connect(db_path)
    db.executescript(LEGACY_TABLE)
    db.commit()
    db.close()
    return db_path


def test_legacy_schema_migrates_remote_worker_columns(tmp_path, legacy_db):
    db = sqlite3.connect(legacy_db)
    cols = [r[1] for r in db.execute("PRAGMA table_info(runtime_sessions)").fetchall()]
    db.close()
    assert "remote_worker_id" not in cols  # precondition: legacy schema

    engine = RuntimeEngine(
        database=legacy_db,
        identity=RuntimeEngineIdentity(runtime_id="rt-test", instance_id="inst-test"),
        workspace_exists=lambda _wid: True,
    )

    db = sqlite3.connect(legacy_db)
    cols = [r[1] for r in db.execute("PRAGMA table_info(runtime_sessions)").fetchall()]
    indexes = [r[1] for r in db.execute("PRAGMA index_list(runtime_sessions)").fetchall()]
    db.close()

    assert "remote_worker_id" in cols
    assert "remote_worker_name" in cols
    assert "idx_runtime_sessions_remote_worker" in indexes
