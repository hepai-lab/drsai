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
    _extract_messages_from_thread,
    _thread_to_info,
)

from . import config as cli_config

import logging

logger = logging.getLogger(__name__)

__all__ = ["CLISessionStore"]


class CLISessionStore:
    """All session I/O the CLI needs, keyed by ``(user_id, thread_id)``."""

    def __init__(self, db_manager: DatabaseManager, user_id: str) -> None:
        self._db = db_manager
        self._user_id = user_id
        self._legacy_migrated = False

    # ── Discovery ───────────────────────────────────────────────────────────
    def list(self, limit: int = 50) -> list[SessionInfo]:
        """Return recent Threads, newest first (by last activity time)."""
        self._ensure_legacy_migrated()
        resp = self._db.get(
            Thread,
            filters={"user_id": self._user_id},
            order="desc",
            order_by="updated_at",  # Sort by last activity, not creation time
            return_json=False,
        )
        if not resp.status or not resp.data:
            return []
        return [_thread_to_info(row) for row in resp.data[:limit]]

    def load(self, thread_id: str) -> list[dict[str, Any]]:
        """Return conversation messages from Thread (messages or state fallback)."""
        row = self._get(thread_id)
        if row is None:
            return []
        return _extract_messages_from_thread(row)

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
                msgs = _extract_messages_from_thread(row)
                blob = _json.dumps(msgs, ensure_ascii=False).lower()
            except Exception:
                continue
            if needle in blob:
                out.append(_thread_to_info(row))
                if len(out) >= limit:
                    break
        return out

    def smart_search(self, query: str, limit: int = 10, workdir: str | None = None) -> list[SessionInfo]:
        """Semantic + keyword hybrid search across sessions.

        Three-phase approach:
        1. Keyword pre-filter on name + preview (fast, in-memory)
        2. FTS5 search on session messages (medium, uses session_messages_fts)
        3. Composite scoring with time decay + workdir relevance
        """
        if not query:
            return []

        needle = query.lower()
        seen: set[str] = set()
        scored: list[tuple[float, SessionInfo]] = []

        # Phase 1: keyword pre-filter (name + preview + workdir)
        for info in self.list(limit=500):
            if getattr(info, 'archived', False):
                continue
            if workdir and info.workdir != workdir:
                continue
            blob = f"{info.name}\n{info.preview}\n{info.workdir}".lower()
            if needle in blob:
                score = 10.0  # base keyword match score
                # Boost for workdir match
                if workdir and info.workdir == workdir:
                    score += 5.0
                # Boost for name match (more specific)
                if needle in info.name.lower():
                    score += 3.0
                seen.add(info.thread_id)
                scored.append((score, info))

        # Phase 2: FTS5 deep search on message content
        try:
            fts_hits = self._fts_search(query, limit=limit * 2)
            for score_val, info in fts_hits:
                if info.thread_id in seen:
                    # Merge scores
                    for i, (s, existing) in enumerate(scored):
                        if existing.thread_id == info.thread_id:
                            scored[i] = (s + score_val, existing)
                            break
                else:
                    if workdir and info.workdir != workdir:
                        continue
                    if getattr(info, 'archived', False):
                        continue
                    seen.add(info.thread_id)
                    scored.append((score_val, info))
        except Exception:
            logger.exception("FTS search failed, falling back to deep scan")
            # Phase 2 fallback: deep scan messages
            import json as _json
            for info in self.list(limit=500):
                if info.thread_id in seen:
                    continue
                if getattr(info, 'archived', False):
                    continue
                if workdir and info.workdir != workdir:
                    continue
                row = self._get(info.thread_id)
                if row is None:
                    continue
                try:
                    msgs = _extract_messages_from_thread(row)
                    blob = _json.dumps(msgs, ensure_ascii=False).lower()
                    if needle in blob:
                        seen.add(info.thread_id)
                        scored.append((5.0, info))  # deep match score
                except Exception:
                    continue

        # Phase 3: Apply time decay and sort
        from datetime import datetime
        final_scored: list[tuple[float, SessionInfo]] = []
        for score, info in scored:
            try:
                ts = info.updated_at
                if isinstance(ts, str):
                    ts_val = datetime.fromisoformat(ts.replace('Z', '+00:00')).timestamp()
                else:
                    ts_val = ts.timestamp() if hasattr(ts, 'timestamp') else 0
                hours_ago = max(0.001, (datetime.now().timestamp() - ts_val) / 3600)
                time_decay = 1.0 / (1 + hours_ago / 168)  # half-life = 1 week
                final_score = score * time_decay
            except Exception:
                final_score = score
            # Set relevance_score on the info object
            try:
                info.relevance_score = round(final_score, 3)
            except Exception:
                pass
            final_scored.append((final_score, info))

        final_scored.sort(key=lambda x: x[0], reverse=True)
        return [info for _, info in final_scored[:limit]]

    def _fts_search(self, query: str, limit: int = 20) -> list[tuple[float, "SessionInfo"]]:
        """Search sessions using FTS5.

        Uses ``session_search_fts`` (session-level metadata: name, workdir,
        tags) which supports BM25 ranking. Falls back to a simpler COUNT-based
        scoring on ``session_messages_fts`` (message content) if the primary
        table is unavailable.
        """
        results: list[tuple[float, SessionInfo]] = []
        try:
            db = self._db
            engine = getattr(db, '_engine', None) or getattr(db, 'engine', None)
            if engine is None:
                return results

            # Build FTS5 query: split into words and join with OR
            words = query.lower().split()
            fts_query = ' OR '.join(f'"{w}"' for w in words if len(w) >= 2)
            if not fts_query:
                return results

            from sqlalchemy import text

            with engine.connect() as conn:
                # Primary: search session_search_fts (session-level metadata)
                # This table supports bm25() because it is NOT external-content.
                try:
                    rows = conn.execute(text("""
                        SELECT thread_id, bm25(session_search_fts) as score
                        FROM session_search_fts
                        WHERE session_search_fts MATCH :query
                          AND user_id = :user_id
                        ORDER BY score
                        LIMIT :limit
                    """), {"query": fts_query, "user_id": self._user_id, "limit": limit}).fetchall()

                    for row in rows:
                        thread_id, score = row[0], float(row[1])
                        info = self.resolve(thread_id)
                        if info:
                            # Negate BM25 score (more negative = more relevant)
                            results.append((max(0.1, -score), info))
                except Exception:
                    # session_search_fts may not exist on very old databases
                    logger.debug("session_search_fts search failed, trying session_messages_fts fallback")

                # Fallback: search message content via session_messages_fts
                # NOTE: session_messages_fts uses external-content mode so
                # bm25() may fail with "unable to use function bm25 in the
                # requested context". Use COUNT-based scoring instead.
                if not results:
                    try:
                        rows = conn.execute(text("""
                            SELECT sm.thread_id, COUNT(*) as hit_count
                            FROM session_messages_fts
                            JOIN sessionmessage sm ON session_messages_fts.rowid = sm.id
                            WHERE session_messages_fts MATCH :query
                              AND sm.user_id = :user_id
                            GROUP BY sm.thread_id
                            ORDER BY hit_count DESC
                            LIMIT :limit
                        """), {"query": fts_query, "user_id": self._user_id, "limit": limit}).fetchall()

                        for row in rows:
                            thread_id = row[0]
                            hit_count = int(row[1])
                            info = self.resolve(thread_id)
                            if info:
                                results.append((float(hit_count), info))
                    except Exception:
                        logger.debug("session_messages_fts fallback also failed")

        except Exception:
            logger.exception("_fts_search failed")

        return results

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

    def tag_add(self, thread_id: str, tags: list[str]) -> bool:
        """Add tags to a session's metadata."""
        row = self._get(thread_id)
        if row is None:
            return False
        meta = dict(row.meta or {})
        existing_tags = meta.get("tags", [])
        for tag in tags:
            tag = tag.strip().lstrip('#')
            if tag and tag not in existing_tags:
                existing_tags.append(tag)
        meta["tags"] = existing_tags
        row.meta = meta
        self._db.upsert(row, return_json=False)
        return True

    def tag_remove(self, thread_id: str, tags: list[str]) -> bool:
        """Remove tags from a session's metadata."""
        row = self._get(thread_id)
        if row is None:
            return False
        meta = dict(row.meta or {})
        existing_tags = meta.get("tags", [])
        meta["tags"] = [t for t in existing_tags if t.strip().lstrip('#') not in [x.strip().lstrip('#') for x in tags]]
        row.meta = meta
        self._db.upsert(row, return_json=False)
        return True

    def set_meta_flag(self, thread_id: str, flag: str, value: Any) -> bool:
        """Set a boolean flag in session metadata (e.g. pinned, archived)."""
        row = self._get(thread_id)
        if row is None:
            return False
        meta = dict(row.meta or {})
        meta[flag] = value
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
