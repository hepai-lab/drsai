# 函数工具的接入

OpenDrSai和Autogen支持FunctionTool类型，可以将本地函数工具接入到OpenDrSai中。

## 本地/FastAPI/HepAI函数工具的接入

```python
from autogen_core.tools import FunctionTool, StaticWorkbench
from drsai import get_fastapi_tools
from hepai import HRModel
import os
from hepai.tools.get_woker_functions import get_worker_sync_functions, get_worker_async_functions

# 本地函数工具
async def get_weather(city: str) -> str:
    """Get the weather for a given city."""
    return f"The weather in {city} is 73 degrees and Sunny."
tools = [get_weather]

# 符合OpenAPI规范的函数工具
tools.extend(get_fastapi_tools("www.example.com"))

# HepAI Worker函数工具
api_key = os.environ.get("HEPAI_API_KEY")
funcs_decs = get_worker_sync_functions(name="hepai/web_search", api_key=api_key, base_url="https://aiapi.ihep.ac.cn/apiv2")
tools.extend(funcs_decs)

FunctionTools = []
for tool in tools:
    if hasattr(tool, "__doc__") and tool.__doc__ is not None:
        description = tool.__doc__
    else:
        description = ""
    FunctionTools.append(FunctionTool(tool, description=description))
```

## MCP的接入

```python
from autogen_ext.tools.mcp import (
    StdioServerParams, 
    SseServerParams,
    mcp_server_tools)

FunctionTools = []
# 本地MCP工具
FunctionTools.extend(await mcp_server_tools(StdioServerParams(
        command="python3",
        args=["./my_function_tool.py"],
        env=None)
    ))
# 远程MCP工具
FunctionTools.extend(await mcp_server_tools(SseServerParams(
        url = "http://127.0.0.1:50052/sse",
        timeout = 30,
    )))
```

## 组件式加载

具体见[examples/components/tools01.py](../../examples/components/tools01.py)
 
## 执行工具

```python
workbench = StaticWorkbench(FunctionTools)
ToolResult = await workbench.call_tool(
    name = tool_name,
    arguments = arguments)
```

## 接入智能体

```python
AssistantAgent(
    name="weather_agent",
    model_client=model_client,
    system_message="You are a helpful assistant.",
    tools=FunctionTools # 或者直接传入列表tools
    )
```