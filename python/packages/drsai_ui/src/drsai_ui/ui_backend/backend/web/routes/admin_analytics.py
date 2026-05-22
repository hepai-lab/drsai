"""Platform-admin analytics: agent usage and session/run aggregates."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

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

ANALYTICS_TZ = ZoneInfo("Asia/Shanghai")


def _beijing_today_key() -> str:
    return datetime.now(ANALYTICS_TZ).strftime("%Y-%m-%d")


def _beijing_day_utc_range(day_key: Optional[str] = None) -> Tuple[datetime, datetime]:
    """Inclusive start, exclusive end in UTC for a Beijing calendar day (YYYY-MM-DD)."""
    key = day_key or _beijing_today_key()
    y, m, d = (int(x) for x in key.split("-"))
    start_local = datetime(y, m, d, 0, 0, 0, tzinfo=ANALYTICS_TZ)
    end_local = start_local + timedelta(days=1)
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)


def _session_created_iso(row: ChatSessionRecord) -> Optional[str]:
    raw = row.created_at
    if isinstance(raw, datetime):
        return raw.isoformat()
    if isinstance(raw, str) and raw.strip():
        return raw.strip()
    return None


def _build_today_session_stats(
    db_engine: Any,
    agent_labels: Dict[str, str],
    day_key: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Effective usage = Session rows with resolvable user_id + agent_id (from agent_mode_config).
    Counted by session.created_at on the Beijing calendar day.
    """
    start_utc, end_utc = _beijing_day_utc_range(day_key)
    today_key = day_key or _beijing_today_key()

    with DBSession(db_engine) as s:
        created_today = s.exec(
            select(ChatSessionRecord)
            .where(ChatSessionRecord.created_at >= start_utc)
            .where(ChatSessionRecord.created_at < end_utc)
            .order_by(ChatSessionRecord.created_at.desc())
        ).all()
    pair_counts: Dict[Tuple[str, str], int] = {}
    pair_latest: Dict[Tuple[str, str], str] = {}
    pair_agent_name: Dict[Tuple[str, str], Optional[str]] = {}
    today_user_ids: set[str] = set()
    today_agent_ids: set[str] = set()

    for row in created_today:
        uid = str(row.user_id or "").strip()
        cfg = row.agent_mode_config if isinstance(row.agent_mode_config, dict) else None
        aid = _agent_id_from_session_config(cfg)
        if not uid or not aid:
            continue
        key = (uid, aid)
        pair_counts[key] = pair_counts.get(key, 0) + 1
        created_iso = _session_created_iso(row)
        if created_iso and (key not in pair_latest or created_iso > pair_latest[key]):
            pair_latest[key] = created_iso
        cfg_name = _agent_display_name(cfg) if cfg else None
        resolved = agent_labels.get(aid) or cfg_name
        if resolved:
            pair_agent_name[key] = resolved
        today_user_ids.add(uid)
        today_agent_ids.add(aid)

    if today_agent_ids:
        extra_labels = _collect_agent_labels(db_engine, list(today_agent_ids))
        agent_labels = {**agent_labels, **extra_labels}

    recent_by_user_agent: List[Dict[str, Any]] = []
    for (uid, aid), count in pair_counts.items():
        latest = pair_latest.get((uid, aid))
        if not latest:
            continue
        name = pair_agent_name.get((uid, aid)) or agent_labels.get(aid)
        recent_by_user_agent.append(
            {
                "user_id": uid,
                "agent_id": aid,
                "agent_name": name,
                "session_count": int(count),
                "latest_created_at": latest,
            }
        )
    recent_by_user_agent.sort(key=lambda x: x["latest_created_at"], reverse=True)

    return {
        "today_key": today_key,
        "session_count": sum(pair_counts.values()),
        "dau": len(today_user_ids),
        "recent_by_user_agent": [
            {
                "user_id": row["user_id"],
                "agent_name": row.get("agent_name"),
                "session_count": row["session_count"],
                "latest_created_at": row["latest_created_at"],
            }
            for row in recent_by_user_agent[:20]
        ],
    }


SESSION_SCATTER_WINDOW_DAYS = 7


def _build_session_usage_scatter(
    db_engine: Any,
    agent_labels: Dict[str, str],
    window_days: int = SESSION_SCATTER_WINDOW_DAYS,
) -> List[Dict[str, Any]]:
    """
    Rolling window scatter rows: one point per (user, agent) with sessions in window.
    X-axis time = latest session.created_at; bubble size = session_count in window.
    """
    end_utc = datetime.now(timezone.utc)
    start_utc = end_utc - timedelta(days=max(1, int(window_days)))

    with DBSession(db_engine) as s:
        window_sessions = s.exec(
            select(ChatSessionRecord)
            .where(ChatSessionRecord.created_at >= start_utc)
            .where(ChatSessionRecord.created_at < end_utc)
            .order_by(ChatSessionRecord.created_at.desc())
        ).all()

    pair_counts: Dict[Tuple[str, str], int] = {}
    pair_latest: Dict[Tuple[str, str], str] = {}
    pair_agent_name: Dict[Tuple[str, str], Optional[str]] = {}
    scatter_agent_ids: set[str] = set()

    for row in window_sessions:
        uid = str(row.user_id or "").strip()
        cfg = row.agent_mode_config if isinstance(row.agent_mode_config, dict) else None
        aid = _agent_id_from_session_config(cfg)
        if not uid or not aid:
            continue
        key = (uid, aid)
        pair_counts[key] = pair_counts.get(key, 0) + 1
        created_iso = _session_created_iso(row)
        if created_iso and (key not in pair_latest or created_iso > pair_latest[key]):
            pair_latest[key] = created_iso
        cfg_name = _agent_display_name(cfg) if cfg else None
        if cfg_name:
            pair_agent_name[key] = cfg_name
        scatter_agent_ids.add(aid)

    if scatter_agent_ids:
        extra_labels = _collect_agent_labels(db_engine, list(scatter_agent_ids))
        agent_labels = {**agent_labels, **extra_labels}

    scatter_rows: List[Dict[str, Any]] = []
    for (uid, aid), count in pair_counts.items():
        latest = pair_latest.get((uid, aid))
        if not latest:
            continue
        name = pair_agent_name.get((uid, aid)) or agent_labels.get(aid)
        scatter_rows.append(
            {
                "user_id": uid,
                "agent_id": aid,
                "agent_name": name,
                "latest_created_at": latest,
                "session_count": int(count),
            }
        )
    scatter_rows.sort(key=lambda x: x["latest_created_at"], reverse=True)
    return scatter_rows


def _build_session_rankings(db_engine: Any) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Rankings from effective sessions only (user_id + resolvable agent_id in agent_mode_config).
    Returns (top_agents_raw, sessions_per_user) using the same response field shapes as before.
    """
    with DBSession(db_engine) as s:
        all_sessions = s.exec(select(ChatSessionRecord)).all()

    agent_counts: Dict[str, int] = {}
    user_counts: Dict[str, int] = {}

    for row in all_sessions:
        uid = str(row.user_id or "").strip()
        cfg = row.agent_mode_config if isinstance(row.agent_mode_config, dict) else None
        aid = _agent_id_from_session_config(cfg)
        if not uid or not aid:
            continue
        agent_counts[aid] = agent_counts.get(aid, 0) + 1
        user_counts[uid] = user_counts.get(uid, 0) + 1

    top_agents_raw = [
        {"agent_id": aid, "total_use_count_records": int(cnt)}
        for aid, cnt in sorted(agent_counts.items(), key=lambda kv: kv[1], reverse=True)[:40]
    ]
    sessions_per_user = [
        {"user_id": uid, "session_count": int(cnt)}
        for uid, cnt in sorted(user_counts.items(), key=lambda kv: kv[1], reverse=True)
    ]
    return top_agents_raw, sessions_per_user


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


@router.get("/usage-overview")
async def usage_overview(
    operator_user_id: str,
    usage_limit: int = 400,
    db=Depends(get_db),
) -> Dict[str, Any]:
    """
    Cross-user usage snapshots (platform admin only).
    Combines persisted agent usage rows with coarse session/run counts.
    """
    _require_platform_admin(db, operator_user_id)

    safe_usage = max(1, min(int(usage_limit), 5000))

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

        exec_counts = s.exec(
            select(Run.user_id, func.count(Run.id)).where(Run.user_id.isnot(None)).group_by(Run.user_id)
        ).all()

    top_agents_raw, sessions_per_user = _build_session_rankings(db.engine)

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

    agent_labels = _collect_agent_labels(db.engine, label_ids)
    today_session_stats = _build_today_session_stats(db.engine, agent_labels)
    session_usage_scatter = _build_session_usage_scatter(db.engine, agent_labels)

    usage_serial: List[Dict[str, Any]] = []
    for r in usage_rows:
        uid = getattr(r, "user_id", None)
        if not uid:
            continue
        aid = str(getattr(r, "agent_id", "") or "").strip()
        usage_serial.append(
            {
                "user_id": str(uid),
                "agent_id": aid,
                "use_count": int(getattr(r, "use_count", 0) or 0),
            }
        )

    top_agents_by_usage_records = [
        {
            "agent_id": x["agent_id"],
            "agent_name": agent_labels.get(x["agent_id"]),
            "total_use_count_records": x["total_use_count_records"],
        }
        for x in top_agents_raw
    ]

    runs_per_user = [
        {"user_id": str(uid), "run_count": int(cnt or 0)} for uid, cnt in exec_counts if uid
    ]
    runs_per_user.sort(key=lambda x: x["run_count"], reverse=True)

    return {
        "status": True,
        "data": {
            "usage_events": usage_serial,
            "top_agents_by_usage_records": top_agents_by_usage_records,
            "sessions_per_user": sessions_per_user[:200],
            "runs_per_user": runs_per_user[:200],
            "today_session_stats": today_session_stats,
            "session_usage_scatter": session_usage_scatter,
            "limits": {"usage_events": safe_usage},
        },
    }
