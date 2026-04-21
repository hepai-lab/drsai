import asyncio
import logging
import traceback
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Sequence, Union, List
import json

from autogen_agentchat.base._task import TaskResult
from autogen_agentchat.messages import (
    AgentEvent,
    ChatMessage,
    HandoffMessage,
    ModelClientStreamingChunkEvent,
    MultiModalMessage,
    StopMessage,
    TextMessage,
    ToolCallSummaryMessage,
    ToolCallExecutionEvent,
    ToolCallRequestEvent,
)
from drsai.modules.managers.messages.agent_messages import (
    AgentLogEvent,
    Send_level,
    TaskEvent,
    FilesEvent,
)
from ....input_func import InputFuncType, InputRequestType
from autogen_core import CancellationToken
from fastapi import WebSocket, WebSocketDisconnect
from pathlib import Path
from ....types import CheckpointEvent
from ...database import DatabaseManager
from ...datamodel import (
    LLMCallEventMessage,
    Message,
    MessageConfig,
    Run,
    RunStatus,
    Settings,
    SettingsConfig,
    TeamResult,
    UserAgents,
)
from ...teammanager import TeamManager
from ...utils.utils import compress_state, decompress_state
from autogen_agentchat.messages import ThoughtEvent

logger = logging.getLogger(__name__)


class WebSocketManager:
    """
    Manages WebSocket connections and message streaming for team task execution

    Args:
        db_manager (DatabaseManager): Database manager instance for database operations
        internal_workspace_root (Path): Path to the internal root directory
        external_workspace_root (Path): Path to the external root directory
        inside_docker (bool): Flag indicating if the application is running inside Docker
        config (dict): Configuration for Magentic-UI
    """

    def __init__(
        self,
        db_manager: DatabaseManager,
        internal_workspace_root: Path,
        external_workspace_root: Path,
        inside_docker: bool,
        config: Dict[str, Any],
    ):
        self.db_manager = db_manager
        self.internal_workspace_root = internal_workspace_root
        self.external_workspace_root = external_workspace_root
        self.inside_docker = inside_docker
        self.config = config
        self._connections: Dict[int, WebSocket] = {}
        # Monotonic generation per run_id to avoid stale disconnect races:
        # old websocket finally blocks must not close a newer websocket.
        self._conn_gen: Dict[int, int] = {}
        self._cancellation_tokens: Dict[int, CancellationToken] = {}
        # Runs that are terminal (stopped/error) and should not accept further streaming/input.
        # IMPORTANT: do NOT treat transient websocket disconnect as "closed run".
        self._closed_connections: set[int] = set()
        self._input_responses: Dict[int, asyncio.Queue[str]] = {}
        self._team_managers: Dict[int, TeamManager] = {}
        self._streaming_buffers: Dict[int, Dict[str, Any]] = {}
        self._cancel_message = TeamResult(
            task_result=TaskResult(
                messages=[TextMessage(source="user", content="Run cancelled by user")],
                stop_reason="cancelled by user",
            ),
            usage="",
            duration=0,
        ).model_dump()

    def _get_stop_message(self, reason: str) -> dict[str, Any]:
        return TeamResult(
            task_result=TaskResult(
                messages=[TextMessage(source="user", content=reason)],
                stop_reason=reason,
            ),
            usage="",
            duration=0,
        ).model_dump()

    async def connect(self, websocket: WebSocket, run_id: int) -> bool:
        try:
            await websocket.accept()
            self._conn_gen[run_id] = self._conn_gen.get(run_id, 0) + 1
            self._connections[run_id] = websocket
            # A websocket reconnect does not imply the run is terminal; keep closed state as-is.
            # Initialize input queue for this connection.
            # IMPORTANT: do not overwrite an existing queue on reconnect, otherwise
            # pending input/resume semantics can break (frontend sees "awaiting_input"
            # but backend lost the queue).
            if run_id not in self._input_responses:
                self._input_responses[run_id] = asyncio.Queue()

            await self._send_message(
                run_id,
                {
                    "type": "system",
                    "status": "connected",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                },
            )

            # If the run was waiting for user input, re-send the pending input_request
            # so the frontend can recover after a transient websocket reconnect.
            try:
                run = await self._get_run(run_id)
                if run and getattr(run, "status", None) == RunStatus.AWAITING_INPUT:
                    pending = getattr(run, "input_request", None)
                    if isinstance(pending, dict) and pending.get("prompt"):
                        await self._send_message(
                            run_id,
                            {
                                "type": "system",
                                "status": RunStatus.AWAITING_INPUT,
                                "timestamp": datetime.now(timezone.utc).isoformat(),
                            },
                        )
                        await self._send_message(
                            run_id,
                            {
                                "type": "input_request",
                                "input_type": pending.get("input_type") or "text_input",
                                "prompt": pending.get("prompt") or "",
                                "data": {
                                    "source": "system",
                                    "content": pending.get("prompt") or "",
                                },
                                "timestamp": datetime.now(timezone.utc).isoformat(),
                            },
                        )
            except Exception as e:
                logger.warning(f"Failed to replay input_request for run {run_id}: {e}")

            return True
        except Exception as e:
            logger.error(f"Connection error for run {run_id}: {e}")
            return False

    async def start_stream(
        self,
        run_id: int,
        task: str | ChatMessage | Sequence[ChatMessage] | None,
        team_config: Dict[str, Any],
        settings_config: Dict[str, Any],
        files: List[Dict[str, Any]] | None = None,
        user_settings: Settings | None = None,
    ) -> None:
        """
        Start streaming task execution with proper run management

        Args:
            run_id (int): ID of the run
            task (str | ChatMessage | Sequence[ChatMessage] | None): Task to execute
            team_config (Dict[str, Any]): Configuration for the team
            settings_config (Dict[str, Any]): Configuration for settings
            user_settings (Settings, optional): User settings for the run
        """
        if run_id not in self._connections:
            raise ValueError(f"No active connection for run {run_id}")
        # Starting a new stream explicitly re-opens the run even if a previous attempt stopped.
        # This matches UI expectation: user can send a new prompt after stopping.
        self._closed_connections.discard(run_id)

        # IMPORTANT: if a previous stream is still around (paused / awaiting_input / half-closed),
        # starting a new stream on the same run_id can deadlock state machines.
        # Minimal safety: stop and close any existing run resources before starting anew.
        if run_id in self._cancellation_tokens or run_id in self._team_managers:
            try:
                # Internal restart: clean up previous run resources but do not mark the run as terminal.
                await self.stop_run(run_id, "Restarted by client", mark_closed=False)
            except Exception as e:
                logger.warning(f"Failed to stop previous run before restart (run {run_id}): {e}")
            try:
                old_tm = self._team_managers.pop(run_id, None)
                if old_tm:
                    await old_tm.close()
            except Exception as e:
                logger.warning(f"Failed to close previous TeamManager (run {run_id}): {e}")
            self._streaming_buffers.pop(run_id, None)
            # Ensure the new stream isn't immediately short-circuited by a terminal flag.
            self._closed_connections.discard(run_id)

        team_manager = TeamManager(
            internal_workspace_root=self.internal_workspace_root,
            external_workspace_root=self.external_workspace_root,
            inside_docker=self.inside_docker,
            config=self.config,
        )
        self._team_managers[run_id] = team_manager
        cancellation_token = CancellationToken()
        self._cancellation_tokens[run_id] = cancellation_token
        final_result = None

        try:
            # Update run with task and status
            run = await self._get_run(run_id)
            assert run is not None, f"Run {run_id} not found in database"
            assert run.user_id is not None, f"Run {run_id} has no user ID"

            # Get user Settings
            user_settings = await self._get_settings(run.user_id)
            env_vars = (
                SettingsConfig(**user_settings.config).environment  # type: ignore
                if user_settings
                else None
            )

            settings_config["memory_controller_key"] = run.user_id

            state = None
            if run:
                run.task = MessageConfig(content=task, source="user").model_dump()
                run.status = RunStatus.ACTIVE
                state = run.state
                self.db_manager.upsert(run)
                await self._update_run_status(run_id, RunStatus.ACTIVE)

                # TODO: 让不同后端都能获取前端之前的记忆
                if isinstance(state, str):
                    try:
                        # Try to decompress if it's compressed
                        state_dict_decompress = decompress_state(state)
                    except Exception:
                        # If decompression fails, assume it's a regular JSON string
                        state_dict_decompress = json.loads(state)
                else:
                    state_dict_decompress = state
                
                # # TODO: 后面思考换掉
                # if state_dict_decompress:
                #     if 'RemoteAgent' in state_dict_decompress["agent_states"]:
                #         state_dict_decompress = None

            raw_agent_id = settings_config.get("agent_id")
            agent_id = (
                raw_agent_id.strip()
                if isinstance(raw_agent_id, str)
                else (str(raw_agent_id).strip() if raw_agent_id is not None else "")
            )
            if not agent_id:
                resolved = self._resolve_default_agent_id(run.user_id)
                if resolved:
                    settings_config["agent_id"] = resolved
                    agent_id = resolved
            agent_mode_config = await self._get_agent_mode_config(user_id=run.user_id, agent_id = agent_id)
            if agent_mode_config:
                settings_config["agent_mode_config"] = agent_mode_config
            else:
                raise ValueError(
                    f"No agent config found for agent_id {agent_id} in UserAgents "
                    f"(user_id={run.user_id})."
                )

            # add task as message
            if isinstance(task, str):
                await self._send_message(
                    run_id,
                    self._format_message(TextMessage(source="user_proxy", content=task))
                    or {},
                )
                await self._save_message(
                    run_id, TextMessage(source="user_proxy", content=task)
                )

            elif isinstance(task, Sequence):
                for task_message in task:
                    if isinstance(task_message, TextMessage) or isinstance(
                        task_message, MultiModalMessage
                    ):
                        if (
                            hasattr(task_message, "metadata")
                            and task_message.metadata.get("internal") == "yes"
                        ):
                            continue

                        await self._send_message(
                            run_id, self._format_message(task_message) or {}
                        )
                        await self._save_message(run_id, task_message)

            input_func: InputFuncType = self.create_input_func(run_id)

            message: ChatMessage | AgentEvent | TeamResult | LLMCallEventMessage
            async for message in team_manager.run_stream(
                task=task,
                team_config=team_config,
                state=state_dict_decompress,
                input_func=input_func,
                cancellation_token=cancellation_token,
                env_vars=env_vars,
                settings_config=settings_config,
                run=run,
                files=files,
            ):
                if (
                    cancellation_token.is_cancelled()
                    or run_id in self._closed_connections
                ):
                    logger.info(
                        f"Stream cancelled or connection closed for run {run_id}"
                    )
                    break

                if isinstance(message, CheckpointEvent):
                    # Save state to run
                    run = await self._get_run(run_id)
                    if run:
                        # Use compress_state utility to compress the state
                        state_dict = json.loads(message.state)
                        run.state = compress_state(state_dict)
                        self.db_manager.upsert(run)
                    continue
                
                if isinstance(message, ToolCallSummaryMessage):
                    message = TextMessage(
                        content=message.content,
                        source=message.source,
                        metadata=message.metadata,
                    )
                    
                # do not show internal messages
                if (
                    hasattr(message, "metadata")
                    and message.metadata.get("internal") == "yes"  # type: ignore
                ):
                    if message.metadata.get("is_save") == "yes":
                        await self._save_message(run_id, message)
                    continue

                if isinstance(message, ModelClientStreamingChunkEvent):
                    is_start = str(message.metadata.get("start_flag", "")).lower() == "yes" if message.metadata else False
                    if is_start and run_id in self._streaming_buffers:
                        await self._flush_streaming_buffer(run_id)
                    self._accumulate_chunk(run_id, message)
                else:
                    if run_id in self._streaming_buffers:
                        await self._flush_streaming_buffer(run_id)

                formatted_message = self._format_message(message)
                if formatted_message:
                    await self._send_message(run_id, formatted_message)

                    if isinstance(
                        message,
                        (
                            TextMessage,
                            MultiModalMessage,
                            StopMessage,
                            HandoffMessage,
                            ToolCallRequestEvent,
                            ToolCallExecutionEvent,
                            AgentLogEvent,
                            ThoughtEvent,
                            TaskEvent,
                            LLMCallEventMessage,
                            FilesEvent,
                        ),
                    ):
                        await self._save_message(run_id, message)
                    elif isinstance(message, TeamResult):
                        final_result = message.model_dump()
                    self._team_managers[run_id] = team_manager
            # Flush any remaining streaming content after the stream ends
            if run_id in self._streaming_buffers:
                await self._flush_streaming_buffer(run_id)
            if (
                not cancellation_token.is_cancelled()
                and run_id not in self._closed_connections
            ):
                if final_result:
                    await self._update_run(
                        run_id, RunStatus.COMPLETE, team_result=final_result
                    )
                else:
                    # Hard safety net: never let a run "finish" without an explicit final result.
                    # This avoids UI hangs when upstream ends a stream early (no final message / no TaskResult).
                    logger.error(f"No final result captured for run {run_id}; emitting error completion")

                    error_message = TeamResult(
                        task_result=TaskResult(
                            messages=[
                                TextMessage(
                                    source="system",
                                    content=(
                                        "The run ended unexpectedly before producing a final result. "
                                        "Please try again: resend your message, or type 'continue'. "
                                        "If this keeps happening, refresh the page."
                                    ),
                                    metadata={"internal": "no"},
                                )
                            ],
                            stop_reason="upstream_stream_ended_without_final_result",
                        ),
                        usage="",
                        duration=0,
                    ).model_dump()

                    # Mark run terminal so input handlers won't keep prompting.
                    self._closed_connections.add(run_id)

                    await self._send_message(
                        run_id,
                        {
                            "type": "completion",
                            "status": "error",
                            "data": error_message,
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                        },
                    )
                    await self._update_run(
                        run_id,
                        RunStatus.ERROR,
                        team_result=error_message,
                        error="No final result captured (upstream stream ended early)",
                    )
            else:
                await self._send_message(
                    run_id,
                    {
                        "type": "completion",
                        "status": "cancelled",
                        "data": self._cancel_message,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    },
                )
                # Update run with cancellation result
                await self._update_run(
                    run_id, RunStatus.STOPPED, team_result=self._cancel_message
                )

        except Exception as e:
            logger.error(f"Stream error for run {run_id}: {e}")
            traceback.print_exc()
            await self._handle_stream_error(run_id, e)
        finally:
            self._cancellation_tokens.pop(run_id, None)
            self._team_managers.pop(run_id, None)  # Remove the team manager when done

    async def _flush_streaming_buffer(self, run_id: int) -> None:
        """Flush accumulated streaming chunks as a TextMessage and save to database."""
        buf = self._streaming_buffers.pop(run_id, None)
        if not buf or not buf.get("content"):
            return
        assembled = TextMessage(
            source=buf["source"],
            content=buf["content"],
            metadata=buf.get("metadata", {}),
        )
        await self._save_message(run_id, assembled)

    def _accumulate_chunk(self, run_id: int, message: ModelClientStreamingChunkEvent) -> None:
        """Accumulate a streaming chunk into the buffer for the given run."""
        source = message.source
        content = message.content if isinstance(message.content, str) else ""
        metadata = dict(message.metadata) if message.metadata else {}
        is_start = str(metadata.get("start_flag", "")).lower() == "yes"

        buf = self._streaming_buffers.get(run_id)
        if is_start or buf is None or buf["source"] != source:
            self._streaming_buffers[run_id] = {
                "source": source,
                "content": content,
                "metadata": metadata,
            }
        else:
            buf["content"] += content
            if metadata:
                buf["metadata"].update(metadata)

    async def _save_message(
        self, run_id: int, message: Union[AgentEvent | ChatMessage, LLMCallEventMessage]
    ) -> None:
        """
        Save a message to the database

        Args:
            run_id (int): ID of the run
            message (Union[AgentEvent | ChatMessage, LLMCallEventMessage]): Message to save
        """

        run = await self._get_run(run_id)
        if run:
            db_message = Message(
                created_at=datetime.now(),
                session_id=run.session_id,
                run_id=run_id,
                config=message.model_dump(),
                user_id=run.user_id,  # Pass the user_id from the run object
            )
            self.db_manager.upsert(db_message)

    async def _update_run(
        self,
        run_id: int,
        status: RunStatus,
        team_result: Optional[TeamResult | Dict[str, Any]] = None,
        error: Optional[str] = None,
    ) -> None:
        """
        Update run status and result

        Args:
            run_id (int): ID of the run
            status (RunStatus): New status to set
            team_result (TeamResult | dict[str, Any], optional): Optional team result to set
            error (str, optional): Optional error message
        """
        run = await self._get_run(run_id)
        if run:
            run.status = status
            if team_result:
                run.team_result = team_result
            if error:
                run.error_message = error
            self.db_manager.upsert(run)

    def create_input_func(self, run_id: int, timeout: int = 600) -> InputFuncType:
        """
        Creates an input function for a specific run

        Args:
            run_id (int): ID of the run
            timeout (int, optional): Timeout for input response in seconds. Default: 600
        Returns:
            InputFuncType: Input function for the run
        """

        async def input_handler(
            prompt: str = "",
            cancellation_token: Optional[CancellationToken] = None,
            input_type: InputRequestType = "text_input",
        ) -> str:
            try:
                # If the run was explicitly stopped, never prompt for more input.
                if run_id in self._closed_connections:
                    raise asyncio.CancelledError("Run stopped while awaiting input")
                if cancellation_token is not None and cancellation_token.is_cancelled():
                    raise asyncio.CancelledError("Run cancelled while awaiting input")

                # resume run if it is paused
                await self.resume_run(run_id)

                # update run status to awaiting_input
                await self._update_run_status(run_id, RunStatus.AWAITING_INPUT)
                # Send input request to client
                logger.info(
                    f"Sending input request for run {run_id}: ({input_type}) {prompt}"
                )
                await self._send_message(
                    run_id,
                    {
                        "type": "input_request",
                        "input_type": input_type,
                        "prompt": prompt,
                        "data": {"source": "system", "content": prompt},
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    },
                )

                # Store input_request in the Run object
                run = await self._get_run(run_id)
                if run:
                    run.input_request = {"prompt": prompt, "input_type": input_type}
                    self.db_manager.upsert(run)

                # Wait for response with timeout
                # If a transient disconnect happened during/after sending input_request,
                # we may have dropped the in-memory queue. Re-create it to avoid hard failure.
                if run_id not in self._input_responses:
                    self._input_responses[run_id] = asyncio.Queue()

                if run_id in self._input_responses:
                    try:

                        async def poll_for_response():
                            while True:
                                # Check if run was cancelled (user stop / restart)
                                if (
                                    cancellation_token is not None
                                    and cancellation_token.is_cancelled()
                                ):
                                    raise asyncio.CancelledError(
                                        "Run cancelled while awaiting input"
                                    )

                                # Try to get response with short timeout
                                try:
                                    response = await asyncio.wait_for(
                                        self._input_responses[run_id].get(),
                                        timeout=min(timeout, 5),
                                    )
                                    await self._update_run_status(
                                        run_id, RunStatus.ACTIVE
                                    )
                                    return response
                                except asyncio.TimeoutError:
                                    continue  # Keep checking for closed status

                        response = await asyncio.wait_for(
                            poll_for_response(), timeout=timeout
                        )
                        return response

                    except asyncio.TimeoutError:
                        # Stop the run if timeout occurs
                        logger.warning(f"Input response timeout for run {run_id}")
                        await self.stop_run(
                            run_id,
                            "Dr.Sai-UI timed out while waiting for your input. To resume, please enter a follow-up message in the input box or you can simply type 'continue'.",
                        )
                        raise
                else:
                    raise ValueError(f"No input queue for run {run_id}")

            except Exception as e:
                logger.error(f"Error handling input for run {run_id}: {e}")
                raise

        return input_handler

    async def handle_input_response(self, run_id: int, response: str|dict) -> None:
        """Handle input response from client"""
        if run_id in self._input_responses and run_id in self._connections:
            # TODO: 使用Session的配置进行metadata更新
            # agent_mode_config = await self._get_agent_mode_config(user_id=run.user_id, agent_id = agent_id)
            await self._input_responses[run_id].put(response)
        else:
            logger.warning(f"Received input response for inactive run {run_id}")

    async def stop_run(self, run_id: int, reason: str, *, mark_closed: bool = True) -> None:
        if run_id in self._cancellation_tokens:
            logger.info(f"Stopping run {run_id}")

            stop_message = self._get_stop_message(reason)

            try:
                # Mark run as terminal (user stop/error). Internal restart should not mark terminal.
                if mark_closed:
                    self._closed_connections.add(run_id)

                # Update run record first
                await self._update_run(
                    run_id, status=RunStatus.STOPPED, team_result=stop_message
                )

                # Then handle websocket communication if connection is active
                if run_id in self._connections:
                    await self._send_message(
                        run_id,
                        {
                            "type": "completion",
                            "status": "cancelled",
                            "data": stop_message,
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                        },
                    )

                # Finally cancel the token
                tok = self._cancellation_tokens.get(run_id)
                if tok is not None:
                    tok.cancel()
                # remove team manager
                team_manager = self._team_managers.pop(run_id, None)
                if team_manager:
                    await team_manager.close()

                # Clean up in-memory run state so a subsequent start on the same run_id
                # doesn't inherit cancelled tokens/buffers.
                self._cancellation_tokens.pop(run_id, None)
                self._streaming_buffers.pop(run_id, None)
            except Exception as e:
                logger.error(f"Error stopping run {run_id}: {e}")
                # We might want to force disconnect here if db update failed
                # await self.disconnect(run_id)  # Optional

    async def disconnect(
        self, run_id: int, conn_gen: int | None = None, *, stop_run: bool = False
    ) -> None:
        """
        Clean up connection and associated resources

        Args:
            run_id (int): ID of the run to disconnect
        """
        # If this disconnect comes from an older websocket, ignore it.
        if conn_gen is not None and self._conn_gen.get(run_id) != conn_gen:
            logger.info(
                f"Ignoring stale disconnect for run {run_id}: conn_gen={conn_gen}, current={self._conn_gen.get(run_id)}"
            )
            return
        logger.info(f"Disconnecting run {run_id}")

        # IMPORTANT: websocket disconnect is often transient. Do NOT mark run as closed here.

        # IMPORTANT: a websocket disconnect may be transient (tab refresh, network blip).
        # Do not stop the run by default; allow reconnect + continue. Only stop if explicitly asked.
        if stop_run:
            await self.stop_run(run_id, "Connection closed")

        # Clean up resources
        self._connections.pop(run_id, None)
        if stop_run:
            self._cancellation_tokens.pop(run_id, None)
            self._input_responses.pop(run_id, None)

    async def _send_message(self, run_id: int, message: Dict[str, Any]) -> None:
        """Send a message through the WebSocket with connection state checking

        Args:
            run_id (int): int of the run
            message (Dict[str, Any]): Message dictionary to send
        """
        try:
            if run_id in self._connections:
                websocket = self._connections[run_id]
                # print(message)
                await websocket.send_json(message)
            else:
                logger.warning(
                    f"Attempted to send message without active websocket for run {run_id}"
                )
        except WebSocketDisconnect:
            logger.warning(
                f"WebSocket disconnected while sending message for run {run_id}"
            )
            await self.disconnect(run_id, conn_gen=self._conn_gen.get(run_id), stop_run=False)
        except Exception as e:
            logger.error(f"Error sending message for run {run_id}: {e}, {message}")
            # Don't try to send error message here to avoid potential recursive loop
            await self._update_run_status(run_id, RunStatus.ERROR, str(e))
            await self.disconnect(run_id, conn_gen=self._conn_gen.get(run_id), stop_run=False)

    async def _handle_stream_error(self, run_id: int, error: Exception) -> None:
        """
        Handle stream errors with proper run updates

        Args:
            run_id (int): ID of the run
            error (Exception): Exception that occurred
        """
        # Always terminate the run on stream error, and only communicate via completion(error).
        # This prevents the UI from hanging in awaiting_input after upstream failures.
        self._closed_connections.add(run_id)

        # Best-effort: cancel any running stream and close team resources.
        tok = self._cancellation_tokens.get(run_id)
        if tok is not None:
            tok.cancel()
        tm = self._team_managers.pop(run_id, None)
        if tm:
            try:
                await tm.close()
            except Exception:
                pass

        error_result = TeamResult(
            task_result=TaskResult(
                messages=[
                    TextMessage(
                        source="system",
                        content=(
                            "This run ended unexpectedly and was stopped safely. "
                            "Please resend your message, or type 'continue'. "
                            "If it keeps happening, refresh the page."
                        ),
                        metadata={"internal": "no"},
                    )
                ],
                stop_reason="stream_error",
            ),
            usage="",
            duration=0,
        ).model_dump()

        await self._send_message(
            run_id,
            {
                "type": "completion",
                "status": "error",
                "data": error_result,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
        )

        await self._update_run(
            run_id, RunStatus.ERROR, team_result=error_result, error=str(error)
        )

    def _format_message(self, message: Any) -> Optional[Dict[str, Any]]:
        """Format message for WebSocket transmission

        Args:
            message (Any): Message to format

        Returns:
            Optional[Dict[str, Any]]: Formatted message or None if formatting fails
        """

        try:
            # Never forward agent error messages as normal chat messages.
            if isinstance(message, TextMessage):
                md = getattr(message, "metadata", None) or {}
                if isinstance(md, dict) and ("error_message" in md):
                    return None
            if isinstance(message, MultiModalMessage):
                message_dump = message.model_dump()

                message_content: list[dict[str, Any]] = []
                for row in message_dump["content"]:
                    if "data" in row:
                        message_content.append(
                            {
                                "url": f"data:image/png;base64,{row['data']}",
                                "alt": "WebSurfer Screenshot",
                            }
                        )
                    else:
                        message_content.append(row)
                message_dump["content"] = message_content

                return {"type": "message", "data": message_dump}

            elif isinstance(message, TeamResult):
                return {
                    "type": "result",
                    "data": message.model_dump(),
                    "status": "complete",
                }
            elif isinstance(message, ModelClientStreamingChunkEvent):
                return {"type": "message_chunk", "data": message.model_dump()}
            # elif isinstance(message, ToolCallExecutionEvent):
            #     message.metadata.update({"start_flag": "yes"})
            #     tool_call_output = ""
            #     for tool_call_content in message.content:
            #         tool_call_output += tool_call_content.name + ":" + tool_call_content.content + "\n\n"

            #     tool_call_chunk = ModelClientStreamingChunkEvent(
            #         source=message.source,
            #         content=tool_call_output,
            #         metadata=message.metadata,
            #         )
            #     return {
            #         "type": "message_chunk",
            #         "data": tool_call_chunk.model_dump(),
            #     }
            elif isinstance(
                message,
                (TextMessage,),
            ):
                return {"type": "message", "data": message.model_dump()}
            elif isinstance(message, str):
                return {
                    "type": "message",
                    "data": {"source": "user", "content": message},
                }
            elif isinstance(message, AgentLogEvent):
                return {
                    "type": "message_log",
                    "data": message.model_dump(),
                }
            elif isinstance(message, TaskEvent):
                return {
                    "type": "message_task",
                    "data": message.model_dump(),
                }
            elif isinstance(message, FilesEvent):
                return {
                    "type": "message_files",
                    "data": message.model_dump(),
                }
            return None

        except Exception as e:
            logger.error(f"Message formatting error: {e}")
            return None

    async def _get_run(self, run_id: int) -> Optional[Run]:
        """Get run from database

        Args:
            run_id (int): int of the run to retrieve

        Returns:
            Optional[Run]: Run object if found, None otherwise
        """
        response = self.db_manager.get(Run, filters={"id": run_id}, return_json=False)
        return response.data[0] if response.status and response.data else None

    async def _get_agent_mode_config(self, user_id: str, agent_id: str) -> Optional[Dict]:
        """Resolve the selected agent config from UserAgents as single source of truth."""
        updated_agent = None
        response = self.db_manager.get(UserAgents, filters={"user_id": user_id}, return_json=False)
        if response.status and response.data:
            # Use the user's agent list as the only runtime lookup source.
            user_agents: UserAgents = response.data[0]
            agents_list = user_agents.agents or []
            for agent in agents_list:
                if agent["id"] == agent_id:
                    updated_agent = agent
                    break
        if updated_agent is None:
            logger.warning(f"Agent config not found in UserAgents for user_id={user_id}, agent_id={agent_id}")
        return updated_agent

    def _resolve_default_agent_id(self, user_id: str) -> Optional[str]:
        """When the client omits agent_id, pick default / first agent from UserAgents."""
        response = self.db_manager.get(UserAgents, filters={"user_id": user_id}, return_json=False)
        if not response.status or not response.data:
            return None
        agents_list = response.data[0].agents or []
        for agent in agents_list:
            if not isinstance(agent, dict):
                continue
            if agent.get("is_default") and isinstance(agent.get("id"), str) and agent["id"].strip():
                return agent["id"].strip()
        for agent in agents_list:
            if isinstance(agent, dict) and isinstance(agent.get("id"), str) and agent["id"].strip():
                return agent["id"].strip()
        return None

    async def _get_settings(self, user_id: str) -> Optional[Settings]:
        """Get user settings from database
        Args:
            user_id (str): User ID to retrieve settings for
        Returns:
            Optional[Settings]: User settings if found, None otherwise
        """
        response = self.db_manager.get(
            filters={"user_id": user_id}, model_class=Settings, return_json=False
        )
        return response.data[0] if response.status and response.data else None

    async def _update_run_status(
        self, run_id: int, status: RunStatus, error: Optional[str] = None
    ) -> None:
        """Update run status in database

        Args:
            run_id (int): int of the run to update
            status (RunStatus): New status to set
            error (str, optional): Optional error message
        """
        run = await self._get_run(run_id)
        if run:
            run.status = status
            run.error_message = error
            self.db_manager.upsert(run)
        # send system message to client with status
        await self._send_message(
            run_id,
            {
                "type": "system",
                "status": status,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
        )

    async def cleanup(self) -> None:
        """Clean up all active connections and resources when server is shutting down"""
        logger.info(f"Cleaning up {len(self.active_connections)} active connections")

        try:
            # First cancel all running tasks
            for run_id in self.active_runs.copy():
                if run_id in self._cancellation_tokens:
                    self._cancellation_tokens[run_id].cancel()
                run = await self._get_run(run_id)
                if run and run.status == RunStatus.ACTIVE:
                    interrupted_result = TeamResult(
                        task_result=TaskResult(
                            messages=[
                                TextMessage(
                                    source="system",
                                    content="Run interrupted by server shutdown",
                                )
                            ],
                            stop_reason="server_shutdown",
                        ),
                        usage="",
                        duration=0,
                    ).model_dump()

                    run.status = RunStatus.STOPPED
                    run.team_result = interrupted_result
                    self.db_manager.upsert(run)

            # Then disconnect all websockets with timeout
            # 10 second timeout for entire cleanup
            async def disconnect_all():
                for run_id in self.active_connections.copy():
                    try:
                        await asyncio.wait_for(self.disconnect(run_id), timeout=2)
                    except asyncio.TimeoutError:
                        logger.warning(f"Timeout disconnecting run {run_id}")
                    except Exception as e:
                        logger.error(f"Error disconnecting run {run_id}: {e}")

            await asyncio.wait_for(disconnect_all(), timeout=10)

        except asyncio.TimeoutError:
            logger.warning("WebSocketManager cleanup timed out")
        except Exception as e:
            logger.error(f"Error during WebSocketManager cleanup: {e}")
        finally:
            # Always clear internal state, even if cleanup had errors
            self._connections.clear()
            self._cancellation_tokens.clear()
            self._closed_connections.clear()
            self._input_responses.clear()

    @property
    def active_connections(self) -> set[int]:
        """Get set of active run IDs"""
        return set(self._connections.keys()) - self._closed_connections

    @property
    def active_runs(self) -> set[int]:
        """Get set of runs with active cancellation tokens"""
        return set(self._cancellation_tokens.keys())

    async def pause_run(self, run_id: int) -> None:
        """Pause the run"""
        if (
            run_id in self._connections
            and run_id not in self._closed_connections
            and run_id in self._team_managers
        ):
            team_manager = self._team_managers.get(run_id)
            if team_manager:
                await team_manager.pause_run()
                await self._send_message(
                    run_id,
                    {
                        "type": "system",
                        "status": "paused",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    },
                )
                await self._update_run_status(run_id, RunStatus.PAUSED)

    async def resume_run(self, run_id: int) -> None:
        """Resume the run"""
        if (
            run_id in self._connections
            and run_id not in self._closed_connections
            and run_id in self._team_managers
        ):
            team_manager = self._team_managers.get(run_id)
            if team_manager:
                await team_manager.resume_run()
                await self._update_run_status(run_id, RunStatus.ACTIVE)
