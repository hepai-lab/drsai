from autogen_ext.tools.mcp import SseServerParams,mcp_server_tools

async def test_mcp_sse_server():

    tools = await mcp_server_tools(SseServerParams(
        url="http://0.0.0.0:42608/sse",
        env=None))
    print(tools[0].name)
    

if __name__ == '__main__':
    import asyncio
    asyncio.run(test_mcp_sse_server())
