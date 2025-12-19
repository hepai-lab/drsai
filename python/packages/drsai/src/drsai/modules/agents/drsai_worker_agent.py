import json
import asyncio
from typing import AsyncGenerator,Optional, List, Dict, Tuple, Sequence, Any, Awaitable, Callable, Union
from loguru import logger
# from datetime import datetime
from pydantic import BaseModel


from drsai.modules.managers import CancellationToken, FunctionCall

from drsai.modules.baseagent import Response, TaskResult, HandoffBase
from drsai.modules.managers.messages import (
    BaseAgentEvent,
    BaseChatMessage,
    TextMessage,
    ThoughtEvent,
    ModelClientStreamingChunkEvent,
    ToolCallExecutionEvent,
    ToolCallRequestEvent,
    ToolCallSummaryMessage,
    UserInputRequestedEvent,
)
from drsai.modules.components.model_context import (
    ChatCompletionContext,
)
from drsai.modules.components.model_client import (
    AssistantMessage,
    ChatCompletionClient,
    HepAIChatCompletionClient,
    CreateResult,
    RequestUsage,
    FunctionExecutionResult,
    FunctionExecutionResultMessage,
    LLMMessage,
    # ModelFamily,
    SystemMessage,
)
from drsai.modules.components.tool import (
    BaseTool, 
    Workbench, 
    )
from drsai.modules.baseagent import DrSaiAgent

from hepai.tools.get_woker_functions import get_worker_sync_functions
from openai import Stream


from drsai.modules.managers.messages.agent_messages import (
    AgentLogEvent,
    Send_level,
    TaskEvent,
    DrSaiMessageFactory
)

class HepAIWorkerAgent(DrSaiAgent):
    '''
    连接HepAI Worker 格式的模型或者智能体后端
    '''
    def __init__(
        self, 
        name: str,
        model_client: HepAIChatCompletionClient|None = None,
        model_client_stream: bool = True,
        tools: List[BaseTool[Any, Any] | Callable[..., Any] | Callable[..., Awaitable[Any]]] | None = None,
        description: str = "An agent that provides assistance with ability to use tools.",
        system_message: (
            str | None
        ) = "You are a helpful AI assistant. Solve tasks using your tools. Reply with TERMINATE when the task has been completed.",
        memory_function: Callable | None = None,
        allow_reply_function: bool = False,
        reply_function: Callable | None = None,
        model_remote_configs: Dict[str, Any] = {},
        chat_id: str|None = None,
        run_info: Dict[str, Any] = {},
        **kwargs):
        
        super().__init__(
            name = name, 
            model_client = model_client,
            model_client_stream = model_client_stream,
            tools = tools,
            description = description,
            system_message = system_message,
            memory_function = memory_function,
            allow_reply_function = allow_reply_function,
            reply_function = reply_function,
            **kwargs)

        self.is_paused = False
        self._paused = asyncio.Event()

        self._chat_id = chat_id
        run_info.update(kwargs)
        self._run_info = run_info 
        
        # initialize the sync model client
        self.api_key = model_remote_configs.pop("api_key", "")
        self.url = model_remote_configs.pop("url", "https://aiapi.ihep.ac.cn/apiv2")
        self.model_name = model_remote_configs.pop("name", "hepai/drsai")

        # worker函数
        self._funcs_map = {}

        self._init_message: str|dict = ""

        # 消息类型
        self._message_factory = DrSaiMessageFactory()
        # self._message_factory._message_types[AgentLogEvent.__name__] = AgentLogEvent
        # self._message_factory._message_types[TaskEvent.__name__] = TaskEvent

        try:
            funcs = get_worker_sync_functions(name=self.model_name, api_key=self.api_key, base_url=self.url )
            self._funcs_map = {f.__name__: f for f in funcs}
        except Exception as e:
            self._funcs_map = {}
            logger.error(f"Failed to load worker functions: {str(e)}")

    async def lazy_init(self, **kwargs) -> Any:
        """Initialize the tools and models needed by the agent."""
        if not self._funcs_map:
            return
        try:
            result: Dict[str, Any] = await asyncio.wait_for(
              asyncio.to_thread(
                  self._funcs_map['lazy_init'],
                  chat_id=self._chat_id,
                  api_key=self.api_key,
                  run_info=self._run_info
              ),
              timeout=60.0
            )
            status = result.get("status", False)
            message = result.get("message", "")
            if not status:
                # raise Exception(message)
                logger.error(message)
            else:
                logger.info(f"Lazy init {self.name} successfully.")
            if message:
                self._init_message = message
                return message
        except asyncio.TimeoutError:
            logger.error(f"Timeout initializing worker functions for {self.model_name}")
        except Exception as e:
            logger.error(f"Failed to load worker functions: {e}")
        

    async def pause(self) -> None:
        """Pause the agent by setting the paused state."""
        logger.info(f"Paused {self.name}...")

        if not self._funcs_map:
            return
        
        # 先设置暂停状态,让流检测到并停止
        self.is_paused = True
        self._paused.set()

        # 给流一点时间来检测暂停状态并停止
        await asyncio.sleep(0.1)

        # 停掉远程的模型
        try:
            result: Dict[str, Any] = await asyncio.wait_for(
                  asyncio.to_thread(
                      self._funcs_map['pause'],
                      chat_id=self._chat_id
                  ),
                  timeout=60.0
                )
            status = result.get("status", False)
            message = result.get("message", "")
            if not status:
                logger.warning(f"Remote pause failed: {message}")
            else:
                logger.info(f"Paused {self.name} successfully.")
        except Exception as e:
            logger.warning(f"Error pausing remote agent (local state is paused): {e}")
    
    async def pause_long_task(self) -> None:
        """Pause the long task by setting the paused state."""
        logger.info(f"Paused long task {self.name}...")

        if not self._funcs_map:
            return
        
        # 停掉远程的long task
        # result: Dict[str, Any] = self._funcs_map['pause_long_task'](chat_id=self._chat_id)
        result: Dict[str, Any] = await asyncio.wait_for(
              asyncio.to_thread(
                  self._funcs_map['pause_long_task'],
                  chat_id=self._chat_id
              ),
              timeout=60.0
            )
        status = result.get("status", False)
        message = result.get("message", "")
        if not status:
            raise Exception(message)
        else:
            logger.info(f"Paused long task {self.name} successfully.")

    async def resume(self) -> None:
        """Resume the agent by clearing the paused state."""

        # 先取消暂停状态
        self.is_paused = False
        self._paused.clear()
        if not self._funcs_map:
            return

        # 恢复远程的模型
        try:
            result: Dict[str, Any] = await asyncio.wait_for(
                    asyncio.to_thread(
                        self._funcs_map['resume'],
                        chat_id=self._chat_id
                    ),
                    timeout=60.0
                )
            status = result.get("status", False)
            message = result.get("message", "")
            if not status:
                logger.warning(f"Remote resume failed: {message}")
            else:
                logger.info(f"Resumed {self.name} successfully.")
                return
        except asyncio.TimeoutError:
            logger.warning(f"Resume timeout for {self.name}.")
        except Exception as e:
            logger.warning(f"Error resuming remote agent: {e}")
        
    async def close(self) -> None:
        """Clean up resources used by the agent.

        This method:
          ...
        """
        logger.info(f"Closing {self.name}...")
        if not self._funcs_map:
            return

        # 关闭模型客户端
        if self._model_client:
            await self._model_client.close()

        # result: Dict[str, Any] = self._funcs_map['close'](chat_id=self._chat_id)
        result: Dict[str, Any] = await asyncio.wait_for(
              asyncio.to_thread(
                  self._funcs_map['close'],
                  chat_id=self._chat_id
              ),
              timeout=60.0
            )
        status = result.get("status", False)
        message = result.get("message", "")
        if not status:
            raise Exception(message)
        else:
            logger.info(f"Closed {self.name} successfully.")

    async def async_stream_generator(self, stream, timeout: float = 120.0) -> AsyncGenerator[dict, None]:
        loop = asyncio.get_event_loop()
        queue = asyncio.Queue()

        def sync_consumer():
            try:
                for chunk in stream:
                    # 检查暂停状态
                    if self.is_paused:
                        logger.info(f"Stream detected pause signal, stopping consumer")
                        break
                    loop.call_soon_threadsafe(queue.put_nowait, chunk)
            except Exception as e:
                # 如果是连接关闭错误且已暂停,不记录为错误
                if self.is_paused and "peer closed connection" in str(e).lower():
                    logger.info(f"Connection closed due to pause, this is expected")
                else:
                    logger.error(f"Error in sync consumer: {e}")
                loop.call_soon_threadsafe(queue.put_nowait, e)
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, None)  # 结束信号

        executor_task = loop.run_in_executor(None, sync_consumer)

        try:
            while True:
                # 检查是否被暂停
                if self.is_paused:
                    logger.info(f"Stream generator detected pause, stopping")
                    break

                try:
                    item = await asyncio.wait_for(queue.get(), timeout=timeout)
                except asyncio.TimeoutError:
                    logger.warning(f"Stream timeout after {timeout} seconds")
                    raise asyncio.TimeoutError("Model streaming timed out")

                if item is None:  # 正常结束
                    break
                elif isinstance(item, type) and issubclass(item, Exception):
                    raise item()
                elif isinstance(item, Exception):
                    # 如果是连接错误且已暂停,不抛出异常
                    if self.is_paused and "peer closed connection" in str(item).lower():
                        logger.info(f"Connection closed due to pause, stopping gracefully")
                        break
                    raise item
                else:
                    yield item
        except asyncio.CancelledError:
            logger.info(f"Stream generator was cancelled")
            raise
        finally:
            if not executor_task.done():
                executor_task.cancel()
            try:
                await executor_task
            except asyncio.CancelledError:
                pass

    async def on_messages_stream(
        self, messages: Sequence[BaseChatMessage], cancellation_token: CancellationToken
    ) -> AsyncGenerator[BaseAgentEvent | BaseChatMessage | Response, None]:
        """Handle incoming messages and yield responses as a stream. Append the request to agents chat history."""

        if not self._funcs_map:
            yield Response(
                chat_message=TextMessage(
                    content=f"Cannot connect to the model: {self.model_name} through {self.url}. Please check the connection and try again later.",
                    source=self.name,
                    metadata={"internal": "no"},
                )
            )
            return
        
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
        # async def monitor_pause() -> None:
        #     await self._paused.wait()
        #     self.is_paused = True
        # monitor_pause_task = asyncio.create_task(monitor_pause())

        # if self._init_message:
        #     init_message = ""
        #     init_message_mate = {}
        #     if isinstance(self._init_message, str):
        #         init_message = self._init_message
        #     elif isinstance(self._init_message, dict):
        #         init_message = self._init_message.pop("content", "")
        #         init_message_mate = self._init_message
        #     else: 
        #         init_message = str(self._init_message)
        #     init_message_mate.update({"internal": "no"})
        #     yield TextMessage(
        #             content=init_message,
        #             source=self.name,
        #             metadata=init_message_mate,
        #         )

        try:
        ##########Your costum code here##########
        # NOTE: Can only yield TextMessage or MultiModalMessage in MagenticAgent becasue the limit in src/magentic_ui/utils.py", line 160, in thread_to_context:
        # ```assert isinstance(m, TextMessage) or isinstance(m, MultiModalMessage)```

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
            ## 将前端传入的json格式的user message转换为str
            # try:
            #     input = messages[-1].content
            #     data = json.loads(input)
            #     if not isinstance(data, dict):
            #         raise ValueError("Input string must be a JSON object")
            #     input_str = data.get("content", "")
            # except Exception as e:
            #     # logger.log(f"Error parsing input string: {e}")
            #     input_str = messages[-1].content
            
            # messages[-1].content = input_str
            
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
            
            # NOTE: 请注意，这是一个同步的迭代器，会堵塞当前线程，直到模型返回结果

            stream: Stream = self._funcs_map['a_chat_completions'](
                messages = [message.model_dump(mode="json") for message in messages],
                apikey = self.api_key,
                stream=True,
                model = agent_name,
                chat_id = self._chat_id,
                user = self._run_info,
            )
            full_response = []
            try:
                async for chunk in self.async_stream_generator(stream):
                    if self.is_paused:
                        logger.info(f"{self.name} paused during streaming")
                        raise asyncio.CancelledError("Agent paused during streaming")
                    message_type = chunk.get("type", None)
                    if message_type in self._message_factory._message_types:
                        msg: BaseChatMessage|BaseAgentEvent = self._message_factory._message_types[message_type].model_validate(chunk)

                        if message_type in [
                            "TextMessage",
                            "ToolCallSummaryMessage",
                            "StructuredMessage",
                            "HandoffMessage",
                            "MultiModalMessage",
                            "StopMessage"]:
                            full_response.append({msg.source: msg.content})
                        yield msg
                    if "stop_reason" in chunk:
                        # taskresult = TaskResult.model_validate(chunk)
                        break

            except asyncio.CancelledError:
                # 如果是由于暂停导致的取消,返回一个友好的消息
                if self.is_paused:
                    logger.info(f"{self.name} was paused, handling gracefully")
                raise
            except Exception as e:
                # 检查是否是由于暂停导致的连接关闭
                if self.is_paused and "peer closed connection" in str(e).lower():
                    logger.info(f"Connection closed due to pause for {self.name}, handling as cancellation")
                    raise asyncio.CancelledError("Agent paused")
                else:
                    logger.error(f"Error during streaming: {e}")
                    raise

            full_response_str = ""
            if len(full_response)>1:
                for response in full_response:
                    for key, value in response.items():
                        full_response_str += f"**{key}:**\n\n{value}\n\n"
            else:
                for response in full_response:
                    for key, value in response.items():
                        full_response_str += f"{value}"

            model_result = CreateResult(
                content=full_response_str, 
                finish_reason="stop",
                usage = RequestUsage(prompt_tokens = 0, completion_tokens = len(full_response_str.split())),
                cached = False
                )
            

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

        ##########Your costum code above##########

        except asyncio.CancelledError:
            # If the task is cancelled, we respond with a message.
            # 如果是由于暂停导致的取消,使用更友好的消息
            if self.is_paused:
                yield Response(
                    chat_message=TextMessage(
                        content=f"The {self.name} was paused.",
                        source=self.name,
                        metadata={"internal": "yes"},
                    ),
                    inner_messages=inner_messages,
                )
            else:
                yield Response(
                    chat_message=TextMessage(
                        content="The task was cancelled by the user.",
                        source=self.name,
                        metadata={"internal": "yes"},
                    ),
                    inner_messages=inner_messages,
                )
        except asyncio.TimeoutError:
            # If the task times out, we respond with a message.
            yield Response(
                chat_message=TextMessage(
                    content="The task timed out.",
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
                    content="An error occurred while executing the task.",
                    source=self.name,
                    metadata={"internal": "no"},
                ),
                inner_messages=inner_messages,
            )
        finally:

            # # Cancel the monitor task.
            # try:
            #     monitor_pause_task.cancel()
            #     await monitor_pause_task
            # except asyncio.CancelledError:
            #     pass
            pass
    
    @classmethod
    async def _process_model_result(
        cls,
        model_result: CreateResult,
        inner_messages: List[BaseAgentEvent | BaseChatMessage],
        cancellation_token: CancellationToken,
        agent_name: str,
        system_messages: List[SystemMessage],
        model_context: ChatCompletionContext,
        workbench: Workbench,
        handoff_tools: List[BaseTool[Any, Any]],
        handoffs: Dict[str, HandoffBase],
        model_client: ChatCompletionClient,
        model_client_stream: bool,
        reflect_on_tool_use: bool,
        tool_call_summary_format: str,
        output_content_type: type[BaseModel] | None,
        format_string: str | None = None,
    ) -> AsyncGenerator[BaseAgentEvent | BaseChatMessage | Response, None]:
        """
        Handle final or partial responses from model_result, including tool calls, handoffs,
        and reflection if needed.

        NOTE: Can only yield TextMessage or MultiModalMessage in MagenticAgent becasue the limit in src/magentic_ui/utils.py", line 160, in thread_to_context:
        ```assert isinstance(m, TextMessage) or isinstance(m, MultiModalMessage)```

        """

        # If direct text response (string)
        if isinstance(model_result.content, str):
            # if output_content_type:
            #     content = output_content_type.model_validate_json(model_result.content)
            #     yield Response(
            #         chat_message=StructuredMessage[output_content_type](  # type: ignore[valid-type]
            #             content=content,
            #             source=agent_name,
            #             models_usage=model_result.usage,
            #             format_string=format_string,
            #         ),
            #         inner_messages=inner_messages,
            #     )
            # else:
            #     yield Response(
            #         chat_message=TextMessage(
            #             content=model_result.content,
            #             source=agent_name,
            #             models_usage=model_result.usage,
            #         ),
            #         inner_messages=inner_messages,
            #     )
            yield Response(
                chat_message=TextMessage(
                    content=model_result.content,
                    source=agent_name,
                    models_usage=model_result.usage,
                    metadata={"internal": "yes"}, # detect if it is internal message or not
                ),
                inner_messages=inner_messages,
            )
            return

        # Otherwise, we have function calls
        assert isinstance(model_result.content, list) and all(
            isinstance(item, FunctionCall) for item in model_result.content
        )

        # cannot yield ToolCallRequestEvent in MagenticAgent
        # STEP 4A: Yield ToolCallRequestEvent
        tool_call_msg = ToolCallRequestEvent(
            content=model_result.content,
            source=agent_name,
            models_usage=model_result.usage,
        )

        # event_logger.debug(tool_call_msg)
        logger.info(f"{cls.name} handling tool call with params : {model_result.content}")
        inner_messages.append(tool_call_msg)
        yield tool_call_msg

        # STEP 4B: Execute tool calls
        executed_calls_and_results = await asyncio.gather(
            *[
                cls._execute_tool_call(
                    tool_call=call,
                    workbench=workbench,
                    handoff_tools=handoff_tools,
                    agent_name=agent_name,
                    cancellation_token=cancellation_token,
                )
                for call in model_result.content
            ]
        )

        # cannot yield ToolCallExecutionEvent in MagenticAgent
        exec_results = [result for _, result in executed_calls_and_results]

        # Yield ToolCallExecutionEvent
        tool_call_result_msg = ToolCallExecutionEvent(
            content=exec_results,
            source=agent_name,
        )
        # event_logger.debug(tool_call_result_msg)
        await model_context.add_message(FunctionExecutionResultMessage(content=exec_results))
        inner_messages.append(tool_call_result_msg)
        yield tool_call_result_msg

        # cannot yield HandoffMessage
        # # STEP 4C: Check for handoff
        # handoff_output = cls._check_and_handle_handoff(
        #     model_result=model_result,
        #     executed_calls_and_results=executed_calls_and_results,
        #     inner_messages=inner_messages,
        #     handoffs=handoffs,
        #     agent_name=agent_name,
        # )
        # if handoff_output:
        #     yield handoff_output
        #     return

        # STEP 4D: Reflect or summarize tool results
        if reflect_on_tool_use:
            async for reflection_response in cls._reflect_on_tool_use_flow(
                system_messages=system_messages,
                model_client=model_client,
                model_client_stream=model_client_stream,
                model_context=model_context,
                agent_name=agent_name,
                inner_messages=inner_messages,
                output_content_type=output_content_type,
            ):
                yield reflection_response
        else:
            yield cls._summarize_tool_use(
                executed_calls_and_results=executed_calls_and_results,
                inner_messages=inner_messages,
                handoffs=handoffs,
                tool_call_summary_format=tool_call_summary_format,
                agent_name=agent_name,
            )

    @classmethod
    async def _reflect_on_tool_use_flow(
        cls,
        system_messages: List[SystemMessage],
        model_client: ChatCompletionClient,
        model_client_stream: bool,
        model_context: ChatCompletionContext,
        agent_name: str,
        inner_messages: List[BaseAgentEvent | BaseChatMessage],
        output_content_type: type[BaseModel] | None,
    ) -> AsyncGenerator[Response | ModelClientStreamingChunkEvent | ThoughtEvent, None]:
        """
        If reflect_on_tool_use=True, we do another inference based on tool results
        and yield the final text response (or streaming chunks).
        """
        all_messages = system_messages + await model_context.get_messages()
        llm_messages = cls._get_compatible_context(model_client=model_client, messages=all_messages)

        reflection_result: Optional[CreateResult] = None

        if model_client_stream:
            async for chunk in model_client.create_stream(
                llm_messages,
                json_output=output_content_type,
            ):
                if isinstance(chunk, CreateResult):
                    reflection_result = chunk
                elif isinstance(chunk, str):
                    yield ModelClientStreamingChunkEvent(content=chunk, source=agent_name)
                else:
                    raise RuntimeError(f"Invalid chunk type: {type(chunk)}")
        else:
            reflection_result = await model_client.create(llm_messages, json_output=output_content_type)

        if not reflection_result or not isinstance(reflection_result.content, str):
            raise RuntimeError("Reflect on tool use produced no valid text response.")

        # --- NEW: If the reflection produced a thought, yield it ---
        if reflection_result.thought:
            thought_event = ThoughtEvent(content=reflection_result.thought, source=agent_name)
            yield thought_event
            inner_messages.append(thought_event)

        # Add to context (including thought if present)
        await model_context.add_message(
            AssistantMessage(
                content=reflection_result.content,
                source=agent_name,
                thought=getattr(reflection_result, "thought", None),
            )
        )

        # if output_content_type:
        #     content = output_content_type.model_validate_json(reflection_result.content)
        #     yield Response(
        #         chat_message=StructuredMessage[output_content_type](  # type: ignore[valid-type]
        #             content=content,
        #             source=agent_name,
        #             models_usage=reflection_result.usage,
        #         ),
        #         inner_messages=inner_messages,
        #     )
        # else:
        #     yield Response(
        #         chat_message=TextMessage(
        #             content=reflection_result.content,
        #             source=agent_name,
        #             models_usage=reflection_result.usage,
        #         ),
        #         inner_messages=inner_messages,
        #     )

        yield Response(
            chat_message=TextMessage(
                content=reflection_result.content,
                source=agent_name,
                models_usage=reflection_result.usage,
                metadata={"internal": "no"}, # detect if it is internal message or not
            ),
            inner_messages=inner_messages,
        )

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
            tool_call_summaries.append(
                tool_call_summary_format.format(
                    tool_name=tool_call.name,
                    arguments=tool_call.arguments,
                    result=tool_call_result.content,
                )
            )
        tool_call_summary = "\n".join(tool_call_summaries)
        # return Response(
        #     chat_message=ToolCallSummaryMessage(
        #         content=tool_call_summary,
        #         source=agent_name,
        #     ),
        #     inner_messages=inner_messages,
        # )

        return Response(
            chat_message=TextMessage(
                content=tool_call_summary,
                source=agent_name,
                metadata={"internal": "no"}, # detect if it is internal message or not
            ),
            inner_messages=inner_messages,
        )
    
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
            input_messages.append(task)
            output_messages.append(task)
            task.metadata["internal"] = "yes"
            yield task
        else:
            if not task:
                raise ValueError("Task list cannot be empty.")
            for msg in task:
                if isinstance(msg, BaseChatMessage):
                    input_messages.append(msg)
                    output_messages.append(msg)
                    msg.metadata["internal"] = "yes"
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

