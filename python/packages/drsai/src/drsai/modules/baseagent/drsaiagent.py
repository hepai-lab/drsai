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
import os

from pydantic import BaseModel

from autogen_core import CancellationToken, FunctionCall
from autogen_core.tools import (
    BaseTool, 
    Workbench, 
    ToolSchema)
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

from autogen_agentchat.agents import AssistantAgent
from autogen_agentchat.state import AssistantAgentState
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
    StructuredMessageFactory,
    # MultiModalMessage,
    Image,
)
from drsai import HepAIChatCompletionClient
from drsai.modules.managers.database import DatabaseManager


class DrSaiAgent(AssistantAgent):
    """基于aotogen AssistantAgent的定制Agent"""
    def __init__(
        self,
        name: str,
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
        memory_function: Callable = None,
        # allow_reply_function: bool = False,
        reply_function: Callable = None,
        db_manager: DatabaseManager = None,
        thread_id: str = None,
        user_id: str = None,
        **kwargs,
            ):
        '''
        memory_function: 自定义的memory_function，用于RAG检索等功能，为大模型回复增加最新的知识
        reply_function: 自定义的reply_function，用于自定义对话回复的定制
        db_manager: 数据库管理器
        thread_id: 前端当前会话的id
        user_id: 用户id
        '''
        if not model_client:
            model_client = HepAIChatCompletionClient(model="openai/gpt-4o", api_key=os.environ.get("HEPAI_API_KEY"))
        
        super().__init__(
            name, 
            model_client,
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
            metadata=metadata
            )
        
        # 自定义回复函数，代替call_llm
        # self._allow_reply_function: bool = allow_reply_function
        self._reply_function: Callable = reply_function
        
        # 记忆管理
        self._memory_function: Callable = memory_function
       
        # 状态管理
        self.is_paused = False
        self._paused = asyncio.Event()

        # 数据管理
        self._thread_id: str = thread_id
        self._user_id: str = user_id
        self._db_manager: DatabaseManager = db_manager

        # 自定义参数
        self._user_params: Dict[str, Any] = {}
        self._user_params.update(kwargs)
    
    async def lazy_init(self, **kwargs: Any) -> None:
        """Initialize the tools and models needed by the agent."""
        pass

    async def close(self) -> None:
        """Clean up resources used by the agent.

        This method:
          ...
        """
        logger.info(f"Closing {self.name}...")
        
        # Close the model client.
        await self._model_client.close()

    async def pause(self) -> None:
        """Pause the agent by setting the paused state."""
        logger.info(f"Pausing {self.name}...")

        self.is_paused = True
        self._paused.set()

    async def resume(self) -> None:
        """Resume the agent by clearing the paused state."""
        self.is_paused = False
        self._paused.clear()

    async def llm_messages2oai_messages(self, llm_messages: List[LLMMessage]) -> List[Dict[str, str]]:
        """Convert a list of LLM messages to a list of OAI chat messages."""

        def handle_mulyimodal(content: list[Union[str, Image]])->list:
            """
            处理多模态消息
            """
            base64_images: str = ""
            text: str = ""
            handle_content = []
            for item in content:
                if isinstance(item, Image):
                    base64_images = item.data_uri
                    handle_content.append( {
                    "type": "image_url",
                    "image_url": {
                        "url": base64_images,
                    }
                })
                else:
                    text = item
                    handle_content.append({"type": "text", "text": text})
            return handle_content
        
        messages = []
        for llm_message in llm_messages:
            if isinstance(llm_message, SystemMessage):
                messages.append({"role": "system", "content": llm_message.content} )
            if isinstance(llm_message, UserMessage):
                messages.append({"role": "user", "content": llm_message.content, "name": llm_message.source})
            if isinstance(llm_message, AssistantMessage):
                messages.append({"role": "assistant", "content": llm_message.content, "name": llm_message.source})
            if isinstance(llm_message, FunctionExecutionResultMessage):
                messages.append({"role": "function", "content": json.dumps(llm_message.content)}) 

            
        
        for message in messages:
            if isinstance(message["content"], list):
                message["content"] = handle_mulyimodal(message["content"])
        return messages
    
    async def oai_messages2llm_messages(self, oai_messages: List[Dict[str, str]]) -> List[LLMMessage]:
        """Convert a list of OAI chat messages to a list of LLM messages."""
        messages = []
        for oai_message in oai_messages:
            if oai_message["role"] == "system":
                messages.append(SystemMessage(content=oai_message["content"]))
            if oai_message["role"] == "user":
                messages.append(UserMessage(content=oai_message["content"], source=oai_message.get("name", self.name)))
            if oai_message["role"] == "assistant":
                messages.append(AssistantMessage(content=oai_message["content"], source=oai_message.get("name", self.name)))
            if oai_message["role"] == "function":
                messages.append(FunctionExecutionResultMessage(content=oai_message["content"]))
        return messages
    
    async def _call_memory_function(
            self, 
            llm_messages: List[LLMMessage],
            model_client: ChatCompletionClient,
            cancellation_token: CancellationToken,
            agent_name: str,) -> List[LLMMessage]:
        """使用自定义的memory_function，为大模型回复增加最新的知识"""
        # memory_function: 自定义的memory_function，用于RAG检索等功能，为大模型回复增加最新的知识
        memory_messages: List[Dict[str, str]] = await self.llm_messages2oai_messages(llm_messages)
        try:
            memory_messages_with_new_knowledge: List[Dict[str, str]]|List[LLMMessage] = await self._memory_function(
                memory_messages, 
                llm_messages, 
                model_client, 
                cancellation_token,
                agent_name,
                **self._user_params)
            if isinstance(memory_messages_with_new_knowledge[0], dict):
                llm_messages: List[LLMMessage] = await self.oai_messages2llm_messages(memory_messages_with_new_knowledge)
            else:
                llm_messages = memory_messages_with_new_knowledge
            return llm_messages
        except Exception as e:
            raise ValueError(f"Error: memory_function: {self._memory_function.__name__} failed with error {e}.")
    
    async def _call_reply_function(
            self, 
            llm_messages: List[LLMMessage],
            model_client: ChatCompletionClient,
            workbench: Workbench,
            handoff_tools: List[BaseTool[Any, Any]],
            tools: Union[ToolSchema, List[BaseTool[Any, Any]]],
            agent_name: str,
            cancellation_token: CancellationToken,
            db_manager: DatabaseManager,
            **kwargs,
            ) -> AsyncGenerator[Union[CreateResult, ModelClientStreamingChunkEvent], None]:
        """使用自定义的reply_function，自定义对话回复的定制, CreateResult被期待在最后一个事件返回"""

        oai_messages = await self.llm_messages2oai_messages(llm_messages)

        model_result: Optional[CreateResult] = None
        allowed_events = [
            ToolCallRequestEvent,
            ToolCallExecutionEvent,
            MemoryQueryEvent,
            UserInputRequestedEvent,
            ModelClientStreamingChunkEvent,
            ThoughtEvent]
        
        if self._model_client_stream:
            # 如果reply_function不是返回一个异步生成器而使用了流式模式，则会报错
            if not inspect.isasyncgenfunction(self._reply_function):
                raise ValueError("reply_function must be AsyncGenerator function if model_client_stream is True.")
            # Stream the reply_function.
            response = ""
            async for chunk in self._reply_function(
                self,
                oai_messages, 
                agent_name = agent_name,
                llm_messages = llm_messages, 
                model_client=model_client, 
                workbench=workbench, 
                handoff_tools=handoff_tools, 
                tools=tools, 
                cancellation_token=cancellation_token, 
                db_manager=db_manager,
                **self._user_params
                ):
                if isinstance(chunk, str):
                    response += chunk
                    yield ModelClientStreamingChunkEvent(content=chunk, source=agent_name)
                elif any(isinstance(chunk, event_type) for event_type in allowed_events):
                    response += str(chunk.content)
                    yield chunk
                elif isinstance(chunk, HandoffMessage):
                    yield chunk
                elif isinstance(chunk, CreateResult):
                    model_result = chunk
                else:
                    raise RuntimeError(f"Invalid chunk type: {type(chunk)}")
            if isinstance(model_result, CreateResult):
                pass
            elif model_result is None:
            #     if isinstance(chunk, str):
            #         yield ModelClientStreamingChunkEvent(content=chunk, source=agent_name)
            #         response += chunk
            #     elif isinstance(chunk, AgentEvent):
            #         yield chunk
            #     elif isinstance(chunk, BaseAgentEvent):
            #     else:
            #         raise RuntimeError(f"Invalid chunk type: {type(chunk)}")
                assert isinstance(response, str)
                model_result = CreateResult(
                    content=response, finish_reason="stop",
                    usage = RequestUsage(prompt_tokens=0, completion_tokens=0),
                    cached=False)
        else:
            # 如果reply_function不是异步函数，或者是一个异步生成器，则会报错
            if not asyncio.iscoroutinefunction(self._reply_function) and not inspect.isasyncgenfunction(self._reply_function):
                raise ValueError("reply_function must be a coroutine function if model_client_stream is False.")
            response = await self._reply_function(
                self,
                oai_messages, 
                agent_name = agent_name,
                llm_messages = llm_messages, 
                model_client=model_client, 
                workbench=workbench, 
                handoff_tools=handoff_tools, 
                tools=tools, 
                cancellation_token=cancellation_token, 
                db_manager=db_manager,
                **self._user_params
                )
            if isinstance(response, str):
                model_result = CreateResult(
                    content=response, finish_reason="stop",
                    usage = RequestUsage(prompt_tokens=0, completion_tokens=0),
                    cached=False)
            elif isinstance(response, CreateResult):
                model_result = response
            else:
                raise RuntimeError(f"Invalid response type: {type(response)}")
        yield model_result

    @classmethod
    async def call_llm(
        cls,
        agent_name: str,
        model_client: ChatCompletionClient,
        llm_messages: List[LLMMessage], 
        tools: List[BaseTool[Any, Any]], 
        model_client_stream: bool,
        cancellation_token: CancellationToken,
        output_content_type: type[BaseModel] | None,
        ) -> AsyncGenerator:
    
        model_result: Optional[CreateResult] = None

        if model_client_stream:
                
            async for chunk in model_client.create_stream(
                llm_messages, 
                tools=tools,
                json_output=output_content_type,
                cancellation_token=cancellation_token
            ):
                if isinstance(chunk, CreateResult):
                    model_result = chunk
                elif isinstance(chunk, str):
                    yield ModelClientStreamingChunkEvent(content=chunk, source=agent_name)
                else:
                    raise RuntimeError(f"Invalid chunk type: {type(chunk)}")
            if model_result is None:
                raise RuntimeError("No final model result in streaming mode.")
            yield model_result
        else:
            model_result = await model_client.create(
                llm_messages, tools=tools, cancellation_token=cancellation_token
            )
            yield model_result


### autogen 更改源码区

    async def _call_llm(
        self,
        model_client: ChatCompletionClient,
        model_client_stream: bool,
        system_messages: List[SystemMessage],
        model_context: ChatCompletionContext,
        workbench: Workbench,
        handoff_tools: List[BaseTool[Any, Any]],
        agent_name: str,
        cancellation_token: CancellationToken,
        output_content_type: type[BaseModel] | None,
    ) -> AsyncGenerator[Union[CreateResult, ModelClientStreamingChunkEvent], None]:
        """
        Perform a model inference and yield either streaming chunk events or the final CreateResult.
        """
        all_messages = await model_context.get_messages()
        
        llm_messages: List[LLMMessage] = self._get_compatible_context(model_client=model_client, messages=system_messages + all_messages)

        # 自定义的memory_function，用于RAG检索等功能，为大模型回复增加最新的知识
        if self._memory_function is not None:
            llm_messages = await self._call_memory_function(llm_messages, model_client, cancellation_token, agent_name)

        all_tools = (await workbench.list_tools()) + handoff_tools
        # model_result: Optional[CreateResult] = None
        if self._reply_function is not None:
            # 自定义的reply_function，用于自定义对话回复的定制
            async for chunk in self._call_reply_function(
                llm_messages, 
                model_client = model_client, 
                workbench=workbench,
                handoff_tools=handoff_tools,
                tools = all_tools,
                agent_name=agent_name, 
                cancellation_token=cancellation_token,
                db_manager=self._db_manager,
            ):
                # if isinstance(chunk, CreateResult):
                #     model_result = chunk
                yield chunk
        else:
           async for chunk in self.call_llm(
                agent_name = agent_name,
                model_client = model_client,
                llm_messages = llm_messages, 
                tools = all_tools, 
                model_client_stream = model_client_stream,
                cancellation_token = cancellation_token,
                output_content_type = output_content_type,
           ):
               yield chunk

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
            inner_messages: List[BaseAgentEvent | BaseChatMessage] = []
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
    
    async def run_stream(
        self,
        *,
        task: str | BaseChatMessage | Sequence[BaseChatMessage] | None = None,
        cancellation_token: CancellationToken | None = None,
    ) -> AsyncGenerator[BaseAgentEvent | BaseChatMessage | TaskResult, None]:
        """Run the agent with the given task and return a stream of messages
        and the final task result as the last item in the stream."""
        if cancellation_token is None:
            cancellation_token = CancellationToken()
        input_messages: List[BaseChatMessage] = []
        output_messages: List[BaseAgentEvent | BaseChatMessage] = []
        if task is None:
            pass
        elif isinstance(task, str):
            text_msg = TextMessage(content=task, source="user", metadata={"internal": "yes"})
            input_messages.append(text_msg)
            output_messages.append(text_msg)
            yield text_msg
        elif isinstance(task, BaseChatMessage):
            task.metadata["internal"] = "yes"
            input_messages.append(task)
            output_messages.append(task)
            yield task
        else:
            if not task:
                raise ValueError("Task list cannot be empty.")
            for msg in task:
                if isinstance(msg, BaseChatMessage):
                    msg.metadata["internal"] = "yes"
                    input_messages.append(msg)
                    output_messages.append(msg)
                    yield msg
                else:
                    raise ValueError(f"Invalid message type in sequence: {type(msg)}")
        async for message in self.on_messages_stream(input_messages, cancellation_token):
            if isinstance(message, Response):
                yield message.chat_message
                output_messages.append(message.chat_message)
                yield TaskResult(messages=output_messages)
            else:
                yield message
                if isinstance(message, ModelClientStreamingChunkEvent):
                    # Skip the model client streaming chunk events.
                    continue
                output_messages.append(message)

    @staticmethod
    def _summarize_tool_use(
        executed_calls_and_results: List[Tuple[FunctionCall, FunctionExecutionResult]],
        inner_messages: List[BaseAgentEvent | BaseChatMessage],
        handoffs: Dict[str, HandoffBase],
        tool_call_summary_format: str,
        agent_name: str,
    ) -> Response:
        """
        If reflect_on_tool_use=False, create a summary message of all tool calls.
        """
        # Filter out calls which were actually handoffs
        normal_tool_calls = [(call, result) for call, result in executed_calls_and_results if call.name not in handoffs]
        tool_call_summaries: List[str] = []
        for tool_call, tool_call_result in normal_tool_calls:
            # 对MCP的结果进行处理
            try:
                json_results = json.loads(tool_call_result.content)
                if isinstance(json_results, list):
                    json_result = json_results[0]
                    if isinstance(json_result, dict) and 'type' in json_result:
                        if json_result['type'] == 'text':
                            tool_call_result.content = json_result['text']
            except:
                pass
            # 其他的tool的结果直接用content
            tool_call_summaries.append(
                tool_call_summary_format.format(
                    tool_name=tool_call.name,
                    arguments=tool_call.arguments,
                    result=tool_call_result.content,
                )
            )
        tool_call_summary = "\n".join(tool_call_summaries)
        return Response(
            chat_message=ToolCallSummaryMessage(
                content=tool_call_summary,
                source=agent_name,
            ),
            inner_messages=inner_messages,
        )
    
    async def on_reset(self, cancellation_token: CancellationToken) -> None:
        """Reset the assistant agent to its initialization state."""
        await self._model_context.clear()

    async def save_state(self) -> Mapping[str, Any]:
        """Save the current state of the assistant agent."""
        model_context_state = await self._model_context.save_state()
        return AssistantAgentState(llm_context=model_context_state).model_dump()

    async def load_state(self, state: Mapping[str, Any]) -> None:
        """Load the state of the assistant agent"""
        assistant_agent_state = AssistantAgentState.model_validate(state)
        # Load the model context state.
        await self._model_context.load_state(assistant_agent_state.llm_context)

    @classmethod
    def _from_config(
        cls, config: AssistantAgentConfig, 
        db_manager: DatabaseManager,
        memory_function: Callable = None,
        reply_function: Callable = None,
        **kwargs,
        ) -> Self:
        """Create an assistant agent from a declarative config."""
        if config.structured_message_factory:
            structured_message_factory = StructuredMessageFactory.load_component(config.structured_message_factory)
            format_string = structured_message_factory.format_string
            output_content_type = structured_message_factory.ContentModel

        else:
            format_string = None
            output_content_type = None

        return cls(
            name=config.name,
            model_client=ChatCompletionClient.load_component(config.model_client),
            workbench=Workbench.load_component(config.workbench) if config.workbench else None,
            handoffs=config.handoffs,
            model_context=ChatCompletionContext.load_component(config.model_context) if config.model_context else None,
            tools=[BaseTool.load_component(tool) for tool in config.tools] if config.tools else None,
            memory=[Memory.load_component(memory) for memory in config.memory] if config.memory else None,
            description=config.description,
            system_message=config.system_message,
            model_client_stream=config.model_client_stream,
            reflect_on_tool_use=config.reflect_on_tool_use,
            tool_call_summary_format=config.tool_call_summary_format,
            output_content_type=output_content_type,
            output_content_type_format=format_string,
            metadata=config.metadata,
            memory_function=memory_function,
            reply_function=reply_function,
            db_manager=db_manager,
            **kwargs,
        
        )