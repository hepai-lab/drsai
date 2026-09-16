from typing import Dict, List, Any  
import asyncio, os, json
from pathlib import Path
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel
# from openai import OpenAI
from hepai import HepAI
from hepai import HRModel
from hepai.components.haiddf.worker._related_class import WorkerInfo
from drsai_ui.ui_backend.backend.datamodel.db import (
    UserRemoteAgents,
    UserRemoteAgent,
    UserDDFAgents,
    AgentModeSettings,
)
from drsai_ui.ui_backend.backend.database import DatabaseManager
from sqlmodel import Session as DBSession, select
import uuid
from dotenv import load_dotenv
load_dotenv()
import logging
from drsai_ui.platform_config import get_active_platform

logger = logging.getLogger(__name__)


def _normalize_platform_url(url: str | None) -> str:
    return str(url or "").strip().rstrip("/")


def _agent_dict_from_remote_row(row: UserRemoteAgent) -> Dict[str, Any]:
    payload = dict(row.payload or {})
    payload["id"] = row.agent_id
    payload["mode"] = row.mode or payload.get("mode") or "remote"
    if row.name:
        payload["name"] = row.name
    return payload


def list_user_remote_agent_rows(db: DatabaseManager, user_id: str) -> List[UserRemoteAgent]:
    """Return UserRemoteAgent ORM rows for a user (may be empty before migration)."""
    response = db.get(UserRemoteAgent, filters={"user_id": user_id})
    if response.status and response.data:
        return list(response.data)
    return []


def migrate_user_remote_agents_blob(db: DatabaseManager, user_id: str) -> int:
    """Expand legacy UserRemoteAgents JSON blobs into UserRemoteAgent rows.

    Returns number of rows inserted. Idempotent: skips agent_ids already present.
    """
    existing = {
        str(r.agent_id)
        for r in list_user_remote_agent_rows(db, user_id)
        if getattr(r, "agent_id", None)
    }
    blob_resp = db.get(UserRemoteAgents, filters={"user_id": user_id})
    if not (blob_resp.status and blob_resp.data):
        return 0

    inserted = 0
    for blob_row in blob_resp.data:
        agents = getattr(blob_row, "agents", None) or []
        for agent in agents:
            if not isinstance(agent, dict):
                continue
            agent_id = str(agent.get("id") or "").strip() or str(uuid.uuid4())
            if agent_id in existing:
                continue
            mode = str(agent.get("mode") or "remote").strip() or "remote"
            name = str(agent.get("name") or "").strip()
            if not name:
                cfg = agent.get("config") if isinstance(agent.get("config"), dict) else {}
                name = str(cfg.get("name") or "").strip()
            payload = dict(agent)
            payload["id"] = agent_id
            row = UserRemoteAgent(
                user_id=user_id,
                agent_id=agent_id,
                mode=mode,
                name=name,
                payload=payload,
            )
            result = db.upsert(row)
            if result.status:
                existing.add(agent_id)
                inserted += 1
            else:
                logger.warning(
                    "Failed to migrate remote agent %s for user %s: %s",
                    agent_id,
                    user_id,
                    result.message,
                )
    if inserted:
        logger.info(
            "Migrated %d remote agent(s) from JSON blob to rows for user %s",
            inserted,
            user_id,
        )
    return inserted


def list_user_remote_agents(db: DatabaseManager, user_id: str) -> List[Dict[str, Any]]:
    """User-owned remote/custom agents as catalog dicts (migrates legacy blob if needed)."""
    migrate_user_remote_agents_blob(db, user_id)
    rows = list_user_remote_agent_rows(db, user_id)
    return [_agent_dict_from_remote_row(r) for r in rows]


def get_user_remote_agent_row(
    db: DatabaseManager, user_id: str, agent_id: str
) -> UserRemoteAgent | None:
    """Return the UserRemoteAgent row for (user_id, agent_id), if any."""
    target = str(agent_id or "").strip()
    if not target:
        return None
    for row in list_user_remote_agent_rows(db, user_id):
        if str(getattr(row, "agent_id", "") or "").strip() == target:
            return row
    return None


def upsert_user_remote_agent(
    db: DatabaseManager, user_id: str, agent: Dict[str, Any]
) -> Dict[str, Any]:
    """Insert or update one user-owned agent row. Returns the stored catalog dict."""
    agent_id = str(agent.get("id") or "").strip() or str(uuid.uuid4())
    mode = str(agent.get("mode") or "remote").strip() or "remote"
    name = str(agent.get("name") or "").strip()
    if not name:
        cfg = agent.get("config") if isinstance(agent.get("config"), dict) else {}
        name = str(cfg.get("name") or "").strip()
    payload = dict(agent)
    payload["id"] = agent_id
    payload["mode"] = mode
    if name:
        payload["name"] = name

    existing = get_user_remote_agent_row(db, user_id, agent_id)

    if existing:
        existing.mode = mode
        existing.name = name
        existing.payload = payload
        existing.updated_at = datetime.now()
        result = db.upsert(existing)
        if not result.status:
            raise HTTPException(status_code=500, detail=result.message or "Failed to update agent")
        return _agent_dict_from_remote_row(existing)

    row = UserRemoteAgent(
        user_id=user_id,
        agent_id=agent_id,
        mode=mode,
        name=name,
        payload=payload,
    )
    result = db.upsert(row)
    if not result.status:
        raise HTTPException(status_code=500, detail=result.message or "Failed to save agent")
    return payload


def delete_user_remote_agent(db: DatabaseManager, user_id: str, agent_id: str) -> bool:
    """Delete one user-owned agent row. Also strips id from legacy blob if present."""
    agent_id = str(agent_id or "").strip()
    deleted = False
    with DBSession(db.engine) as session:
        row = session.exec(
            select(UserRemoteAgent).where(
                UserRemoteAgent.user_id == user_id,
                UserRemoteAgent.agent_id == agent_id,
            )
        ).first()
        if row is not None:
            session.delete(row)
            session.commit()
            deleted = True

    # Best-effort cleanup of legacy blob so re-migration does not resurrect it.
    blob_resp = db.get(UserRemoteAgents, filters={"user_id": user_id})
    if blob_resp.status and blob_resp.data:
        for blob_row in blob_resp.data:
            agents = list(getattr(blob_row, "agents", None) or [])
            new_agents = [
                a
                for a in agents
                if not (
                    isinstance(a, dict)
                    and str(a.get("id") or "").strip() == agent_id
                )
            ]
            if len(new_agents) != len(agents):
                blob_row.agents = new_agents
                db.upsert(blob_row)
                deleted = True
    return deleted


def list_ddf_agents_cached(
    db: DatabaseManager, user_id: str, platform_url: str | None = None
) -> List[Dict[str, Any]]:
    """Read DDF cache only (no remote fetch)."""
    platform = get_active_platform()
    target = _normalize_platform_url(platform_url or platform.base_url)
    response = db.get(UserDDFAgents, filters={"user_id": user_id})
    if not (response.status and response.data):
        return []
    for row in response.data:
        row_url = _normalize_platform_url(getattr(row, "platform_url", None))
        if row_url and row_url != target:
            continue
        agents = getattr(row, "agents", None) or []
        if agents:
            return [dict(a) for a in agents if isinstance(a, dict)]
        # Prefer explicit platform match even if empty.
        if row_url == target:
            return []
    # Legacy rows without platform_url: use first non-empty.
    for row in response.data:
        agents = getattr(row, "agents", None) or []
        if agents:
            return [dict(a) for a in agents if isinstance(a, dict)]
    return []


def assemble_catalog_agents(
    user_id: str,
    db: DatabaseManager,
    *,
    ddf_agents: List[Dict[str, Any]] | None = None,
    user_source: str | None = None,
) -> List[Dict[str, Any]]:
    """Pure in-memory merge of platform defaults + DDF + user-owned remotes.

    Does not write UserAgents. When *ddf_agents* is None, reads DDF cache only.
    """
    platform = get_active_platform()
    agents_list: List[Dict[str, Any]] = []
    agents_list.extend(
        get_default_agent_mode_config(user_id=user_id, user_source=user_source)
    )

    ddf = (
        ddf_agents
        if ddf_agents is not None
        else list_ddf_agents_cached(db, user_id, platform.base_url)
    )
    for agent in ddf:
        if not isinstance(agent, dict):
            continue
        agent = dict(agent)
        if not agent.get("config"):
            agent["config"] = {
                "name": agent.get("name"),
                "url": platform.base_url,
            }
        if not agent.get("id"):
            agent["id"] = str(uuid.uuid4())
        agents_list.append(agent)

    for agent in list_user_remote_agents(db, user_id):
        agent = dict(agent)
        if agent.get("mode") == "remote" and not agent.get("config"):
            agent["config"] = {
                "name": agent.get("name"),
                "url": agent.get("url"),
            }
        if not agent.get("id"):
            agent["id"] = str(uuid.uuid4())
        agents_list.append(agent)

    _overlay_saved_default_config_names(db, user_id, agents_list)
    _mark_featured_and_default_agents(agents_list)

    if (user_source or "").strip() == "user_agent":
        target = get_user_agent_default_agent_name()
        matched = find_agent_by_name(agents_list, target)
        if matched and matched.get("id"):
            matched_id = str(matched["id"])
            for agent in agents_list:
                if isinstance(agent, dict):
                    agent["is_default"] = str(agent.get("id") or "") == matched_id

    return agents_list


def find_catalog_agent(
    user_id: str,
    agent_id: str,
    db: DatabaseManager,
    *,
    user_source: str | None = None,
) -> Dict[str, Any] | None:
    """Look up one agent across the three catalog sources (no UserAgents snapshot)."""
    target = str(agent_id or "").strip()
    if not target:
        return None
    for agent in assemble_catalog_agents(user_id, db, user_source=user_source):
        if str(agent.get("id") or "").strip() == target:
            return agent
    return None


def _resolved_default_config_name(agent: Dict[str, Any] | None) -> str:
    if not isinstance(agent, dict):
        return ""
    value = agent.get("defult_config_name") or agent.get("default_config_name")
    return str(value).strip() if value is not None else ""


def _is_agent_pref_stub(agent: Dict[str, Any]) -> bool:
    """True when agents_mode entry only stores a model preference, not a full agent."""
    return not (
        agent.get("name")
        or agent.get("config")
        or agent.get("mode")
        or agent.get("url")
    )


def _overlay_saved_default_config_names(
    db: DatabaseManager, user_id: str, agents: List[Dict[str, Any]]
) -> None:
    """Apply per-agent defult_config_name saved via PUT /user_agent/save."""
    response = db.get(AgentModeSettings, filters={"user_id": user_id})
    if not (response.status and response.data):
        return
    prefs: Dict[str, str] = {}
    for entry in getattr(response.data[0], "agents_mode", None) or []:
        if not isinstance(entry, dict):
            continue
        aid = str(entry.get("id") or "").strip()
        name = _resolved_default_config_name(entry)
        if aid and name:
            prefs[aid] = name
    if not prefs:
        return
    for agent in agents:
        if not isinstance(agent, dict):
            continue
        aid = str(agent.get("id") or "").strip()
        if aid in prefs:
            agent["defult_config_name"] = prefs[aid]


def _upsert_agent_default_config_pref(
    db: DatabaseManager, user_id: str, agent_id: str, defult_config_name: str
) -> None:
    """Persist a user's default model choice for one catalog agent."""
    agent_id = str(agent_id or "").strip()
    name = str(defult_config_name or "").strip()
    if not agent_id or not name:
        return

    response = db.get(AgentModeSettings, filters={"user_id": user_id})
    if response.status and response.data:
        settings = response.data[0]
        agents = [
            dict(a) for a in (getattr(settings, "agents_mode", None) or [])
            if isinstance(a, dict)
        ]
        found = False
        for agent in agents:
            if str(agent.get("id") or "").strip() == agent_id:
                agent["defult_config_name"] = name
                found = True
                break
        if not found:
            agents.append({"id": agent_id, "defult_config_name": name})
        settings.agents_mode = agents
        result = db.upsert(settings)
        if not result.status:
            raise HTTPException(
                status_code=500,
                detail=getattr(result, "message", None) or "Failed to save model preference",
            )
        return

    settings = AgentModeSettings(
        user_id=user_id,
        agents_mode=[{"id": agent_id, "defult_config_name": name}],
    )
    result = db.upsert(settings)
    if not result.status:
        raise HTTPException(
            status_code=500,
            detail=getattr(result, "message", None) or "Failed to save model preference",
        )


def _apply_stored_agents_mode(
    defaults: List[Dict[str, Any]], stored: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """Merge stored agents_mode onto defaults without promoting model-pref stubs."""
    by_id: Dict[str, Dict[str, Any]] = {}
    for agent in defaults:
        if isinstance(agent, dict) and agent.get("id"):
            by_id[str(agent["id"])] = dict(agent)
    for agent in stored:
        if not isinstance(agent, dict) or not agent.get("id"):
            continue
        aid = str(agent["id"])
        name = _resolved_default_config_name(agent)
        if aid in by_id:
            if name:
                by_id[aid]["defult_config_name"] = name
            if not _is_agent_pref_stub(agent):
                merged = dict(by_id[aid])
                merged.update(agent)
                by_id[aid] = merged
        elif not _is_agent_pref_stub(agent):
            by_id[aid] = dict(agent)
    return list(by_id.values())


def patch_user_agent(
    db: DatabaseManager,
    user_id: str,
    patch: Dict[str, Any],
    *,
    user_source: str | None = None,
) -> Dict[str, Any]:
    """Merge a partial catalog update (typically id + defult_config_name).

    PUT /user_agent/save is used by the LLM selector before a session exists.
    It must not require mode, and must not insert a stub UserRemoteAgent row
    for DDF / platform catalog agents.
    """
    if not isinstance(patch, dict):
        raise HTTPException(status_code=400, detail="agent_config 须为对象。")
    agent_id = str(patch.get("id") or "").strip()
    if not agent_id:
        raise HTTPException(status_code=400, detail="请提供智能体 id。")

    existing = find_catalog_agent(
        user_id, agent_id, db, user_source=user_source
    )
    if not existing:
        raise HTTPException(
            status_code=404,
            detail="该智能体已经下线或更新，请刷新后重试。",
        )

    merged = dict(existing)
    for key, value in patch.items():
        if key == "id" or value is None:
            continue
        merged[key] = value
    merged["id"] = agent_id

    default_name = _resolved_default_config_name(patch)
    if default_name:
        _upsert_agent_default_config_pref(db, user_id, agent_id, default_name)
        merged["defult_config_name"] = default_name

    owned = get_user_remote_agent_row(db, user_id, agent_id)
    if owned is not None:
        payload = dict(owned.payload or {})
        for key, value in patch.items():
            if key == "id" or value is None:
                continue
            payload[key] = value
        payload["id"] = agent_id
        payload["mode"] = owned.mode or payload.get("mode") or "remote"
        if owned.name and not str(payload.get("name") or "").strip():
            payload["name"] = owned.name
        if default_name:
            payload["defult_config_name"] = default_name
        upsert_user_remote_agent(db, user_id, payload)
        return _agent_dict_from_remote_row(
            get_user_remote_agent_row(db, user_id, agent_id) or owned
        )

    return merged


def _truthy_env(value: str | None) -> bool:
    if value is None:
        return False
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def _int_env(name: str, default: int, min_value: int = 1) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return max(min_value, value)


def _float_env(name: str, default: float, min_value: float = 0.1) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = float(raw)
    except ValueError:
        return default
    return max(min_value, value)


def get_platform_auto_load_default_agent() -> bool:
    """Whether brand-new users (no personal default / usage) auto-select a platform agent."""
    return _truthy_env(os.getenv("DRSUI_AUTO_LOAD_DEFAULT_AGENT"))


def get_platform_default_agent_name() -> str | None:
    """Agent display name to match in /user_agents/list when auto-load is enabled."""
    raw = os.getenv("DRSUI_DEFAULT_AGENT_NAME")
    if raw is None:
        return None
    name = raw.strip()
    return name or None


def get_science_default_agent_name() -> str | None:
    """Science user 专用默认智能体名称 — 无视 auto_load 开关，存在即生效。"""
    raw = os.getenv("DRSCIENCE_DEFAULT_AGENT_NAME")
    if raw is None:
        return None
    name = raw.strip()
    return name or None


def get_user_agent_default_agent_name() -> str:
    """user_agent（CSNS）嵌入登录后默认展示的智能体名称。"""
    raw = os.getenv("DRUSER_AGENT_DEFAULT_AGENT_NAME")
    if raw is None:
        return "iPanda"
    return raw.strip() or "iPanda"


def find_agent_by_name(agents: List[Dict[str, Any]], name: str | None) -> Dict[str, Any] | None:
    target = (name or "").strip().lower()
    if not target:
        return None
    return next(
        (
            agent
            for agent in agents
            if (value := str(agent.get("name") or "").strip().lower())
            and (value == target or value.endswith(target) or target in value)
        ),
        None,
    )


def get_platform_agent_policy(user_source: str | None = None) -> Dict[str, Any]:
    source = (user_source or "").strip()
    science_name = get_science_default_agent_name()
    if source == "user_agent":
        science_name = get_user_agent_default_agent_name()
    return {
        "auto_load_default_agent": get_platform_auto_load_default_agent(),
        "default_agent_name": get_platform_default_agent_name(),
        "science_default_agent_name": science_name,
    }


def _resolve_platform_api_key(
    authorization: str | None,
    *,
    user_id: str | None = None,
    is_refresh: bool = False,
    user_source: str | None = None,
) -> str:
    """Prefer caller Bearer; else shared/personal key; else admin env.

    CSNS / science embed users (shared-key sources) resolve the shared key even
    when the client did not pass Bearer and is_refresh is false — otherwise the
    first catalog load can persist an empty DDF cache and stick on DocMaster.
    """
    apikey = ""
    if authorization and authorization.startswith("Bearer "):
        apikey = authorization[7:].strip()
    if apikey:
        return apikey

    from drsai_ui.drsai_adapter.personal_config_fetcher import uses_shared_api_key

    should_resolve_user_key = bool(user_id) and (
        is_refresh or uses_shared_api_key(user_source)
    )
    if should_resolve_user_key:
        try:
            from drsai_ui.drsai_adapter.singleton import (
                personal_key_config_fetcher as fetcher,
            )

            personal = fetcher.get_personal_key(
                username=user_id, user_source=user_source
            ).strip()
            if personal:
                return personal
        except Exception as exc:
            logger.warning(
                "Failed to resolve personal HepAI API key for user %s: %s",
                user_id,
                exc,
            )
    for env_name in ("HEPAI_APP_ADMIN_API_KEY", "HEPAI_API_KEY"):
        candidate = (os.getenv(env_name) or "").strip()
        if candidate:
            return candidate
    return ""


def _mark_featured_and_default_agents(agents: List[Dict[str, Any]]) -> None:
    """
    Add UI-related flags to agent dicts.

    Only environment overrides control which agent gets marked "featured" —
    there is no hard-coded builtin fallback. If no env matches, no agent is
    auto-featured; use DEFAULT_REMOTE_AGENTS ordering / is_default to drive
    the default instead.

    Environment overrides (optional):
    - DRSUI_FEATURED_AGENT_ID / _NAME / _OWNER: match rule for "featured" agent
    """
    featured_id = os.getenv("DRSUI_FEATURED_AGENT_ID")
    featured_name = os.getenv("DRSUI_FEATURED_AGENT_NAME")
    featured_owner = os.getenv("DRSUI_FEATURED_AGENT_OWNER")

    def _match(agent: Dict[str, Any]) -> bool:
        a_id = str(agent.get("id") or "").strip()
        a_name = str(agent.get("name") or "").strip()
        a_owner = str(agent.get("owner") or "").strip().lower()

        if featured_id and a_id == featured_id.strip():
            return True
        if featured_name and a_name == featured_name.strip():
            if featured_owner:
                return a_owner == featured_owner.strip().lower()
            return True
        if featured_owner and a_owner == featured_owner.strip().lower():
            return True
        return False

    featured_agent_id: str | None = None
    for agent in agents:
        if _match(agent):
            agent["featured"] = True
            featured_agent_id = str(agent.get("id") or "").strip() or featured_agent_id
            break

    # Default agent selection:
    # - If caller already set `is_default`, keep it.
    # - Else, optionally fall back to featured (keeps legacy "one highlighted agent" behavior).
    # NOTE: We intentionally DO NOT read env like DRSUI_DEFAULT_AGENT_ID here; downstream
    # deployments should control default via DEFAULT_REMOTE_AGENTS ordering.
    if not any(bool(a.get("is_default")) for a in agents):
        target_default_id = (featured_agent_id or "").strip() or None
        if target_default_id:
            for agent in agents:
                if str(agent.get("id") or "").strip() == target_default_id:
                    agent["is_default"] = True
                    break


def get_agent_mode_config(
        user_id: str,
) -> list[dict[str, str]]:
    """
    Legacy built-in agent pack (General / WebSurfer / BESIII) is disabled.

    The catalog for /user_agents/list is built from:
    - DEFAULT_REMOTE_AGENTS JSON (if set), else nothing here;
    - platform DDF agents (get_ddf_agents);
    - user remote/custom agents.

    To ship a fixed starter list, use the DEFAULT_REMOTE_AGENTS file or register
    workers on the HepAI platform instead of hard-coding builtins.
    """
    return []


def get_default_agent_mode_config(
    user_id: str, user_source: str | None = None
) -> List[Dict[str, Any]]:
    """Return the default agent list for a user.

    For CSNS embed users (``user_source=user_agent``), do not mark the first
    DEFAULT_REMOTE_AGENTS entry (often DocMaster) as ``is_default`` — their
    product default is iPanda from DDF / ``DRUSER_AGENT_DEFAULT_AGENT_NAME``.
    """
    agents_list = []
    DEFAULT_REMOTE_AGENTS = os.getenv("DEFAULT_REMOTE_AGENTS", None)
    loaded_default_remote_agents = False
    source = (user_source or "").strip()
    if DEFAULT_REMOTE_AGENTS:
        try:
            p = Path(DEFAULT_REMOTE_AGENTS).expanduser()
            if p.is_file():
                with p.open("r", encoding="utf-8") as f:
                    default_agents = json.load(f)
                for agent in default_agents:
                    if not agent.get("config"):
                        agent.update(
                            {
                                "config": {
                                    "name": agent.get("name"),
                                    "url": agent.get("url"),
                                    "apiKey": agent.get("apiKey"),
                                }
                            }
                        )
                    if not agent.get("id"):
                        agent.update({"id": str(uuid.uuid4())})
                # First entry is treated as default (downstream-friendly).
                # If the config already has an explicit `is_default`, we keep it.
                # CSNS users must not inherit DocMaster as is_default.
                if source == "user_agent":
                    for agent in default_agents:
                        if isinstance(agent, dict):
                            agent["is_default"] = False
                elif default_agents and not any(
                    bool(a.get("is_default")) for a in default_agents
                ):
                    default_agents[0]["is_default"] = True
                agents_list.extend(default_agents)
                loaded_default_remote_agents = True
            else:
                logger.warning(
                    "DEFAULT_REMOTE_AGENTS file not found: %s (fallback to builtin defaults)",
                    str(p),
                )
        except Exception:
            logger.exception(
                "Failed to load DEFAULT_REMOTE_AGENTS=%s (fallback to builtin defaults)",
                DEFAULT_REMOTE_AGENTS,
            )

    if not loaded_default_remote_agents:
        default_agents_mode = get_agent_mode_config(user_id=user_id)
        for agent_mode in default_agents_mode:
            if not agent_mode.get("id"):
                agent_mode["id"] = str(uuid.uuid4())
        agents_list.extend(default_agents_mode)
    return agents_list

async def get_agents_mode(
    user_id: str, db: DatabaseManager, user_source: str | None = None
) -> Dict:
    '''
    获取侧边栏的 mode 配置
    '''
    response = db.get(AgentModeSettings, filters={"user_id": user_id})
    if not response.status or not response.data:
        # create a default agents_mode
        default_agents_mode = get_default_agent_mode_config(
            user_id=user_id, user_source=user_source
        )
        for agent_mode in default_agents_mode:
            if not agent_mode.get("id"):
                agent_mode["id"] = str(uuid.uuid4())
        settings = AgentModeSettings(user_id=user_id, agents_mode=default_agents_mode)
        db.upsert(settings)
    else:
        settings = response.data[0]

    stored = [dict(a) for a in (settings.agents_mode or []) if isinstance(a, dict)]
    merged = _apply_stored_agents_mode(
        get_default_agent_mode_config(user_id=user_id, user_source=user_source),
        stored,
    )
    _mark_featured_and_default_agents(merged)
    payload = settings.model_dump(mode="json")
    payload["agents_mode"] = merged
    return {"status": True, "data": payload}
    

async def get_ddf_agents(user_id: str, authorization: str = Header(...), is_refresh: bool = False, db: DatabaseManager = None, user_source: str | None = None) -> Dict:
    '''
    获取后端的mode种类设置
    '''
    user_ddf_agents: UserDDFAgents | None = None
    agents_old: List[Dict[str, Any]] = []
    platform = get_active_platform()
    platform_url = _normalize_platform_url(platform.base_url)
    try:
        # Check cache first — prefer row matching current platform_url.
        response = db.get(UserDDFAgents, filters={"user_id": user_id})

        agents_name_old = {}
        if response.status and response.data:
            matched_row: UserDDFAgents | None = None
            legacy_row: UserDDFAgents | None = None
            for row in response.data:
                row_url = _normalize_platform_url(getattr(row, "platform_url", None))
                if row_url == platform_url:
                    matched_row = row
                    break
                if not row_url and legacy_row is None:
                    legacy_row = row
            user_ddf_agents = matched_row or legacy_row
            if user_ddf_agents is not None:
                agents_old = user_ddf_agents.agents or []
                agents_name_old = {
                    agent["name"]: agent
                    for agent in agents_old
                    if isinstance(agent, dict) and agent.get("name")
                }
                # Empty catalog is never a valid cache hit.
                if not is_refresh and agents_old:
                    time_diff = timedelta(hours=3)
                    if user_ddf_agents.updated_at:
                        time_diff = datetime.now() - user_ddf_agents.updated_at.replace(
                            tzinfo=None
                        )
                    row_url = _normalize_platform_url(
                        getattr(user_ddf_agents, "platform_url", None)
                    )
                    if row_url:
                        cache_matches_platform = row_url == platform_url
                    else:
                        cached_platform_urls = {
                            str((agent.get("config") or {}).get("url") or "").rstrip("/")
                            for agent in agents_old
                            if isinstance(agent, dict)
                        }
                        cache_matches_platform = cached_platform_urls == {platform_url}
                    if time_diff < timedelta(hours=2) and cache_matches_platform:
                        return {"status": True, "data": agents_old}

        apikey = _resolve_platform_api_key(
            authorization,
            user_id=user_id,
            is_refresh=is_refresh,
            user_source=user_source,
        )
        if not apikey:
            return {"status": True, "data": agents_old}

        client = HepAI(
            api_key=apikey,
            base_url=platform.base_url,
        )
        models = client.agents.list()

        timeout_seconds = _float_env("DRSUI_DDF_AGENT_INFO_TIMEOUT", default=5.0, min_value=0.5)
        max_concurrency = _int_env("DRSUI_DDF_AGENT_INFO_MAX_CONCURRENCY", default=8, min_value=1)
        semaphore = asyncio.Semaphore(max_concurrency)

        async def _fetch_model_info(model_id: str) -> Dict[str, Any] | None:
            try:
                async with semaphore:
                    worker = HRModel.connect(
                        name=model_id,
                        api_key=apikey,
                        base_url=platform.base_url,
                    )
                    agent_info: dict | WorkerInfo = await asyncio.wait_for(
                        asyncio.to_thread(worker.get_info),
                        timeout=timeout_seconds,
                    )
                if isinstance(agent_info, WorkerInfo):
                    return None
                agent_info.update({"mode": "ddf"})
                agent_info.update({"owner": agent_info.get("author")})
                agent_info.update(
                    {
                        "config": {
                            "name": agent_info.get("name"),
                            "url": platform.base_url,
                        }
                    }
                )
                if agent_info.get("name") in agents_name_old:
                    old = agents_name_old[agent_info.get("name")]
                    agent_info.update({"id": old["id"]})
                    old_default = old.get("defult_config_name") or old.get(
                        "default_config_name"
                    )
                    if old_default and not agent_info.get("defult_config_name"):
                        agent_info["defult_config_name"] = old_default
                else:
                    agent_info.update({"id": str(uuid.uuid4())})
                return agent_info
            except Exception:
                return None

        model_ids = []
        for model in getattr(models, "data", None) or []:
            if isinstance(model, dict):
                mid = str(model.get("id") or "").strip()
            else:
                mid = str(getattr(model, "id", None) or "").strip()
            if mid and mid != "hepai/custom-model":
                model_ids.append(mid)
        if model_ids:
            fetched_agents = await asyncio.gather(
                *(_fetch_model_info(model_id) for model_id in model_ids)
            )
        else:
            fetched_agents = []
        agents = [agent for agent in fetched_agents if agent]

        # list() succeeded. Zero listed workers is a real empty catalog
        # (last DDF agent stopped/unregistered) and must clear the cache.
        # Keep the old cache only when workers were listed but every
        # get_info() failed — a transient timeout must not wipe the catalog.
        listed_count = len(model_ids)
        if not agents and agents_old and listed_count:
            logger.warning(
                "DDF get_info failed for all %d listed workers for user %s; keeping cached catalog",
                listed_count,
                user_id,
            )
            agents = agents_old

        if agents:
            if user_ddf_agents is not None:
                if agents != agents_old or _normalize_platform_url(
                    getattr(user_ddf_agents, "platform_url", None)
                ) != platform_url:
                    user_ddf_agents.agents = agents
                    user_ddf_agents.platform_url = platform_url
                    db.upsert(user_ddf_agents)
            else:
                db.upsert(
                    UserDDFAgents(
                        user_id=user_id,
                        platform_url=platform_url,
                        agents=agents,
                    )
                )
        elif user_ddf_agents is not None:
            try:
                db.delete(UserDDFAgents, filters={"user_id": user_id})
                if agents_old:
                    logger.info(
                        "Cleared DDF cache for user %s after HepAI listed 0 workers (was %d cached)",
                        user_id,
                        len(agents_old),
                    )
            except Exception:
                logger.warning(
                    "Failed to clear empty DDF cache for user %s", user_id
                )

        return {"status": True, "data": agents}

    except Exception as e:
        logger.warning("Failed to refresh DDF agents for user %s: %s", user_id, str(e))
        return {"status": True, "data": agents_old}

async def get_user_remote_agents(user_id: str, db: DatabaseManager = None) -> Dict:
    '''
    获取用户保存的远程智能体列表（一行一智能体；必要时从旧 JSON blob 迁移）
    '''
    try:
        return {"status": True, "data": list_user_remote_agents(db, user_id)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


async def get_user_agents(
    user_id: str,
    authorization: str = Header(...),
    is_refresh: bool = False,
    db: DatabaseManager = None,
    user_source: str | None = None,
) -> Dict:
    '''
    组装用户可见的智能体目录（只读合并，不写 UserAgents 快照）：

    1. 系统默认（DEFAULT_REMOTE_AGENTS 文件，不入库）
    2. DDF 平台目录（UserDDFAgents 缓存；is_refresh / 过期时回源）
    3. 用户远程/自定义（UserRemoteAgent 一行一智能体）

    前端拿到后请直接将该字段传入 /ws/run_id 的 settings_config.agent_mode_config。
    '''
    ddf_result = await get_ddf_agents(
        user_id=user_id,
        authorization=authorization,
        is_refresh=is_refresh,
        db=db,
        user_source=user_source,
    )
    agents_list = assemble_catalog_agents(
        user_id,
        db,
        ddf_agents=ddf_result.get("data") or [],
        user_source=user_source,
    )
    return {"status": True, "data": agents_list}
