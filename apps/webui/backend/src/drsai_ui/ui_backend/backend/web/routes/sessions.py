# api/routes/sessions.py
import re
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from loguru import logger
from pydantic import BaseModel, Field

from ...datamodel import Message, Run, Session, RunStatus
from ..deps import get_db

router = APIRouter()

# Non-image extensions that should NOT be rendered as inline markdown images
_NON_IMAGE_EXTENSIONS = (
    "json", "txt", "csv", "xml", "yaml", "yml", "toml", "ini", "cfg",
    "py", "js", "ts", "jsx", "tsx", "html", "css", "md", "rst",
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
    "zip", "tar", "gz", "rar", "7z",
)

# Pattern to match markdown image syntax with data URIs for non-image files
_NON_IMAGE_MD_PATTERN = re.compile(
    r'!\[[^\]]*\]\(data:image/(' + '|'.join(_NON_IMAGE_EXTENSIONS) + r');base64,[^)]+\)\n*'
)


def _clean_historical_markdown_images(content: str) -> str:
    """Remove markdown image syntax for files that are not real images (json, csv, etc.)"""
    if not isinstance(content, str):
        return content
    return _NON_IMAGE_MD_PATTERN.sub("", content)

_SHARE_FLAG = "_share_enabled"


def _is_session_shared(session: Session) -> bool:
    cfg = session.agent_mode_config or {}
    return bool(cfg.get(_SHARE_FLAG))


def _set_session_shared(session: Session, enabled: bool) -> Session:
    cfg = dict(session.agent_mode_config or {})
    if enabled:
        cfg[_SHARE_FLAG] = True
    else:
        cfg.pop(_SHARE_FLAG, None)
    session.agent_mode_config = cfg
    return session


def _clean_message(msg: Any) -> Any:
    """Clean a message's content by removing non-image markdown image syntax."""
    if not isinstance(msg, dict):
        return msg
    config = msg.get("config")
    if isinstance(config, dict):
        content = config.get("content")
        if isinstance(content, str):
            config["content"] = _clean_historical_markdown_images(content)
    elif isinstance(msg.get("content"), str):
        msg["content"] = _clean_historical_markdown_images(msg["content"])
    return msg


def _build_runs_payload(db, session_id: int, session: Optional[Session] = None) -> List[Dict[str, Any]]:
    runs = db.get(Run, filters={"session_id": session_id}, order="asc", return_json=False)
    if not runs.status:
        raise HTTPException(status_code=500, detail="Database error while fetching runs")

    run_data: List[Dict[str, Any]] = []
    if not runs.data:
        # Desktop shares may store a frozen snapshot on the session with no Run rows yet.
        synthetic = _synthetic_share_run(session, session_id)
        return [synthetic] if synthetic else run_data

    for run in runs.data:
        try:
            messages = db.get(
                Message,
                filters={"run_id": run.id},
                order="asc",
                return_json=False,
            )
            if not messages.status:
                logger.error(f"Failed to fetch messages for run {run.id}")
                messages.data = []

            message_payload = [
                _clean_message(_message_as_dict(m)) for m in (messages.data or [])
            ]
            used_share_snapshot = False
            if not message_payload:
                message_payload = _share_messages_from_session(session)
                used_share_snapshot = bool(message_payload)

            # Desktop shares often leave the placeholder run in CREATED with no
            # Message rows. Injected snapshot content must not keep "created",
            # or the share page spins on "Processing" forever.
            status_value = (
                RunStatus.STOPPED.value
                if used_share_snapshot
                else (run.status.value if hasattr(run.status, "value") else run.status)
            )

            run_data.append(
                {
                    "id": str(run.id),
                    "created_at": run.created_at,
                    "status": status_value,
                    "task": run.task or (message_payload[0].get("config") if message_payload else None),
                    "team_result": run.team_result,
                    "messages": message_payload,
                    "input_request": getattr(run, "input_request", None),
                    "session_id": session_id,
                }
            )
        except Exception as e:
            logger.error(f"Error processing run {run.id}: {str(e)}")
            run_data.append(
                {
                    "id": str(run.id),
                    "created_at": run.created_at,
                    "status": "ERROR",
                    "task": run.task,
                    "team_result": None,
                    "messages": [],
                    "error": f"Failed to process run: {str(e)}",
                    "input_request": getattr(run, "input_request", None),
                    "session_id": session_id,
                }
            )
    return run_data


def _message_as_dict(message: Any) -> Dict[str, Any]:
    if isinstance(message, dict):
        return message
    if hasattr(message, "model_dump"):
        return message.model_dump(mode="json")
    return dict(message)


def _share_messages_from_session(session: Optional[Session]) -> List[Dict[str, Any]]:
    if session is None:
        return []
    cfg = session.agent_mode_config or {}
    raw = cfg.get("_share_messages")
    if not isinstance(raw, list):
        return []
    messages: List[Dict[str, Any]] = []
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            continue
        source = str(item.get("source") or "").strip() or "assistant"
        content = item.get("content")
        if not isinstance(content, str) or not content.strip():
            continue
        messages.append(
            {
                "id": item.get("id") or f"share-msg-{index}",
                "config": {
                    "source": source,
                    "content": content,
                    "message_type": item.get("message_type") or "text",
                },
                "session_id": getattr(session, "id", None),
            }
        )
    return messages


def _synthetic_share_run(session: Optional[Session], session_id: int) -> Optional[Dict[str, Any]]:
    messages = _share_messages_from_session(session)
    if not messages:
        return None
    return {
        "id": f"share-{session_id}",
        "created_at": getattr(session, "created_at", None),
        "status": RunStatus.STOPPED.value,
        "task": messages[0].get("config"),
        "team_result": None,
        "messages": messages,
        "input_request": None,
        "session_id": session_id,
    }


def _get_owned_session(db, session_id: int, user_id: str) -> Session:
    response = db.get(Session, filters={"id": session_id, "user_id": user_id}, return_json=False)
    if not response.status:
        raise HTTPException(status_code=500, detail="Database error while fetching session")
    if not response.data:
        raise HTTPException(status_code=404, detail="Session not found")
    return response.data[0]


@router.get("/")
async def list_sessions(user_id: str, db=Depends(get_db)) -> Dict:
    """List all sessions for a user"""
    response = db.get(Session, filters={"user_id": user_id})
    if response.data and len(response.data) > 0:
        agent_modes = {}
        for s in response.data:
            cfg = getattr(s, 'agent_mode_config', None) or {}
            mode = cfg.get('mode', 'unknown') if isinstance(cfg, dict) else 'unknown'
            agent_modes[mode] = agent_modes.get(mode, 0) + 1
        logger.info(
            f"total={len(response.data)} "
            f"by_mode={agent_modes}"
        )
    return {"status": True, "data": response.data}


@router.get("/shared/{share_token}")
async def get_shared_session(share_token: str, db=Depends(get_db)) -> Dict:
    """Public read-only access to a shared session (no login required)."""
    response = db.get(Session, filters={"uuid": share_token}, return_json=False)
    if not response.status:
        raise HTTPException(status_code=500, detail="Database error while fetching session")
    if not response.data:
        raise HTTPException(status_code=404, detail="Session not found or sharing disabled")

    session: Session = response.data[0]
    if not _is_session_shared(session):
        raise HTTPException(status_code=404, detail="Session not found or sharing disabled")

    run_data = _build_runs_payload(db, session.id, session)
    session_payload = session.model_dump() if hasattr(session, "model_dump") else dict(session)
    return {
        "status": True,
        "data": {
            "session": session_payload,
            "runs": run_data,
        },
    }


class DesktopShareMessage(BaseModel):
    role: str = Field(..., min_length=1, max_length=32)
    content: str = Field(..., max_length=200_000)


class DesktopShareRequest(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=254)
    title: str = Field(default="Shared conversation", max_length=120)
    messages: List[DesktopShareMessage] = Field(..., min_length=1, max_length=500)
    desktop_thread_id: Optional[str] = Field(default=None, max_length=160)


@router.post("/desktop-share")
async def create_desktop_share(req: DesktopShareRequest, db=Depends(get_db)) -> Dict:
    """Create a read-only shared session from a desktop conversation snapshot.

    Mirrors the WebUI sidebar share flow: persists messages under a Session with
    ``_share_enabled``, then returns ``share_token`` (= session.uuid) for
    ``/share?token=...``.
    """
    user_id = req.user_id.strip()
    if not user_id or "@" not in user_id:
        raise HTTPException(status_code=400, detail="A signed-in user email is required.")

    title = (req.title or "Shared conversation").strip()[:120] or "Shared conversation"
    prepared: List[DesktopShareMessage] = []
    for item in req.messages:
        role = item.role.strip().lower()
        content = (item.content or "").strip()
        if role not in {"user", "assistant"} or not content:
            continue
        prepared.append(DesktopShareMessage(role=role, content=content[:200_000]))
    if not prepared:
        raise HTTPException(status_code=400, detail="Select at least one message to share.")

    session = Session(
        user_id=user_id,
        name=title,
        agent_mode_config={
            "mode": "desktop-share",
            "config": {},
            _SHARE_FLAG: True,
            "_desktop_share": True,
            **({"_desktop_thread_id": req.desktop_thread_id} if req.desktop_thread_id else {}),
        },
    )
    session_response = db.upsert(session, return_json=False)
    if not session_response.status or not session_response.data:
        raise HTTPException(status_code=400, detail=session_response.message or "Failed to create share session")
    created_session: Session = (
        session_response.data[0]
        if isinstance(session_response.data, list)
        else session_response.data
    )

    try:
        first_user = next((m.content for m in prepared if m.role == "user"), prepared[0].content)
        run_response = db.upsert(
            Run(
                session_id=created_session.id,
                status=RunStatus.STOPPED,
                user_id=user_id,
                task={"source": "user", "content": first_user[:8_000], "message_type": "text"},
                team_result=None,
            ),
            return_json=False,
        )
        if not run_response.status or not run_response.data:
            raise HTTPException(status_code=400, detail=run_response.message or "Failed to create share run")
        created_run: Run = (
            run_response.data[0] if isinstance(run_response.data, list) else run_response.data
        )

        for item in prepared:
            source = "user" if item.role == "user" else "assistant"
            msg_response = db.upsert(
                Message(
                    user_id=user_id,
                    session_id=created_session.id,
                    run_id=created_run.id,
                    config={
                        "source": source,
                        "content": item.content,
                        "message_type": "text",
                    },
                ),
                return_json=False,
            )
            if not msg_response.status:
                raise HTTPException(status_code=400, detail=msg_response.message or "Failed to save share message")
    except HTTPException:
        try:
            db.delete(filters={"id": created_session.id, "user_id": user_id}, model_class=Session)
        except Exception:
            logger.exception("Failed to clean up desktop share session after error")
        raise
    except Exception as exc:
        try:
            db.delete(filters={"id": created_session.id, "user_id": user_id}, model_class=Session)
        except Exception:
            logger.exception("Failed to clean up desktop share session after error")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {
        "status": True,
        "data": {
            "share_token": created_session.uuid,
            "share_enabled": True,
            "session_id": created_session.id,
            "message_count": len(prepared),
        },
    }


@router.get("/{session_id}")
async def get_session(session_id: int, user_id: str, db=Depends(get_db)) -> Dict:
    """Get a specific session"""
    response = db.get(Session, filters={"id": session_id, "user_id": user_id})
    if not response.status or not response.data:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"status": True, "data": response.data[0]}


@router.post("/{session_id}/share")
async def set_session_share(
    session_id: int,
    user_id: str,
    enabled: bool = True,
    db=Depends(get_db),
) -> Dict:
    """Enable or disable public read-only sharing for a session."""
    session = _get_owned_session(db, session_id, user_id)
    session = _set_session_shared(session, enabled)
    response = db.upsert(session)
    if not response.status:
        raise HTTPException(status_code=400, detail=response.message)

    return {
        "status": True,
        "data": {
            "share_token": session.uuid,
            "share_enabled": enabled,
        },
    }


@router.post("/")
async def create_session(session: Session, db=Depends(get_db)) -> Dict:
    """Create a new session with an associated run"""
    # Set default mode if not provided
    if not session.agent_mode_config:
        session.agent_mode_config = {"mode": "magentic-one", "config": {}}
    
    # Create session
    session_response = db.upsert(session, return_json=False)
    if not session_response.status or not session_response.data:
        raise HTTPException(status_code=400, detail=session_response.message)

    created_session: Session = (
        session_response.data[0]
        if isinstance(session_response.data, list)
        else session_response.data
    )
    share_messages = _share_messages_from_session(created_session)

    # Create associated run. Desktop public shares may already include a frozen
    # `_share_messages` snapshot — persist those as real Message rows so the
    # existing /share viewer works even before frontend snapshot support ships.
    try:
        if share_messages:
            first_config = share_messages[0].get("config") or {
                "source": "user",
                "content": "",
                "message_type": "text",
            }
            run_response = db.upsert(
                Run(
                    session_id=created_session.id,
                    status=RunStatus.STOPPED,
                    user_id=created_session.user_id,
                    task=first_config,
                    team_result=None,
                ),
                return_json=False,
            )
            if not run_response.status or not run_response.data:
                raise HTTPException(
                    status_code=400,
                    detail=run_response.message or "Failed to create share run",
                )
            created_run: Run = (
                run_response.data[0]
                if isinstance(run_response.data, list)
                else run_response.data
            )
            for item in share_messages:
                config = item.get("config") if isinstance(item, dict) else None
                if not isinstance(config, dict):
                    continue
                msg_response = db.upsert(
                    Message(
                        user_id=created_session.user_id,
                        session_id=created_session.id,
                        run_id=created_run.id,
                        config=config,
                    ),
                    return_json=False,
                )
                if not msg_response.status:
                    raise HTTPException(
                        status_code=400,
                        detail=msg_response.message or "Failed to save share message",
                    )
        else:
            run_response = db.upsert(
                Run(
                    session_id=created_session.id,
                    status=RunStatus.CREATED,
                    user_id=created_session.user_id,
                    task=None,
                    team_result=None,
                ),
                return_json=False,
            )
            if not run_response.status:
                raise HTTPException(status_code=400, detail=run_response.message)

        payload = (
            created_session.model_dump()
            if hasattr(created_session, "model_dump")
            else dict(created_session)
        )
        # Preserve historical list-shaped create responses for existing clients.
        return {"status": True, "data": [payload]}
    except HTTPException:
        try:
            db.delete(
                filters={"id": created_session.id, "user_id": created_session.user_id},
                model_class=Session,
            )
        except Exception:
            logger.exception("Failed to clean up session after create_session error")
        raise
    except Exception as e:
        try:
            db.delete(
                filters={"id": created_session.id, "user_id": created_session.user_id},
                model_class=Session,
            )
        except Exception:
            logger.exception("Failed to clean up session after create_session error")
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.put("/{session_id}")
async def update_session(
    session_id: int, user_id: str, session: Session, db=Depends(get_db)
) -> Dict:
    """Update an existing session"""
    # First verify the session belongs to user
    existing = db.get(Session, filters={"id": session_id, "user_id": user_id})
    if not existing.status or not existing.data:
        raise HTTPException(status_code=404, detail="Session not found")

    # Update the session
    session.created_at = existing.data[0].created_at  # Preserve creation time
    response = db.upsert(session)
    if not response.status:
        raise HTTPException(status_code=400, detail=response.message)

    return {
        "status": True,
        "data": response.data,
        "message": "Session updated successfully",
    }


@router.delete("/{session_id}")
async def delete_session(session_id: int, user_id: str, db=Depends(get_db)) -> Dict:
    """Delete a session and all its associated runs and messages"""
    db.delete(filters={"id": session_id, "user_id": user_id}, model_class=Session)

    return {"status": True, "message": "Session deleted successfully"}


@router.get("/{session_id}/runs")
async def list_session_runs(session_id: int, user_id: str, db=Depends(get_db)) -> Dict:
    """Get complete session history organized by runs"""
    try:
        session = _get_owned_session(db, session_id, user_id)
        run_data = _build_runs_payload(db, session_id, session)
        return {"status": True, "data": {"runs": run_data}}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in list_messages: {str(e)}")
        raise HTTPException(
            status_code=500, detail="Internal server error while fetching session data"
        ) from e


@router.put("/{session_id}/run")
async def update_session(
    session_id: int, user_id: str, run: Run, db=Depends(get_db)
) -> Dict:
    """Update an existing run"""
    runs = db.get(
            Run, filters={"id": run.id, "user_id": user_id, "session_id": session_id}, order="asc", return_json=False
        )
    if not runs.status:
        raise HTTPException(
            status_code=500, detail="Database error while fetching runs"
        )

    # Update the session
    response = db.upsert(run)
    if not response.status:
        raise HTTPException(status_code=400, detail=response.message)

    return {
        "status": True,
        "data": response.data,
        "message": "Run updated successfully",
    }
