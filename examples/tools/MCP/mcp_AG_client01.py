from autogen_ext.tools.mcp import StdioServerParams, SseServerParams, mcp_server_tools
import asyncio

# class Tools:
#     def __init__(self):
#         self.
#     # 定义一个名为tool的函数
#     async def tool(self):
#         tools=[]
#         for config in self.tool_config:
#             tools.extend(await mcp_server_tools(StdioServerParams(
#                                 command=config["command"],
#                                 args=config["args"],
#                                 env=None)
#                         ) )
#         return tools

async def get_std_tools():
    tool_config=[
            {
                "command":"conda",
                "args":[
                    "run",
                    "-n",
                    "drsai",
                    "--live-stream",
                    "python",
                    "examples/tools/MCP/mcp_sever01.py"
                    ],
            }
            
        ]
    tools=[]
    for config in tool_config:
            tools.extend(await mcp_server_tools(StdioServerParams(
                                command=config["command"],
                                args=config["args"],
                                env=None)
                        ) )

    return tools

async def get_sse_tool():
    urls=[
            "http://localhost:42996/sse", # sse url链接
        ]
    tools=[]
    # 遍历self.urls中的每一个url
    for url in urls:
        # 将mcp_server_tools函数返回的值添加到tools列表中
        tools.extend(await mcp_server_tools(SseServerParams(
                            url=url,
                            env=None)
                    ) )

    return tools

async def main():
    # 获取标准输入工具
    # std_tools=await get_std_tools()
    # 获取SSE工具
    sse_tools=await get_sse_tool()

if __name__ == "__main__":
    asyncio.run(main())


