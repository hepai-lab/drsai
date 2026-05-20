"""Platform-admin analytics: agent usage and session/run aggregates."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session as DBSession, func, select

from ...datamodel.db import (
    AgentModeSettings,
    OrganizationAgent,
    Run,
    Session as ChatSessionRecord,
    UserAgentUsage,
    UserAgents,
    UserDDFAgents,
    UserRemoteAgents,
)
from ..authz import get_is_platform_admin
from ..deps import get_db

router = APIRouter()


def _require_platform_admin(db, operator_user_id: str) -> None:
    if not operator_user_id:
        raise HTTPException(status_code=400, detail="Missing operator_user_id")
    if not get_is_platform_admin(db, operator_user_id):
        raise HTTPException(status_code=403, detail="Admin privileges required")


def _agent_id_from_session_config(cfg: Optional[Dict[str, Any]]) -> Optional[str]:
    if not cfg or not isinstance(cfg, dict):
        return None
    raw = cfg.get("agent_id") or cfg.get("id")
    if raw is None:
        return None
    s = str(raw).strip()
    return s or None


def _agent_display_name(agent_obj: Any) -> Optional[str]:
    if not isinstance(agent_obj, dict):
        return None
    name = agent_obj.get("name")
    if isinstance(name, str):
        n = name.strip()
        if n:
            return n
    return None


def _collect_agent_labels(db_engine: Any, agent_ids: List[str]) -> Dict[str, str]:
    """Resolve agent UUID -> human-readable name from org snapshots and user agent libraries."""
    wanted_set = {str(x).strip() for x in agent_ids if str(x).strip()}
    if not wanted_set:
        return {}
    out: Dict[str, str] = {}
    remain = set(wanted_set)

    with DBSession(db_engine) as s:
        if remain:
            org_stmt = select(OrganizationAgent).where(OrganizationAgent.agent_id.in_(tuple(remain)))
            for row in s.exec(org_stmt).all():
                aid = str(row.agent_id or "").strip()
                if aid not in remain:
                    continue
                snap = row.snapshot if isinstance(row.snapshot, dict) else {}
                label = _agent_display_name(snap)
                if label:
                    out[aid] = label
                    remain.discard(aid)

        if remain:
            for settings_row in s.exec(select(AgentModeSettings)).all():
                for ag in settings_row.agents_mode or []:
                    if not isinstance(ag, dict):
                        continue
                    aid = str(ag.get("id") or "").strip()
                    if aid not in remain:
                        continue
                    label = _agent_display_name(ag)
                    if label:
                        out[aid] = label
                        remain.discard(aid)
                    if not remain:
                        break
                if not remain:
                    break

        for model in (UserAgents, UserRemoteAgents, UserDDFAgents):
            if not remain:
                break
            for row in s.exec(select(model)).all():
                agents = getattr(row, "agents", None) or []
                for ag in agents:
                    if not isinstance(ag, dict):
                        continue
                    aid = str(ag.get("id") or "").strip()
                    if aid not in remain:
                        continue
                    label = _agent_display_name(ag)
                    if label:
                        out[aid] = label
                        remain.discard(aid)
                    if not remain:
                        break
                if not remain:
                    break

    return out


def _usage_row_to_api_dict(row: UserAgentUsage) -> Dict[str, Any]:
    """model_dump + ORM fallback so SQLite string/null timestamps still surface in admin JSON."""
    data: Dict[str, Any] = row.model_dump(mode="json")
    for key in ("last_used_at", "updated_at", "created_at"):
        if data.get(key) is not None:
            continue
        raw = getattr(row, key, None)
        if isinstance(raw, datetime):
            data[key] = raw.isoformat()
        elif isinstance(raw, str) and raw.strip():
            data[key] = raw.strip()
    return data


@router.get("/usage-overview")
async def usage_overview(
    operator_user_id: str,
    usage_limit: int = 400,
    session_sample_limit: int = 800,
    db=Depends(get_db),
) -> Dict[str, Any]:
    """
    Cross-user usage snapshots (platform admin only).
    Combines persisted agent usage rows with coarse session/run counts.
    """
    _require_platform_admin(db, operator_user_id)

    safe_usage = max(1, min(int(usage_limit), 5000))
    safe_sessions = max(1, min(int(session_sample_limit), 10000))

    with DBSession(db.engine) as s:
        usage_rows = s.exec(
            select(UserAgentUsage)
            .order_by(
                func.coalesce(
                    UserAgentUsage.last_used_at,
                    UserAgentUsage.updated_at,
                    UserAgentUsage.created_at,
                ).desc()
            )
            .limit(safe_usage)
        ).all()

        sessions_by_user_rows = s.exec(
            select(ChatSessionRecord.user_id, func.count(ChatSessionRecord.id)).group_by(ChatSessionRecord.user_id)
        ).all()

        exec_counts = s.exec(
            select(Run.user_id, func.count(Run.id)).where(Run.user_id.isnot(None)).group_by(Run.user_id)
        ).all()

        recent_sessions = s.exec(
            select(ChatSessionRecord)
            .order_by(ChatSessionRecord.updated_at.desc())
            .limit(safe_sessions)
        ).all()

        # Full-table aggregate (not limited to usage_events sample) for stable rankings
        agent_totals_rows = s.exec(
            select(
                UserAgentUsage.agent_id,
                func.sum(UserAgentUsage.use_count).label("total_use_count"),
            )
            .where(UserAgentUsage.agent_id.isnot(None))
            .group_by(UserAgentUsage.agent_id)
            .order_by(func.sum(UserAgentUsage.use_count).desc())
            .limit(40)
        ).all()

    top_agents_raw = [
        {
            "agent_id": str(aid),
            "total_use_count_records": int(total or 0),
        }
        for aid, total in agent_totals_rows
        if aid and str(aid).strip()
    ]

    label_ids: List[str] = []
    seen_ids: set[str] = set()

    def _push_label_id(raw: Optional[str]) -> None:
        s_ = str(raw or "").strip()
        if not s_ or s_ == "__unknown_agent__" or s_ in seen_ids:
            return
        seen_ids.add(s_)
        label_ids.append(s_)

    for r in usage_rows:
        _push_label_id(getattr(r, "agent_id", None))
    for x in top_agents_raw:
        _push_label_id(x["agent_id"])
    for row in recent_sessions:
        cfg = row.agent_mode_config
        _push_label_id(_agent_id_from_session_config(cfg if isinstance(cfg, dict) else None))

    agent_labels = _collect_agent_labels(db.engine, label_ids)

    usage_serial: List[Dict[str, Any]] = []
    for r in usage_rows:
        if not getattr(r, "user_id", None):
            continue
        row_d = _usage_row_to_api_dict(r)
        uaid = str(row_d.get("agent_id") or "").strip()
        row_d["agent_name"] = agent_labels.get(uaid) if uaid else None
        usage_serial.append(row_d)

    top_agents_by_usage_records = [
        {
            "agent_id": x["agent_id"],
            "agent_name": agent_labels.get(x["agent_id"]),
            "total_use_count_records": x["total_use_count_records"],
        }
        for x in top_agents_raw
    ]

    sessions_per_user = [
        {"user_id": str(uid) if uid is not None else "", "session_count": int(cnt or 0)}
        for uid, cnt in sessions_by_user_rows
        if uid
    ]
    sessions_per_user.sort(key=lambda x: x["session_count"], reverse=True)

    runs_per_user = [
        {"user_id": str(uid), "run_count": int(cnt or 0)} for uid, cnt in exec_counts if uid
    ]
    runs_per_user.sort(key=lambda x: x["run_count"], reverse=True)

    sess_agent_counts: Dict[str, Dict[str, int]] = {}
    recent_session_rows: List[Dict[str, Any]] = []
    for row in recent_sessions:
        uid = row.user_id
        cfg = row.agent_mode_config
        aid = _agent_id_from_session_config(cfg if isinstance(cfg, dict) else None) or "__unknown_agent__"

        bucket = sess_agent_counts.setdefault(str(uid or ""), {})
        bucket[aid] = bucket.get(aid, 0) + 1

        updated = row.updated_at.isoformat() if row.updated_at else None
        created = row.created_at.isoformat() if row.created_at else None
        if len(recent_session_rows) < 120:
            resolved_aid = None if aid == "__unknown_agent__" else aid
            recent_session_rows.append(
                {
                    "session_id": row.id,
                    "user_id": row.user_id,
                    "name": row.name,
                    "agent_id": resolved_aid,
                    "agent_name": agent_labels.get(resolved_aid) if resolved_aid else None,
                    "updated_at": updated,
                    "created_at": created,
                }
            )

    session_agent_summary = []
    for uid, agents in sess_agent_counts.items():
        parts = sorted(agents.items(), key=lambda kv: kv[1], reverse=True)[:15]
        session_agent_summary.append(
            {"user_id": uid, "sessions_by_agent_sample": [{"agent_id": k, "count": v} for k, v in parts]}
        )
    session_agent_summary.sort(key=lambda x: sum(p["count"] for p in x["sessions_by_agent_sample"]), reverse=True)

    return {
        "status": True,
        "data": {
            "usage_events": usage_serial,
            "top_agents_by_usage_records": top_agents_by_usage_records,
            "sessions_per_user": sessions_per_user[:200],
            "runs_per_user": runs_per_user[:200],
            "session_agent_summary_sample": session_agent_summary[:120],
            "recent_sessions_preview": recent_session_rows,
            "limits": {"usage_events": safe_usage, "session_sample_rows": safe_sessions},
        },
    }
