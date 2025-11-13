
from autogen_core.tools import BaseTool, FunctionTool, StaticWorkbench, Workbench
from drsai import DrsaiStaticWorkbench

async def get_weather(city: str) -> str:
    """Get the weather for a given city."""
    return f"The weather in {city} is 73 degrees and Sunny."


async def test():
    tool = FunctionTool(get_weather, description=get_weather.__doc__)
    config = tool.dump_component()
    print(config)
    tool2 = BaseTool.load_component(config)
    print(tool2.description)

async def test2():
    tool = FunctionTool(get_weather, description=get_weather.__doc__)
    wb = DrsaiStaticWorkbench(tools=[tool])
    print(await wb.list_tools())
    result = await wb.call_tool(name = 'get_weather', arguments={'city': 'New York'})
    print(result)
    


if __name__ == '__main__':
    import asyncio
    # asyncio.run(test())
    asyncio.run(test2())
