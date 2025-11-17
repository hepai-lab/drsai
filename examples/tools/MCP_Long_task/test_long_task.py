"""
Test script for the long task management system.
Demonstrates how to create tasks, check status, and retrieve results.
"""
import asyncio
import sys
import os
import json
from autogen_ext.tools.mcp import StdioServerParams, SseServerParams, mcp_server_tools
from autogen_core.tools import BaseTool, FunctionTool, StaticWorkbench, Workbench
from drsai import DrsaiStaticWorkbench

# Add the parent directory to the path to import long_task_test

async def test_task_flow():
    """Test the complete task lifecycle."""
    tools = []
    tools.extend(await mcp_server_tools(SseServerParams(
                            url="http://localhost:42608/sse",
                            env=None)
                    ) )
    workbench = DrsaiStaticWorkbench(tools)
    # print(await workbench.list_tools())
    
    print("=" * 60)
    print("Test 1: Create a new task")
    print("=" * 60)

    # Create a new task without task_id
    keywords = ["OpenDrSai", "AutoGen", "AI Agent"]
    result = await workbench.call_tool(
        name = "perform_long_research",
        arguments={'keywords': keywords})
    result1 = json.loads(result.result[0].content)
    print(f"\nResult 1: {result1}")
    task_id = result1['id']

    print("\n" + "=" * 60)
    print("Test 2: Check task status with same task_id")
    print("=" * 60)

    # Check status after initial time_limit
    result2 = await workbench.call_tool(
        name = "perform_long_research",
        arguments={'keywords': keywords, "task_id": task_id})
    print(f"\nResult 2: {result2}")

    print("\n" + "=" * 60)
    print("Test 3: Wait and check again")
    print("=" * 60)

    # Wait a bit more and check again
    await asyncio.sleep(5)
    result3 = await workbench.call_tool(
        name = "perform_long_research",
        arguments={'keywords': keywords, "task_id": task_id})
    print(f"\nResult 3: {result3}")

    print("\n" + "=" * 60)
    print("Test 4: Keep checking until done")
    print("=" * 60)

    # Keep checking until task is done
    max_checks = 10
    check_count = 0
    while check_count < max_checks:
        result = await workbench.call_tool(
        name = "perform_long_research",
        arguments={'keywords': keywords, "task_id": task_id})
        result = json.loads(result.result[0].content)
        print(f"\nCheck {check_count + 1}: Status = {result['status']}")

        if result['status'] in ['DONE', 'ERROR']:
            print(f"\nFinal Result: {result}")
            break

        check_count += 1
        await asyncio.sleep(5)

    print("\n" + "=" * 60)
    print("Test 5: Create a new independent task")
    print("=" * 60)

    # Create another task
    keywords2 = ["Machine Learning", "Deep Learning"]
    result_new = await workbench.call_tool(
        name = "perform_long_research",
        arguments={'keywords': keywords2})
    
    print(f"\nNew Task Result: {result_new}")

    print("\n" + "=" * 60)
    print("Tests completed!")
    print("=" * 60)

if __name__ == "__main__":
    # Note: This test should be run separately from the MCP server
    # as it imports the functions directly
    asyncio.run(test_task_flow())
