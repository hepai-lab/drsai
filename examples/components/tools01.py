
from autogen_core.tools import BaseTool, FunctionTool

async def get_weather(city: str) -> str:
    """Get the weather for a given city."""
    return f"The weather in {city} is 73 degrees and Sunny."


async def test():
    tool = FunctionTool(get_weather, description=get_weather.__doc__)
    config = tool.dump_component()
    print(config)
    tool2 = BaseTool.load_component(config)
    print(tool2.description)




if __name__ == '__main__':
    import asyncio
    asyncio.run(test())
