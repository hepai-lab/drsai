
from typing import List, Dict, Union, AsyncGenerator, Any
import os
import copy
import json
import asyncio
import time
import traceback

from drsai.modules.managers.threads_manager import ThreadsManager
from drsai.modules.managers.base_thread_message import Content, Text
from drsai.modules.managers.base_thread import Thread

from autogen_agentchat.agents import AssistantAgent, BaseChatAgent
from autogen_agentchat.base import TaskResult
from autogen_core import FunctionCall
from autogen_core.model_context import (
    ChatCompletionContext,
)
from autogen_agentchat.messages import (
    # AgentEvent,
    ThoughtEvent,
    # ChatMessage,
    LLMMessage,
    TextMessage,
    BaseChatMessage,
    UserMessage,
    HandoffMessage,
    ToolCallSummaryMessage,
    ToolCallRequestEvent,
    ToolCallExecutionEvent,
    ModelClientStreamingChunkEvent,
    # MultiModalMessage,
    # UserInputRequestedEvent,
)
from autogen_agentchat.teams import BaseGroupChat
from autogen_agentchat.ui import Console

# from loguru import logger
# logger = logger.bind(name="dr_sai.py")

# 单个模型日志
import logging
third_party_logger1 = logging.getLogger("autogen_core")
third_party_logger1.propagate = False
third_party_logger2 = logging.getLogger("autogen_agentchat.events")
third_party_logger2.propagate = False
third_party_logger3 = logging.getLogger("httpx")
third_party_logger3.propagate = False

# from drsai.utils.async_process import sync_wrapper

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
        self.username = "anonymous"
        self.threads_mgr = ThreadsManager()

        # 智能体管理
        self.agent_factory: callable = kwargs.pop('agent_factory', None)
        self.agent_instance: Dict[str, AssistantAgent | BaseGroupChat] = {}

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

    async def _create_agent_instance(self) -> AssistantAgent | BaseGroupChat:
        agent: AssistantAgent | BaseGroupChat = (
            await self.agent_factory() 
            if asyncio.iscoroutinefunction(self.agent_factory)
            else (self.agent_factory())
        )
        return agent

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
            # 处理用户的kwargs参数

            ## 传入的消息列表
            messages: List[Dict[str, str]] = kwargs.pop('messages', [])
            ## 保存用户的extra_requests
            extra_requests: Dict = copy.deepcopy(kwargs)
            ## 大模型配置
            api_key = kwargs.pop('apikey', None) or kwargs.pop('api_key', None)
            # temperature = kwargs.pop('temperature', 0.6)
            # top_p = kwargs.pop('top_p', 1)
            # cache_seed = kwargs.pop('cache_seed', None)
            ## 额外的请求参数处理
            extra_body: Union[Dict, None] = kwargs.pop('extra_body', None)
            if extra_body is not None:
                ## 用户信息 从DDF2传入的
                user_info: Dict = kwargs.pop('extra_body', {}).get("user", {})
                username = user_info.get('email', None) or user_info.get('name', "anonymous")
                chat_id = extra_body.get("chat_id", None) # 获取前端聊天界面的chat_id
            else:
                #  {'model': 'drsai_pipeline', 'user': {'name': '888', 'id': '888', 'email': 888', 'role': 'admin'}, 'metadata': {}, 'base_models': 'openai/gpt-4o', 'apikey': 'sk-88'}
                user_info = kwargs.pop('user', {})
                username = user_info.get('email', None) or user_info.get('name', "anonymous")
                chat_id = kwargs.pop('chat_id', None) # 获取前端聊天端口的chat_id
                # history_mode = kwargs.pop('history_mode', None) or self.history_mode # backend or frontend

            # 创建/获取智能体实例

            if chat_id in self.agent_instance:
                agent = self.agent_instance[chat_id]
            else:
                agent = await self._create_agent_instance()

            ## 是否使用流式模式
            agent_stream = agent._model_client_stream if not isinstance(agent, BaseGroupChat) else agent._participants[0]._model_client_stream
            stream = kwargs.pop('stream', agent_stream)
            if isinstance(agent, BaseGroupChat) and stream:
                for participant in agent._participants:
                    if not participant._model_client_stream:
                        raise ValueError("Streaming mode is not supported when participant._model_client_stream is False")
            thread: Thread|None = agent._thread
            if thread is None:
                ## 创建thread
                if not chat_id:
                    chat_id = str(uuid.uuid4())
                thread: Thread = self.threads_mgr.create_threads(username=username, chat_id=chat_id) # TODO: 这里需要改成异步加载
                assert hasattr(agent, "_thread") and hasattr(agent, "_thread_mgr"), "Agent must have _thread and _thread_mgr attributes, please check your agent factory while from drsai."
                agent._thread = thread
                agent._thread_mgr = self.threads_mgr
                if isinstance(agent, BaseGroupChat):
                    for participant in agent._participants:
                        participant._thread = thread
                        participant._thread_mgr = self.threads_mgr
                ## 判断是否为智能体添加前端的API_KEY
                if self.use_api_key_mode == "frontend":
                    if hasattr(agent, "_model_client"):
                        agent._model_client._client.api_key = api_key
                    if hasattr(agent, "_participants"):
                        for participant in agent._participants:
                            if hasattr(participant, "_model_client"):
                                participant._model_client._client.api_key = api_key
                ## 注册agent实例到agent_instance字典
                self.agent_instance[chat_id] = agent

            # 处理额外的请求参数

            thread.metadata["extra_requests"] = extra_requests

            # 历史消息处理
            
            ## 将前端消息整理为autogen BaseChatMessage格式
            task: list[BaseChatMessage] = []
            for message in messages[:-1]:
                task.append(TextMessage(content=message["content"], source=message["role"], metadata={"internal": "no"}))  
            ## 最后一条处理Handoff
            last_message = messages[-1]
            if isinstance(agent, BaseGroupChat):
                if (HandoffMessage in agent._participants[0].produced_message_types) and thread.metadata.get("handoff_target") == "user":
                    task.append(HandoffMessage(source="user", target=thread.metadata.get("handoff_source"), content=last_message["content"], metadata={"internal": "no"}))
                else:
                    task.append(TextMessage(content=last_message["content"], source=last_message["role"], metadata={"internal": "no"})) 
            else:
                task.append(TextMessage(content=last_message["content"], source=last_message["role"], metadata={"internal": "no"})) 
            
            # 开始聊天

            res = agent.run_stream(task=task)
            tool_flag = 0
            ThoughtContent = None
            role = ""
            async for message in res:
                
                # print(message)
                oai_chunk = copy.deepcopy(chatcompletionchunk)
                # The Unix timestamp (in seconds) of when the chat completion was created
                oai_chunk["created"] = int(time.time())
                if isinstance(message, ModelClientStreamingChunkEvent):
                    if stream and isinstance(agent, BaseChatAgent):
                        content = message.content
                        oai_chunk["choices"][0]["delta"]['content'] = content
                        oai_chunk["choices"][0]["delta"]['role'] = 'assistant'
                        yield f'data: {json.dumps(oai_chunk)}\n\n'
                    elif stream and isinstance(agent, BaseGroupChat):
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
                    self.threads_mgr.create_message(
                        thread=thread,
                        role = "assistant",
                        content=[Content(type="text", text=Text(value=message.content,annotations=[]), thought=ThoughtContent)],
                        sender=message.source,
                        metadata={},
                        )
                    if ThoughtContent is not None:
                        ThoughtContent = None # 重置thought内容

                    chatcompletions["choices"][0]["message"]["created"] = int(time.time())
                    if (not stream) and isinstance(agent, BaseChatAgent):
                        if message.source!="user":
                            content = message.content
                            chatcompletions["choices"][0]["message"]["content"] = content
                            yield f'data: {json.dumps(chatcompletions)}\n\n'
                    elif (not stream) and isinstance(agent, BaseGroupChat):
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
                    self.threads_mgr.create_message(
                        thread=thread,
                        role = "assistant",
                        content=[Content(type="text", text=Text(value=message.content,annotations=[]))],
                        sender=message.source,
                        metadata={},
                        )
                    if tool_flag == 2:
                        role_tmp = message.source
                        if role != role_tmp:
                            role = role_tmp
                        if not stream:
                            content = message.content
                            chatcompletions["choices"][0]["message"]["content"] = content + "\n\n"
                            yield f'data: {json.dumps(chatcompletions)}\n\n'
                        else:
                            if role and isinstance(agent, BaseGroupChat):
                                oai_chunk["choices"][0]["delta"]['content'] = f"\n\n**{role}发言：**\n\n"
                                oai_chunk["choices"][0]["delta"]['role'] = 'assistant'
                                yield f'data: {json.dumps(oai_chunk)}\n\n'

                            oai_chunk["choices"][0]["delta"]['content'] = message.content + "\n\n"
                            oai_chunk["choices"][0]["delta"]['role'] = 'assistant'
                            yield f'data: {json.dumps(oai_chunk)}\n\n'
                        tool_flag = 0

                # TODO: 这里暂时不向前端发送智能体转移消息
                # elif isinstance(message, HandoffMessage):
                #     # 解析handoff_target
                #     if isinstance(message.content, str):
                #         content = message.content
                #         oai_chunk["choices"][0]["delta"]['content'] = f"""\n\n**{message.source}转移给{message.target}：**\n\n{content}\n\n"""
                #         oai_chunk["choices"][0]["delta"]['role'] = 'assistant'
                #         yield f'data: {json.dumps(oai_chunk)}\n\n'
                
                elif isinstance(message, ThoughtEvent):
                    ThoughtContent = message.content

                elif isinstance(message, TaskResult):
                    # 判断最后一条消息是否是转移给user的HandoffMessage
                    last_message = message.messages[-1] if message.messages else {}
                    if isinstance(last_message, HandoffMessage) and last_message.target.lower() == "user":
                        thread.metadata["handoff_target"] = "user"
                        thread.metadata["handoff_source"] = last_message.source
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
        # finally:
        #     # 关闭model_client
        #     if isinstance(agent, BaseGroupChat):
        #         clients = {p._model_client for p in agent._participants}
        #         for client in clients:
        #             if client is not None:  # 避免空引用
        #                 await client.close()
        #     else:
        #         await agent._model_client.close()
    
    #### --- 关于get agent/groupchat infomation --- ####
    async def get_agents_info(self, agent: AssistantAgent | BaseGroupChat=None) -> List[Dict[str, Any]]:
        """
        获取当前运行的Agents信息
        """
        # 从函数工厂中获取定义的Agents
        if agent is None:
            agent: AssistantAgent | BaseGroupChat = (
                await self.agent_factory() 
                if asyncio.iscoroutinefunction(self.agent_factory)
                else (self.agent_factory())
            )
        agent_info = []
        if isinstance(agent, AssistantAgent):
            agent_info.append(agent._to_config().model_dump())
            return agent_info
        elif isinstance(agent, BaseGroupChat):
            participant_names = [participant.name for participant in agent._participants]
            for participant in agent._participants:
                agent_info.append(participant._to_config().model_dump())
            agent_info.append({"name": "groupchat", "participants": participant_names})
            return agent_info
        else:
            raise ValueError("Agent must be AssistantAgent or BaseGroupChat")

    #### --- 关于测试 agent/groupchat --- ####
    async def test_agents(self, **kwargs) -> AsyncGenerator:

        agent: AssistantAgent | BaseGroupChat = (
            await self.agent_factory() 
            if asyncio.iscoroutinefunction(self.agent_factory)
            else (self.agent_factory())
        )

        agent_name = kwargs.pop('model', None)

        assert agent_name is not None, "agent_name must be provided"

        if isinstance(agent, AssistantAgent):
            kwargs.update({"agent": agent})
        elif isinstance(agent, BaseGroupChat):
            if agent_name == "groupchat":
                kwargs.update({"agent": agent})
            else:
                agent_names = [participant.name for participant in agent._participants]
                
                if agent_name not in agent_names:
                    raise ValueError(f"agent_name must be one of {agent_names}")
                participant = next((p for p in agent._participants if p.name == agent_name), None)
                kwargs.update({"agent": participant})
        else:
            raise ValueError("Agent must be AssistantAgent or BaseGroupChat")
        
        # 启动聊天任务
        async for message in self.a_start_chat_completions(**kwargs):
            yield message
                
            



        


        