# load_agent from config
from drsai_ui.agent_factory.magentic_one.agents.drsai_agents.drsai_agent import MagenticAgent
from drsai_ui.agent_factory.magentic_one.agents.drsai_agents.drsai_remote_agent import RemoteAgent
from drsai_ui.agent_factory.magentic_one.agents._coder import CoderAgent, CoderAgentConfig, CoderAgentState
from drsai_ui.agent_factory.magentic_one.agents.web_surfer import WebSurfer, WebSurferConfig, WebSurferCUA
from drsai_ui.agent_factory.load_agent import (
    get_model_client, 
    load_mcp_tools, 
    load_hepai_tools,
    load_memory_functions,
    load_agent_factory_from_config,
    a_load_mcp_tools, 
    a_load_hepai_tools,
    a_load_memory_functions,
    a_load_agent_factory_from_config,
    )