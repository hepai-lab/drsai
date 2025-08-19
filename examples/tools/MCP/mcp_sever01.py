"""
FastMCP quickstart example.

cd to the `examples/snippets/clients` directory and run:
    uv run server fastmcp_quickstart stdio
"""

from mcp.server.fastmcp import FastMCP
from starlette.applications import Starlette
from mcp.server.sse import SseServerTransport
from starlette.requests import Request
from starlette.routing import Mount, Route
from mcp.server import Server
import uvicorn

# Create an MCP server
mcp = FastMCP(
    name="Demo",
    instructions="Welcome to the demo server!",
    host="0.0.0.0",
    port=42996,
    )


# Add an addition tool
@mcp.tool()
def add(a: int, b: int) -> int:
    """Add two numbers"""
    return a + b


# Add a dynamic greeting resource
@mcp.resource("greeting://{name}")
def get_greeting(name: str) -> str:
    """Get a personalized greeting"""
    return f"Hello, {name}!"


# Add a prompt
@mcp.prompt()
def greet_user(name: str, style: str = "friendly") -> str:
    """Generate a greeting prompt"""
    styles = {
        "friendly": "Please write a warm, friendly greeting",
        "formal": "Please write a formal, professional greeting",
        "casual": "Please write a casual, relaxed greeting",
    }

    return f"{styles.get(style, styles['friendly'])} for someone named {name}."



if __name__ == "__main__":
    # mcp.run(transport="stdio")
    # mcp.run(transport="sse")
    mcp.run(transport="streamable-http")


# def create_starlette_app(mcp_server: Server, *, debug: bool = False) -> Starlette:
#     """Create a Starlette application that can server the provied mcp server with SSE."""
#     sse = SseServerTransport("/messages/")

#     async def handle_sse(request: Request) -> None:
#         async with sse.connect_sse(
#                 request.scope,
#                 request.receive,
#                 request._send,  # noqa: SLF001
#         ) as (read_stream, write_stream):
#             await mcp_server.run(
#                 read_stream,
#                 write_stream,
#                 mcp_server.create_initialization_options(),
#             )

#     return Starlette(
#         debug=debug,
#         routes=[
#             Route("/sse", endpoint=handle_sse),
#             Mount("/messages/", app=sse.handle_post_message),
#         ],
#     )


# if __name__ == "__main__":
#     mcp_server = mcp._mcp_server  # noqa: WPS437

#     # Bind SSE request handling to MCP server
#     starlette_app = create_starlette_app(mcp_server, debug=True)

#     uvicorn.run(starlette_app, host='0.0.0.0', port=42998)
