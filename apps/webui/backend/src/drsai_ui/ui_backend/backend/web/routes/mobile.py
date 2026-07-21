"""Authenticated, stable API surface for the native OpenDrSai clients."""
from __future__ import annotations

from typing import Any
from datetime import timedelta
import os

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .....drsai_adapter.sso.jwt import ACCESS_TOKEN_EXPIRE_MINUTES, REFRESH_TOKEN_EXPIRE_DAYS, create_jwt_token, get_current_user_id
from ...datamodel import Message, Run, RunStatus, Session
from ...datamodel.db import AgentModeSettings, UserAgents
from ..deps import get_db, get_websocket_manager

router = APIRouter()


class CreateConversation(BaseModel):
    title: str = "新对话"
    agent_id: str
    agent_config: dict[str, Any] = {}


class SetDefaultAgent(BaseModel):
    agent_id: str


class RenameConversation(BaseModel):
    title: str


class DevLogin(BaseModel):
    user_id: str = "android-dev"


@router.post("/auth/dev-login")
async def dev_login(payload: DevLogin) -> dict:
    """Local-only test identity. It is disabled unless explicitly enabled."""
    if os.getenv("OPENDRSAI_MOBILE_DEV_AUTH", "").lower() not in {"1", "true", "yes"}:
        raise HTTPException(status_code=404, detail="Not found")
    user_id = payload.user_id.strip()
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id is required")
    access = create_jwt_token({"sub": user_id}, timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    refresh = create_jwt_token({"sub": user_id}, timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS))
    return {"status": True, "data": {"user_id": user_id, "access_token": access.access_token, "refresh_token": refresh.access_token}}


@router.post("/auth/logout")
async def logout(user_id: str = Depends(get_current_user_id)) -> dict:
    """Acknowledge logout; native clients then erase their encrypted tokens."""
    return {"status": True, "data": {"logged_out": True, "user_id": user_id}}


def _owned_session(db, session_id: int, user_id: str) -> Session:
    result = db.get(Session, filters={"id": session_id, "user_id": user_id}, return_json=False)
    if not result.status or not result.data:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return result.data[0]


def _owned_run(db, run_id: int, user_id: str) -> Run:
    result = db.get(Run, filters={"id": run_id, "user_id": user_id}, return_json=False)
    if not result.status or not result.data:
        raise HTTPException(status_code=404, detail="Run not found")
    return result.data[0]


@router.get("/agents")
async def list_agents(user_id: str = Depends(get_current_user_id), db=Depends(get_db)) -> dict:
    result = db.get(UserAgents, filters={"user_id": user_id}, return_json=False)
    agents = list(result.data[0].agents or []) if result.status and result.data else []
    if not agents:
        from .....agent_factory.agent_mode_cofigs import get_default_agent_mode_config
        agents = list(get_default_agent_mode_config(user_id=user_id) or [])
    settings = db.get(AgentModeSettings, filters={"user_id": user_id}, return_json=False)
    default_id = getattr(settings.data[0], "default_agent_id", None) if settings.status and settings.data else None
    for agent in agents:
        agent["is_default"] = str(agent.get("id")) == str(default_id)
        agent.setdefault("available", True)
    return {"status": True, "data": {"items": agents, "default_agent_id": default_id}}


@router.put("/agents/default")
async def set_default_agent(payload: SetDefaultAgent, user_id: str = Depends(get_current_user_id), db=Depends(get_db)) -> dict:
    owned = db.get(UserAgents, filters={"user_id": user_id}, return_json=False)
    ids = {str(a.get("id")) for a in (owned.data[0].agents or [])} if owned.status and owned.data else set()
    if payload.agent_id not in ids:
        raise HTTPException(status_code=404, detail="Agent not available")
    result = db.get(AgentModeSettings, filters={"user_id": user_id}, return_json=False)
    if result.status and result.data:
        settings = result.data[0]
        settings.default_agent_id = payload.agent_id
    else:
        settings = AgentModeSettings(user_id=user_id, agents_mode=[], default_agent_id=payload.agent_id)
    db.upsert(settings)
    return {"status": True, "data": {"default_agent_id": payload.agent_id}}


@router.get("/conversations")
async def list_conversations(user_id: str = Depends(get_current_user_id), db=Depends(get_db)) -> dict:
    result = db.get(Session, filters={"user_id": user_id}, order="updated_at desc", return_json=False)
    items = [s.model_dump(mode="json") for s in (result.data or [])] if result.status else []
    return {"status": True, "data": {"items": items}}


@router.post("/conversations")
async def create_conversation(payload: CreateConversation, user_id: str = Depends(get_current_user_id), db=Depends(get_db)) -> dict:
    session = Session(user_id=user_id, name=payload.title, agent_mode_config={"mode": payload.agent_config.get("mode", "drsai"), "config": payload.agent_config})
    saved = db.upsert(session, return_json=False)
    if not saved.status or not saved.data:
        raise HTTPException(status_code=400, detail=saved.message)
    session = saved.data[0] if isinstance(saved.data, list) else saved.data
    run_saved = db.upsert(Run(session_id=session.id, user_id=user_id, status=RunStatus.CREATED), return_json=False)
    if not run_saved.status or not run_saved.data:
        db.delete(filters={"id": session.id, "user_id": user_id}, model_class=Session)
        raise HTTPException(status_code=500, detail="Unable to create conversation run")
    run = run_saved.data[0] if isinstance(run_saved.data, list) else run_saved.data
    return {"status": True, "data": {"conversation": session.model_dump(mode="json"), "run_id": str(run.id)}}


@router.get("/conversations/{session_id}")
async def get_conversation(session_id: int, user_id: str = Depends(get_current_user_id), db=Depends(get_db)) -> dict:
    session = _owned_session(db, session_id, user_id)
    runs = db.get(Run, filters={"session_id": session_id, "user_id": user_id}, order="created_at asc", return_json=False)
    payload = []
    for run in runs.data or []:
        messages = db.get(Message, filters={"run_id": run.id}, order="created_at asc", return_json=False)
        payload.append({"id": str(run.id), "status": run.status, "messages": [m.model_dump(mode="json") for m in (messages.data or [])]})
    return {"status": True, "data": {"conversation": session.model_dump(mode="json"), "runs": payload}}


@router.put("/conversations/{session_id}")
async def rename_conversation(payload: RenameConversation, session_id: int, user_id: str = Depends(get_current_user_id), db=Depends(get_db)) -> dict:
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="title is required")
    session = _owned_session(db, session_id, user_id)
    session.name = title[:80]
    saved = db.upsert(session, return_json=False)
    if not saved.status:
        raise HTTPException(status_code=400, detail=saved.message)
    return {"status": True, "data": {"conversation": session.model_dump(mode="json")}}


@router.delete("/conversations/{session_id}")
async def delete_conversation(session_id: int, user_id: str = Depends(get_current_user_id), db=Depends(get_db)) -> dict:
    _owned_session(db, session_id, user_id)
    db.delete(filters={"id": session_id, "user_id": user_id}, model_class=Session)
    return {"status": True, "data": {"deleted": True}}


@router.post("/runs/{run_id}/stop")
async def stop_run(run_id: int, user_id: str = Depends(get_current_user_id), db=Depends(get_db), manager=Depends(get_websocket_manager)) -> dict:
    _owned_run(db, run_id, user_id)
    await manager.stop_run(run_id, reason="Stopped from Android")
    return {"status": True, "data": {"status": "stopped"}}
