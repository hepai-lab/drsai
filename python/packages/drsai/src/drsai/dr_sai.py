
from typing import (
    List,
    Dict,
    Tuple,
    Union,
    AsyncGenerator,
    Any,
    Optional)
import os
import copy
import json
import asyncio
import time
import traceback
import inspect

from autogen_core import FunctionCall
from autogen_core.model_context import (
    ChatCompletionContext,
)
from autogen_agentchat.messages import (
    StructuredMessageFactory,
    BaseChatMessage,
    TextMessage,
    HandoffMessage,
    StopMessage,
    ToolCallSummaryMessage,
    StructuredMessage,
    BaseAgentEvent,
    ToolCallExecutionEvent,
    ToolCallRequestEvent,
    CodeGenerationEvent,
    CodeExecutionEvent,
    UserInputRequestedEvent,
    MemoryQueryEvent,
    ModelClientStreamingChunkEvent,
    ThoughtEvent,
    SelectSpeakerEvent,
    SelectorEvent,
    MessageFactory,
    MultiModalMessage,
    Image,
    # UserInputRequestedEvent,
)
# from autogen_agentchat.teams import BaseGroupChat
from autogen_agentchat.base import ChatAgent, TaskResult, Team
from autogen_agentchat.ui import Console


# logger = logger.bind(name="dr_sai.py")

# 单个模型日志
import logging
third_party_logger1 = logging.getLogger("autogen_core")
third_party_logger1.propagate = False
third_party_logger2 = logging.getLogger("autogen_agentchat.events")
third_party_logger2.propagate = False
third_party_logger3 = logging.getLogger("httpx")
third_party_logger3.propagate = False

from loguru import logger
# from drsai.utils.async_process import sync_wrapper
# from drsai.modules.managers.threads_manager import ThreadsManager
# from drsai.modules.managers.base_thread_message import Content, Text
# from drsai.modules.managers.base_thread import Thread

from drsai.modules.managers.database import DatabaseManager
from drsai.modules.managers.datamodel import (
    UserInput,
    Thread,
)

from drsai.modules.managers.datamodel.db import RunStatus
from drsai.modules.managers.datamodel.types import Response, TeamResult
from drsai.configs import CONST
from drsai.utils.utils import decompress_state
from drsai.utils.oai_stream_event import (
    chatcompletionchunk, 
    chatcompletionchunkend,
    chatcompletions)

import uuid
from dotenv import load_dotenv
load_dotenv(dotenv_path = "drsai_test.env")

class DrSai:
    """
    This is the main class of OpenDrSai, in
    """
    def __init__(self, **kwargs):

        # 数据库管理
        # self.threads_mgr = ThreadsManager()
        self.db_manager: Optional[DatabaseManager] = kwargs.pop('db_manager', None)
        if not self.db_manager:
            engine_uri = kwargs.pop('engine_uri', None) or f"sqlite:///{CONST.FS_DIR}/drsai.db"
            base_dir = kwargs.pop('base_dir', None) or CONST.FS_DIR
            self.db_manager = DatabaseManager(
                engine_uri = engine_uri,
                base_dir = base_dir
            )
            auto_upgrade = kwargs.pop('auto_upgrade', False)
            init_response = self.db_manager.initialize_database(auto_upgrade=auto_upgrade)
            assert init_response.status, init_response.message

        # 智能体管理
        self.agent_factory: callable = kwargs.pop('agent_factory', None)
        self.agent_instance: Dict[str, ChatAgent | Team] = {}

        # 额外设置
        # self.history_mode = kwargs.pop('history_mode', 'backend') # backend or frontend
        self.use_api_key_mode = kwargs.pop('use_api_key_mode', "frontend") # frontend or backend

        # 后端测试接口
        load_test_api_key = os.environ.get("LOAD_TEST_API_KEY", None)
        if not load_test_api_key:
            ## 创建一个随机的api_key，并存入本地的.env文件中
            load_test_api_key = "DrSai_" + str(uuid.uuid4())
            with open("drsai_test.env", "w") as f:
                f.write(f"LOAD_TEST_API_KEY={load_test_api_key}\n")
        self.drsai_test_api_key = load_test_api_key
        print(f"\nDrSai_test_api_key: {self.drsai_test_api_key}\n")

    # 作为析构函数（Destructor），当对象实例被垃圾回收机制销毁时自动调用，推荐使用显式调用
    # def __del__(self):
    #     """Destructor to ensure database connections are properly closed when DrSai instance is destroyed"""
    #     try:
    #         if hasattr(self, 'db_manager') and self.db_manager is not None:
    #             # Since db_manager.close() is async, we need to handle it properly
    #             import asyncio
    #             try:
    #                 # Try to get the current event loop
    #                 loop = asyncio.get_event_loop()
    #                 if loop.is_running():
    #                     # If loop is running, create a task
    #                     loop.create_task(self.db_manager.close())
    #                 else:
    #                     # If no loop or loop is not running, run in new loop
    #                     loop.run_until_complete(self.db_manager.close())
    #             except RuntimeError:
    #                 # If no event loop, create one
    #                 asyncio.run(self.db_manager.close())
    #     except Exception as e:
    #         # Use print instead of logger to avoid potential issues during destruction
    #         print(f"Warning: Error closing database connections in DrSai destructor: {e}")

    async def close(self):
        """Explicitly close database connections and cleanup resources"""
        try:
            if hasattr(self, 'db_manager') and self.db_manager is not None:
                await self.db_manager.close()
                self.db_manager = None
            
            # Clear agent instances
            if hasattr(self, 'agent_instance'):
                self.agent_instance.clear()
                
        except Exception as e:
            print(f"Error closing DrSai resources: {e}")
            raise

    async def _create_agent_instance(
        self,
        api_key: str = None,
        thread_id: str = None,
        user_id: str = None,
        ) -> ChatAgent | Team:

        sig = inspect.signature(self.agent_factory)
        params = sig.parameters
        if len(params) > 0:
            kwargs = {}
            if 'api_key' in params:
                kwargs['api_key'] = api_key
            if 'thread_id' in params:
                kwargs['thread_id'] = thread_id
            if 'user_id' in params:
                kwargs['user_id'] = user_id
            if 'db_manager' in params:
                kwargs['db_manager'] = self.db_manager
            agent: ChatAgent | Team = (
                await self.agent_factory(**kwargs)
                if asyncio.iscoroutinefunction(self.agent_factory)
                else (self.agent_factory(**kwargs))
            )
        else:
            agent: ChatAgent | Team = (
                await self.agent_factory()
                if asyncio.iscoroutinefunction(self.agent_factory)
                else (self.agent_factory())
            )
        
        # # 判断是否为智能体添加前端的API_KEY
        # if self.use_api_key_mode == "frontend":
        #     if hasattr(agent, "_model_client"):
        #         agent._model_client._client.api_key = api_key
        #     if hasattr(agent, "_participants"):
        #         for participant in agent._participants:
        #             if hasattr(participant, "_model_client"):
        #                 participant._model_client._client.api_key = api_key

        if hasattr(agent, "_thread_id") and agent._thread_id is None:
            agent._thread_id = thread_id
            if hasattr(agent, "_participants"):
                for participant in agent._participants:
                    if hasattr(participant, "_thread_id"):
                        participant._thread_id = thread_id
        if hasattr(agent, "_user_id") and agent._user_id is None:
            agent._user_id = user_id
            if hasattr(agent, "_participants"):
                for participant in agent._participants:
                    if hasattr(participant, "user_id"):
                        participant.user_id = user_id
        ## 为智能体添加数据库管理器
        if hasattr(agent, "_db_manager") and agent._db_manager is None:
            agent._db_manager = self.db_manager
            if hasattr(agent, "_participants"):
                for participant in agent._participants:
                    participant._db_manager = self.db_manager
            else:
                agent._db_manager = self.db_manager

        return agent
    
    async def handle_input_info(self, **kwargs) -> UserInput:
        ## 传入的消息列表
        messages: List[Dict[str, str]] = kwargs.pop('messages', [])
        ## 大模型配置
        api_key = kwargs.pop('apikey', None) or kwargs.pop('api_key', None)
        temperature = kwargs.pop('temperature', 0.6)
        top_p = kwargs.pop('top_p', 1)
        cache_seed = kwargs.pop('cache_seed', None)
        n = kwargs.pop('n', 1)
        max_tokens = kwargs.pop('max_tokens', 100000)
        stream = kwargs.pop('stream', True)
        ## 额外的请求参数处理
        extra_body: Union[Dict, None] = kwargs.pop('extra_body', None)
        if extra_body is not None:
            ## 用户信息 从DDF2传入的
            user_info: Dict = extra_body.get("user", {})
            username = user_info.get('email', None) or user_info.get('name', "anonymous")
            # chat_id = extra_body.get("chat_id", None) # 获取前端聊天界面的chat_id
            api_key = user_info.pop('api_key', None) 
        else:
            #  {'model': 'drsai_pipeline', 'user': {'name': '888', 'id': '888', 'email': 888', 'role': 'admin'}, 'metadata': {}, 'base_models': 'openai/gpt-4o', 'apikey': 'sk-88'}
            user_info = kwargs.get('user', {})
            username = user_info.get('email', None) or user_info.get('name', "anonymous")
        chat_id = kwargs.pop('chat_id', None) # 获取前端聊天端口的chat_id
            # history_mode = kwargs.pop('history_mode', None) or self.history_mode # backend or frontend
        ## 保存用户的extra_requests
        extra_requests: Dict = copy.deepcopy(kwargs)
        ## 保存用户的参数
        response = self.db_manager.get(
            UserInput,
            filters={"user_id": username,"thread_id": chat_id},
            return_json=False
            )
        if not response.status or not response.data:
            user_input = UserInput(
                user_id = username,
                thread_id = chat_id,
                user_messages = messages,
                user_last_message = messages[-1],
                api_key = api_key,
                temperature = temperature,
                max_tokens = max_tokens,
                top_p = top_p,
                cache_seed = cache_seed,
                n = n,
                stream = stream,
                extra_requests = extra_requests, 
            )
        else:
            user_input: UserInput = response.data[0]
            user_input.user_messages = messages
            user_input.user_last_message = messages[-1]
            user_input.api_key = api_key
            user_input.temperature = temperature
            user_input.max_tokens = max_tokens
            user_input.top_p = top_p
            user_input.cache_seed = cache_seed
            user_input.n = n
            user_input.stream = stream
            user_input.extra_requests = extra_requests

        response: Response = self.db_manager.upsert(user_input)
        if not response.status or not response.data:
            raise RuntimeError(f"Failed to save user input: {response.message}")
        else:
            return user_input

    async def get_agent_and_thread(
            self,
            user_id: str,
            thread_id: str,
            stream: bool,
            api_key: str,
            ) -> Tuple[ChatAgent | Team, Thread|None]:

        # 加载/检查Thread

        thread : Thread | None = None
        response: Response = self.db_manager.get(
            Thread, 
            filters={"user_id": user_id,"thread_id": thread_id},
            return_json=False
            )
        if response.status and response.data:
            thread: Thread = response.data[0]
        
        # 创建或者获取智能体实例
        
        if thread_id in self.agent_instance:
            agent = self.agent_instance[thread_id]
        else:
            agent = await self._create_agent_instance(api_key=api_key, thread_id=thread_id, user_id=user_id,)
            self.agent_instance[thread_id] = agent

        ## 加载历史状态
        if thread is not None:
            state = thread.state
            if state:
                if isinstance(state, str):
                    try:
                        # Try to decompress if it's compressed
                        state_dict = decompress_state(state)
                        await agent.load_state(state_dict)
                    except Exception:
                        # If decompression fails, assume it's a regular JSON string
                        state_dict = json.loads(state)
                        await agent.load_state(state_dict)
                else:
                    await agent.load_state(state)

        ## 是否使用流式模式
        if isinstance(agent, Team) and stream:
            for participant in agent._participants:
                if not participant._model_client_stream:
                    raise ValueError("Streaming mode is not supported when participant._model_client_stream is False")
        else:
            if agent._model_client_stream != stream:
                raise ValueError("Streaming mode is not supported when agent._model_client_stream is False")
            
        return agent, thread

    #### --- 关于DrSai的UI接口 --- ####
    async def a_drsai_ui_completions(self, **kwargs) -> AsyncGenerator:
        """
        为drsai ui提供completions接口，yield autogen的BaseChatMessage和BaseAgentEvent
        """
        try:
            start_time = time.time()
            # 处理用户的kwargs参数，保存UserInput到数据库
            user_input: UserInput = await self.handle_input_info(**kwargs)
            user_id = user_input.user_id
            thread_id = user_input.thread_id
            stream = user_input.stream
            api_key = user_input.api_key
            messages = user_input.user_messages

            # 加载智能体实例和状态，检查thread状态
            agent, thread = await self.get_agent_and_thread(user_id, thread_id, stream, api_key)
                
            # TODO:历史消息处理

            ## 将前端传入的BaseChatMessage.model_dump(mode="json")消息整理为BaseChatMessage格式
            task: list[BaseChatMessage] = []
            for message in messages:
                if message["type"] == "TextMessage":
                    task.append(TextMessage.model_validate(message))
                elif message["type"] == "MultiModalMessage":
                    task.append(MultiModalMessage.model_validate(message))
                elif message["type"] == "HandoffMessage":
                    task.append(HandoffMessage.model_validate(message))
                elif message["type"] == "StopMessage":
                    task.append(StopMessage.model_validate(message))
                elif message["type"] == "ToolCallSummaryMessage":
                    task.append(ToolCallSummaryMessage.model_validate(message))
                else:
                    raise ValueError(f"Unsupported message type: {message['type']}")

            # 创建或者更新thread

            if thread is None:
                thread = Thread(
                    user_id = user_id,
                    thread_id = thread_id,
                    user_input = user_input.model_dump(mode="json"),
                    status = RunStatus.CREATED,
                    messages = [message.model_dump(mode="json") for message in task],
                )
            else:
                thread.user_input = user_input.model_dump(mode="json")
                thread.status = RunStatus.ACTIVE
                thread.messages.append(task[-1].model_dump(mode="json")) # 已经存在的Thread只添加最后一条消息
            response: Response = self.db_manager.upsert(thread)
            if not response.status:
                raise RuntimeError(f"Failed to create thread: {response.message}")

            # 开始聊天

            rely_messages: List[BaseChatMessage] = []
            agent_result: TaskResult|None = None
            
            res = agent.run_stream(task=task)
            role = ""
            async for message in res:
                if hasattr(message, "metadata"):
                    if message.metadata.get("internal", "no") == "no":
                        if isinstance(message, ModelClientStreamingChunkEvent):
                            role_tmp = message.source
                            if role != role_tmp:
                                role = role_tmp
                                message.metadata["start_flag"] = "yes"
                        message_str = json.dumps(message.model_dump(mode="json"))
                        yield f"data: {message_str}\n\n"

                        if isinstance(message, TextMessage):
                            rely_messages.append(message)
                        elif isinstance(message, ToolCallSummaryMessage):
                            rely_messages.append(message)
                        elif isinstance(message, HandoffMessage):
                            rely_messages.append(message)
                        elif isinstance(message, StructuredMessage):
                            rely_messages.append(message)
                        elif isinstance(message, StopMessage):
                            rely_messages.append(message)
                        else:
                            pass
                if isinstance(message, TaskResult):
                    agent_result = message
                    message_str = json.dumps(message.model_dump(mode="json"))
                    yield f"data: {message_str}\n\n"
                    break

        except asyncio.CancelledError:
            logger.info(f"Top-level cancellation for thread {thread_id}")
            pass
        except Exception as e:
            logger.error(f"Error in a_drsai_ui_completions: {e}")
            traceback.print_exc()
        finally:
            # 更新thread状态
            response: Response = self.db_manager.get(
                Thread, 
                filters={"user_id": user_id,"thread_id": thread_id},
                return_json=False
                )
            if not response.status or not response.data:
                raise RuntimeError(f"Failed to get thread: {response.message}")
            else:
                if agent_result:
                    thread: Thread = response.data[0]
                    thread.status = RunStatus.COMPLETE
                    thread.messages.extend([rely_message.model_dump(mode="json") for rely_message in rely_messages]) # 已经存在的Thread只添加最后一条消息
                    if thread.team_result is None:
                            thread.team_result = TeamResult(
                                task_result = agent_result,
                                usage="",
                                duration= time.time() - start_time,
                            )
                    else:
                        thread.team_result["task_result"] = agent_result.model_dump(mode="json")
            response: Response = self.db_manager.upsert(thread)
            if not response.status:
                raise RuntimeError(f"Failed to create thread: {response.message}")

    #### --- 关于OpenAI Chat/Completions --- ####
    async def a_start_chat_completions(self, **kwargs) -> AsyncGenerator:
        """
        启动聊天任务，使用completions后端模式
        加载默认的Agents, 并启动聊天任务, 这里默认使用GroupChat
        params:
        stream: bool, 是否使用流式模式
        messages: List[Dict[str, str]], 传入的消息列表
        api_key: str, 访问hepai的api_key
        usr_info: Dict, 用户信息
        base_models: Union[str, List[str]], 智能体基座模型
        chat_mode: str, 聊天模式，默认once
        **kwargs: 其他参数
        """
        try:
            start_time = time.time()

            # 处理用户的kwargs参数，保存UserInput到数据库
            user_input: UserInput = await self.handle_input_info(**kwargs)
            user_id = user_input.user_id
            thread_id = user_input.thread_id
            stream = user_input.stream
            api_key = user_input.api_key
            messages = user_input.user_messages

            # 加载智能体实例和状态，检查thread状态
            agent, thread = await self.get_agent_and_thread(user_id, thread_id, stream, api_key)
                
            # 历史消息处理
            
            ## 将前端消息整理为autogen BaseChatMessage格式
            task: list[BaseChatMessage] = []
            for message in messages[:-1]:
                if isinstance(message["content"], list):
                    content = []
                    for sub_message in message["content"]:
                        if sub_message["type"] == "text":
                            content.append(sub_message["text"])
                        elif sub_message["type"] == "image_url":
                            content.append(Image.from_uri(sub_message["image_url"]["url"]))
                    task.append(MultiModalMessage(content=content, source=message["role"], metadata={"internal": "no"}))
                else:
                    task.append(TextMessage(content=message["content"], source=message["role"], metadata={"internal": "no"}))  
            ## 最后一条处理Handoff
            last_message = messages[-1]
            is_not_handoff = True
            if thread is not None:
                if isinstance(agent, Team) and thread.messages:
                    if (HandoffMessage in agent._participants[0].produced_message_types) and thread.messages[-1]["type"] == "HandoffMessage":
                        task.append(HandoffMessage(
                            source=thread.messages[-1]["target"], 
                            target=thread.messages[-1]["source"], 
                            content=last_message["content"], 
                            metadata={"internal": "no"}))
                        is_not_handoff = False
            if is_not_handoff:
                if isinstance(last_message["content"], list):
                    content = []
                    for sub_message in last_message["content"]:
                        if sub_message["type"] == "text":
                            content.append(sub_message["text"])
                        elif sub_message["type"] == "image_url":
                            content.append(Image.from_uri(sub_message["image_url"]["url"]))
                    task.append(MultiModalMessage(content=content, source=message["role"], metadata={"internal": "no"}))
                else:
                    task.append(TextMessage(content=last_message["content"], source=last_message["role"], metadata={"internal": "no"}))  
            

            # 创建或者更新thread

            if thread is None:
                thread = Thread(
                    user_id = user_id,
                    thread_id = thread_id,
                    user_input = user_input.model_dump(mode="json"),
                    status = RunStatus.CREATED,
                    messages = [message.model_dump(mode="json") for message in task],
                )
                # if hasattr(agent, "_db_manager"):
                #     agent._db_manager = self.db_manager
                #     if isinstance(agent, BaseGroupChat):
                #         for participant in agent._participants:
                #             participant._db_manager = self.db_manager
                #     else:
                #         agent._db_manager = self.db_manager
            else:
                thread.user_input = user_input.model_dump(mode="json")
                thread.status = RunStatus.ACTIVE
                thread.messages.append(task[-1].model_dump(mode="json")) # 已经存在的Thread只添加最后一条消息
            response: Response = self.db_manager.upsert(thread)
            if not response.status:
                raise RuntimeError(f"Failed to create thread: {response.message}")
                
            # 开始聊天

            tool_flag = 0
            ThoughtContent = None
            role = ""
            rely_messages: List[BaseChatMessage] = []
            agent_result: TaskResult|None = None

            res = agent.run_stream(task=task)
            async for message in res:
                
                # print(message)
                oai_chunk = copy.deepcopy(chatcompletionchunk)
                # The Unix timestamp (in seconds) of when the chat completion was created
                oai_chunk["created"] = int(time.time())
                if isinstance(message, ModelClientStreamingChunkEvent):
                    if stream and isinstance(agent, ChatAgent):
                        content = message.content
                        oai_chunk["choices"][0]["delta"]['content'] = content
                        oai_chunk["choices"][0]["delta"]['role'] = 'assistant'
                        yield f'data: {json.dumps(oai_chunk)}\n\n'
                    elif stream and isinstance(agent, Team):
                        role_tmp = message.source
                        if role != role_tmp:
                            role = role_tmp
                            # oai_chunk["choices"][0]["delta"]['content'] = f"\n\n**Speaker: {role}**\n\n"
                            if role:
                                oai_chunk["choices"][0]["delta"]['content'] = f"\n\n**{role}发言：**\n\n"
                                oai_chunk["choices"][0]["delta"]['role'] = 'assistant'
                                yield f'data: {json.dumps(oai_chunk)}\n\n'
                        
                        content = message.content
                        oai_chunk["choices"][0]["delta"]['content'] = content
                        oai_chunk["choices"][0]["delta"]['role'] = 'assistant'
                        yield f'data: {json.dumps(oai_chunk)}\n\n'
                        
                    else:
                        if stream:
                            raise ValueError("No valid agent type for chat completions")
                        else:
                            pass

                elif isinstance(message, TextMessage):
                    # 将智能体回复加入thread.messages中 TODO: 加入thinking事件的内容
                    if message.metadata.get("internal", "no") == "no":
                        rely_messages.append(message)
                    if ThoughtContent is not None:
                        ThoughtContent = None # 重置thought内容

                    chatcompletions["choices"][0]["message"]["created"] = int(time.time())
                    if (not stream) and isinstance(agent, ChatAgent):
                        if message.source!="user":
                            content = message.content
                            chatcompletions["choices"][0]["message"]["content"] = content
                            yield f'data: {json.dumps(chatcompletions)}\n\n'
                    elif (not stream) and isinstance(agent, Team):
                        if message.source!="user":
                            content = message.content
                            source = message.source
                            content = f"\n\nSpeaker: {source}\n\n{content}\n\n"
                            chatcompletions["choices"][0]["message"]["content"] = content
                            yield f'data: {json.dumps(chatcompletions)}\n\n'
                    else:
                        if (not stream):
                            raise ValueError("No valid agent type for chat completions")
                        else:
                            pass

                elif isinstance(message, ToolCallRequestEvent):
                    tool_flag = 1
                    tool_content: List[FunctionCall]=message.content
                    tool_calls = []
                    for tool in tool_content:
                        tool_calls.append(
                            {"id": tool.id, "type": "function","function": {"name": tool.name,"arguments": tool.arguments}}
                            )
                    if stream:
                        oai_chunk["choices"][0]["delta"]['tool_calls'] = tool_calls
                        oai_chunk["choices"][0]["delta"]['role'] = 'assistant'
                        yield f'data: {json.dumps(oai_chunk)}\n\n'
                    else:
                        chatcompletions["choices"][0]["message"]["tool_calls"] = tool_calls
                elif isinstance(message, ToolCallExecutionEvent):
                    tool_flag = 2
                elif isinstance(message, ToolCallSummaryMessage):
                    # 将智能体的ToolCallSummaryMessage回复加入thread.messages中
                    if message.metadata.get("internal", "no") == "no":
                        rely_messages.append(message)
                    if tool_flag == 2:
                        role_tmp = message.source
                        if role != role_tmp:
                            role = role_tmp
                        if not stream:
                            content = message.content
                            chatcompletions["choices"][0]["message"]["content"] = content + "\n\n"
                            yield f'data: {json.dumps(chatcompletions)}\n\n'
                        else:
                            if role and isinstance(agent, Team):
                                oai_chunk["choices"][0]["delta"]['content'] = f"\n\n**{role}发言：**\n\n"
                                oai_chunk["choices"][0]["delta"]['role'] = 'assistant'
                                yield f'data: {json.dumps(oai_chunk)}\n\n'

                            oai_chunk["choices"][0]["delta"]['content'] = message.content + "\n\n"
                            oai_chunk["choices"][0]["delta"]['role'] = 'assistant'
                            yield f'data: {json.dumps(oai_chunk)}\n\n'
                        tool_flag = 0

                elif isinstance(message, HandoffMessage):
                    if message.metadata.get("internal", "no") == "no":
                        rely_messages.append(message)
                    # 解析handoff_target
                    if isinstance(message.content, str):
                        content = message.content
                        oai_chunk["choices"][0]["delta"]['content'] = f"""\n\n**{message.source}转移给{message.target}：**\n\n{content}\n\n"""
                        oai_chunk["choices"][0]["delta"]['role'] = 'assistant'
                        yield f'data: {json.dumps(oai_chunk)}\n\n'
                
                elif isinstance(message, ThoughtEvent):
                    ThoughtContent = message.content

                elif isinstance(message, TaskResult):
                    agent_result = message
                    # if thread.team_result is None:
                    #     agent_result = TeamResult(
                    #         task_result = message
                    #     )
                    # else:
                    #     thread.team_result.task_result = message
                    if stream:
                        # 最后一个chunk
                        chatcompletionchunkend["created"] = int(time.time())
                        yield f'data: {json.dumps(chatcompletionchunkend)}\n\n'

                # TODO：其他消息类型暂时不处理
                # elif isinstance(message, Response):
                #     # print("Response: " + str(message))
                # elif isinstance(message, UserInputRequestedEvent):
                #     print("UserInputRequestedEvent:" + str(message))
                # elif isinstance(message, MultiModalMessage):
                #     print("MultiModalMessage:" + str(message))
                else:
                    # print("Unknown message:" + str(message))
                    # print(f"Unknown message, type: {type(message)}")
                    pass

        except Exception as e:
            raise traceback.print_exc()
        finally:
            # 更新thread状态
            response: Response = self.db_manager.get(
                Thread, 
                filters={"user_id": user_id,"thread_id": thread_id},
                return_json=False
                )
            if not response.status or not response.data:
                raise RuntimeError(f"Failed to get thread: {response.message}")
            else:
                thread: Thread = response.data[0]
                thread.status = RunStatus.COMPLETE
                thread.messages.extend([rely_message.model_dump(mode="json") for rely_message in rely_messages]) # 已经存在的Thread只添加最后一条消息
                if thread.team_result is None:
                        thread.team_result = TeamResult(
                            task_result = agent_result,
                            usage="",
                            duration= time.time() - start_time,
                        )
                else:
                    thread.team_result["task_result"] = agent_result.model_dump(mode="json")
            response: Response = self.db_manager.upsert(thread)
            if not response.status:
                raise RuntimeError(f"Failed to create thread: {response.message}")

    
    #### --- 关于get agent/groupchat infomation --- ####
    async def get_agents_info(self, agent: ChatAgent | Team=None) -> List[Dict[str, Any]]:
        """
        获取当前运行的Agents信息
        """
        # 从函数工厂中获取定义的Agents
        if agent is None:
            agent: ChatAgent | Team = (
                await self.agent_factory() 
                if asyncio.iscoroutinefunction(self.agent_factory)
                else (self.agent_factory())
            )
        agent_info = []
        if isinstance(agent, ChatAgent):
            agent_info.append(agent._to_config().model_dump())
            return agent_info
        elif isinstance(agent, Team):
            participant_names = [participant.name for participant in agent._participants]
            for participant in agent._participants:
                agent_info.append(participant._to_config().model_dump())
            agent_info.append({"name": "groupchat", "participants": participant_names})
            return agent_info
        else:
            raise ValueError("Agent must be AssistantAgent or BaseGroupChat")

    #### --- 关于测试 agent/groupchat --- ####
    async def test_agents(self, **kwargs) -> AsyncGenerator:

        agent: ChatAgent | Team = (
            await self.agent_factory() 
            if asyncio.iscoroutinefunction(self.agent_factory)
            else (self.agent_factory())
        )

        agent_name = kwargs.pop('model', None)

        assert agent_name is not None, "agent_name must be provided"

        if isinstance(agent, ChatAgent):
            kwargs.update({"agent": agent})
        elif isinstance(agent, Team):
            if agent_name == "groupchat":
                kwargs.update({"agent": agent})
            else:
                agent_names = [participant.name for participant in agent._participants]
                
                if agent_name not in agent_names:
                    raise ValueError(f"agent_name must be one of {agent_names}")
                participant = next((p for p in agent._participants if p.name == agent_name), None)
                kwargs.update({"agent": participant})
        else:
            raise ValueError("Agent must be ChatAgent or Team")
        
        # 启动聊天任务
        async for message in self.a_start_chat_completions(**kwargs):
            yield message
                
            



        


        