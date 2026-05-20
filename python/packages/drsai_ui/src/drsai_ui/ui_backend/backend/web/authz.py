"""Shared admin / org role checks for API routes."""

from __future__ import annotations

import os
from ..datamodel.db import UserRole
from ..database import DatabaseManager


def _platform_admin_user_ids_from_env() -> set[str]:
    """Comma-separated allowlist persisted to UserRole on startup."""
    ids: set[str] = set()
    for key in ("PLATFORM_ADMIN_USER_IDS", "INITIAL_ADMIN_USER_ID"):
        raw = os.getenv(key, "")
        if not raw:
            continue
        for part in raw.split(","):
            uid = part.strip()
            if uid:
                ids.add(uid)
    return ids


def bootstrap_platform_admins(db: DatabaseManager) -> None:
    """Ensure configured user ids have UserRole.is_admin=true."""
    for user_id in _platform_admin_user_ids_from_env():
        existing = db.get(UserRole, filters={"user_id": user_id}, return_json=False)
        if existing.status and existing.data:
            role: UserRole = existing.data[0]
            if not role.is_admin:
                role.is_admin = True
                db.upsert(role)
        else:
            db.upsert(UserRole(user_id=user_id, is_admin=True))


def get_is_platform_admin(db: DatabaseManager, user_id: str) -> bool:
    if not user_id:
        return False
    role_resp = db.get(UserRole, filters={"user_id": user_id}, return_json=False)
    if role_resp.status and role_resp.data:
        role: UserRole = role_resp.data[0]
        return bool(role.is_admin)
    return False
