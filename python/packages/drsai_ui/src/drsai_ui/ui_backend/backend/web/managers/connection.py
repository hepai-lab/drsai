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
from ..model_resolve import settings_config_from_input_response
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
        self._cancellation_tokens: Dict[int, CancellationToken] = {}
        # Track explicitly closed connections
        self._closed_connections: set[int] = set()
        self._input_responses: Dict[int, asyncio.Queue[str]] = {}
        self._team_managers: Dict[int, TeamManager] = {}
        # self._streaming_buffers: Dict[int, Dict[str, Any]] = {}
        # Track run states and state locks for atomic state transitions
        self._run_states: Dict[int, RunStatus] = {}
        self._state_locks: Dict[int, asyncio.Lock] = {}
        # Serialize team-level pause/resume operations so they can't overlap.
        # team.pause/resume make remote HTTP calls; if resume's HTTP call
        # completes before pause's, the remote ends up in paused state
        # while local state shows resumed.
        self._team_op_locks: Dict[int, asyncio.Lock] = {}
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
            self._connections[run_id] = websocket
            self._closed_connections.discard(run_id)
            # Initialize input queue for this connection
            self._input_responses[run_id] = asyncio.Queue()
            # Initialize state lock for this connection
            self._state_locks[run_id] = asyncio.Lock()
            self._team_op_locks[run_id] = asyncio.Lock()
            self._run_states[run_id] = RunStatus.ACTIVE

            await self._send_message(
                run_id,
                {
                    "type": "system",
                    "status": "connected",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                },
            )

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
    ) -> None:
        """
        Start streaming task execution with proper run management

        Args:
            run_id (int): ID of the run
            task (str | ChatMessage | Sequence[ChatMessage] | None): Task to execute
            team_config (Dict[str, Any]): Configuration for the team
            settings_config (Dict[str, Any]): Configuration for settings
            files (List[Dict[str, Any]] | None): Optional file metadata list
        """
        if run_id not in self._connections or run_id in self._closed_connections:
            raise ValueError(f"No active connection for run {run_id}")

        # do not create a new team manager if one already exists
        if run_id not in self._team_managers:
            team_manager = TeamManager(
                internal_workspace_root=self.internal_workspace_root,
                external_workspace_root=self.external_workspace_root,
                inside_docker=self.inside_docker,
                config=self.config,
            )
            self._team_managers[run_id] = team_manager

        else:
            team_manager = self._team_managers[run_id]
        cancellation_token = CancellationToken()
        self._cancellation_tokens[run_id] = cancellation_token
        final_result = None

        try:
            # Update run with task and status
            run = await self._get_run(run_id)
            if run is None:
                raise ValueError(f"Run {run_id} not found in database")
            if run.user_id is None:
                raise ValueError(f"Run {run_id} has no user ID")

            # Get user Settings
            user_settings = await self._get_settings(run.user_id)
            env_vars = (
                SettingsConfig(**user_settings.config).environment  # type: ignore
                if user_settings
                else None
            )

            settings_config["memory_controller_key"] = run.user_id

            run.task = MessageConfig(content=task, source="user").model_dump()
            state = run.state
            self.db_manager.upsert(run)
            await self._update_run_status(run_id, RunStatus.ACTIVE)

            if isinstance(state, str):
                try:
                    state_dict_decompress = decompress_state(state)
                except Exception:
                    try:
                        state_dict_decompress = json.loads(state)
                    except (json.JSONDecodeError, TypeError):
                        state_dict_decompress = None
            elif state is not None:
                state_dict_decompress = state
            else:
                state_dict_decompress = None

            agent_id = settings_config.get("agent_id")
            requested_model_alias = (
                settings_config.get("defult_config_name")
                or settings_config.get("default_config_name")
            )
            agent_mode_config = await self._get_agent_mode_config(user_id=run.user_id, agent_id = agent_id)
            if agent_mode_config:
                # Runtime websocket settings override the saved agent default for
                # this run only.  This lets the UI switch the remote Dr.Sai
                # internal model without mutating UserAgents/global config.
                if requested_model_alias:
                    agent_mode_config = dict(agent_mode_config)
                    agent_mode_config["defult_config_name"] = requested_model_alias
                settings_config["agent_mode_config"] = agent_mode_config
            else:
                raise ValueError(
                    f"No agent config found for agent_id {agent_id} in UserAgents,"
                    f"(user_id={run.user_id}). Please create a new session!"
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
                    run = await self._get_run(run_id)
                    if run:
                        try:
                            state_dict = json.loads(message.state)
                        except (json.JSONDecodeError, TypeError):
                            logger.warning(
                                f"Failed to decode checkpoint state for run {run_id}"
                            )
                            continue
                        run.state = compress_state(state_dict)
                        self.db_manager.upsert(run)
                    continue
                
                # Skip internal messages not meant for client display
                if (
                    hasattr(message, "metadata")
                    and message.metadata.get("internal") == "yes"  # type: ignore
                ):
                    if message.metadata.get("is_save") == "yes":
                        await self._save_message(run_id, message)
                    continue

                formatted_message = self._format_message(message)
                if formatted_message:
                    await self._send_message(run_id, formatted_message)

                    if isinstance(
                        message,
                        (
                            TextMessage,
                            ToolCallSummaryMessage,
                            MultiModalMessage,
                            StopMessage,
                            HandoffMessage,
                            ToolCallRequestEvent,
                            ToolCallExecutionEvent,
                            AgentLogEvent,
                            ThoughtEvent,
                            LLMCallEventMessage,
                            FilesEvent,
                        ),
                    ):
                        await self._save_message(run_id, message)
                    elif isinstance(message, TeamResult):
                        final_result = message.model_dump()
            if (
                not cancellation_token.is_cancelled()
                and run_id not in self._closed_connections
            ):
                if final_result:
                    await self._update_run(
                        run_id, RunStatus.COMPLETE, team_result=final_result
                    )
                else:
                    logger.warning(
                        f"No final result captured for completed run {run_id}"
                    )
                    await self._update_run_status(run_id, RunStatus.COMPLETE)
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
                # If paused when agent needs input, auto-resume so the request
                # can be delivered to the user (they will naturally respond).
                # resume_run is a no-op if not paused.
                if self._is_paused(run_id):
                    logger.info(
                        f"Run {run_id} paused but needs input, auto-resuming"
                    )
                    await self.resume_run(run_id)

                # Transition to AWAITING_INPUT
                await self._update_run_status(run_id, RunStatus.AWAITING_INPUT)
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

                if run_id not in self._input_responses:
                    raise ValueError(f"No input queue for run {run_id}")

                # Wait for response with timeout
                try:
                    response = await asyncio.wait_for(
                        self._poll_input_response(run_id, timeout),
                        timeout=timeout,
                    )
                except asyncio.TimeoutError:
                    logger.warning(f"Input response timeout for run {run_id}")
                    await self.stop_run(
                        run_id,
                        "Dr.Sai-UI timed out while waiting for your input. "
                        "To resume, please enter a follow-up message in the input box "
                        "or you can simply type 'continue'.",
                    )
                    raise

                # If user paused while awaiting input, auto-resume so agent
                # can actually process the input (team remote state needs
                # to be resumed too). Otherwise just transition to ACTIVE.
                if self._is_paused(run_id):
                    logger.info(
                        f"Run {run_id} paused during input wait, auto-resuming "
                        f"after input received"
                    )
                    await self.resume_run(run_id)
                else:
                    await self._update_run_status(run_id, RunStatus.ACTIVE)
                return response

            except Exception as e:
                logger.error(f"Error handling input for run {run_id}: {e}")
                raise

        return input_handler

    async def _poll_input_response(self, run_id: int, timeout: int):
        """Poll the input response queue, handling closed connections."""
        while True:
            if run_id in self._closed_connections:
                raise ValueError("Run was closed")
            try:
                return await asyncio.wait_for(
                    self._input_responses[run_id].get(),
                    timeout=min(timeout, 5),
                )
            except asyncio.TimeoutError:
                continue  # loop back to check closed state

    async def handle_input_response(self, run_id: int, response: str|dict) -> None:
        """Handle input response from client"""
        if run_id in self._input_responses and run_id in self._connections:
            team_manager = self._team_managers.get(run_id)
            settings_config = settings_config_from_input_response(response)
            if team_manager is not None and settings_config is not None:
                switch_results = await team_manager._switch_remote_model_if_requested(
                    settings_config
                )
                for result in switch_results:
                    if result.get("status", False):
                        continue
                    await self._send_message(
                        run_id,
                        {
                            "type": "error",
                            "error": (
                                f"Model switch failed ({result.get('agent', 'agent')}): "
                                f"{result.get('message', 'unknown error')}"
                            ),
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                        },
                    )
            await self._input_responses[run_id].put(response)
        else:
            logger.warning(f"Received input response for inactive run {run_id}")

    async def stop_run(self, run_id: int, reason: str) -> None:
        if run_id in self._cancellation_tokens:
            logger.info(f"Stopping run {run_id}")

            stop_message = self._get_stop_message(reason)

            try:
                # Update run record first
                await self._update_run(
                    run_id, status=RunStatus.STOPPED, team_result=stop_message
                )

                # Then handle websocket communication if connection is active
                if (
                    run_id in self._connections
                    and run_id not in self._closed_connections
                ):
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
                self._cancellation_tokens[run_id].cancel()
                # remove team manager
                team_manager = self._team_managers.pop(run_id, None)
                if team_manager:
                    await team_manager.close()
            except Exception as e:
                logger.error(f"Error stopping run {run_id}: {e}")
                # We might want to force disconnect here if db update failed
                # await self.disconnect(run_id)  # Optional

    async def disconnect(self, run_id: int) -> None:
        """
        Clean up connection and associated resources

        Args:
            run_id (int): ID of the run to disconnect
        """
        logger.info(f"Disconnecting run {run_id}")

        # Mark as closed before cleanup to prevent any new messages
        self._closed_connections.add(run_id)

        # Cancel any running tasks
        await self.stop_run(run_id, "Connection closed")

        # Clean up resources
        self._connections.pop(run_id, None)
        self._cancellation_tokens.pop(run_id, None)
        self._input_responses.pop(run_id, None)
        self._run_states.pop(run_id, None)
        self._state_locks.pop(run_id, None)
        self._team_op_locks.pop(run_id, None)

    async def _send_message(self, run_id: int, message: Dict[str, Any]) -> None:
        """Send a message through the WebSocket with connection state checking

        Args:
            run_id (int): int of the run
            message (Dict[str, Any]): Message dictionary to send
        """
        if run_id in self._closed_connections:
            logger.warning(
                f"Attempted to send message to closed connection for run {run_id}"
            )
            return

        try:
            if run_id in self._connections:
                websocket = self._connections[run_id]
                # print(message)
                await websocket.send_json(message)
        except WebSocketDisconnect:
            logger.warning(
                f"WebSocket disconnected while sending message for run {run_id}"
            )
            await self.disconnect(run_id)
        except Exception as e:
            logger.error(f"Error sending message for run {run_id}: {e}, {message}")
            # Don't try to send error message here to avoid potential recursive loop
            await self._update_run_status(run_id, RunStatus.ERROR, str(e))
            await self.disconnect(run_id)

    async def _handle_stream_error(self, run_id: int, error: Exception) -> None:
        """
        Handle stream errors with proper run updates

        Args:
            run_id (int): ID of the run
            error (Exception): Exception that occurred
        """
        if run_id not in self._closed_connections:
            error_message = TextMessage(source="system", content=str(error))
            error_result = TeamResult(
                task_result=TaskResult(
                    messages=[error_message],
                    stop_reason="An error occurred while processing this run",
                ),
                usage="",
                duration=0,
            ).model_dump()

            await self._send_message(
                run_id,
                {"type": "message", "data": error_message.model_dump()},
            )

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
            elif isinstance(
                message,
                (ToolCallSummaryMessage,),
            ):
                return {"type": "tool_call_summary", "data": message.model_dump()}
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
            elif isinstance(message, ThoughtEvent):
                return {
                    "type": "message_thinking",
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
        self,
        run_id: int,
        status: RunStatus,
        error: Optional[str] = None,
        force: bool = False,
    ) -> bool:
        """Update run status in database atomically.

        Deduplicates transitions: if the run is already in `status` and no
        error is provided, this is a no-op and no system message is emitted.
        Pass force=True to always send the status message (e.g. for terminal
        states where a re-emit is meaningful).

        Args:
            run_id: Run identifier
            status: New status to set
            error: Optional error message
            force: If True, always emit the status message even if unchanged

        Returns:
            True if the status actually changed (message sent), False otherwise.
        """
        # Use lock to ensure atomic state transitions
        if run_id not in self._state_locks:
            self._state_locks[run_id] = asyncio.Lock()

        async with self._state_locks[run_id]:
            # Deduplicate: skip if state is already the requested value
            if (
                not force
                and self._run_states.get(run_id) == status
                and error is None
            ):
                return False

            run = await self._get_run(run_id)
            if run:
                run.status = status
                run.error_message = error
                self.db_manager.upsert(run)

            # Update in-memory state
            self._run_states[run_id] = status

            # send system message to client with status
            await self._send_message(
                run_id,
                {
                    "type": "system",
                    "status": status,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                },
            )
            return True

    def _is_paused(self, run_id: int) -> bool:
        """Check if the run is currently in paused state."""
        return self._run_states.get(run_id) == RunStatus.PAUSED

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
            self._run_states.clear()
            self._state_locks.clear()
            self._team_op_locks.clear()

    @property
    def active_connections(self) -> set[int]:
        """Get set of active run IDs"""
        return set(self._connections.keys()) - self._closed_connections

    @property
    def active_runs(self) -> set[int]:
        """Get set of runs with active cancellation tokens"""
        return set(self._cancellation_tokens.keys())

    def _is_run_manageable(self, run_id: int) -> bool:
        """Check if run has an active connection and team manager for pause/resume ops."""
        return (
            run_id in self._connections
            and run_id not in self._closed_connections
            and run_id in self._team_managers
        )

    async def pause_run(self, run_id: int) -> None:
        """Pause the run.

        State transition: ACTIVE/AWAITING_INPUT → PAUSED
        Calls team.pause() under team_op_lock so any concurrent resume()
        waits until pause's remote HTTP call fully completes.
        """
        if not self._is_run_manageable(run_id):
            return
        team_manager = self._team_managers.get(run_id)
        if not team_manager:
            return

        # Update state first (dedup inside) so clients see "paused" immediately
        # and input_handler can detect PAUSED. If already paused, this is a no-op.
        changed = await self._update_run_status(run_id, RunStatus.PAUSED)
        if not changed:
            logger.info(f"Run {run_id} already paused, skipping team.pause()")
            return

        # Ensure team op lock exists
        if run_id not in self._team_op_locks:
            self._team_op_locks[run_id] = asyncio.Lock()

        # Pause team inside team_op_lock so remote HTTP calls don't race
        # with concurrent resume()
        async with self._team_op_locks[run_id]:
            await team_manager.pause_run()

    async def resume_run(self, run_id: int) -> None:
        """Resume the run.

        State transition: PAUSED → ACTIVE (no-op if not paused)
        Waits for any pending pause() to fully complete before calling
        team.resume() to avoid remote state divergence.
        """
        if not self._is_run_manageable(run_id):
            return
        team_manager = self._team_managers.get(run_id)
        if not team_manager:
            return

        # Skip if not paused - avoids unnecessary team.resume() HTTP calls
        if not self._is_paused(run_id):
            return

        # Ensure team op lock exists
        if run_id not in self._team_op_locks:
            self._team_op_locks[run_id] = asyncio.Lock()

        # Serialize with any pending pause to prevent HTTP call overlap
        async with self._team_op_locks[run_id]:
            # Re-check under lock: state may have changed while waiting
            if not self._is_paused(run_id):
                return
            await team_manager.resume_run()
            await self._update_run_status(run_id, RunStatus.ACTIVE)
