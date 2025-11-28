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
import inspect
import json
import os, json, time
import asyncio
from pydantic import BaseModel

from autogen_core import CancellationToken, FunctionCall
from autogen_core.tools import (
    BaseTool, 
    Workbench, 
    ToolSchema)
from autogen_ext.tools.mcp import SseServerParams,mcp_server_tools
from autogen_core.memory import Memory
from autogen_core.model_context import ChatCompletionContext
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
)

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

from drsai.modules.managers.database import DatabaseManager
from drsai import DrSaiStaticWorkbench
from drsai import RAGFlowMemory, RAGFlowMemoryConfig
from autogen_core.model_context import (
    BufferedChatCompletionContext,)
from drsai import AssistantAgent, HepAIChatCompletionClient
from drsai.modules.components.task_manager.base_task_system import TaskType, TaskStatus, Task
from drsai.modules.managers.messages.agent_messages import(
    AgentLongTaskMessage,
    LongTaskQueryMessage,
    AgentLogEvent,
    ToolLongTaskEvent,
)

from drsai import run_backend, run_console, run_worker

class LongMCPAgent(AssistantAgent):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)

        self._tool_name: Optional[str] = None
        self._tool_arguments: Optional[Dict[str, Any]] = None
    
    async def on_messages_stream(
        self, messages: Sequence[BaseChatMessage], cancellation_token: CancellationToken
    ) -> AsyncGenerator[BaseAgentEvent | BaseChatMessage | Response, None]:
        """
        Process the incoming messages with the assistant agent and yield events/responses as they happen.
        """

        # monitor the pause event
        if self.is_paused:
            yield Response(
                chat_message=TextMessage(
                    content=f"The {self.name} is paused.",
                    source=self.name,
                    metadata={"internal": "yes"},
                )
            )
            return

        # Set up background task to monitor the pause event and cancel the task if paused.
        async def monitor_pause() -> None:
            await self._paused.wait()
            self.is_paused = True

        monitor_pause_task = asyncio.create_task(monitor_pause())
        inner_messages: List[BaseAgentEvent | BaseChatMessage] = []
        try:
            # Gather all relevant state here
            agent_name = self.name
            model_context = self._model_context
            memory = self._memory
            system_messages = self._system_messages
            workbench = self._workbench
            handoff_tools = self._handoff_tools
            handoffs = self._handoffs
            model_client = self._model_client
            model_client_stream = self._model_client_stream
            reflect_on_tool_use = self._reflect_on_tool_use
            tool_call_summary_format = self._tool_call_summary_format
            output_content_type = self._output_content_type
            format_string = self._output_content_type_format

            # STEP 1: Add new user/handoff messages to the model context
            await self._add_messages_to_context(
                model_context=model_context,
                messages=messages,
            )

            # STEP 2: Update model context with any relevant memory
            for event_msg in await self._update_model_context_with_memory(
                memory=memory,
                model_context=model_context,
                agent_name=agent_name,
            ):
                inner_messages.append(event_msg)
                yield event_msg

            # STEP 3: Run the first inference
            model_result = None
            async for inference_output in self._call_llm(
                model_client=model_client,
                model_client_stream=model_client_stream,
                system_messages=system_messages,
                model_context=model_context,
                workbench=workbench,
                handoff_tools=handoff_tools,
                agent_name=agent_name,
                cancellation_token=cancellation_token,
                output_content_type=output_content_type,
            ):
                if self.is_paused:
                    raise asyncio.CancelledError()
                
                if isinstance(inference_output, CreateResult):
                    model_result = inference_output
                else:
                    # Streaming chunk event
                    yield inference_output

            assert model_result is not None, "No model result was produced."

            # --- NEW: If the model produced a hidden "thought," yield it as an event ---
            if model_result.thought:
                thought_event = ThoughtEvent(content=model_result.thought, source=agent_name)
                yield thought_event
                inner_messages.append(thought_event)

            # Add the assistant message to the model context (including thought if present)
            await model_context.add_message(
                AssistantMessage(
                    content=model_result.content,
                    source=agent_name,
                    thought=getattr(model_result, "thought", None),
                )
            )

            # For long task 
            if not isinstance(model_result.content, str):
                self._tool_name = model_result.content[0].name
                self._tool_arguments = json.loads(model_result.content[0].arguments)
                
            # STEP 4: Process the model output
            async for output_event in self._process_model_result(
                model_result=model_result,
                inner_messages=inner_messages,
                cancellation_token=cancellation_token,
                agent_name=agent_name,
                system_messages=system_messages,
                model_context=model_context,
                workbench=workbench,
                handoff_tools=handoff_tools,
                handoffs=handoffs,
                model_client=model_client,
                model_client_stream=model_client_stream,
                reflect_on_tool_use=reflect_on_tool_use,
                tool_call_summary_format=tool_call_summary_format,
                output_content_type=output_content_type,
                format_string=format_string,
            ): 
                if isinstance(output_event, Response):
                    if isinstance(output_event.chat_message, ToolCallSummaryMessage):
                        mcp_output = json.loads(output_event.chat_message.content)
                        if mcp_output["status"] == "IN_PROGRESS":
                            self._tool_arguments["task_id"] = mcp_output["id"]
                            output_event.chat_message =  AgentLongTaskMessage(
                                source=self.name,
                                content=f"{self._tool_name} is running. Please wait for the result.",
                                task_status=TaskStatus.in_progress.value,
                                query_arguments=self._tool_arguments,
                                tool_name=self._tool_name
                            )
                        yield output_event
                else:
                    yield output_event

        except asyncio.CancelledError:
            # If the task is cancelled, we respond with a message.
            yield Response(
                chat_message=TextMessage(
                    content="The task was cancelled by the user.",
                    source=self.name,
                    metadata={"internal": "yes"},
                ),
                inner_messages=inner_messages,
            )
        except Exception as e:
            logger.error(f"Error in {self.name}: {e}")
            # add to chat history
            await model_context.add_message(
                AssistantMessage(
                    content=f"An error occurred while executing the task: {e}",
                    source=self.name
                )
            )
            yield Response(
                chat_message=TextMessage(
                    content=f"An error occurred while executing the task: {e}",
                    source=self.name,
                    metadata={"internal": "no"},
                ),
                inner_messages=inner_messages,
            )
        finally:
            # Cancel the monitor task.
            try:
                monitor_pause_task.cancel()
                await monitor_pause_task
            except asyncio.CancelledError:
                pass

    async def _process_long_task_query(
            self,
            task: Dict|LongTaskQueryMessage|Sequence[BaseChatMessage] | None = None,
            cancellation_token: CancellationToken | None = None,
        )-> AsyncGenerator[BaseAgentEvent | BaseChatMessage | Response, None]:
        
        if not isinstance(task, LongTaskQueryMessage):
            raise ValueError("tasks must be a LongTaskQueryMessage")
        
        query_arguments: Dict = task.query_arguments
        query_tool_name = task.tool_name
        if query_tool_name is None or query_arguments is None:
            raise ValueError("query_tool_name or query_arguments cannot be None")
        
        result = await self._workbench.call_tool(
                name = query_tool_name,
                arguments=query_arguments)
        result_json = json.loads(result.result[0].content)

        if result_json["status"] == "IN_PROGRESS":
            yield Response(
                chat_message=AgentLongTaskMessage(
                    source=self.name,
                    content=result_json["result"],
                    task_status=TaskStatus.in_progress.value,
                    query_arguments=query_arguments,
                    tool_name=query_tool_name
                ))
        else:
            yield Response(
                chat_message=TextMessage(
                        source=self.name,
                        content=result_json["result"],
                    ))
        
    


# 创建一个工厂函数，用于并发访问时确保后端使用的Agent实例是隔离的。
async def create_agent() -> LongMCPAgent:

    model_client = HepAIChatCompletionClient(
        model="deepseek-ai/deepseek-v3-1",
    )
    tools=await mcp_server_tools(SseServerParams(
                                url="http://0.0.0.0:42608/sse",
                                env=None)
                        ) 
    workbench = DrSaiStaticWorkbench(tools = tools)
    assistant_agent = LongMCPAgent(
        name="assistant_agent",
        system_message="""你是一个可以进行web检索的智能体""",
        description="一个web检索助手",
        model_client=model_client,
        model_client_stream=True,
        model_context=BufferedChatCompletionContext(buffer_size = 20), # 限制最多20条消息
        workbench=workbench,
    )

    return assistant_agent

async def agent_event_output():
    agent_event = await create_agent()
    
    output_ChunkEvent_once = False

    async for event in agent_event.run_stream(
        task = "你好，请问如何使用BOSS8？",
        cancellation_token=CancellationToken()
    ):
        if isinstance(event, ModelClientStreamingChunkEvent):
            if output_ChunkEvent_once:
                continue
            output_ChunkEvent_once = True
            print(event)
        else:
            print(event)
        
        print()

async def agent_long_task_output():
    agent_event = await create_agent()
    
    async for event in agent_event._process_long_task_query(
        task = LongTaskQueryMessage(
            source="user",
            content="""查询任务进度""",
            tool_name="perform_long_research",
            query_arguments={
                "keywords": ["如何使用BOSS8"],
                "task_id": "6ee56087-d6a0-46a7-9509-e13b721f9598"
            }
        ),
        cancellation_token=CancellationToken()
    ):
        print(event)




if __name__ == "__main__":
    # asyncio.run(agent_event_output())
    asyncio.run(agent_long_task_output())
    # asyncio.run(
    #     run_worker(
    #         # 智能体注册信息
    #         agent_name="Task_Assistant",
    #         author = "xiongdb@ihep.ac.cn",
    #         permission='groups: drsai, payg; users: admin, xiongdb@ihep.ac.cn, ddf_free, yqsun@ihep.ac.cn; owner: xiongdb@ihep.ac.cn',
    #         description = "一个任务系统的问答助手",
    #         version = "0.1.0",
    #         logo="https://aiapi.ihep.ac.cn/apiv2/files/file-8572b27d093f4e15913bebfac3645e20/preview",
    #         # 智能体实体
    #         agent_factory=create_agent, 
    #         # 后端服务配置
    #         port = 42816, 
    #         no_register=False,
    #         enable_openwebui_pipeline=True, 
    #         pipelines_dir="/home/xiongdb/drsai/examples/agent_groupchat/assistant_ragflow/pipelines/",
    #         history_mode = "backend",
    #         # use_api_key_mode = "backend",
    #     )
    # )