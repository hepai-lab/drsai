import os, sys
from groupchat_task.groupchat import TaskGroupChat
from groupchat_task.Long_MCP_Agent import LongMCPAgent
from drsai import HepAIChatCompletionClient
from drsai.modules.baseagent import DrSaiAgent
from autogen_ext.tools.mcp import SseServerParams,mcp_server_tools
from autogen_core import CancellationToken
from autogen_core.model_context import BufferedChatCompletionContext
from autogen_agentchat.conditions import (
    StopMessageTermination,
    TextMentionTermination,
    TimeoutTermination,
    TextMessageTermination,
    TokenUsageTermination,
    MaxMessageTermination,
    HandoffTermination,
    FunctionalTermination,
    ExternalTermination,
    SourceMatchTermination,
)
from autogen_agentchat.messages import ModelClientStreamingChunkEvent
async def create_group_chat() -> TaskGroupChat:
    

    # Create a Web_agent
    model_client = HepAIChatCompletionClient(
        model="deepseek-ai/deepseek-v3-1",
    )
    tools=await mcp_server_tools(SseServerParams(
                                url="http://0.0.0.0:42608/sse",
                                env=None)
                        ) 
    Web_agent = LongMCPAgent(
        name="Web_agent",
        system_message="""你是一个可以进行web检索的智能体""",
        description="一个web检索助手",
        model_client=model_client,
        model_client_stream=True,
        model_context=BufferedChatCompletionContext(buffer_size = 20), # 限制最多20条消息
        tools = tools,
    )

    summrize_agent = DrSaiAgent(
        name="Summarize_agent",
        system_message="""你是一个可以进行文本摘要的智能体，需要根据用户的要求进行问题总结。""",
        description="一个文本摘要助手",
        model_client=model_client,
        model_client_stream=True,
        model_context=BufferedChatCompletionContext(buffer_size = 20) # 限制最多20条消息
    )

    return TaskGroupChat(
        participants=[Web_agent, summrize_agent],
        termination_condition=SourceMatchTermination(sources = summrize_agent.name),
        max_turns=2,
    )

async def agent_event_output():
    agent_event = await create_group_chat()
    
    output_ChunkEvent_once = False

    async for event in agent_event.run_stream(
        task = "你好，请问如何使用BOSS8？",
        cancellation_token=CancellationToken()
    ):
        if isinstance(event, ModelClientStreamingChunkEvent):
            if output_ChunkEvent_once:
                continue
            output_ChunkEvent_once = True
            print(event)
        else:
            print(event)
        
        print()

if __name__ == "__main__":
    import asyncio
    asyncio.run(agent_event_output())