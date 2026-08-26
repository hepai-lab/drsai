"""Thread-backed session store for the OpenDrSai CLI.

Wraps the existing :class:`DatabaseManager` + :class:`Thread` schema so the
REPL can list, resume, rename, and search conversation sessions without a
separate ``cli_sessions.json`` file. One-time migration imports any legacy
JSON entries into ``Thread.meta['name']``.
"""

from __future__ import annotations

import re
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
        1. Keyword pre-filter on name + preview + workdir (fast, in-memory)
           Matches any individual word from the query, not just the full
           phrase — so "ui tui optimization" matches a session named "ui-tui".
        2. FTS5 deep search on session metadata + message content
        3. Composite scoring with time decay + workdir relevance
        """
        if not query:
            return []

        needle = query.lower()
        words = [w for w in needle.split() if w]
        seen: set[str] = set()
        scored: list[tuple[float, SessionInfo]] = []

        # Phase 1: keyword pre-filter (name + preview + workdir)
        # Match if ANY query word appears in the blob (not just the full
        # phrase). This dramatically improves recall for multi-word queries.
        for info in self.list(limit=500):
            if getattr(info, 'archived', False):
                continue
            if workdir and info.workdir != workdir:
                continue
            blob = f"{info.name}\n{info.preview}\n{info.workdir}".lower()
            # Check both full-phrase match AND any-word match
            matched = False
            if needle in blob:
                matched = True
            else:
                for w in words:
                    if w in blob:
                        matched = True
                        break
            if matched:
                score = 10.0  # base keyword match score
                # Boost for workdir match
                if workdir and info.workdir == workdir:
                    score += 5.0
                # Boost for name match (more specific)
                name_lower = info.name.lower()
                if needle in name_lower or any(w in name_lower for w in words):
                    score += 3.0
                    # Generate a highlighted snippet from the name
                    snippet = info.name
                    for w in sorted(words, key=len, reverse=True):
                        # Case-insensitive replace, preserve original case
                        snippet = re.sub(
                            f'({re.escape(w)})',
                            f'【\\1】',
                            snippet,
                            flags=re.IGNORECASE,
                        )
                    info.match_snippet = snippet
                elif info.preview:
                    # Generate a highlighted snippet from the preview
                    snippet = info.preview
                    for w in sorted(words, key=len, reverse=True):
                        snippet = re.sub(
                            f'({re.escape(w)})',
                            f'【\\1】',
                            snippet,
                            flags=re.IGNORECASE,
                        )
                    info.match_snippet = snippet
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
        """Search sessions using FTS5 — searches THREE FTS tables.

        1. ``session_search_fts`` (trigram tokenizer) — session metadata
           (name/workdir/tags), BM25 ranked, matches ≥ 3 chars.
        2. ``session_messages_fts`` (default tokenizer) — message content,
           COUNT-based, handles short ASCII words (1-2 chars).
        3. ``session_messages_fts_trigram`` (trigram tokenizer) — message
           content, COUNT-based, handles CJK text by matching ≥ 3 char
           substrings.  Essential for searching user questions in Chinese/Japanese.

        Returns ``list[tuple[score, SessionInfo]]`` where each ``SessionInfo``
        has ``match_snippet`` set to a highlighted excerpt of the matched text
        (using ``【`` / ``】`` delimiters around matched terms).
        """
        results: list[tuple[float, SessionInfo]] = []
        try:
            db = self._db
            engine = getattr(db, '_engine', None) or getattr(db, 'engine', None)
            if engine is None:
                return results

            # Build FTS5 query: split into words and join with OR.
            # Words ≥ 3 chars go into the trigram query (session_search_fts).
            # All words go into the default-tokenizer query (session_messages_fts).
            words = [w for w in query.lower().split() if w]
            if not words:
                return results

            # For session_search_fts (trigram): only words ≥ 3 chars are useful.
            # Use OR to match any word.  Use prefix matching (*) so "app" also
            # matches "apps", "application", etc.
            trigram_words = [w for w in words if len(w) >= 3]
            trigram_query = ' OR '.join(f'"{w}"*' for w in trigram_words) if trigram_words else ''

            # For session_messages_fts (default tokenizer): all words ≥ 1 char.
            msg_query = ' OR '.join(f'"{w}"' for w in words if len(w) >= 1)

            # For session_messages_fts_trigram: the FULL query string as a
            # single phrase (not split into words).  Trigram tokenizer handles
            # both ASCII and CJK by matching 3-char substrings.  This is
            # essential for CJK queries like "检索到用户的问题" where the
            # default tokenizer can't split CJK into searchable tokens.
            # Only use the full query if it's ≥ 3 chars (trigram minimum).
            trigram_msg_query = ""
            if len(query.strip()) >= 3:
                trigram_msg_query = f'"{query.strip()}"'
            # Also try individual words ≥ 3 chars as fallback
            for w in trigram_words:
                if w not in query.strip():
                    if trigram_msg_query:
                        trigram_msg_query += ' OR '
                    trigram_msg_query += f'"{w}"'

            from sqlalchemy import text

            # Delimiters for FTS5 highlight() — wrapped around matched terms.
            # Using CJK corner brackets so they're visually distinct and
            # unlikely to collide with message content.
            HL_OPEN, HL_CLOSE = '【', '】'

            with engine.connect() as conn:
                seen_fts: set[str] = set()

                # ── 1. session_search_fts (BM25 ranked, trigram) ─────────
                if trigram_query:
                    try:
                        rows = conn.execute(text("""
                            SELECT thread_id,
                                   bm25(session_search_fts) as score,
                                   highlight(session_search_fts, 2, :hl_open, :hl_close) as name_hl,
                                   highlight(session_search_fts, 4, :hl_open, :hl_close) as workdir_hl
                            FROM session_search_fts
                            WHERE session_search_fts MATCH :query
                              AND user_id = :user_id
                            ORDER BY score
                            LIMIT :limit
                        """), {"query": trigram_query, "user_id": self._user_id,
                               "limit": limit,
                               "hl_open": HL_OPEN, "hl_close": HL_CLOSE}).fetchall()

                        for row in rows:
                            thread_id, score = row[0], float(row[1])
                            name_hl = row[2] or ""
                            workdir_hl = row[3] or ""
                            info = self.resolve(thread_id)
                            if info:
                                seen_fts.add(thread_id)
                                # Pick the snippet that contains highlight markers
                                snippet = ""
                                if HL_OPEN in name_hl:
                                    snippet = name_hl
                                elif HL_OPEN in workdir_hl:
                                    snippet = workdir_hl
                                if snippet:
                                    info.match_snippet = snippet
                                results.append((max(0.1, -score), info))
                    except Exception:
                        logger.debug("session_search_fts search failed")

                # ── 2. session_messages_fts (COUNT-based, default tokenizer) ─
                # ALWAYS run this — not just as a fallback.  This catches:
                #  - short words (< 3 chars) that trigram can't match
                #  - message content that isn't in name/workdir/tags
                #  - results missed because session_search_fts.preview is empty
                #
                # FTS5 highlight()/snippet() cannot be used inside a GROUP BY
                # with a JOIN (SQLite raises "unable to use function highlight
                # in the requested context").  So we use a two-step approach:
                #   Step A: GROUP BY query → thread_id + hit_count
                #   Step B: Per-thread snippet() query → highlighted excerpt
                if msg_query:
                    try:
                        # Step A: Get thread_ids and hit counts
                        rows = conn.execute(text("""
                            SELECT sm.thread_id, COUNT(*) as hit_count
                            FROM session_messages_fts
                            JOIN sessionmessage sm ON session_messages_fts.rowid = sm.id
                            WHERE session_messages_fts MATCH :query
                              AND sm.user_id = :user_id
                            GROUP BY sm.thread_id
                            ORDER BY hit_count DESC
                            LIMIT :limit
                        """), {"query": msg_query, "user_id": self._user_id,
                               "limit": limit}).fetchall()

                        # Step B: Get a snippet for each thread
                        for row in rows:
                            thread_id = row[0]
                            hit_count = int(row[1])
                            snippet = ""

                            # Fetch one matching message with a snippet
                            try:
                                snip_row = conn.execute(text("""
                                    SELECT snippet(session_messages_fts, 0,
                                                   :hl_open, :hl_close, '…', 20)
                                    FROM session_messages_fts
                                    JOIN sessionmessage sm
                                      ON session_messages_fts.rowid = sm.id
                                    WHERE session_messages_fts MATCH :query
                                      AND sm.thread_id = :tid
                                      AND sm.user_id = :user_id
                                    ORDER BY sm.id DESC
                                    LIMIT 1
                                """), {"query": msg_query, "tid": thread_id,
                                       "user_id": self._user_id,
                                       "hl_open": HL_OPEN,
                                       "hl_close": HL_CLOSE}).fetchone()
                                if snip_row and snip_row[0]:
                                    snippet = snip_row[0]
                            except Exception:
                                pass  # snippet retrieval is best-effort

                            # Merge with existing result from session_search_fts
                            merged = False
                            for i, (s, existing) in enumerate(results):
                                if existing.thread_id == thread_id:
                                    results[i] = (s + float(hit_count), existing)
                                    # Message content snippet takes priority
                                    # over metadata snippet (more informative)
                                    if snippet and HL_OPEN in snippet:
                                        existing.match_snippet = snippet
                                    merged = True
                                    break
                            if not merged:
                                info = self.resolve(thread_id)
                                if info:
                                    if snippet and HL_OPEN in snippet:
                                        info.match_snippet = snippet
                                    results.append((float(hit_count), info))
                    except Exception:
                        logger.debug("session_messages_fts search failed")

                # ── 3. session_messages_fts_trigram (trigram, CJK support) ─
                # This catches CJK content that the default tokenizer misses.
                # The trigram tokenizer matches any ≥ 3 char substring, making
                # it essential for searching Chinese/Japanese/Korean text.
                # Also catches results that the default tokenizer found but
                # with different ranking.
                if trigram_msg_query:
                    try:
                        rows = conn.execute(text("""
                            SELECT sm.thread_id, COUNT(*) as hit_count
                            FROM session_messages_fts_trigram
                            JOIN sessionmessage sm ON session_messages_fts_trigram.rowid = sm.id
                            WHERE session_messages_fts_trigram MATCH :query
                              AND sm.user_id = :user_id
                            GROUP BY sm.thread_id
                            ORDER BY hit_count DESC
                            LIMIT :limit
                        """), {"query": trigram_msg_query, "user_id": self._user_id,
                               "limit": limit}).fetchall()

                        for row in rows:
                            thread_id = row[0]
                            hit_count = int(row[1])
                            snippet = ""

                            # Fetch one matching message with a snippet
                            try:
                                snip_row = conn.execute(text("""
                                    SELECT snippet(session_messages_fts_trigram, 0,
                                                   :hl_open, :hl_close, '…', 20)
                                    FROM session_messages_fts_trigram
                                    JOIN sessionmessage sm
                                      ON session_messages_fts_trigram.rowid = sm.id
                                    WHERE session_messages_fts_trigram MATCH :query
                                      AND sm.thread_id = :tid
                                      AND sm.user_id = :user_id
                                    ORDER BY sm.id DESC
                                    LIMIT 1
                                """), {"query": trigram_msg_query, "tid": thread_id,
                                       "user_id": self._user_id,
                                       "hl_open": HL_OPEN,
                                       "hl_close": HL_CLOSE}).fetchone()
                                if snip_row and snip_row[0]:
                                    snippet = snip_row[0]
                            except Exception:
                                pass  # snippet retrieval is best-effort

                            # Merge with existing results
                            merged = False
                            for i, (s, existing) in enumerate(results):
                                if existing.thread_id == thread_id:
                                    results[i] = (s + float(hit_count), existing)
                                    # Trigram snippet takes priority (better for CJK)
                                    if snippet and HL_OPEN in snippet:
                                        existing.match_snippet = snippet
                                    merged = True
                                    break
                            if not merged:
                                info = self.resolve(thread_id)
                                if info:
                                    if snippet and HL_OPEN in snippet:
                                        info.match_snippet = snippet
                                    results.append((float(hit_count), info))
                    except Exception:
                        logger.debug("session_messages_fts_trigram search failed")

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
