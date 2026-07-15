"""Stable, authenticated API surface shared by Windows and mobile clients."""
from __future__ import annotations

import asyncio
import json
import os
import re
from pathlib import Path
import shutil
import tempfile
from typing import Any, Literal

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from .....agent_factory.agent_mode_cofigs import get_user_agents
from ...datamodel.db import Run, RunStatus, Session, UserAgents, UserRemoteAgents
from ..deps import get_db, get_websocket_manager
from ..native_agent_models import public_agent
from ..native_attachments import NativeAttachmentStore, get_native_attachment_store
from ..native_agent_security import resolve_and_validate_agent_execution_targets
from ..native_agent_stream import NativeSseAdapter, NativeStreamSocket
from ..native_auth import NativeIdentity, get_native_identity
from .agent_worker import (
    RecordAgentUsageRequest,
    SetDefaultAgentRequest,
    get_recent_user_agents,
    get_user_default_agent,
    record_user_agent_usage,
    set_user_default_agent,
)

router = APIRouter()


class NativeAgentSelection(BaseModel):
    agent_id: str


class NativeChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(min_length=1, max_length=16000)


class NativeAgentChatRequest(BaseModel):
    messages: list[NativeChatMessage] = Field(min_length=1, max_length=40)
    stream: bool = True
    thread_id: str = Field(min_length=1, max_length=160, pattern=r"^[a-zA-Z0-9_.:-]+$")
    run_id: str | None = Field(default=None, max_length=160)
    model: str | None = Field(default=None, max_length=120)
    attachments: list[dict[str, Any]] = Field(default_factory=list, max_length=20)
    metadata: dict[str, Any] = Field(default_factory=dict)


class NativeAgentInputResponse(BaseModel):
    response: str | dict[str, Any]


@router.get("/agents")
async def list_native_agents(
    refresh: bool = False,
    authorization: str = Header(...),
    identity: NativeIdentity = Depends(get_native_identity),
    db=Depends(get_db),
) -> dict[str, Any]:
    catalog = await get_user_agents(
        user_id=identity.user_id,
        authorization=authorization,
        is_refresh=refresh,
        db=db,
    )
    default_result = await get_user_default_agent(user_id=identity.user_id, db=db)
    recent_result = await get_recent_user_agents(user_id=identity.user_id, limit=50, db=db)
    default_id = (default_result.get("data") or {}).get("default_agent_id")
    recent = {
        str(item.get("agent_id")): item
        for item in recent_result.get("data", [])
        if isinstance(item, dict) and item.get("agent_id")
    }
    remote_result = db.get(UserRemoteAgents, filters={"user_id": identity.user_id})
    remote_rows = remote_result.data if remote_result.status and remote_result.data else []
    owned_ids = {
        str(agent.get("id") or "")
        for row in remote_rows
        for agent in (row.agents or [])
        if isinstance(agent, dict) and agent.get("id")
    }
    agents = [
        public_agent(
            agent,
            is_default=str(agent.get("id") or "") == str(default_id or ""),
            recent=recent.get(str(agent.get("id") or "")),
            catalog_group="mine" if str(agent.get("id") or "") in owned_ids else "official",
        )
        for agent in catalog.get("data", [])
        if isinstance(agent, dict) and agent.get("id")
    ]
    if _native_chat_enabled():
        for public_item in agents:
            capabilities = set(public_item.get("capabilities") or [])
            capabilities.update({"attachment-upload", "image-input", "document-input", "artifact-output"})
            public_item["capabilities"] = sorted(capabilities)
    return {
        "status": True,
        "api_version": "native-v1",
        "capabilities": [
            "agents",
            "agent-details",
            "agent-default",
            "agent-usage",
        ] + ([
            "agent-chat",
            "agent-stop",
            "agent-files",
            "agent-input-request",
            "attachment-upload",
            "image-input",
            "document-input",
            "artifact-output",
        ] if _native_chat_enabled() else []),
        "data": {"agents": agents, "default_agent_id": default_id},
    }


@router.post("/attachments")
async def upload_native_attachment(
    file: UploadFile = File(...),
    thread_id: str = Form(...),
    run_id: str | None = Form(default=None),
    identity: NativeIdentity = Depends(get_native_identity),
    store: NativeAttachmentStore = Depends(get_native_attachment_store),
) -> dict[str, Any]:
    _require_native_chat_enabled()
    _validate_native_thread_id(thread_id)
    if run_id is not None:
        _validate_native_thread_id(run_id)
    store.cleanup_expired()
    item = await store.save(file, identity.user_id, thread_id, run_id)
    return {"status": True, "data": item.public()}


@router.get("/attachments/{attachment_id}/context")
async def get_native_attachment_context(
    attachment_id: str,
    identity: NativeIdentity = Depends(get_native_identity),
    store: NativeAttachmentStore = Depends(get_native_attachment_store),
) -> dict[str, Any]:
    _require_native_chat_enabled()
    item = store.get(attachment_id, identity.user_id)
    return {"status": True, "data": store.context(item)}


@router.get("/attachments/{attachment_id}/content")
async def download_native_attachment(
    attachment_id: str,
    identity: NativeIdentity = Depends(get_native_identity),
    store: NativeAttachmentStore = Depends(get_native_attachment_store),
) -> FileResponse:
    _require_native_chat_enabled()
    item = store.get(attachment_id, identity.user_id)
    return FileResponse(item.path, filename=item.name, media_type=item.mime_type)


@router.delete("/attachments/{attachment_id}")
async def delete_native_attachment(
    attachment_id: str,
    identity: NativeIdentity = Depends(get_native_identity),
    store: NativeAttachmentStore = Depends(get_native_attachment_store),
) -> dict[str, Any]:
    _require_native_chat_enabled()
    store.delete(attachment_id, identity.user_id)
    return {"status": True, "data": {"id": attachment_id, "status": "deleted"}}


@router.get("/agents/default")
async def get_native_default_agent(
    identity: NativeIdentity = Depends(get_native_identity),
    db=Depends(get_db),
) -> dict[str, Any]:
    return await get_user_default_agent(user_id=identity.user_id, db=db)


@router.put("/agents/default")
async def set_native_default_agent(
    selection: NativeAgentSelection,
    identity: NativeIdentity = Depends(get_native_identity),
    db=Depends(get_db),
) -> dict[str, Any]:
    _owned_agent(db, identity.user_id, selection.agent_id)
    return await set_user_default_agent(
        request=SetDefaultAgentRequest(user_id=identity.user_id, agent_id=selection.agent_id),
        db=db,
    )


@router.get("/agents/{agent_id}")
async def get_native_agent(
    agent_id: str,
    identity: NativeIdentity = Depends(get_native_identity),
    db=Depends(get_db),
) -> dict[str, Any]:
    agent = _owned_agent(db, identity.user_id, agent_id)
    return {"status": True, "data": public_agent(agent)}


@router.post("/agents/{agent_id}/usage")
async def record_native_agent_usage(
    agent_id: str,
    identity: NativeIdentity = Depends(get_native_identity),
    db=Depends(get_db),
) -> dict[str, Any]:
    _owned_agent(db, identity.user_id, agent_id)
    return await record_user_agent_usage(
        request=RecordAgentUsageRequest(user_id=identity.user_id, agent_id=agent_id),
        db=db,
    )


@router.post("/agents/{agent_id}/chat")
async def chat_with_native_agent(
    agent_id: str,
    request: NativeAgentChatRequest,
    identity: NativeIdentity = Depends(get_native_identity),
    db=Depends(get_db),
    manager=Depends(get_websocket_manager),
    attachment_store: NativeAttachmentStore = Depends(get_native_attachment_store),
) -> StreamingResponse:
    _require_native_chat_enabled()
    if not isinstance(attachment_store, NativeAttachmentStore):
        # Direct function calls in compatibility tests do not resolve FastAPI
        # dependency defaults; production requests always receive the store.
        attachment_store = get_native_attachment_store()
    if not request.stream:
        raise HTTPException(status_code=400, detail="Native agent chat requires stream=true")
    agent = _owned_agent(db, identity.user_id, agent_id)
    try:
        allowed_hosts = await resolve_and_validate_agent_execution_targets(agent)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    latest_user = next((item.content for item in reversed(request.messages) if item.role == "user"), "")
    if not latest_user:
        raise HTTPException(status_code=400, detail="A user message is required")
    runtime_files = _resolve_native_attachments(
        request.attachments,
        identity.user_id,
        request.thread_id,
        attachment_store,
    )
    runtime_files, materialized_root = _materialize_native_files(runtime_files)
    session, run = _get_or_create_native_run(db, identity.user_id, request.thread_id, agent)
    if session.id is None or run.id is None:
        raise HTTPException(status_code=500, detail="Unable to initialize native agent run")
    socket = NativeStreamSocket()
    if not await manager.connect(socket, run.id):
        raise HTTPException(status_code=503, detail="Unable to connect agent runtime")
    settings_config: dict[str, Any] = {
        "agent_id": agent_id,
        "agent_mode_config": agent,
        "native_allowed_hosts": sorted(allowed_hosts),
    }
    if request.model:
        settings_config["defult_config_name"] = request.model
    team_config = {
        "name": "Native Agent Team",
        "participants": [],
        "team_type": "RoundRobinGroupChat",
        "component_type": "team",
    }

    async def execute() -> None:
        try:
            await manager.start_stream(
                run.id,
                latest_user,
                team_config,
                settings_config,
                files=runtime_files,
            )
        except asyncio.CancelledError:
            raise
        except Exception:
            await socket.send_json({
                "type": "error",
                "error": "Agent execution failed. Check the selected agent status and try again.",
            })
        finally:
            if materialized_root:
                shutil.rmtree(materialized_root, ignore_errors=True)

    execution = asyncio.create_task(execute())

    async def event_stream():
        adapter = NativeSseAdapter()
        terminal = False
        try:
            while not terminal:
                try:
                    message = await asyncio.wait_for(socket.queue.get(), timeout=15)
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
                    continue
                _stage_native_artifacts(message, attachment_store, identity.user_id, request.thread_id, str(run.id))
                frames, terminal = adapter.encode(message)
                for frame in frames:
                    yield frame
        finally:
            if not terminal and not execution.done():
                await manager.stop_run(run.id, "Native client disconnected")
                execution.cancel()
            await manager.disconnect(run.id, stop_run=False)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "X-OpenDrSai-Run-Id": str(run.id),
        },
    )


@router.post("/agents/{agent_id}/threads/{thread_id}/stop")
async def stop_native_agent_thread(
    agent_id: str,
    thread_id: str,
    identity: NativeIdentity = Depends(get_native_identity),
    db=Depends(get_db),
    manager=Depends(get_websocket_manager),
) -> dict[str, Any]:
    _require_native_chat_enabled()
    _validate_native_thread_id(thread_id)
    _owned_agent(db, identity.user_id, agent_id)
    run = _find_native_run(db, identity.user_id, thread_id)
    if not run or run.id is None:
        raise HTTPException(status_code=404, detail="Native agent run not found")
    await manager.stop_run(run.id, "Stopped by native client")
    return {"status": True, "data": {"thread_id": thread_id, "run_id": str(run.id), "status": "stopped"}}


@router.post("/agents/{agent_id}/threads/{thread_id}/input")
async def respond_to_native_agent_input(
    agent_id: str,
    thread_id: str,
    payload: NativeAgentInputResponse,
    identity: NativeIdentity = Depends(get_native_identity),
    db=Depends(get_db),
    manager=Depends(get_websocket_manager),
) -> dict[str, Any]:
    _require_native_chat_enabled()
    _validate_native_thread_id(thread_id)
    if len(json.dumps(payload.response, ensure_ascii=False)) > 16_000:
        raise HTTPException(status_code=413, detail="Native agent input response is too large")
    _owned_agent(db, identity.user_id, agent_id)
    run = _find_native_run(db, identity.user_id, thread_id)
    if not run or run.id is None:
        raise HTTPException(status_code=404, detail="Native agent run not found")
    await manager.handle_input_response(run.id, payload.response)
    return {"status": True, "data": {"thread_id": thread_id, "run_id": str(run.id), "status": "continued"}}


def _get_or_create_native_run(db, user_id: str, thread_id: str, agent: dict[str, Any]) -> tuple[Session, Run]:
    name = _native_session_name(thread_id)
    result = db.get(Session, filters={"user_id": user_id, "name": name}, return_json=False)
    if result.status and result.data:
        session = result.data[0]
    else:
        saved = db.upsert(Session(user_id=user_id, name=name, agent_mode_config={"agent_id": agent.get("id")}), return_json=False)
        if not saved.status or not saved.data:
            raise HTTPException(status_code=500, detail="Unable to create native agent session")
        session = saved.data
    runs = db.get(Run, filters={"session_id": session.id, "user_id": user_id}, return_json=False)
    if runs.status and runs.data:
        return session, runs.data[0]
    saved_run = db.upsert(Run(session_id=session.id, user_id=user_id, status=RunStatus.CREATED), return_json=False)
    if not saved_run.status or not saved_run.data:
        raise HTTPException(status_code=500, detail="Unable to create native agent run")
    return session, saved_run.data


def _find_native_run(db, user_id: str, thread_id: str) -> Run | None:
    sessions = db.get(Session, filters={"user_id": user_id, "name": _native_session_name(thread_id)}, return_json=False)
    if not sessions.status or not sessions.data:
        return None
    runs = db.get(Run, filters={"session_id": sessions.data[0].id, "user_id": user_id}, return_json=False)
    return runs.data[0] if runs.status and runs.data else None


def _native_session_name(thread_id: str) -> str:
    return f"native:{thread_id[:160]}"


def _validate_native_thread_id(thread_id: str) -> None:
    if not re.fullmatch(r"[a-zA-Z0-9_.:-]{1,160}", thread_id):
        raise HTTPException(status_code=400, detail="Native thread id is invalid")


def _native_chat_enabled() -> bool:
    return os.getenv("OPENDRSAI_NATIVE_AGENT_CHAT_ENABLED", "true").strip().lower() not in {"0", "false", "off", "no"}


def _require_native_chat_enabled() -> None:
    if not _native_chat_enabled():
        raise HTTPException(status_code=404, detail="Native agent chat is disabled")


def _public_attachment_metadata(attachments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    public: list[dict[str, Any]] = []
    for item in attachments[:20]:
        name = item.get("name")
        kind = item.get("kind")
        if isinstance(name, str) and name and isinstance(kind, str):
            public.append({"name": name[:260], "kind": kind[:40]})
    return public


def _resolve_native_attachments(
    attachments: list[dict[str, Any]],
    user_id: str,
    thread_id: str,
    store: NativeAttachmentStore,
) -> list[dict[str, Any]]:
    if not attachments:
        return []
    with_ids = [isinstance(item, dict) and isinstance(item.get("id"), str) for item in attachments]
    if all(with_ids):
        return [item.runtime_file() for item in store.resolve_many(attachments, user_id, thread_id)]
    if any(with_ids):
        raise HTTPException(
            status_code=422,
            detail={"code": "attachment_invalid", "message": "Attachment references cannot mix IDs and legacy metadata"},
        )
    # Desktop v1.4.5 compatibility: retain public name/kind metadata while
    # discarding every client path and URL. New clients must upload and use IDs.
    return _public_attachment_metadata(attachments)


def _stage_native_artifacts(
    message: dict[str, Any],
    store: NativeAttachmentStore,
    user_id: str,
    thread_id: str,
    run_id: str,
) -> None:
    if message.get("type") != "message_files":
        return
    data = message.get("data") if isinstance(message.get("data"), dict) else {}
    files = data.get("files") if isinstance(data.get("files"), list) else []
    staged: list[dict[str, Any]] = []
    for raw in files[:20]:
        if not isinstance(raw, dict):
            continue
        path = raw.get("path")
        if not isinstance(path, str):
            continue
        try:
            item = store.import_runtime_file(Path(path), user_id, thread_id, run_id)
            staged.append({**raw, **item.public(), "path": item.name, "action": "artifact"})
        except HTTPException:
            # Preserve the existing public name/path event for compatibility,
            # but do not expose a download ID for unavailable or unsafe files.
            staged.append(raw)
    data["files"] = staged
    message["data"] = data


def _materialize_native_files(files: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], str | None]:
    if not any(item.get("id") and item.get("path") for item in files):
        return files, None
    root = tempfile.mkdtemp(prefix="opendrsai-native-run-")
    materialized: list[dict[str, Any]] = []
    try:
        for item in files:
            source = Path(str(item.get("path") or ""))
            if not item.get("id") or not source.is_file():
                materialized.append(item)
                continue
            name = re.sub(r"[^\w.()\-\u4e00-\u9fff ]", "_", str(item.get("name") or source.name))[:200]
            target = Path(root) / f"{item['id']}-{name}"
            shutil.copyfile(source, target)
            materialized.append({**item, "path": str(target)})
        return materialized, root
    except Exception:
        shutil.rmtree(root, ignore_errors=True)
        raise


def _owned_agent(db, user_id: str, agent_id: str) -> dict[str, Any]:
    result = db.get(UserAgents, filters={"user_id": user_id})
    agents = result.data[0].agents or [] if result.status and result.data else []
    agent = next((item for item in agents if str(item.get("id") or "") == agent_id), None)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not available")
    return agent
