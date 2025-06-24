# import importlib
# from inspect import getmembers, isfunction, iscoroutinefunction
import asyncio

from typing import Union, Any, Dict, List, Optional, Callable
from autogen_core.models import ChatCompletionClient, LLMMessage
from autogen_core import ComponentModel, CancellationToken

from autogen_core.tools._function_tool import FunctionTool, FunctionToolConfig
from autogen_agentchat.agents._assistant_agent import AssistantAgentConfig
from autogen_agentchat.agents import UserProxyAgent, BaseChatAgent
from autogen_agentchat.teams import BaseGroupChat
from autogen_ext.tools.mcp import (
    SseServerParams, 
    StdioServerParams, 
    mcp_server_tools,
    SseMcpToolAdapter,
    StdioMcpToolAdapter,
    )
from autogen_core.tools._function_tool import FunctionTool, FunctionToolConfig
from autogen_core.code_executor._func_with_reqs import (
    Import, 
    import_to_str, 
    to_code,
    ImportFromModule, 
    Alias
    )
from drsai import (
    AssistantAgent, 
    DrSaiRoundRobinGroupChat, 
    DrSaiSelectorGroupChat, 
    DrSaiSwarm)
from .magentic_one.agents.drsai_agents import MagenticAgent
from .magentic_one.teams.orchestrator import GroupChat as MagenticGroupChat

# def load_tools(tool_names: list[str]):
#     loaded_tools = {}
#     for tool_name in tool_names:
#         module_path, func_name = tool_name.rsplit('.', 1)
        
#         # 动态导入模块
#         module = importlib.import_module(module_path)
        
#         # 获取函数对象
#         func = getattr(module, func_name)
        
#         # 验证有效性
#         if not (iscoroutinefunction(func) or isfunction(func)):
#             raise ValueError(f"{tool_name} 不是有效函数")
            
#         # 存储函数元数据
#         loaded_tools[func_name] = {
#             "func": func,
#             "is_async": iscoroutinefunction(func),
#             "doc": func.__doc__ or ""
#         }
#     tools = [loaded_tools[name]["func"] for name in tool_names]
#     return tools

def get_model_client(
        model_client_config: Union[ComponentModel, Dict[str, Any], None],
    ) -> ChatCompletionClient:
        return ChatCompletionClient.load_component(model_client_config)

def load_mcp_tools(mcp_tools_config: list[dict]) -> list[StdioMcpToolAdapter | SseMcpToolAdapter]:
    '''
    加载AutoGen的MCP工具
    '''
    mcp_tools = []
    for mcp_tool_config in mcp_tools_config:

        if mcp_tool_config["type"] == "std":
            command = mcp_tool_config.get("command", None)
            assert command is not None, "mcp_tools的command不能为空"
            args = mcp_tool_config.get("args", [])
            env = mcp_tool_config.get("env", None)
            cwd = mcp_tool_config.get("cwd", None)
            std_tool: list[StdioMcpToolAdapter] = asyncio.run( mcp_server_tools(StdioServerParams(
                                command=command,
                                args=args,
                                env=env,
                                cwd=cwd)
                        ) )
            mcp_tools.extend(std_tool)
        elif mcp_tool_config["type"] == "sse":
            url = mcp_tool_config.get("url", None)
            assert url is not None, "mcp_tools的url不能为空"
            headers = mcp_tool_config.get("headers", None)
            timeout = mcp_tool_config.get("timeout", 20)
            sse_read_timeout = mcp_tool_config.get("sse_read_timeout", 60 * 5)
            sse_tool: list[SseMcpToolAdapter] = asyncio.run( mcp_server_tools(SseServerParams(
                                url=url,
                                headers=headers,
                                timeout=timeout,
                                sse_read_timeout=sse_read_timeout)
                        ) )
            mcp_tools.extend(sse_tool)
        else:
            raise ValueError(f"mcp_tools的type只能是std或sse")
    return mcp_tools

def load_hepai_tools(hepai_tools_config: list[dict]) -> list[Callable]:
    '''
    加载HepAI的worker工具
    '''
    hepai_tools = []
    try:
        from hepai.tools.get_woker_functions import get_worker_sync_functions
        for hepai_tool_config in hepai_tools_config:
            worker_name = hepai_tool_config.get("worker_name", None)
            api_key = hepai_tool_config.get("api_key", None)
            base_url = hepai_tool_config.get("base_url", "https://aiapi.ihep.ac.cn/apiv2")
            funcs: list[Callable] = get_worker_sync_functions(worker_name, api_key, base_url)
            allowed_tools = hepai_tool_config.get("allowed_tools", [])
            if allowed_tools:
                funcs = [func for func in funcs if func.__name__ in allowed_tools]
            hepai_tools.extend(funcs)
        return hepai_tools
    except ImportError:
        raise ImportError("please install <hepai> package")

def load_memory_functions(memory_functions_config: dict) -> Callable:
    '''
    加载memory_functions
    '''
    worker_name = memory_functions_config.get("worker_name", None)
    api_key = memory_functions_config.get("api_key", None)
    base_url = memory_functions_config.get("base_url", "https://aiapi.ihep.ac.cn/apiv2")
    rag_config = memory_functions_config.get("rag_config", {})
    # TODO: 目前只支持last_message
    try:
        from hepai import HRModel
        async def memory_functions(
            memory_messages: List[Dict[str, str]], 
            llm_messages: List[LLMMessage],
            model_client: ChatCompletionClient,
            cancellation_token: CancellationToken,
            agent_name: str,
            **kwargs,
            ) -> List[Dict[str, str]]|List[LLMMessage]:
            model = HRModel.connect(
                name=worker_name,
                base_url=base_url,
                api_key=api_key
                )
            query = memory_messages[-1]["content"]  # Select the last message of the chat history as the RAG query statement.
            rag_config.update({"content": query})
            # 检索结果格式：[{"text": "xxx", "score": 0.5}, {"text": "yyy", "score": 0.3}] 
            results: List[dict] = model.interface(
                **rag_config,
                )
            retrieve_txt = ""
            for index, result in enumerate(results):
                retrieve_txt += f"Ref {index+1}: \n{result['text']}\n"

            last_txt = f"\n\nPlease provide closely related answers based on the reference materials provided below. Ensure that your response is closely integrated with the content of the reference materials to provide appropriate and well-supported answers.\nThe reference materials are: {retrieve_txt}."
            memory_messages[-1]["content"] += last_txt
            return memory_messages
    except ImportError:
        raise ImportError("please install <hepai> package")

def load_agent_factory_from_config(
        config: dict,
        mode = "backend"
        ) -> Callable[[], Union[AssistantAgent, BaseGroupChat]]:
    '''
    加载配置，创建AssistantAgent或BaseGroupChat实例
    '''
    
    assistant_list = []
    groupchat: BaseGroupChat|None = None
    for key, value in config.items():
        if isinstance(value, dict) and "type" in value.keys():
             
            if value["type"] == "AssistantAgent":
                name = value.get("name", "AssistantAgent")
                system_message = value.get("system_message", None)
                description = value.get("description", None)
                model_client = get_model_client(value.get("model_client", None))
                # 加载tools
                mcp_tools = load_mcp_tools(value.get("mcp_tools", []))
                hepai_tools = load_hepai_tools(value.get("hepai_tools", []))
                # TODO: 加载 memory_functions, RAG
                if mode == "ui":
                    assistant_list.append(MagenticAgent(
                        name=name,
                        system_message=system_message,
                        description=description,
                        model_client=model_client,
                        tools=mcp_tools+hepai_tools if len(mcp_tools+hepai_tools) > 0 else None,
                    ))
                else:
                    assistant_list.append(AssistantAgent(
                        name=name,
                        system_message=system_message,
                        description=description,
                        model_client=model_client,
                        tools=mcp_tools+hepai_tools if len(mcp_tools+hepai_tools) > 0 else None,
                    ))
                
    # TODO: 完善GroupChat的加载, UI模式下的Groupchat需要MagenticGroupChat

    # TODO: 通过本地PIP安装的智能体/多智能体系统进行通用加载

    assert len(assistant_list) > 0, "AssistantAgent配置不能为空"
    def agent_factory() -> AssistantAgent:
        return assistant_list[0]
    return agent_factory


##############
# 异步加载
##############

async def a_load_mcp_tools(mcp_tools_config: list[dict]) -> list[StdioMcpToolAdapter | SseMcpToolAdapter]:
    '''
    加载AutoGen的MCP工具
    yaml:
        mcp_tools_1: &tool_1
            type: std
            command: python3
            args:
                - /your/path/to/mcp_server.py
            env: null

            mcp_tools_2: &tool_2
            type: sse
            url: www.example.com
            headers:
                Authorization: Bearer <token>
                event_name: mcp_tools_event
            timeout: 20
            sse_read_timeout: 300
    '''
    mcp_tools = []
    for mcp_tool_config in mcp_tools_config:

        if mcp_tool_config["type"] == "std":
            command = mcp_tool_config.get("command", None)
            assert command is not None, "mcp_tools的command不能为空"
            args = mcp_tool_config.get("args", [])
            env = mcp_tool_config.get("env", None)
            cwd = mcp_tool_config.get("cwd", None)
            std_tool: list[StdioMcpToolAdapter] = await mcp_server_tools(StdioServerParams(
                                command=command,
                                args=args,
                                env=env,
                                cwd=cwd)
                        ) 
            mcp_tools.extend(std_tool)
        elif mcp_tool_config["type"] == "sse":
            url = mcp_tool_config.get("url", None)
            assert url is not None, "mcp_tools的url不能为空"
            headers = mcp_tool_config.get("headers", None)
            timeout = mcp_tool_config.get("timeout", 20)
            sse_read_timeout = mcp_tool_config.get("sse_read_timeout", 60 * 5)
            sse_tool: list[SseMcpToolAdapter] = await mcp_server_tools(SseServerParams(
                                url=url,
                                headers=headers,
                                timeout=timeout,
                                sse_read_timeout=sse_read_timeout)
                        ) 
            mcp_tools.extend(sse_tool)
        else:
            raise ValueError(f"mcp_tools的type只能是std或sse")
    return mcp_tools

async def a_load_hepai_tools(hepai_tools_config: list[dict]) -> list[Callable]:
    '''
    加载HepAI的worker工具
    yaml:
        hepai_tools_1: &hepai_tool_1
            worker_name: besiii_boss_08
            api_key: sk-****
            allowed_tools:
                - json_mapping
                - job_status
            base_url: "https://aiapi.ihep.ac.cn/apiv2"
    '''
    hepai_tools = []
    try:
        from hepai.tools.get_woker_functions import get_worker_async_functions
        for hepai_tool_config in hepai_tools_config:
            worker_name = hepai_tool_config.get("worker_name", None)
            api_key = hepai_tool_config.get("api_key", None)
            base_url = hepai_tool_config.get("base_url", "https://aiapi.ihep.ac.cn/apiv2")
            funcs: list[Callable] = await get_worker_async_functions(worker_name, api_key, base_url)
            allowed_tools = hepai_tool_config.get("allowed_tools", [])
            if allowed_tools:
                funcs = [func for func in funcs if func.__name__ in allowed_tools]
            hepai_tools.extend(funcs)
        return hepai_tools
    except ImportError:
        raise ImportError("please install <hepai> package")

async def a_load_source_code_tools(source_tools_config: list[dict]) -> list[FunctionTool]:
    '''
    加载前端源代码工具
    yaml:
        source_tools_1: &source_tool_1
            type: FunctionTool
            config:
                source_code: |
                    def calculator(a: float, b: float, operator: str) -> str:
                        try:
                            if operator == "+":
                                return str(a + b)
                            elif operator == "-":
                                return str(a - b)
                            elif operator == "*":
                                return str(a * b)
                            elif operator == "/":
                                if b == 0:
                                    return "Error: Division by zero"
                                return str(a / b)
                            else:
                                return "Error: Invalid operator. Please use +, -, *, or /"
                        except Exception as e:
                            return f"Error: {str(e)}"
                name: calculator
                description: A simple calculator that performs basic arithmetic operations
                global_imports:
                    - math: 
                        - pi
                        - e
                has_cancellation_support: False
    '''
    source_code_tools = []
    for source_tool_config in source_tools_config:
        if source_tool_config["type"] == "FunctionTool":
            global_imports = source_tool_config["config"].get("global_imports", [])
            global_imports_modules = []
            if global_imports:
                for global_import in global_imports:
                    module_name = list(global_import.keys())[0]
                    import_list = global_import[module_name]
                    global_imports_modules.append(ImportFromModule(module=module_name, imports=import_list))
                source_tool_config["config"]["global_imports"] = global_imports_modules
            tool_config = FunctionToolConfig(**source_tool_config["config"])
            tool = FunctionTool._from_config(tool_config)
            source_code_tools.append(tool)
        else:
            raise ValueError(f"source_tools的type只能是FunctionTool")
    return source_code_tools

async def a_load_memory_functions(memory_functions_config: dict) -> Callable:
    '''
    加载memory_functions
    '''
    worker_name = memory_functions_config.get("worker_name", None)
    api_key = memory_functions_config.get("api_key", None)
    base_url = memory_functions_config.get("base_url", "https://aiapi.ihep.ac.cn/apiv2")
    rag_config = memory_functions_config.get("rag_config", {})
    # TODO: 目前只支持last_message
    try:
        from hepai import HRModel
        async def memory_functions(
            memory_messages: List[Dict[str, str]], 
            llm_messages: List[LLMMessage],
            model_client: ChatCompletionClient,
            cancellation_token: CancellationToken,
            agent_name: str,
            **kwargs,
            ) -> List[Dict[str, str]]|List[LLMMessage]:
            model = HRModel.connect(
                name=worker_name,
                base_url=base_url,
                api_key=api_key
                )
            query = memory_messages[-1]["content"]  # Select the last message of the chat history as the RAG query statement.
            rag_config.update({"content": query})
            # 检索结果格式：[{"text": "xxx", "score": 0.5}, {"text": "yyy", "score": 0.3}] 
            results: List[dict] = model.interface(
                **rag_config,
                )
            retrieve_txt = ""
            for index, result in enumerate(results):
                retrieve_txt += f"Ref {index+1}: \n{result['text']}\n"

            last_txt = f"\n\nPlease provide closely related answers based on the reference materials provided below. Ensure that your response is closely integrated with the content of the reference materials to provide appropriate and well-supported answers.\nThe reference materials are: {retrieve_txt}."
            memory_messages[-1]["content"] += last_txt
            return memory_messages
        return memory_functions
    except ImportError:
        raise ImportError("please install <hepai> package")


async def a_load_agent_factory_from_config(
        config: dict,
        mode = "backend"
        ) -> Callable[[], Union[AssistantAgent, BaseGroupChat]]:
    '''
    加载配置，创建AssistantAgent或BaseGroupChat实例
    '''
    
    assistant_list = []
    groupchat: BaseGroupChat|None = None
    for key, value in config.items():
        if isinstance(value, dict) and "type" in value.keys():
             
            if value["type"] == "AssistantAgent":
                name = value.get("name", "AssistantAgent")
                system_message = value.get("system_message", None)
                description = value.get("description", None)
                model_client = get_model_client(value.get("model_client", None))
                # 加载tools
                mcp_tools = await a_load_mcp_tools(value.get("mcp_tools", []))
                hepai_tools = await a_load_hepai_tools(value.get("hepai_tools", []))
                source_tools = await a_load_source_code_tools(value.get("source_tools", []))
                # TODO: 加载 memory_functions, RAG
                if mode == "ui":
                    assistant_list.append(MagenticAgent(
                        name=name,
                        system_message=system_message,
                        description=description,
                        model_client=model_client,
                        tools=mcp_tools+hepai_tools+source_tools if len(mcp_tools+hepai_tools+source_tools) > 0 else None,
                    ))
                else:
                    assistant_list.append(AssistantAgent(
                        name=name,
                        system_message=system_message,
                        description=description,
                        model_client=model_client,
                        tools=mcp_tools+hepai_tools if len(mcp_tools+hepai_tools) > 0 else None,
                    ))
                
    # TODO: 完善GroupChat的加载, UI模式下的Groupchat需要MagenticGroupChat

    # TODO: 通过本地PIP安装的智能体/多智能体系统进行通用加载，需要实现a_load_agent_factory_from_config

    # TODO: 通过远程启动智能体/多智能体系统进行通用加载-》基于MagenticAgent实现一个智能体OpenAPI接口，可以暂停/关闭等远程模型连接的功能
    assert len(assistant_list) > 0, "AssistantAgent配置不能为空"
    async def agent_factory() -> AssistantAgent:
        return assistant_list[0]
    return agent_factory
         

