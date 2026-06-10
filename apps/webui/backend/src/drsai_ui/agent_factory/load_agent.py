import asyncio

from typing import Union, Any, Dict, List, Optional, Callable
from autogen_core.models import ChatCompletionClient, LLMMessage
from autogen_core import ComponentModel, CancellationToken

from autogen_core.tools._function_tool import FunctionTool, FunctionToolConfig
# from autogen_agentchat.agents._assistant_agent import AssistantAgentConfig
# from autogen_agentchat.agents import UserProxyAgent, BaseChatAgent
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
    DrSaiStaticWorkbench,
    )
from drsai.modules.components.memory.ragflow_memory import RAGFlowMemory, RAGFlowMemoryConfig
from .magentic_one.agents.drsai_agents import MagenticAgent
from .magentic_one.teams.orchestrator import GroupChat as MagenticGroupChat
from .components.memory.load_memory_cofig import load_memory_function

async def a_get_ragflow_memorys(ragflow_configs: List[Dict[str, Any]]) -> List[RAGFlowMemory]:
    memory = []
    for ragflow_config in ragflow_configs:
        if ragflow_config is not None:
            ragflow_url = ragflow_config.get("ragflow_url")
            ragflow_token = ragflow_config.get("ragflow_token")
            dataset_ids = ragflow_config.get("dataset_ids")  # necessary
            # document_ids = ragflow_config.get("document_ids")
            memory.append(
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
    return memory
async def a_get_mcp_workbench(mcp_sse_list: List[Dict[str, Any]]) -> DrSaiStaticWorkbench:
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
        workbench = DrSaiStaticWorkbench(tools=sse_tools)
        return workbench

def get_model_client(
        model_client_config: Union[ComponentModel, Dict[str, Any], None],
    ) -> ChatCompletionClient:
        return ChatCompletionClient.load_component(model_client_config)

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
                # TODO: 加载 agent memory_functions
                # TODO: 加载RAG等knowledge function
                knowledge_cofig = value.get("knowledge_cofig", None)
                memory_function = None
                if knowledge_cofig:
                    memory_function = await load_memory_function(knowledge_cofig)
                assistant_list.append(AssistantAgent(
                    name=name,
                    system_message=system_message,
                    description=description,
                    model_client=model_client,
                    tools=mcp_tools+hepai_tools if len(mcp_tools+hepai_tools+source_tools) > 0 else None,
                    memory_function=memory_function,
                ))
                
    # TODO: 完善GroupChat的加载, UI模式下的Groupchat需要MagenticGroupChat

    # TODO: 通过本地PIP安装的智能体/多智能体系统进行通用加载，需要实现a_load_agent_factory_from_config

    # TODO: 通过远程启动智能体/多智能体系统进行通用加载-》基于MagenticAgent实现一个智能体OpenAPI接口，可以暂停/关闭等远程模型连接的功能
    assert len(assistant_list) > 0, "AssistantAgent配置不能为空"
    async def agent_factory() -> AssistantAgent:
        return assistant_list[0]
    return agent_factory

async def a_load_agent_factory_from_mode(
        config: dict,
        mode = "backend"
        ) -> Callable[[], Union[AssistantAgent, BaseGroupChat]]:
    '''
    加载配置，创建AssistantAgent或BaseGroupChat实例
    '''
    name = config.get("name", "AssistantAgent")
    system_message = config.get("system_message", None)
    description = config.get("description", None)
    model_client = get_model_client(config.get("model_client", None))
    # 加载tools
    mcp_tools = await a_load_mcp_tools(config.get("mcp_tools", []))
    hepai_tools = await a_load_hepai_tools(config.get("hepai_tools", []))
    source_tools = await a_load_source_code_tools(config.get("source_tools", []))
    # TODO: 加载 agent memory_functions
    # TODO: 加载RAG等knowledge function
    knowledge_cofig = config.get("knowledge_cofig", None)
    memory_function = None
    if knowledge_cofig:
        memory_function = await load_memory_function(knowledge_cofig)
    if mode == "ui":
        agent = MagenticAgent(
            name=name,
            system_message=system_message,
            description=description,
            model_client=model_client,
            tools=mcp_tools+hepai_tools+source_tools if len(mcp_tools+hepai_tools+source_tools) > 0 else None,
            memory_function=memory_function,
        )
    else:
        agent = AssistantAgent( 
            name=name,
            system_message=system_message,
            description=description,
            model_client=model_client,
            tools=mcp_tools+hepai_tools if len(mcp_tools+hepai_tools) > 0 else None,
            memory_function=memory_function,
        )
    async def agent_factory() -> AssistantAgent:
        return agent
    return agent_factory


