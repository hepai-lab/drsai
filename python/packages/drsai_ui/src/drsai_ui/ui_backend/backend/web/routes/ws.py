# api/ws.py
import asyncio
import json
from datetime import datetime

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from loguru import logger

from ...datamodel import Run
from ..deps import get_db, get_websocket_manager
from ..managers import WebSocketManager
from ...utils.utils import construct_task

router = APIRouter()


def _enrich_input_response_with_files(
    response: str | dict | None, metadata: dict | None
) -> dict | None:
    """
    Mirror start/continue: run construct_task so metadata gets attached_files (echo + parity).
    Keeps metadata[\"files\"] so the agent runtime can still expand paths downstream.
    """
    if not metadata or not isinstance(metadata, dict):
        return metadata
    files_list = metadata.get("files") or []
    if not files_list:
        return metadata
    query = ""
    if isinstance(response, str):
        try:
            inner = json.loads(response)
            if isinstance(inner, dict):
                query = str(inner.get("content", "") or "")
        except (json.JSONDecodeError, TypeError):
            query = ""
    elif isinstance(response, dict):
        query = str(response.get("content", "") or "")
    md_for_task = {k: v for k, v in metadata.items() if k != "files"}
    try:
        msgs = construct_task(query=query, files=files_list, metadata=md_for_task)
        if msgs:
            last = msgs[-1]
            lm = getattr(last, "metadata", None) or {}
            att = lm.get("attached_files")
            if att:
                metadata["attached_files"] = att
    except Exception as e:
        logger.exception(f"input_response construct_task failed: {e}")
    return metadata


@router.websocket("/runs/{run_id}")
async def run_websocket(
    websocket: WebSocket,
    run_id: int,
    ws_manager: WebSocketManager = Depends(get_websocket_manager),
    db=Depends(get_db),
):
    """
    WebSocket endpoint for run communication
    settings_config：相比原来需要额外加的参数：
    - agent_mode_config:  用于指定agent的模式，如：agent_mode_config={"mode": "drsai", config: {...}}
    - file_info: 用户在当前聊天界面上传的信息，post后直接返回
    """
    # Verify run exists and is in valid state
    run_response = db.get(Run, filters={"id": run_id}, return_json=False)
    if not run_response.status or not run_response.data:
        logger.warning(f"Run not found: {run_id}")
        await websocket.close(code=4004, reason="Run not found")
        return

    # run = run_response.data[0]
    # if run.status not in [RunStatus.CREATED, RunStatus.ACTIVE]:
    #     await websocket.close(code=4003, reason="Run not in valid state")
    #     return

    # Connect websocket
    connected = await ws_manager.connect(websocket, run_id)
    if not connected:
        await websocket.close(code=4002, reason="Failed to establish connection")
        return
    # Capture a connection generation to prevent stale disconnects closing new sockets.
    # (WebSocketManager increments conn_gen per run_id on connect.)
    conn_gen = getattr(ws_manager, "_conn_gen", {}).get(run_id)

    try:
        logger.info(f"WebSocket connection established for run {run_id}")

        while True:
            try:
                raw_message = await websocket.receive_text()
                message = json.loads(raw_message)

                if message.get("type") == "start" or message.get("type") == "continue":
                    # Handle start message
                    logger.info(f"Received start request for run {run_id}")
                    task: str = message.get("task")
                    start_metadata: dict = message.get("metadata")
                    team_config = start_metadata.pop("team_config")
                    settings_config = start_metadata.pop("settings_config")
                    files = start_metadata.pop("files", [])
                    task = construct_task(
                        query=task, 
                        files=files,
                        # settings_config=settings_config,
                        metadata=start_metadata,
                    )
                    if task and team_config:
                        async def _run_stream_guarded():
                            try:
                                await ws_manager.start_stream(
                                    run_id, task, team_config, settings_config, files=files
                                )
                            except Exception as e:
                                logger.exception(f"start_stream failed for run {run_id}: {e}")
                                # Never send type=error to the frontend. Emit a completion(error) instead.
                                try:
                                    await ws_manager._handle_stream_error(run_id, e)  # type: ignore[attr-defined]
                                except Exception:
                                    pass

                        # run in background, but never let exceptions get lost
                        asyncio.create_task(_run_stream_guarded())
                    else:
                        logger.warning(f"Invalid start message format for run {run_id}")
                        # Never send type=error to the frontend.
                        await websocket.send_json(
                            {
                                "type": "completion",
                                "status": "error",
                                "data": {
                                    "task_result": {
                                        "messages": [
                                            {
                                                "source": "system",
                                                "content": "Invalid request. Please resend your message.",
                                                "metadata": {"internal": "no"},
                                            }
                                        ],
                                        "stop_reason": "invalid_start_message",
                                    },
                                    "usage": "",
                                    "duration": 0.0,
                                    "files": None,
                                },
                                "timestamp": datetime.utcnow().isoformat(),
                            }
                        )

                elif message.get("type") == "stop":
                    logger.info(f"Received stop request for run {run_id}")
                    reason = message.get("reason") or "User requested stop/cancellation"
                    await ws_manager.stop_run(run_id, reason=reason)
                    break

                elif message.get("type") == "ping":
                    await websocket.send_json(
                        {"type": "pong", "timestamp": datetime.utcnow().isoformat()}
                    )

                elif message.get("type") == "input_response":
                    # Handle input response from client
                    response = message.get("response")
                    metadata = message.get("metadata")
                    if isinstance(metadata, dict):
                        metadata = dict(metadata)
                        _enrich_input_response_with_files(response, metadata)
                    if metadata:
                        response = {
                            "response": response,
                            "metadata": metadata,
                        }
                    if response is not None:
                        await ws_manager.handle_input_response(run_id, response)
                    else:
                        logger.warning(
                            f"Invalid input response format for run {run_id}"
                        )
                elif message.get("type") == "pause":
                    logger.info(f"Received pause request for run {run_id}")
                    await ws_manager.pause_run(run_id)

                elif message.get("type") == "resume":
                    logger.info(f"Received resume request for run {run_id}")
                    await ws_manager.resume_run(run_id)
            except json.JSONDecodeError:
                logger.warning(f"Invalid JSON received: {raw_message}")
                await websocket.send_json(
                    {
                        "type": "error",
                        "error": "Invalid message format",
                        "timestamp": datetime.utcnow().isoformat(),
                    }
                )

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for run {run_id}")
    except Exception as e:
        logger.error(f"WebSocket error: {str(e)}")
    finally:
        # Do not stop the run on transient websocket disconnect; allow reconnect.
        await ws_manager.disconnect(run_id, conn_gen=conn_gen, stop_run=False)
