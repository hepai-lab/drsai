"""Durable, content-free device attribution for user-readable audit rows."""
from __future__ import annotations

from dataclasses import dataclass
from contextlib import contextmanager
import hashlib
import sqlite3
import threading
import time
from pathlib import Path


@dataclass(frozen=True)
class DeviceActionKey:
    runtime_id: str
    workspace_id: str
    run_id: str
    action: str


class DeviceActionAudit:
    def __init__(self, capacity: int = 10_000, path: Path | None = None) -> None:
        if capacity < 1:
            raise ValueError("device_audit_capacity_invalid")
        self.capacity = capacity
        self._path = path
        self._memory_connection = sqlite3.connect(":memory:", check_same_thread=False) if path is None else None
        self._lock = threading.RLock()
        with self._connect() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS device_action_audit (
                runtime_id TEXT NOT NULL, workspace_id TEXT NOT NULL, run_id TEXT NOT NULL,
                action TEXT NOT NULL, actor_digest TEXT NOT NULL, recorded_at REAL NOT NULL,
                PRIMARY KEY(runtime_id,workspace_id,run_id,action)
            )""")

    @contextmanager
    def _connect(self):
        if self._memory_connection is not None:
            yield self._memory_connection
            self._memory_connection.commit()
            return
        assert self._path is not None
        db = sqlite3.connect(self._path, timeout=5)
        try:
            yield db
            db.commit()
        finally:
            db.close()

    @staticmethod
    def _values(key: DeviceActionKey) -> tuple[str, str, str, str]:
        return key.runtime_id, key.workspace_id, key.run_id, key.action

    @staticmethod
    def _digest(value: str) -> str:
        return hashlib.sha256(value.encode()).hexdigest()

    def record(self, key: DeviceActionKey, device_id: str | None) -> None:
        if not device_id:
            return
        with self._lock, self._connect() as db:
            db.execute("""INSERT INTO device_action_audit
                (runtime_id,workspace_id,run_id,action,actor_digest,recorded_at)
                VALUES(?,?,?,?,?,?) ON CONFLICT(runtime_id,workspace_id,run_id,action)
                DO UPDATE SET actor_digest=excluded.actor_digest,recorded_at=excluded.recorded_at""",
                (*self._values(key), self._digest(device_id), time.time()))
            db.execute("""DELETE FROM device_action_audit WHERE rowid IN (
                SELECT rowid FROM device_action_audit ORDER BY recorded_at DESC,rowid DESC
                LIMIT -1 OFFSET ?
            )""", (self.capacity,))

    def label(self, key: DeviceActionKey, current_device_id: str | None) -> str:
        with self._lock, self._connect() as db:
            row = db.execute("""SELECT actor_digest FROM device_action_audit
                WHERE runtime_id=? AND workspace_id=? AND run_id=? AND action=?""",
                self._values(key)).fetchone()
        if row is None or current_device_id is None:
            return "已授权设备"
        return "此设备" if row[0] == self._digest(current_device_id) else "另一台已授权设备"

    def close(self) -> None:
        with self._lock:
            if self._memory_connection is not None:
                self._memory_connection.close()
                self._memory_connection = None
