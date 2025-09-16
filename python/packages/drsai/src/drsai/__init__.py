from drsai.dr_sai import DrSai

# Agent components
from drsai.modules.components.LLMClient import HepAIChatCompletionClient
from drsai.modules.components.memory.ragflow_memory import RAGFlowMemory

# Agents
from drsai.modules.baseagent.drsaiagent import DrSaiAgent as AssistantAgent

# Groupchat
from drsai.modules.groupchat._round_robin_group_chat import DrSaiRoundRobinGroupChat, DrSaiRoundRobinGroupChatManager
from drsai.modules.groupchat._selector_group_chat import DrSaiSelectorGroupChat
from drsai.modules.groupchat._swarm_group_chat import DrSaiSwarm
from drsai.modules.groupchat._base_group_chat import DrSaiGroupChatManager, DrSaiGroupChat

# manager
# from drsai.modules.managers.base_thread import Thread
# from drsai.modules.managers.threads_manager import ThreadsManager
# from drsai.modules.managers.base_thread_message import ThreadMessage, Content, Text
from drsai.modules.managers.database import DatabaseManager
from drsai.modules.managers.datamodel.db import (Thread, UserInput)

# reply functions
from drsai.modules.baseagent.tool_reply_functions import tools_reply_function, tools_recycle_reply_function

# tools
from drsai.modules.components.tools.mcps_std import web_fetch
from drsai.utils.fastapi2tools import get_fastapi_tools

# utils
from drsai.utils.message_convert import (
    llm_messages2oai_messages, 
    llm_messages2basechatmessages)
from drsai.utils.oai_stream_event import (
    chatcompletionchunk, 
    chatcompletionchunkend, 
    chatcompletions)

# backend
from drsai.backend.run import (
    run_backend, 
    run_console,
    run_worker
    )
from drsai.backend.app_worker import DrSaiAPP

###########
# Autogen #
###########

# autogen_ext Models
from autogen_ext.models.openai import OpenAIChatCompletionClient
from autogen_core.models  import (
    ChatCompletionClient,
    ModelCapabilities,  # type: ignore
    ModelFamily,
    ModelInfo,
    validate_model_info,
)

# autogen_agentchat Agents
from autogen_agentchat.agents import (
    UserProxyAgent, 
    BaseChatAgent,
    CodeExecutorAgent, 
    SocietyOfMindAgent)

# autogen_agentchat Groupchat
from autogen_agentchat.teams import (
    BaseGroupChat, 
    RoundRobinGroupChat, 
    Swarm,
    SelectorGroupChat, 
    MagenticOneGroupChat)

# autogen_agentchat Groupchat Termination Conditions
from autogen_agentchat.conditions import (
    ExternalTermination,
    HandoffTermination,
    MaxMessageTermination,
    SourceMatchTermination,
    StopMessageTermination,
    TextMentionTermination,
    TimeoutTermination,
    TokenUsageTermination,)

# autogen_agentchat UI
from autogen_agentchat.ui import Console, UserInputManager

# autogen_agentchat Messages
from autogen_core.models import (
    AssistantMessage,
    ChatCompletionTokenLogprob,
    CreateResult,
    FinishReasons,
    FunctionExecutionResult,
    FunctionExecutionResultMessage,
    LLMMessage,
    RequestUsage,
    SystemMessage,
    TopLogprob,
    UserMessage,
)
from autogen_agentchat.base import Response
from autogen_agentchat.messages import (
    BaseAgentEvent,
    BaseChatMessage,
    ToolCallSummaryMessage,
    ModelClientStreamingChunkEvent,
    TextMessage,
    HandoffMessage,
)

# autogen_core Tools
from autogen_core.tools import (
    Tool, 
    ToolSchema, 
    ParametersSchema,
    BaseTool,
    BaseToolWithState,
    FunctionTool,
    StaticWorkbench,
    ImageResultContent, 
    TextResultContent, 
    ToolResult, 
    Workbench
    )

# autogen_ext mcp
from autogen_ext.tools.mcp import (
    McpServerParams, 
    SseServerParams, 
    StdioServerParams,
    StdioMcpToolAdapter,
    SseMcpToolAdapter,
    McpWorkbench,
    create_mcp_server_session,
    mcp_server_tools)

from autogen_core import Image as AGImage
from autogen_core import CancellationToken