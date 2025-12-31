
from autogen_core.models import ChatCompletionClient
from autogen_core import ComponentModel
from autogen_agentchat.base import ChatAgent, TaskResult, Team
from autogen_agentchat.agents import UserProxyAgent, BaseChatAgent, AssistantAgent
from autogen_agentchat.teams import BaseGroupChat

from .tools.playwright.browser import get_browser_resource_config
from .teams import GroupChat , RoundRobinGroupChat
# from drsai.modules.groupchat import RoundRobinGroupChat
from .teams.orchestrator.orchestrator_config import OrchestratorConfig
from .agents import WebSurfer, CoderAgent, USER_PROXY_DESCRIPTION, FileSurfer
from .magentic_ui_config import MagenticUIConfig, ModelClientConfigs
from .agents.web_surfer import WebSurferConfig
from .agents.users import DummyUserProxy, MetadataUserProxy
from .approval_guard import (
    ApprovalGuard,
    ApprovalGuardContext,
    ApprovalConfig,
    BaseApprovalGuard,
)
from ..remote_agent.drsai_remote_agent import RemoteAgent
# from ..magentic_one.agents.drsai_agents.drsai_agent import MagenticAgent
from drsai.modules.baseagent import DrSaiAgent, DrSaiUserProxyAgent
from .agents.user_proxy import RoundbinDrSaiUserProxyAgent
from drsai.modules.components.memory.ragflow_memory import RAGFlowMemory, RAGFlowMemoryConfig

from ...ui_backend.input_func import InputFuncType, make_agentchat_input_func
from ...ui_backend.learning.memory_provider import MemoryControllerProvider
from ...ui_backend.utils import get_internal_urls
from ...ui_backend.types import RunPaths
from ...ui_backend.backend.datamodel.types import EnvironmentVariable
from ...ui_backend.backend.utils.utils import decompress_state
from ...agent_factory.remote_agent import StatusAgent
# from drsai.modules.agents import HepAIWorkerAgent
from ...agent_factory.local_agents.ragflow_agent import RAGFlowAgent

import json, os
import aiofiles
from pathlib import Path
from typing import (
    Any,
    cast,
    Dict,
    List,
    Mapping,
    Optional,
    Union,
    Callable,
)

from ...agent_factory.load_agent import (
    get_model_client, 
    a_get_ragflow_memorys, 
    a_get_mcp_workbench,
    a_load_agent_factory_from_config,
    )
import yaml
import importlib
from loguru import logger

async def get_task_team(
    magentic_ui_config: Optional[MagenticUIConfig] = None,
    input_func: Optional[InputFuncType] = None,
    *,
    paths: RunPaths,
) -> GroupChat | RoundRobinGroupChat:
    """
    Creates and returns a GroupChat team with specified configuration.

    Args:
        magentic_ui_config (MagenticUIConfig, optional): Magentic UI configuration for team. Default: None.
        paths (RunPaths): Paths for internal and external run directories.

    Returns:
        GroupChat | RoundRobinGroupChat: An instance of GroupChat or RoundRobinGroupChat with the specified agents and configuration.
    """
    if magentic_ui_config is None:
        magentic_ui_config = MagenticUIConfig()

    def get_model_client(
        model_client_config: Union[ComponentModel, Dict[str, Any], None],
        is_action_guard: bool = False,
    ) -> ChatCompletionClient:
        if model_client_config is None:
            return ChatCompletionClient.load_component(
                ModelClientConfigs.get_default_client_config()
                if not is_action_guard
                else ModelClientConfigs.get_default_action_guard_config()
            )
        return ChatCompletionClient.load_component(model_client_config)

    if not magentic_ui_config.inside_docker:
        assert (
            paths.external_run_dir == paths.internal_run_dir
        ), "External and internal run dirs must be the same in non-docker mode"

    model_client_orch = get_model_client(
        magentic_ui_config.model_client_configs.orchestrator
    )
    approval_guard: BaseApprovalGuard | None = None

    approval_policy = (
        magentic_ui_config.approval_policy
        if magentic_ui_config.approval_policy
        else "never"
    )

    websurfer_loop_team: bool = (
        magentic_ui_config.websurfer_loop if magentic_ui_config else False
    )

    model_client_coder = get_model_client(magentic_ui_config.model_client_configs.coder)
    model_client_file_surfer = get_model_client(
        magentic_ui_config.model_client_configs.file_surfer
    )
    browser_resource_config, _novnc_port, _playwright_port = (
        get_browser_resource_config(
            paths.external_run_dir,
            magentic_ui_config.novnc_port,
            magentic_ui_config.playwright_port,
            magentic_ui_config.inside_docker,
        )
    )

    orchestrator_config = OrchestratorConfig(
        cooperative_planning=magentic_ui_config.cooperative_planning,
        autonomous_execution=magentic_ui_config.autonomous_execution,
        allowed_websites=magentic_ui_config.allowed_websites,
        plan=magentic_ui_config.plan,
        model_context_token_limit=magentic_ui_config.model_context_token_limit,
        do_bing_search=magentic_ui_config.do_bing_search,
        retrieve_relevant_plans=magentic_ui_config.retrieve_relevant_plans,
        memory_controller_key=magentic_ui_config.memory_controller_key,
        allow_follow_up_input=magentic_ui_config.allow_follow_up_input,
        final_answer_prompt=magentic_ui_config.final_answer_prompt,
    )
    websurfer_model_client = magentic_ui_config.model_client_configs.web_surfer
    if websurfer_model_client is None:
        websurfer_model_client = ModelClientConfigs.get_default_client_config()
    websurfer_config = WebSurferConfig(
        name="web_surfer",
        model_client=websurfer_model_client,
        browser=browser_resource_config,
        single_tab_mode=False,
        max_actions_per_step=magentic_ui_config.max_actions_per_step,
        url_statuses={key: "allowed" for key in orchestrator_config.allowed_websites}
        if orchestrator_config.allowed_websites
        else None,
        url_block_list=get_internal_urls(magentic_ui_config.inside_docker, paths),
        multiple_tools_per_call=magentic_ui_config.multiple_tools_per_call,
        downloads_folder=str(paths.internal_run_dir),
        debug_dir=str(paths.internal_run_dir),
        animate_actions=True,
        start_page=None,
        use_action_guard=True,
        to_save_screenshots=False,
    )

    user_proxy: DummyUserProxy | MetadataUserProxy | DrSaiUserProxyAgent

    if magentic_ui_config.user_proxy_type == "dummy":
        user_proxy = DummyUserProxy(name="user_proxy")
    elif magentic_ui_config.user_proxy_type == "metadata":
        assert (
            magentic_ui_config.task is not None
        ), "Task must be provided for metadata user proxy"
        assert (
            magentic_ui_config.hints is not None
        ), "Hints must be provided for metadata user proxy"
        assert (
            magentic_ui_config.answer is not None
        ), "Answer must be provided for metadata user proxy"
        user_proxy = MetadataUserProxy(
            name="user_proxy",
            description="Metadata User Proxy Agent",
            task=magentic_ui_config.task,
            helpful_task_hints=magentic_ui_config.hints,
            task_answer=magentic_ui_config.answer,
            model_client=model_client_orch,
        )
    else:
        user_proxy_input_func = make_agentchat_input_func(input_func)
        user_proxy = DrSaiUserProxyAgent(
            description=USER_PROXY_DESCRIPTION,
            name="user_proxy",
            input_func=user_proxy_input_func,
        )

    if magentic_ui_config.user_proxy_type in ["dummy", "metadata"]:
        model_client_action_guard = get_model_client(
            magentic_ui_config.model_client_configs.action_guard,
            is_action_guard=True,
        )

        # Simple approval function that always returns yes
        def always_yes_input(prompt: str, input_type: str = "text_input") -> str:
            return "yes"

        approval_guard = ApprovalGuard(
            input_func=always_yes_input,
            default_approval=False,
            model_client=model_client_action_guard,
            config=ApprovalConfig(
                approval_policy=approval_policy,
            ),
        )
    elif input_func is not None:
        model_client_action_guard = get_model_client(
            magentic_ui_config.model_client_configs.action_guard
        )
        approval_guard = ApprovalGuard(
            input_func=input_func,
            default_approval=False,
            model_client=model_client_action_guard,
            config=ApprovalConfig(
                approval_policy=approval_policy,
            ),
        )
    with ApprovalGuardContext.populate_context(approval_guard):
        web_surfer = WebSurfer.from_config(websurfer_config)
    if websurfer_loop_team:
        # simplified team of only the web surfer
        team = RoundRobinGroupChat(
            participants=[web_surfer, user_proxy],
            max_turns=10000,
        )
        await team.lazy_init()
        return team

    coder_agent = CoderAgent(
        name="coder_agent",
        model_client=model_client_coder,
        work_dir=paths.internal_run_dir,
        bind_dir=paths.external_run_dir,
        model_context_token_limit=magentic_ui_config.model_context_token_limit,
        approval_guard=approval_guard,
    )

    file_surfer = FileSurfer(
        name="file_surfer",
        model_client=model_client_file_surfer,
        work_dir=paths.internal_run_dir,
        bind_dir=paths.external_run_dir,
        model_context_token_limit=magentic_ui_config.model_context_token_limit,
        approval_guard=approval_guard,
    )

    if (
        orchestrator_config.memory_controller_key is not None
        and orchestrator_config.retrieve_relevant_plans in ["reuse", "hint"]
    ):
        memory_provider = MemoryControllerProvider(
            internal_workspace_root=paths.internal_root_dir,
            external_workspace_root=paths.external_root_dir,
            inside_docker=magentic_ui_config.inside_docker,
        )
    else:
        memory_provider = None

    team = GroupChat(
        participants=[web_surfer, user_proxy, coder_agent, file_surfer],
        orchestrator_config=orchestrator_config,
        model_client=model_client_orch,
        memory_provider=memory_provider,
    )

    await team.lazy_init()
    return team

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

async def create_magentic_one_team(
    team_config: Union[str, Path, Dict[str, Any], ComponentModel],
    state: Optional[Mapping[str, Any] | str] = None,
    input_func: Optional[InputFuncType] = None,
    env_vars: Optional[List[EnvironmentVariable]] = None,
    settings_config: dict[str, Any] = {},
    *,
    paths: RunPaths,
    config: dict[str, Any],
    load_from_config: bool = False,
    inside_docker: bool = True,
) -> tuple[Team, int, int]:
    """Create team instance from config"""

    _, novnc_port, playwright_port = get_browser_resource_config(
        paths.external_run_dir, -1, -1, inside_docker
    )
    try:
        if not load_from_config:
            # Load model configurations from settings if provided
            model_configs: Dict[str, Any] = settings_config.get("model_configs")
            # Use model configs from settings if available, otherwise fall back to config
            orchestrator_config = model_configs.get("orchestrator_client", config.get("orchestrator_client", None))
            model_client_configs = ModelClientConfigs(
                orchestrator=orchestrator_config,
                web_surfer=model_configs.get(
                    "web_surfer_client",
                    config.get("web_surfer_client", None),
                ),
                coder=model_configs.get(
                    "coder_client", config.get("coder_client", None)
                ),
                file_surfer=model_configs.get(
                    "file_surfer_client",
                    config.get("file_surfer_client", None),
                ),
                action_guard=model_configs.get(
                    "action_guard_client",
                    config.get("action_guard_client", None),
                ),
            )

            magentic_ui_config = MagenticUIConfig(
                **(settings_config or {}),
                model_client_configs=model_client_configs,
                playwright_port=playwright_port,
                novnc_port=novnc_port,
                inside_docker=inside_docker,
            )

            team = cast(
                Team,
                await get_task_team(
                    magentic_ui_config=magentic_ui_config,
                    input_func=input_func,
                    paths=paths,
                ),
            )
            if hasattr(team, "_participants"):
                for agent in cast(list[ChatAgent], team._participants):  # type: ignore
                    if isinstance(agent, WebSurfer):
                        novnc_port = agent.novnc_port
                        playwright_port = agent.playwright_port

            if state:
                if isinstance(state, str):
                    try:
                        # Try to decompress if it's compressed
                        state_dict = decompress_state(state)
                        await team.load_state(state_dict)
                    except Exception:
                        # If decompression fails, assume it's a regular JSON string
                        state_dict = json.loads(state)
                        await team.load_state(state_dict)
                else:
                    await team.load_state(state)

            return team, novnc_port, playwright_port

        if isinstance(team_config, (str, Path)):
            config = await load_from_file(team_config)
        elif isinstance(team_config, dict):
            config = team_config
        else:
            config = team_config.model_dump()

        # Load env vars into environment if provided
        if env_vars:
            logger.info("Loading environment variables")
            for var in env_vars:
                os.environ[var.name] = var.value

        team = cast(Team, GroupChat.load_component(config))

        if hasattr(team, "_participants"):
            for agent in cast(list[ChatAgent], self.team._participants):  # type: ignore
                if hasattr(agent, "input_func"):
                    agent.input_func = input_func  # type: ignore
                if isinstance(agent, WebSurfer):
                    novnc_port = agent.novnc_port or -1
                    playwright_port = agent.playwright_port or -1
        return team, novnc_port, playwright_port
    except Exception as e:
        logger.error(f"Error creating team: {e}")
        raise

async def create_magentic_round_team(
    team_config: Union[str, Path, Dict[str, Any], ComponentModel],
    state: Optional[Mapping[str, Any] | str] = None,
    input_func: Optional[InputFuncType] = None,
    env_vars: Optional[List[EnvironmentVariable]] = None,
    settings_config: dict[str, Any] = {},
    *,
    paths: RunPaths,
    config: dict[str, Any],
    load_from_config: bool = False,
    inside_docker: bool = True,
    run_info: dict[str, Any] = {},
    agent_mode_config: dict[str, Any] = {},
    files: List[Dict[str, Any]] | None = None,
) -> tuple[Team, int, int]:
    
    model_configs: Dict[str, Any] = settings_config.get("model_configs")
    model_config = model_configs.get("model_config", {})
    api_key = model_config.get("config", {}).get("api_key")
    if api_key is None:
        raise ValueError("API key not provided in model_configs")

    # 目前可选的mode有，besiii，drsai，custom，magentic-one，remote
    agent_mode: str = agent_mode_config.get("mode", "besiii") 
    agent_config: Dict[str, Any] = agent_mode_config.get("config", {})
    
    # 配置chat_id
    # session_id = run_info.get("session_id")
    chat_id = run_info.get("uuid")
    # 配置用户信息
    user_id = run_info.pop("user_id")
    run_info["name"] = user_id
    run_info["email"] = user_id
    
    if agent_mode == "besiii":
        # raise NotImplementedError("BesIII mode not implemented yet")
        agent = StatusAgent(
            name='besiii',
            model_client=get_model_client(model_client_config = model_config),
            chat_id=chat_id,
            run_info=run_info,
            model_remote_configs={
                # "url": "http://0.0.0.0:42806/apiv2/",
                "model": "drsai/besiii",
                "api_key": api_key
            },
            files = files,
        )
        # agent = RemoteAgent(
        #     name='besiii',
        #     chat_id=chat_id,
        #     run_info=run_info,
        #     model_remote_configs={
        #         "url": "http://202.122.37.163:42887/apiv2/chat/completions",
        #         "model_name": "hepai/drsai",
        #         "api_key": api_key
        #     },
        # )
    
    elif agent_mode == "custom":

        model_config_default = {
            'provider': 'drsai.HepAIChatCompletionClient', 
            'config': {
                'model': 'deepseek-ai/deepseek-v3:671b', 
                'base_url': 'https://aiapi.ihep.ac.cn/apiv2', 
                'api_key': api_key, 
                'max_retries': 10
            }
        }
        
        model_client = agent_config.get("model_client")
        if model_client is not None:
            model_config_default["config"]["model"] = model_client.get("model")
            model_config_default["config"]["base_url"] = model_client.get("base_url") or "https://aiapi.ihep.ac.cn/apiv2"
            model_config_default["config"]["api_key"] = model_client.get("api_key") or api_key

        ragflow_configs = agent_config.get("ragflow_configs")
        if ragflow_configs is not None:
            ragflow_memorys = await a_get_ragflow_memorys(ragflow_configs)
        else:
            ragflow_memorys = None
        
        mcp_sse_list = agent_config.get("mcp_sse_list")
        if mcp_sse_list is not None:
            mcp_workbench = await a_get_mcp_workbench(mcp_sse_list)
        else:
            mcp_workbench = None
        tool_schema = await mcp_workbench.list_tools() if mcp_workbench is not None else None

        agent = RAGFlowAgent(
            name= "drsai", #agent_config.get("name", "drsai"),
            system_message=agent_config.get("system_message","A helpfull assistant."),
            description=agent_config.get("description","A helpfull assistant."),
            model_client=get_model_client(model_client_config = model_config_default),
            memory=ragflow_memorys,
            workbench=mcp_workbench,
            thread_id = chat_id,
            user_id=user_id,
            agent_config = agent_config,
            tool_schema=tool_schema,
        )

    elif agent_mode == "remote" or agent_mode == "ddf":
        agent_config["api_key"] = agent_config.get("api_key", api_key)
        agent = StatusAgent(
            name="RemoteAgent",
            model_client=get_model_client(model_client_config = model_config),
            model_remote_configs = agent_config,
            chat_id=chat_id,
            run_info=run_info
            )
        
    elif agent_mode == "pip_install":
        module = importlib.import_module(agent_config["provider"])
        agent_factory: Callable[[], Union[ChatAgent, Team]] = await module.a_load_agent_factory_from_installed(
            team_config = team_config,
            state = state,
            input_func = input_func,
            env_vars = env_vars,
            settings_config = settings_config,
            paths = paths,
            config = config,
            load_from_config = load_from_config,
            inside_docker = inside_docker,
            run_info = run_info,
        )
        agent: ChatAgent|Team = await agent_factory()
    # TODO: 自定义Agent
    # elif agent_mode == "custom":
    #     agent_factory: Callable[[], Union[ChatAgent, Team]] = await a_load_agent_factory_from_config(agent_config, mode = "ui")
    #     agent: ChatAgent|Team = await agent_factory()

    else:
        raise ValueError(f"Invalid agent mode: {agent_mode}")

    if isinstance(agent, ChatAgent):
        user_proxy_input_func = make_agentchat_input_func(input_func)
        user_proxy = RoundbinDrSaiUserProxyAgent(
            description=USER_PROXY_DESCRIPTION,
            name="user_proxy",
            input_func=user_proxy_input_func,
        )
        team = RoundRobinGroupChat(
            participants=[agent, user_proxy,],
        )
        
    else:
        logger.error(f"Only supports AssistantAgent")
        raise NotImplementedError("GroupChat mode not implemented yet")
    
    await team.lazy_init()

    if state:
        if isinstance(state, str):
            try:
                # Try to decompress if it's compressed
                state_dict = decompress_state(state)
                await team.load_state(state_dict)
            except Exception:
                # If decompression fails, assume it's a regular JSON string
                state_dict = json.loads(state)
                await team.load_state(state_dict)
        else:
            await team.load_state(state)

    return team, -1, -1
