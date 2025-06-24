from autogen_core.tools._function_tool import FunctionTool, FunctionToolConfig
from autogen_core.tools import StaticWorkbench
from autogen_core.code_executor._func_with_reqs import (
    Import, 
    import_to_str, 
    to_code,
    ImportFromModule, 
    Alias
    )
import asyncio
async def main():
    tool = [
            {
              "provider": "autogen_core.tools.FunctionTool",
              "component_type": "tool",
              "version": 1,
              "component_version": 1,
              "description": "Create custom tools by wrapping standard Python functions.",
              "label": "FunctionTool",
              "config": {
                "source_code": "def calculator(a: float, b: float, operator: str) -> str:\n    try:\n        if operator == \"+\":\n            return str(a + b)\n        elif operator == \"-\":\n            return str(a - b)\n        elif operator == \"*\":\n            return str(a * b)\n        elif operator == \"/\":\n            if b == 0:\n                return \"Error: Division by zero\"\n            return str(a / b)\n        else:\n            return \"Error: Invalid operator. Please use +, -, *, or /\"\n    except Exception as e:\n        return f\"Error: {str(e)}\"\n",
                "name": "calculator",
                "description": "A simple calculator that performs basic arithmetic operations",
                "global_imports": [ImportFromModule(module = "math", imports = ["pi"])],
                "has_cancellation_support": False
              }
            }
          ]
    tool = FunctionTool._from_config(FunctionToolConfig(**tool[0]['config']))
    Workbench = StaticWorkbench(tools = [tool])
    result = await Workbench.call_tool(name = "calculator", arguments = {"a": 2, "b": 3, "operator": "*"})
    print(result)

    # MagenticAgent.load_component()

if __name__ == '__main__':
    asyncio.run(main())
    pass