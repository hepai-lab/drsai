# load_agent from config
from drsai_ui.agent_factory.magentic_one.agents.drsai_agents.drsai_agent import MagenticAgent
from drsai_ui.agent_factory.remote_agent import RemoteAgent, StatusAgent
from drsai_ui.agent_factory.magentic_one.agents._coder import CoderAgent, CoderAgentConfig, CoderAgentState
from drsai_ui.agent_factory.magentic_one.agents.web_surfer import WebSurfer, WebSurferConfig, WebSurferCUA
from drsai_ui.agent_factory.load_agent import (
    get_model_client, 
    a_load_mcp_tools, 
    a_load_hepai_tools,
    a_load_agent_factory_from_config,
    )
from drsai_ui.agent_factory.components.memory.load_memory_cofig import load_memory_function