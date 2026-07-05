from typing import Mapping, Any
import asyncio
from mcp.types import TextContent
from autogen_core.tools import StaticWorkbench, ToolResult, TextResultContent
from autogen_ext.tools.mcp import StdioMcpToolAdapter, SseMcpToolAdapter
from autogen_core import CancellationToken

class DrSaiStaticWorkbench(StaticWorkbench):

    component_provider_override = 'drsai.DrSaiStaticWorkbench'

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
    
    async def call_tool(
        self, name: str, arguments: Mapping[str, Any] | None = None, cancellation_token: CancellationToken | None = None
    ) -> ToolResult:
        tool = next((tool for tool in self._tools if tool.name == name), None)
        if tool is None:
            return ToolResult(
                name=name,
                result=[TextResultContent(content=f"Tool {name} not found.")],
                is_error=True,
            )
        if not cancellation_token:
            cancellation_token = CancellationToken()
        if not arguments:
            arguments = {}
        try:
            result_future = asyncio.ensure_future(tool.run_json(arguments, cancellation_token))
            cancellation_token.link_future(result_future)
            actual_tool_output = await result_future
            if isinstance(tool, StdioMcpToolAdapter) or isinstance(tool, SseMcpToolAdapter):
                # actual_tool_output = actual_tool_output[0].text
                if isinstance(actual_tool_output[0], TextContent):
                    actual_tool_outputs = [str(actual_tool_output[i].text) for i in range(len(actual_tool_output))]
                    result_str = '\n'.join(actual_tool_outputs)
                else:
                    result_str = tool.return_value_as_string(actual_tool_output)
            else:
                result_str = tool.return_value_as_string(actual_tool_output)
            is_error = False
            
        except Exception as e:
            result_str = self._format_errors(e)
            is_error = True
        return ToolResult(name=tool.name, result=[TextResultContent(content=result_str)], is_error=is_error)
    
    

