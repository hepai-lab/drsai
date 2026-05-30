# api/routes/sessions.py
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException
from loguru import logger

from ...datamodel import Message, Run, Session, RunStatus
from ..deps import get_db

router = APIRouter()

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


def _build_runs_payload(db, session_id: int) -> List[Dict[str, Any]]:
    runs = db.get(Run, filters={"session_id": session_id}, order="asc", return_json=False)
    if not runs.status:
        raise HTTPException(status_code=500, detail="Database error while fetching runs")

    run_data: List[Dict[str, Any]] = []
    if not runs.data:
        return run_data

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

            run_data.append(
                {
                    "id": str(run.id),
                    "created_at": run.created_at,
                    "status": run.status,
                    "task": run.task,
                    "team_result": run.team_result,
                    "messages": messages.data or [],
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

    run_data = _build_runs_payload(db, session.id)
    session_payload = session.model_dump() if hasattr(session, "model_dump") else dict(session)
    return {
        "status": True,
        "data": {
            "session": session_payload,
            "runs": run_data,
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
    session_response = db.upsert(session)
    if not session_response.status:
        raise HTTPException(status_code=400, detail=session_response.message)

    # Create associated run
    try:
        run = db.upsert(
            Run(
                session_id=session.id,
                status=RunStatus.CREATED,
                user_id=session.user_id,
                task=None,
                team_result=None,
            ),
            return_json=False,
        )
        if not run.status:
            # Clean up session if run creation failed
            raise HTTPException(status_code=400, detail=run.message)
        return {"status": True, "data": session_response.data}
    except Exception as e:
        # Clean up session if run creation failed
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
    # Delete the session
    db.delete(filters={"id": session_id, "user_id": user_id}, model_class=Session)

    return {"status": True, "message": "Session deleted successfully"}


@router.get("/{session_id}/runs")
async def list_session_runs(session_id: int, user_id: str, db=Depends(get_db)) -> Dict:
    """Get complete session history organized by runs"""
    try:
        _get_owned_session(db, session_id, user_id)
        run_data = _build_runs_payload(db, session_id)
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
