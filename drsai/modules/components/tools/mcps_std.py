from autogen_ext.tools.mcp import StdioServerParams, mcp_server_tools, StdioMcpToolAdapter

async def web_fetch() -> StdioMcpToolAdapter:
    try:
        web_fetch_tools = await mcp_server_tools(
            StdioServerParams(
                command="uv",
                args=["tool", "run", "mcp-server-fetch"],
                env=None) )
    except Exception as e:
        error =  "\nPlease make sure you have installed the uv tool and 'pip install mcp-server-fetch'."
        raise str(e) + error
    return web_fetch_tools[0]
