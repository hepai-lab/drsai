"""
Merge / filter sidebar agent list (AgentModeSettings.agents_mode) by org policy.

Platform admins see: global defaults ∪ all org agent snapshots ∪ stored user list.
Members see: filtered to org whitelist ∪ global defaults ∪ cross-org granted rows.
"""

from __future__ import annotations

from typing import Any, Dict, List

from drsai_ui.ui_backend.backend.database import DatabaseManager
from drsai_ui.ui_backend.backend.datamodel.db import OrganizationAgent
from drsai_ui.ui_backend.backend.web.authz import get_is_platform_admin, get_org_membership

from .agent_mode_cofigs import (
    _mark_featured_and_default_agents,
    get_default_agent_mode_config,
)


def _merge_agent_dicts(*lists: List[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    merged: Dict[str, Dict[str, Any]] = {}
    for lst in lists:
        for a in lst or []:
            if not isinstance(a, dict):
                continue
            aid = str(a.get("id") or "").strip()
            if not aid:
                continue
            merged[aid] = dict(a)
    return list(merged.values())


def merge_sidebar_agents_mode(
    db: DatabaseManager,
    user_id: str,
    stored_agents_mode: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    stored = [dict(a) for a in (stored_agents_mode or []) if isinstance(a, dict)]
    defaults = get_default_agent_mode_config(user_id=user_id)
    default_ids = {str(a.get("id")) for a in defaults if a.get("id")}

    if get_is_platform_admin(db, user_id):
        org_rows = db.get(OrganizationAgent, return_json=False).data or []
        org_snaps: List[Dict[str, Any]] = []
        for r in org_rows:
            snap = r.snapshot if isinstance(r.snapshot, dict) else {}
            if snap:
                org_snaps.append(snap)
        out = _merge_agent_dicts(defaults, org_snaps, stored)
        _mark_featured_and_default_agents(out)
        return out

    mem = get_org_membership(db, user_id)
    if not mem:
        out = list(stored)
        _mark_featured_and_default_agents(out)
        return out

    org_rows = db.get(
        OrganizationAgent,
        filters={"org_id": mem.org_id},
        return_json=False,
    ).data or []
    org_ids = {str(r.agent_id) for r in org_rows}
    org_snaps = [dict(r.snapshot) for r in org_rows if isinstance(r.snapshot, dict)]

    merged = _merge_agent_dicts(defaults, org_snaps, stored)

    granted_ids = {
        str(a.get("id"))
        for a in stored
        if a.get("granted_cross_org") and a.get("id")
    }
    allowed_ids = set(default_ids) | org_ids | granted_ids

    out = [a for a in merged if str(a.get("id") or "") in allowed_ids]
    _mark_featured_and_default_agents(out)
    return out
