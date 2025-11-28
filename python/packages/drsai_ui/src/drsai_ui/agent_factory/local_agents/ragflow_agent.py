from typing import (
    AsyncGenerator, 
    List, 
    Sequence, 
    Dict, 
    Any, 
    Callable, 
    Awaitable, 
    Union, 
    Optional, 
    Tuple,
    Self,
    Mapping,
    )

import asyncio
from loguru import logger
import warnings
import inspect
import json
import os

from pydantic import BaseModel, Field

from autogen_core import (
    CancellationToken, 
    FunctionCall, 
    ComponentModel,
    Component
    )
from autogen_core.tools import (
    BaseTool, 
    FunctionTool, 
    StaticWorkbench, 
    Workbench, 
    ToolSchema)
from autogen_ext.tools.mcp import (
    McpServerParams, 
    SseServerParams, 
    StdioServerParams,
    StdioMcpToolAdapter,
    SseMcpToolAdapter,
    McpWorkbench,
    create_mcp_server_session,
    mcp_server_tools)
from autogen_core.memory import Memory
from autogen_core.model_context import (
    ChatCompletionContext,
    UnboundedChatCompletionContext
    )
from autogen_core.models import (
    ChatCompletionClient,
    CreateResult,
    FunctionExecutionResultMessage,
    FunctionExecutionResult,
    LLMMessage,
    UserMessage,
    AssistantMessage,
    SystemMessage,
    RequestUsage,
    ModelFamily,
)

from autogen_agentchat.agents import AssistantAgent, BaseChatAgent
from autogen_agentchat.state import AssistantAgentState, BaseState
from autogen_agentchat.agents._assistant_agent import AssistantAgentConfig
from autogen_agentchat.base import Handoff as HandoffBase
from autogen_agentchat.base import Response, TaskResult
from autogen_agentchat.messages import (
    BaseAgentEvent,
    BaseChatMessage,
    AgentEvent,
    ChatMessage,
    HandoffMessage,
    MemoryQueryEvent,
    ModelClientStreamingChunkEvent,
    TextMessage,
    ToolCallExecutionEvent,
    ToolCallRequestEvent,
    ToolCallSummaryMessage,
    UserInputRequestedEvent,
    ThoughtEvent,
    StructuredMessage,
    StructuredMessageFactory,
    # MultiModalMessage,
    Image,
)
from autogen_agentchat.utils import remove_images
from drsai import HepAIChatCompletionClient
from drsai.modules.components.memory.ragflow_memory import RAGFlowMemory, RAGFlowMemoryConfig
from drsai.modules.managers.database import DatabaseManager, DatabaseManagerConfig
from drsai import DrSaiStaticWorkbench
from drsai import DrSaiChatCompletionContext
from drsai.modules.managers.messages.agent_messages import(
    AgentLongTaskMessage,
    LongTaskQueryMessage,
    AgentLogEvent,
    ToolLongTaskEvent,
)
from drsai import DrSaiAgent


class RAGFlowAgent(DrSaiAgent):

    def __init__(
        self,
        name: str,
        *,
        model_client: ChatCompletionClient = None,
        tools: List[BaseTool[Any, Any] | Callable[..., Any] | Callable[..., Awaitable[Any]]] | None = None,
        workbench: Workbench | None = None,
        handoffs: List[HandoffBase | str] | None = None,
        model_context: ChatCompletionContext | None = None,
        description: str = "An agent that provides assistance with ability to use tools.",
        system_message: (
            str | None
        ) = "You are a helpful AI assistant. Solve tasks using your tools. Reply with TERMINATE when the task has been completed.",
        model_client_stream: bool = True,
        reflect_on_tool_use: bool | None = None,
        tool_call_summary_format: str = "{result}",
        output_content_type: type[BaseModel] | None = None,
        output_content_type_format: str | None = None,
        memory: Sequence[Memory] | None = None,
        metadata: Dict[str, str] | None = None,

        # drsaiAgent specific
        memory_function: Callable = None,
        # allow_reply_function: bool = False,
        reply_function: Callable = None,
        db_manager: DatabaseManager = None,
        thread_id: str = None,
        user_id: str = None,
        **kwargs,
    ):
        super().__init__(
            name=name,
            model_client=model_client,
            tools=tools,
            workbench=workbench,
            handoffs=handoffs,
            model_context=model_context,
            description=description,
            system_message=system_message,
            model_client_stream=model_client_stream,
            reflect_on_tool_use=reflect_on_tool_use,
            tool_call_summary_format=tool_call_summary_format,
            output_content_type=output_content_type,
            output_content_type_format=output_content_type_format,
            memory=memory,
            metadata=metadata,
            memory_function=memory_function,
            # allow_reply_function=allow_reply_function,
            reply_function=reply_function,
            db_manager=db_manager,
            thread_id=thread_id,
            user_id=user_id,
            **kwargs,
        )

        agent_config = kwargs.get("agent_config") or {}

        # ragflow_configs 为可选配置：不存在时直接跳过，不影响其他功能
        ragflow_configs = agent_config.get("ragflow_configs") or []
        for ragflow_config in ragflow_configs:
            if ragflow_config is not None:
                ragflow_url = ragflow_config.get("ragflow_url")
                ragflow_token = ragflow_config.get("ragflow_token")
                dataset_ids = ragflow_config.get("dataset_ids")  # necessary
                # document_ids = ragflow_config.get("document_ids")
                self._memory.append(
                    RAGFlowMemory(
                        config=RAGFlowMemoryConfig(
                            name="ragflow_memory",
                            RAGFLOW_URL=ragflow_url,
                            RAGFLOW_TOKEN=ragflow_token,
                            dataset_ids=dataset_ids,
                            keyword=True,
                        )
                    )
                )
        
        self._workbench: StaticWorkbench | None = None
        tool_schema = None
        mcp_sse_list = agent_config.get("mcp_sse_list")
        if mcp_sse_list is not None:
            asyncio.create_task(self.get_mcp_server_tools(mcp_sse_list))
            tool_schema = self._workbench.list_tools()
        else:
            self._workbench=StaticWorkbench(tools=self._tools)
    
        self._model_context = DrSaiChatCompletionContext(
            agent_name = agent_config.get("name", "drsai"),
            model_client = self._model_client,
            token_limit = 100000,
            tool_schema = tool_schema
        )
        
    async def get_mcp_server_tools(self, mcp_sse_list: List[Dict[str, Any]]) -> List[SseMcpToolAdapter]:
        """
        加载 MCP SSE 工具。
        mcp_sse_list 约定为 List[Dict[str, Any]]，每个元素形如：
        {
            "url": "https://example.com/mcp",
            "token": "xxx",                   # 可选，若不需要鉴权可传空字符串 ""
            "headers": {...},                 # 可选，若提供则优先使用此 headers
            "timeout": 20,                    # 可选，默认 20
            "sse_read_timeout": 300           # 可选，默认 300
        }
        """
        sse_tools: list[SseMcpToolAdapter] = []
        for cfg in mcp_sse_list:
            url = cfg.get("url", None)
            assert url is not None, "mcp_sse_list.url 不能为空"

            # 优先使用用户显式传入的 headers
            headers = cfg.get("headers") or {}

            # 兼容单独传 token 的场景，如果 token 非空则自动加 Authorization
            token = cfg.get("token", "")
            if token:
                headers = dict(headers)  # 拷贝一份，避免修改原对象
                headers.setdefault("Authorization", f"Bearer {token}")

            timeout = cfg.get("timeout", 20)
            sse_read_timeout = cfg.get("sse_read_timeout", 60 * 5)

            sse_tool: list[SseMcpToolAdapter] = await mcp_server_tools(
                SseServerParams(
                    url=url,
                    headers=headers or None,
                    timeout=timeout,
                    sse_read_timeout=sse_read_timeout,
                )
            )
            # mcp_server_tools 返回的是一个工具列表，这里要累加到总的工具集合中
            sse_tools.extend(sse_tool)
        
        # 用所有 SSE 工具构建 Workbench，供后续模型调用工具使用
        self._workbench = DrsaiStaticWorkbench(tools=sse_tools)
        return sse_tools
        
