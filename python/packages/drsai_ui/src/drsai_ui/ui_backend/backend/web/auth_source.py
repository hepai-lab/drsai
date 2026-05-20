from __future__ import annotations

from typing import Dict, Literal, Set

from ..datamodel.db import Userinfo

AuthSource = Literal["local", "sso"]


def record_auth_source(db, user_id: str, source: AuthSource) -> None:
    """Persist the most recent login method for user-management display."""
    response = db.get(Userinfo, filters={"user_id": user_id}, return_json=False)
    if response.status and response.data:
        user: Userinfo = response.data[0]
        meta = dict(getattr(user, "meta", None) or {})
        meta["auth_source"] = source
        user.meta = meta
        db.upsert(user)
        return

    if source == "sso":
        db.upsert(Userinfo(user_id=user_id, password=None, meta={"auth_source": "sso"}))


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
