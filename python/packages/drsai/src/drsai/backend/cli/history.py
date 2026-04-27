"""Thread-backed session store for the drsai CLI.

Wraps the existing :class:`DatabaseManager` + :class:`Thread` schema so the
REPL can list, resume, rename, and search conversation sessions without a
separate ``cli_sessions.json`` file. One-time migration imports any legacy
JSON entries into ``Thread.meta['name']``.
"""

from __future__ import annotations

import uuid
from typing import Any, Optional

from drsai.modules.managers.database import DatabaseManager
from drsai.modules.managers.datamodel.db import Thread
from drsai.modules.agents.skills_agent.drsai_cli_assistant import (
    SessionInfo,
    _thread_to_info,
)

from . import config as cli_config

__all__ = ["CLISessionStore"]


class CLISessionStore:
    """All session I/O the CLI needs, keyed by ``(user_id, thread_id)``."""

    def __init__(self, db_manager: DatabaseManager, user_id: str) -> None:
        self._db = db_manager
        self._user_id = user_id
        self._legacy_migrated = False

    # ── Discovery ───────────────────────────────────────────────────────────
    def list(self, limit: int = 50) -> list[SessionInfo]:
        """Return recent Threads, newest first."""
        self._ensure_legacy_migrated()
        resp = self._db.get(
            Thread,
            filters={"user_id": self._user_id},
            order="desc",
            return_json=False,
        )
        if not resp.status or not resp.data:
            return []
        return [_thread_to_info(row) for row in resp.data[:limit]]

    def load(self, thread_id: str) -> list[dict[str, Any]]:
        """Return the raw ``Thread.messages`` list (or empty)."""
        row = self._get(thread_id)
        if row is None:
            return []
        return list(row.messages or [])

    def search(self, query: str, limit: int = 20) -> list[SessionInfo]:
        if not query:
            return []
        needle = query.lower()
        seen: set[str] = set()
        out: list[SessionInfo] = []
        for info in self.list(limit=500):
            blob = f"{info.name}\n{info.preview}".lower()
            if needle in blob:
                out.append(info)
                seen.add(info.thread_id)
                if len(out) >= limit:
                    return out
        # Deep scan for misses — reads full message JSON.
        import json as _json
        for info in self.list(limit=500):
            if info.thread_id in seen:
                continue
            row = self._get(info.thread_id)
            if row is None:
                continue
            try:
                blob = _json.dumps(row.messages or [], ensure_ascii=False).lower()
            except Exception:
                continue
            if needle in blob:
                out.append(_thread_to_info(row))
                if len(out) >= limit:
                    break
        return out

    # ── Mutation ────────────────────────────────────────────────────────────
    def create(self, name: Optional[str] = None, workdir: Optional[str] = None) -> str:
        """Create an empty Thread and return its id."""
        thread_id = str(uuid.uuid4())
        meta: dict[str, Any] = {}
        if name:
            meta["name"] = name
        if workdir:
            meta["workdir"] = workdir
        row = Thread(
            user_id=self._user_id,
            thread_id=thread_id,
            messages=[],
            meta=meta if meta else None,
        )
        self._db.upsert(row, return_json=False)
        return thread_id

    def get_by_workdir(self, workdir: str) -> Optional[SessionInfo]:
        """Find session by workdir from meta."""
        for info in self.list(limit=500):
            if info.workdir == workdir:
                return info
        return None

    def set_workdir(self, thread_id: str, workdir: str) -> bool:
        """Update session's workdir in meta."""
        row = self._get(thread_id)
        if row is None:
            return False
        meta = dict(row.meta or {})
        meta["workdir"] = workdir
        row.meta = meta
        self._db.upsert(row, return_json=False)
        return True

    def rename(self, thread_id: str, name: str) -> bool:
        row = self._get(thread_id)
        if row is None:
            return False
        meta = dict(row.meta or {})
        meta["name"] = name
        row.meta = meta
        self._db.upsert(row, return_json=False)
        return True

    def resolve(self, token: str) -> Optional[SessionInfo]:
        """Match a user-supplied token against thread_id prefix or name."""
        if not token:
            return None
        for info in self.list(limit=500):
            if info.thread_id.startswith(token) or info.name == token:
                return info
        return None

    # ── Internals ───────────────────────────────────────────────────────────
    def _get(self, thread_id: str) -> Optional[Thread]:
        resp = self._db.get(
            Thread,
            filters={"user_id": self._user_id, "thread_id": thread_id},
            return_json=False,
        )
        if not resp.status or not resp.data:
            return None
        return resp.data[0]

    def _ensure_legacy_migrated(self) -> None:
        if self._legacy_migrated:
            return
        self._legacy_migrated = True
        try:
            legacy = cli_config.load_sessions()
        except Exception:
            return
        if not legacy:
            return
        for sid, info in legacy.items():
            if not isinstance(info, dict):
                continue
            name = info.get("name")
            if not name:
                continue
            existing = self._get(sid)
            if existing is None:
                continue
            meta = dict(existing.meta or {})
            if meta.get("name"):
                continue
            meta["name"] = name
            existing.meta = meta
            try:
                self._db.upsert(existing, return_json=False)
            except Exception:
                continue
