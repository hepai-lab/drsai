from __future__ import annotations

from typing import Dict, Literal, Set

from ..datamodel.db import Userinfo

AuthSource = Literal["local", "sso"]


def record_auth_source(
    db, user_id: str, source: AuthSource, user_source: str | None = None
) -> None:
    """Persist the most recent login method for user-management display.

    Args:
        user_source: Optional discriminator for SSO subtypes (e.g. "science_user").
                     Stored in meta alongside auth_source.
    """
    response = db.get(Userinfo, filters={"user_id": user_id}, return_json=False)
    if response.status and response.data:
        user: Userinfo = response.data[0]
        meta = dict(getattr(user, "meta", None) or {})
        meta["auth_source"] = source
        if user_source:
            meta["user_source"] = user_source
        user.meta = meta
        db.upsert(user)
        return

    meta: dict = {"auth_source": source}
    if user_source:
        meta["user_source"] = user_source
    if source == "sso":
        db.upsert(Userinfo(user_id=user_id, password=None, meta=meta))


def get_user_source(db, user_id: str) -> str | None:
    """Read user_source from Userinfo.meta, or None if not set."""
    response = db.get(Userinfo, filters={"user_id": user_id}, return_json=False)
    if response.status and response.data:
        user: Userinfo = response.data[0]
        meta = dict(getattr(user, "meta", None) or {})
        return meta.get("user_source")
    return None


def resolve_auth_source(
    user_id: str,
    local_by_id: Dict[str, Userinfo],
    agent_user_ids: Set[str],
) -> AuthSource:
    local_user = local_by_id.get(user_id)
    if local_user is not None:
        meta = getattr(local_user, "meta", None) or {}
        recorded = meta.get("auth_source")
        if recorded in ("local", "sso"):
            return recorded  # type: ignore[return-value]
        if getattr(local_user, "password", None):
            # Legacy rows: local Userinfo created before auth_source tracking, but user
            # actually signs in via IHEP SSO (cstnetId email + AgentModeSettings).
            if user_id in agent_user_ids and user_id.endswith("@ihep.ac.cn"):
                return "sso"
            return "local"
    if user_id in agent_user_ids:
        return "sso"
    return "local"


# ── skill role helpers ────────────────────────────────────────────────────────

SkillRole = Literal["admin", "contributor", "user"]


def get_skill_role(db, user_id: str) -> str:
    """Read skill_role from Userinfo.meta, defaulting to 'user'."""
    if not user_id:
        return "user"
    response = db.get(Userinfo, filters={"user_id": user_id}, return_json=False)
    if response.status and response.data:
        user: Userinfo = response.data[0]
        meta = dict(getattr(user, "meta", None) or {})
        return meta.get("skill_role", "user")
    return "user"


def set_skill_role(db, user_id: str, role: str) -> bool:
    """Set skill_role in Userinfo.meta. Returns True on success."""
    if not user_id:
        return False
    response = db.get(Userinfo, filters={"user_id": user_id}, return_json=False)
    if not response.status or not response.data:
        return False
    user: Userinfo = response.data[0]
    meta = dict(getattr(user, "meta", None) or {})
    meta["skill_role"] = role
    user.meta = meta
    db.upsert(user)
    return True
