
from typing import List, Dict, Union, AsyncGenerator, Any
import os
import copy
import json
import asyncio
import time
import traceback

from drsai.modules.managers.threads_manager import ThreadsManager
from drsai.modules.managers.base_thread_message import ThreadMessage, Content, Text
THREADS_MGR = ThreadsManager()
from drsai.modules.managers.base_thread import Thread

from autogen_agentchat.agents import AssistantAgent, UserProxyAgent, BaseChatAgent
from autogen_agentchat.base import Response, TaskResult
from autogen_core import FunctionCall, CancellationToken
from autogen_core.model_context import (
    ChatCompletionContext,
    UnboundedChatCompletionContext,
)
from autogen_agentchat.messages import (
    AgentEvent,
    ThoughtEvent,
    ChatMessage,
    LLMMessage,
    TextMessage,
    UserMessage,
    HandoffMessage,
    ToolCallSummaryMessage,
    ToolCallRequestEvent,
    ToolCallExecutionEvent,
    ModelClientStreamingChunkEvent,
    MultiModalMessage,
    UserInputRequestedEvent,
)
from autogen_agentchat.teams import BaseGroupChat
from autogen_agentchat.ui import Console

from drsai.utils import Logger
logger = Logger.get_logger("dr_sai.py")

import logging
# 单个模型日志
third_party_logger1 = logging.getLogger("autogen_core")
third_party_logger1.propagate = False
third_party_logger2 = logging.getLogger("autogen_agentchat.events")
third_party_logger2.propagate = False
third_party_logger3 = logging.getLogger("httpx")
third_party_logger3.propagate = False


from drsai.utils.async_process import sync_wrapper
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
        self.threads_mgr = THREADS_MGR
        self.agent_factory: callable = kwargs.pop('agent_factory', None)
        self.history_mode = kwargs.pop('history_mode', 'backend') # backend or frontend
        self.use_api_key_mode = kwargs.pop('use_api_key_mode', "frontend") # frontend or backend

        # 后端测试接口
        load_test_api_key = os.environ.get("LOAD_TEST_API_KEY", None)
        if not load_test_api_key:
            ## 创建一个随机的api_key，并存入本地的.env文件中
            load_test_api_key = "DrSai_" + str(uuid.uuid4())
            with open("drsai_test.env", "w") as f:
                f.write(f"LOAD_TEST_API_KEY={load_test_api_key}\n")
            # load_dotenv(dotenv_path = "drsai_test.env")
            # load_test_api_key = os.environ.get("LOAD_TEST_API_KEY", None)
        self.drsai_test_api_key = load_test_api_key
        print(f"\nDrSai_test_api_key: {self.drsai_test_api_key}\n")


    #### --- 关于AutoGen --- ####
    async def start_console(
            self,
            task: str,
            agent: AssistantAgent|BaseGroupChat = None, 
            **kwargs) -> Union[None, TaskResult]:
        """
        启动aotugen原生多智能体运行方式和多智能体逻辑
        """

        # agent: AssistantAgent|BaseGroupChat = self.agent_factory() if agent is None else agent
        agent: AssistantAgent | BaseGroupChat = (
            await self.agent_factory() 
            if agent is None and asyncio.iscoroutinefunction(self.agent_factory)
            else (
                self.agent_factory() 
                if agent is None 
                else agent
            )
        )

        stream = agent._model_client_stream if not isinstance(agent, BaseGroupChat) else agent._participants[0]._model_client_stream
        if stream:
            await Console(agent.run_stream(task=task))
            return 
        else:
            result:TaskResult = await agent.run(task=task)
            print(result)
            # return result

    #### --- 关于OpenAI Chat/Completions --- ####
    async def a_start_chat_completions(self, **kwargs) -> AsyncGenerator:
        """
        启动聊天任务，使用completions后端模式
        加载默认的Agents, 并启动聊天任务, 这里默认使用GroupChat
        params:
        stream: bool, 是否使用流式模式
        messages: List[Dict[str, str]], 传入的消息列表
        HEPAI_API_KEY: str, 访问hepai的api_key
        usr_info: Dict, 用户信息
        base_models: Union[str, List[str]], 智能体基座模型
        chat_mode: str, 聊天模式，默认once
        **kwargs: 其他参数
        """
        try:
            # 从函数工厂中获取定义的Agents
            agent = kwargs.pop('agent', None) 
            if agent is None:
                agent: AssistantAgent | BaseGroupChat = (
                    await self.agent_factory() 
                    if asyncio.iscoroutinefunction(self.agent_factory)
                    else (self.agent_factory())
                )

            # 是否使用流式模式
            agent_stream = agent._model_client_stream if not isinstance(agent, BaseGroupChat) else agent._participants[0]._model_client_stream
            stream = kwargs.pop('stream', agent_stream)
            if isinstance(agent, BaseGroupChat) and stream:
                for participant in agent._participants:
                    if not participant._model_client_stream:
                        raise ValueError("Streaming mode is not supported when participant._model_client_stream is False")
            
            # 传入的消息列表
            messages: List[Dict[str, str]] = kwargs.pop('messages', [])
            usermessage = messages[-1]["content"]

            # 保存用户的extra_requests
            extra_requests: Dict = copy.deepcopy(kwargs)

            # 大模型配置
            api_key = kwargs.pop('apikey', None)
            temperature = kwargs.pop('temperature', 0.6)
            top_p = kwargs.pop('top_p', 1)
            cache_seed = kwargs.pop('cache_seed', None)
            # 额外的请求参数
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
                history_mode = kwargs.pop('history_mode', None) or self.history_mode # backend or frontend
                    
            # 创建/加载thread后端，来绑定指定前端的chat_id
            thread: Thread = self.threads_mgr.create_threads(username=username, chat_id=chat_id) # TODO: 这里需要改成异步加载
            thread.metadata["extra_requests"] = extra_requests

            # 判断agent是否有self._thread和self._thread_mgr属性，没有直接保存，说明drsai仅支持带有self._thread和self._thread_mgr属性的agent
            assert hasattr(agent, "_thread") and hasattr(agent, "_thread_mgr"), "Agent must have _thread and _thread_mgr attributes, please check your agent factory while from drsai."
            agent._thread = thread
            agent._thread_mgr = self.threads_mgr

            # 如果前端没有给定chat_id，则将当前历史消息记录加入到新的thread中/或者使用前端历史消息
            if not chat_id or history_mode == "frontend":
                thread.messages = [] # 清空历史消息
                for message in messages[:-1]: # 除了最后一个用户消息，都作为历史消息
                    thread_content = [Content(type="text", text=Text(value=message["content"],annotations=[]))]
                    self.threads_mgr.create_message(
                        thread=thread,
                        role = message["role"],
                        content=thread_content,
                        sender=message["role"],
                        metadata={},
                        )
                    
            # 提取历史消息
            history_oai_messages = [ {"role": x.role, "content": x.content_str(), "name": x.sender} for x in thread.messages] # 不将usermessage加入到历史消息中，在智能体会重复发送
            thread.metadata["history_oai_messages"] = history_oai_messages
            history: List[LLMMessage] = []
            for history_aoi_message in history_oai_messages:
                if  history_aoi_message["role"] == "user":
                    history.append(UserMessage(content=history_aoi_message["content"], source=history_aoi_message["name"]))
                elif history_aoi_message["role"] == "assistant":
                    history.append(UserMessage(content=history_aoi_message["content"], source=history_aoi_message["name"]))
                # 暂时不加载系统消息和工具消息
                # elif history_aoi_message["role"] == "system":
                #     history.append(SystemMessage(content=history_aoi_message["content"]))
                # elif history_aoi_message["role"] == "function":
                #     history.append(FunctionExecutionResultMessage(content=history_aoi_message["content"]))

            # 启动聊天任务
            async def add_history_to_model_context(model_context: ChatCompletionContext, history: List[LLMMessage]) -> str:
                if history:
                    for message in history:
                        await model_context.add_message(message)
                else:
                    pass
            ## 将api_key(可选的)/thread/self.threads_mgr/history加入每个智能体
            if isinstance(agent, BaseGroupChat):
                ## 传入前端的api_key
                if self.use_api_key_mode == "frontend":
                    if hasattr(agent, "_model_client"):
                        agent._model_client._client.api_key = api_key
                    for participant in agent._participants:
                        if hasattr(participant, "_model_client"):
                            participant._model_client._client.api_key = api_key

                for participant in agent._participants:
                    await add_history_to_model_context(participant._model_context, history)
                    participant._thread = thread
                    participant._thread_mgr = self.threads_mgr

                ## 先判断handoff_target是否为user，如果是，则使用HandoffMessage传入
                if (HandoffMessage in agent._participants[0].produced_message_types) and thread.metadata.get("handoff_target") == "user":
                    res = agent.run_stream(task=HandoffMessage(source="user", target=thread.metadata.get("handoff_source"), content=usermessage))
                else:
                    res = agent.run_stream(task=usermessage)
            else:
                await add_history_to_model_context(agent._model_context, history)
                ## 传入前端的api_key
                if self.use_api_key_mode == "frontend":
                    if hasattr(agent, "_model_client"):
                        agent._model_client._client.api_key = api_key
                res = agent.run_stream(task=usermessage)
                
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
                    last_message = message.messages[-1]
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
    async def get_agents_info(self) -> List[Dict[str, Any]]:
        """
        获取当前运行的Agents信息
        """
        # 从函数工厂中获取定义的Agents
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
                
            



        


        