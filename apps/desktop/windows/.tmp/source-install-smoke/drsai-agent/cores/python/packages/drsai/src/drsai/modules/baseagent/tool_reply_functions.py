# -*- coding: utf-8 -*-
import json
from typing import List, Dict, Union, AsyncGenerator, Tuple, Any

# Model client
from drsai import HepAIChatCompletionClient, AssistantAgent

# backend thread 
from drsai.modules.managers.database import DatabaseManager

# AutoGen imports
from autogen_core import CancellationToken, FunctionCall
from autogen_core.tools import (
    BaseTool, 
    FunctionTool, 
    StaticWorkbench, 
    Workbench, 
    ToolResult, 
    TextResultContent, 
    ToolSchema)

from autogen_core.models import (
    LLMMessage,
    SystemMessage,
    AssistantMessage,
    UserMessage,
    ChatCompletionClient,
    CreateResult,
    FunctionExecutionResultMessage
)
from autogen_agentchat.base import Response
from autogen_agentchat.messages import (
    BaseAgentEvent,
    BaseChatMessage,
    ToolCallSummaryMessage,
    ModelClientStreamingChunkEvent,
    TextMessage,
    UserInputRequestedEvent,
    ThoughtEvent,
    HandoffMessage,
    AgentEvent,
    ChatMessage,
    MemoryQueryEvent,
    ToolCallExecutionEvent,
    ToolCallRequestEvent,
)

async def tools_reply_function( 
    agent: AssistantAgent,  # DrSai assistant agent
    oai_messages: List[str],  # OAI messages
    agent_name: str,  # Agent name
    llm_messages: List[LLMMessage],  # AutoGen LLM messages
    model_client: ChatCompletionClient,  # AutoGen LLM Model client
    workbench: Workbench,
    handoff_tools: List[BaseTool[Any, Any]],
    tools: Union[ToolSchema, List[BaseTool[Any, Any]]],
    cancellation_token: CancellationToken,  # AutoGen cancellation token,
    db_manager: DatabaseManager,  # DrSai database manager,
    thread_id: str,
    user_id: str,
    **kwargs) -> Union[str, AsyncGenerator[str, None]]:
    """
    自定义回复函数：能够智能地调用工具，然后通过工具的执行结果进行回复。
    """

    # 使用AutoGen Workbench获取工具信息
    if isinstance(workbench, StaticWorkbench):
        tools_name = [i.name for i in workbench._tools]
    
    # 进行工具执行
    model_result = None
    async for chunk in model_client.create_stream(
            messages=llm_messages,
            cancellation_token=cancellation_token,
            tools = tools,
        ):
        if isinstance(chunk, CreateResult):
            model_result = chunk
        else:
            yield chunk
        
    # 进一步解析模型返回的结果
    if isinstance(model_result.content, list):
        # 模型返回的结果必须是FunctionCall列表
        assert isinstance(model_result.content, list) and all(
            isinstance(item, FunctionCall) for item in model_result.content
        )
        function_calls_new = [] # 储存不在mp_structure_reply_function中处理的函数，如handoff_function等
        function_calls: List[FunctionCall] = model_result.content
        function_call_contents: str = ""
        for function_call in function_calls:
            if function_call.name in tools_name:
                tool_result: ToolResult = await workbench.call_tool(name=function_call.name, arguments=json.loads(function_call.arguments), cancellation_token=cancellation_token)
                name = tool_result.name
                content: str = "\n".join([str(i.content) for i  in tool_result.result])
                function_call_contents += f"tool:{name}\n{content}\n\n"
                yield "<think>\n"
                yield f"The result of tool {name} is as follows:\n"
                yield f"{content}\n"
                yield "</think>\n"
            else:
                function_calls_new.append(function_call)
        if function_calls_new:
            model_result.content = function_calls_new
            yield model_result
        else:
            prompt = f"""The next is the result of the tool calls. Please summarize the result according to user's requirements and the system's requirements.
    ```
    {function_call_contents}
    ```
    """
            llm_messages.append(UserMessage(content=prompt, source="user"))
            async for chunk in model_client.create_stream(
                messages=llm_messages,
                cancellation_token=cancellation_token,
            ):
                yield chunk
    else:
        yield model_result


async def tools_recycle_reply_function( 
    agent: AssistantAgent,  # DrSai assistant agent
    oai_messages: List[str],  # OAI messages
    agent_name: str,  # Agent name
    llm_messages: List[LLMMessage],  # AutoGen LLM messages
    model_client: ChatCompletionClient,  # AutoGen LLM Model client
    workbench: Workbench,
    handoff_tools: List[BaseTool[Any, Any]],
    tools: Union[ToolSchema, List[BaseTool[Any, Any]]],
    cancellation_token: CancellationToken,  # AutoGen cancellation token,
    db_manager: DatabaseManager,
    thread_id: str,
    user_id: str,
    **kwargs) -> Union[str, AsyncGenerator[str, None]]:
    """
    自定义回复函数：能够智能地循环调用工具自有的工具集进行规划完成任务。
    """

     # 使用AutoGen Workbench获取工具信息
    if isinstance(workbench, StaticWorkbench):
        tools_name = [i.name for i in workbench._tools]

        # 将循环调用的提示词以UserMessage的形式放入
        llm_messages.insert(0, SystemMessage(content=f"""你需要回复我上面的任务，回复要求如下：
1. 如果不需要使用工具集：{tools_name}，或者工具集中的工具无法完成任务，则进行转换或者直接使用你的知识回复；
2. 如果我上面的任务适合使用工具集：{tools_name}，你需要根据每个工具的功能，进行任务和对应的使用工具规划，然后按照规划依次调用对应工具执行
3. 在所有任务执行结束后，你需要进行总结，并回复'TERMINATE'。
"""))

        # 获取最大循环次数
        max_turns = kwargs.get("max_turns", 3)
        for i in range(max_turns):
            # 进行工具执行
            model_result = None
            async for chunk in model_client.create_stream(
                    messages=llm_messages,
                    cancellation_token=cancellation_token,
                    tools = tools,
                ):
                if isinstance(chunk, CreateResult):
                    model_result = chunk
                else:
                    yield chunk
            
            # 进一步解析模型返回的结果
            if isinstance(model_result.content, list):
                # 模型返回的结果必须是FunctionCall列表
                assert isinstance(model_result.content, list) and all(
                    isinstance(item, FunctionCall) for item in model_result.content
                )
                function_calls_new = [] # 储存不在mp_structure_reply_function中处理的函数，如handoff_function等
                function_calls: List[FunctionCall] = model_result.content
                function_call_contents: str = ""
                for function_call in function_calls:
                    if function_call.name in tools_name:
                        tool_result: ToolResult = await workbench.call_tool(name=function_call.name, arguments=json.loads(function_call.arguments), cancellation_token=cancellation_token)
                        name = tool_result.name
                        content: str = "\n".join([str(i.content) for i  in tool_result.result])
                        yield f"工具{name}的执行结果如下:\n"
                        yield "<think>\n"
                        yield f"{content}\n\n"
                        yield "</think>\n"
                        function_call_contents += f"工具{name}的执行结果如下:\n{content}\n\n"
                    else:
                        function_calls_new.append(function_call)

                # 将执行结果以AssistMessage的形式放入
                llm_messages.append(UserMessage(content=function_call_contents, source=agent_name))
                                                  
            # 循环调用结束，则结束对话
            elif 'TERMINATE' in model_result.content:
                yield model_result
                return
            elif function_calls_new:
                # handoff_function函数，则进行转移
                model_result.content = function_calls_new
                yield model_result
                return
            else:
                yield model_result
                continue
    else:
        # 无工具集，则直接使用大模型进行回复
        async for chunk in model_client.create_stream(
                messages=llm_messages,
                cancellation_token=cancellation_token,
                tools = tools,
            ):
            yield chunk

