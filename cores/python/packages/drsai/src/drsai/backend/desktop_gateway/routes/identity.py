"""Identity sync routes used by ``syncAuthIdentityToGateway()``.

The Electron main process calls these three endpoints right after OIDC login
to push the verified identity into the local gateway:

* ``PUT /v1/config/user-name`` — override the desktop user name for this
  server session (best-effort; errors are caught by the caller).
* ``POST /v1/identity/canonicalize`` — remap historical/unstable ``user_id``
  rows in SQLite onto the Desktop canonical identity (BUG-5).

``PUT /v1/config/cli/user_id`` already exists via
``PUT /v1/config/cli/{key}`` in ``routes/config.py``, so it is not duplicated
here.
"""

from __future__ import annotations

import logging
import os
import sqlite3
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from drsai.backend.desktop_gateway._state import state_root

logger = logging.getLogger("drsai.desktop_gateway.identity")

api = APIRouter(tags=["identity"])

# Module-level user name override (mirrors V1 ``_desktop_user_name``).
_desktop_user_name: str | None = None

_UNSTABLE_EXACT_USER_IDS = frozenset(
    {
        "anonymous",
        "desktop",
        "desktop-debug",
        "developer-local",
        "test",
        "u1",
        "opendrsai-smoke",
        "gateway-smoke",
    }
)


class UserNameRequest(BaseModel):
    user_name: str = Field(..., description="Custom user name for the desktop session.")


class CanonicalizeIdentityRequest(BaseModel):
    canonical_user_id: str = Field(
        ...,
        min_length=1,
        max_length=200,
        description="Stable Desktop/OIDC user id that should own local history.",
    )
    aliases: list[str] = Field(
        default_factory=list,
        description="Historical user_id values that should be remapped onto the canonical id.",
    )


def _is_unstable_user_id(value: str, canonical: str, aliases: set[str]) -> bool:
    trimmed = value.strip()
    if not trimmed or trimmed == canonical:
        return False
    lower = trimmed.lower()
    if lower in _UNSTABLE_EXACT_USER_IDS:
        return True
    if lower.startswith("local-api-"):
        return True
    if trimmed in aliases:
        return True
    return False


@api.put("/v1/config/user-name", operation_id="setUserName")
async def set_user_name(req: UserNameRequest):
    """Override the desktop user name for this server session."""
    global _desktop_user_name
    name = req.user_name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="user_name must not be empty")
    previous = _desktop_user_name
    _desktop_user_name = name
    if previous != name:
        logger.info("Desktop user name set to: %s", name)
    return {"user_name": name}


@api.post("/v1/identity/canonicalize", operation_id="canonicalizeIdentity")
async def canonicalize_identity(req: CanonicalizeIdentityRequest):
    """Remap historical/unstable ``user_id`` rows onto the Desktop canonical identity.

    Used after OIDC login so thread/sessionmessage ownership converges on one
    stable id (BUG-5). Only rewrites known-unstable or explicitly aliased values.
    """
    canonical = req.canonical_user_id.strip()
    if not canonical or len(canonical) > 200 or any(ch in canonical for ch in "\r\n\0"):
        raise HTTPException(status_code=400, detail="canonical_user_id is invalid")

    aliases = {
        item.strip()
        for item in req.aliases
        if isinstance(item, str) and item.strip() and item.strip() != canonical
    }
    for env_key in ("USERNAME", "USER"):
        env_user = (os.environ.get(env_key) or "").strip()
        if env_user and env_user != canonical:
            aliases.add(env_user)

    # The Desktop Runtime keeps its SQLite engine at
    # ``state_root()/runtime/engine.sqlite3``.  The legacy gateway stored
    # session data in ``~/.drsai/drsai.db``; check both paths so the migration
    # works regardless of which gateway wrote the rows.
    root = state_root()
    candidate_paths = [
        root / "runtime" / "engine.sqlite3",
        root / "drsai.db",
    ]
    db_path = next((p for p in candidate_paths if p.exists()), None)
    if db_path is None:
        return {
            "ok": True,
            "canonical_user_id": canonical,
            "aliases": [],
            "migrated": {},
            "total_migrated": 0,
        }

    tables = ("thread", "sessionmessage", "sessionsummary")
    migrated: dict[str, int] = {}
    discovered: list[str] = []
    errors: dict[str, str] = {}

    conn = sqlite3.connect(str(db_path), timeout=5.0)
    try:
        conn.execute("PRAGMA busy_timeout=5000")
        existing_tables = {
            str(row[0])
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type IN ('table','view')"
            ).fetchall()
        }

        for table in tables:
            if table not in existing_tables:
                continue
            columns = {
                str(row[1])
                for row in conn.execute(f"PRAGMA table_info({table})").fetchall()
            }
            if "user_id" not in columns:
                continue
            try:
                distinct = [
                    str(row[0])
                    for row in conn.execute(f"SELECT DISTINCT user_id FROM {table}").fetchall()
                    if row[0] is not None
                ]
                rewrite = [
                    value
                    for value in distinct
                    if _is_unstable_user_id(value, canonical, aliases)
                ]
                for value in rewrite:
                    if value not in discovered:
                        discovered.append(value)
                if not rewrite:
                    migrated[table] = 0
                    continue
                # Content FTS triggers fire on any UPDATE and can fail if the
                # FTS index is unhealthy. user_id rewrites do not need them.
                saved_triggers = conn.execute(
                    "SELECT name, sql FROM sqlite_master "
                    "WHERE type='trigger' AND tbl_name=? AND name LIKE '%_update'",
                    (table,),
                ).fetchall()
                for trigger_name, _sql in saved_triggers:
                    conn.execute(f'DROP TRIGGER IF EXISTS "{trigger_name}"')
                try:
                    placeholders = ", ".join("?" for _ in rewrite)
                    cursor = conn.execute(
                        f"UPDATE {table} SET user_id = ? WHERE user_id IN ({placeholders})",
                        [canonical, *rewrite],
                    )
                    migrated[table] = int(cursor.rowcount or 0)
                finally:
                    for trigger_name, trigger_sql in saved_triggers:
                        if trigger_sql:
                            conn.execute(trigger_sql)
            except Exception as exc:
                errors[table] = str(exc)[:300]
                logger.warning("user_id migration failed for %s: %s", table, exc)

        if "session_search_fts" in existing_tables and discovered:
            try:
                fts_cols = {
                    str(row[1])
                    for row in conn.execute("PRAGMA table_info(session_search_fts)").fetchall()
                }
                if "user_id" in fts_cols:
                    placeholders = ", ".join("?" for _ in discovered)
                    cursor = conn.execute(
                        f"UPDATE session_search_fts SET user_id = ? WHERE user_id IN ({placeholders})",
                        [canonical, *discovered],
                    )
                    migrated["session_search_fts"] = int(cursor.rowcount or 0)
            except Exception as exc:
                errors["session_search_fts"] = str(exc)[:300]
                logger.debug("session_search_fts user_id migration skipped: %s", exc)

        conn.commit()
    finally:
        conn.close()

    total = sum(migrated.values())
    if total:
        logger.info(
            "Canonicalized %s historical user_id rows onto %s (aliases=%s)",
            total,
            canonical,
            discovered,
        )
    return {
        "ok": True,
        "canonical_user_id": canonical,
        "aliases": discovered,
        "migrated": migrated,
        "total_migrated": total,
        **({"errors": errors} if errors else {}),
    }


def router() -> APIRouter:
    return api
