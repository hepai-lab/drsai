from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from pathlib import Path
from typing import (
    AsyncGenerator,
    Any,
    cast,
    Dict,
    List,
    Mapping,
    Optional,
    Sequence,
    Union,
)
import aiofiles
import yaml
from loguru import logger
from autogen_agentchat.base import ChatAgent, TaskResult, Team
from autogen_agentchat.messages import AgentEvent, ChatMessage, TextMessage
from autogen_core import EVENT_LOGGER_NAME, CancellationToken, ComponentModel
from autogen_core.logging import LLMCallEvent
from ...types import RunPaths

from ...input_func import InputFuncType

from ..datamodel.types import EnvironmentVariable, LLMCallEventMessage, TeamResult
from ..datamodel.db import Run
from ..utils.utils import get_modified_files

from ....agent_factory.magentic_one.task_team import create_magentic_one_team, create_magentic_round_team

from dotenv import load_dotenv
load_dotenv()


class RunEventLogger(logging.Handler):
    """Event logger that queues LLMCallEvents for streaming"""

    def __init__(self) -> None:
        super().__init__()
        self.events: asyncio.Queue[LLMCallEventMessage] = asyncio.Queue()

    def emit(self, record: logging.LogRecord) -> None:
        if isinstance(record.msg, LLMCallEvent):
            self.events.put_nowait(LLMCallEventMessage(content=str(record.msg)))


class TeamManager:
    """Manages team operations including loading configs and running teams"""

    def __init__(
        self,
        internal_workspace_root: Path,
        external_workspace_root: Path,
        inside_docker: bool = True,
        config: dict[str, Any] = {},
    ) -> None:
        self.team: Team | ChatAgent | None = None
        self.load_from_config = False
        self.internal_workspace_root = internal_workspace_root
        self.external_workspace_root = external_workspace_root
        self.inside_docker = inside_docker

        self.config = config
        self.novnc_port: int|None = None
        self.playwright_port: int|None = None
        self.mode: str|None = None

    @staticmethod
    async def load_from_file(path: Union[str, Path]) -> Dict[str, Any]:
        """Load team configuration from JSON/YAML file"""
        path = Path(path)
        if not path.exists():
            raise FileNotFoundError(f"Config file not found: {path}")

        async with aiofiles.open(path) as f:
            content = await f.read()
            if path.suffix == ".json":
                return json.loads(content)
            elif path.suffix in (".yml", ".yaml"):
                return yaml.safe_load(content)
            raise ValueError(f"Unsupported file format: {path.suffix}")

    def prepare_run_paths(
        self,
        run: Optional[Run] = None,
    ) -> RunPaths:
        external_workspace_root = self.external_workspace_root
        internal_workspace_root = self.internal_workspace_root

        if run:
            run_suffix = os.path.join(
                "files",
                "user",
                str(run.user_id or "unknown_user"),
                str(run.session_id or "unknown_session"),
                str(run.id or "unknown_run"),
            )
        else:
            run_suffix = os.path.join(
                "files", "user", "unknown_user", "unknown_session", "unknown_run"
            )

        internal_run_dir = internal_workspace_root / Path(run_suffix)
        external_run_dir = external_workspace_root / Path(run_suffix)
        # Can only make dir on internal, as it is what a potential docker container sees.
        # TO-ANSWER: why?
        logger.info(f"Creating run dirs: {internal_run_dir} and {external_run_dir}")
        if self.inside_docker:
            internal_run_dir.mkdir(parents=True, exist_ok=True)
        else:
            external_run_dir.mkdir(parents=True, exist_ok=True)

        return RunPaths(
            internal_root_dir=internal_workspace_root,
            external_root_dir=external_workspace_root,
            run_suffix=run_suffix,
            internal_run_dir=internal_run_dir,
            external_run_dir=external_run_dir,
        )

    @staticmethod
    async def load_from_directory(directory: Union[str, Path]) -> List[Dict[str, Any]]:
        """Load all team configurations from a directory"""
        directory = Path(directory)
        configs: List[Dict[str, Any]] = []
        valid_extensions = {".json", ".yaml", ".yml"}

        for path in directory.iterdir():
            if path.is_file() and path.suffix.lower() in valid_extensions:
                try:
                    config = await TeamManager.load_from_file(path)
                    configs.append(config)
                except Exception as e:
                    logger.error(f"Failed to load {path}: {e}")

        return configs

    async def _create_team(
        self,
        team_config: Union[str, Path, Dict[str, Any], ComponentModel],
        state: Optional[Mapping[str, Any] | str] = None,
        input_func: Optional[InputFuncType] = None,
        env_vars: Optional[List[EnvironmentVariable]] = None,
        settings_config: dict[str, Any] = {},
        *,
        paths: RunPaths,
        run: Optional[Run] = None,
        files: List[Dict[str, Any]] | None = None,
    ) -> None:
        """Create team instance from config"""

        # TODO: 判断前端传递的settings_config中agent的配置, 在src/drsai/agent_factory/load_agent.py中进行系统性判断和配置的加载

        try:
            if not self.load_from_config:
                # Load model configurations from settings if provided
                model_configs: Dict[str, Any] = {}
                if isinstance(settings_config.get("model_configs"), str):
                    try:
                        model_configs = yaml.safe_load(settings_config["model_configs"])
                    except Exception as e:
                        logger.error(f"Error loading model configs: {e}")
                        raise e
                settings_config["model_configs"] = model_configs

                # 判断前端的agent mode配置, 并进行相应的agent/team的创建
                agent_mode_config: dict[str, Any] = settings_config.pop("agent_mode_config", {})
                self.mode = agent_mode_config.get("mode", "magentic-one")
                
                if self.mode in ["magentic-one"]:
                    settings_config["model_configs"] = model_configs
                    team, novnc_port, playwright_port = await create_magentic_one_team(
                        team_config = team_config,
                        state = state,
                        input_func = input_func,
                        env_vars = env_vars,
                        settings_config = settings_config,
                        paths = paths,
                        config = self.config,
                        load_from_config = self.load_from_config,
                        inside_docker = self.inside_docker,
                    )
                    self.novnc_port = novnc_port
                    self.playwright_port = playwright_port
                else:
                    team, novnc_port, playwright_port = await create_magentic_round_team(
                        team_config = team_config,
                        state = state,
                        input_func = input_func,
                        env_vars = env_vars,
                        settings_config = settings_config,
                        paths = paths,
                        config = self.config,
                        load_from_config = self.load_from_config,
                        inside_docker = self.inside_docker,
                        run_info = run.model_dump() if run else {},
                        agent_mode_config = agent_mode_config,
                        files = files
                    )
                    self.novnc_port = novnc_port
                    self.playwright_port = playwright_port
            else:
                raise NotImplementedError("load_from_config not implemented yet")
            self.team = team
        except Exception as e:
            logger.error(f"Error creating team: {e}")
            await self.close()
            raise

    async def run_stream(
        self,
        task: Optional[Union[ChatMessage, str, Sequence[ChatMessage]]],
        team_config: Union[str, Path, dict[str, Any], ComponentModel],
        state: Optional[Mapping[str, Any] | str] = None,
        input_func: Optional[InputFuncType] = None,
        cancellation_token: Optional[CancellationToken] = None,
        env_vars: Optional[List[EnvironmentVariable]] = None,
        settings_config: Optional[Dict[str, Any]] = None,
        run: Optional[Run] = None,
        files: List[Dict[str, Any]] | None = None,
    ) -> AsyncGenerator[
        Union[AgentEvent, ChatMessage, LLMCallEventMessage, TeamResult], None
    ]:
        """Stream team execution results"""
        start_time = time.time()

        # Setup logger correctly
        logger = logging.getLogger(EVENT_LOGGER_NAME)
        logger.setLevel(logging.CRITICAL)
        llm_event_logger = RunEventLogger()
        logger.handlers = [llm_event_logger]  # Replace all handlers
        logger.info(f"Running in docker: {self.inside_docker}")
        paths = self.prepare_run_paths(run=run)
        known_files = set(
            file["name"]
            for file in get_modified_files(
                0, time.time(), source_dir=str(paths.internal_run_dir)
            )
        )
        global_new_files: List[Dict[str, str]] = []
        try:
            # TODO: This might cause problems later if we are not careful
        
            # mode = settings_config.get("Use_default_Agent_Groupchat_mode", None)

            if self.team is None:
                # TODO: if we start allowing load from config, we'll need to write the novnc and playwright ports back to the team config..
                await self._create_team(
                    team_config,
                    state,
                    input_func,
                    env_vars,
                    settings_config or {},
                    paths=paths,
                    run=run,
                    files=files,
                )

                # Initialize known files by name for tracking
                initial_files = get_modified_files(
                    start_time, time.time(), source_dir=str(paths.internal_run_dir)
                )
                known_files = {file["name"] for file in initial_files}

               
                if self.mode in ["magentic-one"]:
                    # 前端启动noVNC，在drsai模式下不需要启动noVNC
                    VNC_SERVICE_URL = os.getenv("VNC_SERVICE_URL", "localhost")
                    yield TextMessage(
                        source="system",
                        content=f"Browser noVNC address can be found at {VNC_SERVICE_URL}:{self.novnc_port}/vnc.html",
                        metadata={
                            "internal": "no",
                            "type": "browser_address",
                            "novnc_port": str(self.novnc_port),
                            "playwright_port": str(self.playwright_port),
                        },
                    )

                async for message in self.team.run_stream(  # type: ignore
                    task=task, cancellation_token=cancellation_token
                ):
                    if cancellation_token and cancellation_token.is_cancelled():
                        break

                    # Get all current files with full metadata
                    modified_files = get_modified_files(
                        start_time, time.time(), source_dir=str(paths.internal_run_dir)
                    )
                    current_file_names = {file["name"] for file in modified_files}

                    # Find new files
                    new_file_names = current_file_names - known_files
                    known_files = current_file_names  # Update for next iteration

                    # Get the full data for new files
                    new_files = [
                        file
                        for file in modified_files
                        if file["name"] in new_file_names
                    ]

                    if new_files:
                        # filter files that start with "tmp_code"
                        new_files = [
                            file
                            for file in new_files
                            if not file["name"].startswith("tmp_code")
                        ]
                        if len(new_files) > 0:
                            file_message = TextMessage(
                                source="system",
                                content="File Generated",
                                metadata={
                                    "internal": "no",
                                    "type": "file",
                                    "files": json.dumps(new_files),
                                },
                            )
                            global_new_files.extend(new_files)
                            yield file_message

                    if isinstance(message, TaskResult):
                        yield TeamResult(
                            task_result=message,
                            usage="",
                            duration=time.time() - start_time,
                            files=modified_files,  # Full file data preserved
                        )
                    elif (
                        isinstance(message, TextMessage)
                        and self.mode not in ["magentic-one"]
                    ):
                        # For ModelClientStreamChunk output, we need to add internal: yes to the message
                        internal = message.metadata.get("internal", "unknown")
                        if internal == "yes":
                            yield message
                        else:
                            if message.source not in ["user_proxy", "user"] and internal == "unknown":
                                message.metadata.update({"internal": "yes", "is_save": "yes"})
                            yield message
                    else:
                        yield message
                        
                    # Add generated files to final output
                    if (
                        isinstance(message, TextMessage)
                        and message.metadata.get("type", "") == "final_answer"
                    ):
                        if len(global_new_files) > 0:
                            # only keep unique file names, if there is a file with the same name, keep the latest one
                            global_new_files = list(
                                {
                                    file["name"]: file for file in global_new_files
                                }.values()
                            )
                            file_message = TextMessage(
                                source="system",
                                content="File Generated",
                                metadata={
                                    "internal": "no",
                                    "type": "file",
                                    "files": json.dumps(global_new_files),
                                },
                            )
                            yield file_message
                            global_new_files = []

                    # Check for any LLM events
                    while not llm_event_logger.events.empty():
                        event = await llm_event_logger.events.get()
                        yield event
        finally:
            # Cleanup - remove our handler
            if llm_event_logger in logger.handlers:
                logger.handlers.remove(llm_event_logger)

            # Ensure cleanup happens
            if self.team and hasattr(self.team, "close"):
                logger.info("Closing team")
                await self.team.close()  # type: ignore
                logger.info("Team closed")

    async def close(self):
        """Close the team manager"""
        if self.team and hasattr(self.team, "close"):
            logger.info("Closing team")
            await self.team.close()  # type: ignore
            self.team = None
            logger.info("Team closed")
        else:
            logger.warning("Team manager is not initialized or already closed")

    async def run(
        self,
        task: ChatMessage | Sequence[ChatMessage] | str | None,
        team_config: Union[str, Path, dict[str, Any], ComponentModel],
        input_func: Optional[InputFuncType] = None,
        cancellation_token: Optional[CancellationToken] = None,
        env_vars: Optional[List[EnvironmentVariable]] = None,
    ) -> TeamResult:
        """Run team synchronously"""
        raise NotImplementedError("Use run_stream instead")

    async def pause_run(self) -> None:
        """Pause the run"""
        if self.team:
            await self.team.pause()

    async def resume_run(self) -> None:
        """Resume the run"""
        if self.team:
            await self.team.resume()
