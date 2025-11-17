from mcp.server.fastmcp import FastMCP

# Create an MCP server
mcp = FastMCP(
    name="Calculator",
    instructions="A simple calculator!",
    host="0.0.0.0",
    port=42608,
    )

# Add an addition tool
@mcp.tool()
def add(a: int, b: int) -> int:
    """Add two numbers"""
    return a + b

if __name__ == "__main__":
    mcp.run(transport="sse")
    