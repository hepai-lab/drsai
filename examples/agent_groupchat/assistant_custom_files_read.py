from typing import (
    AsyncGenerator, 
    List, 
    Sequence,
    )

from drsai import AssistantAgent, HepAIChatCompletionClient
from autogen_core.model_context import (
    TokenLimitedChatCompletionContext,
    BufferedChatCompletionContext,)
from drsai import run_backend, run_console, run_worker
import os, json
import asyncio

from autogen_agentchat.base import Response, TaskResult
from autogen_core import CancellationToken
from autogen_agentchat.messages import (
    BaseAgentEvent,
    BaseChatMessage,
    ModelClientStreamingChunkEvent,
    TextMessage,

)

class MyAssistantAgent(AssistantAgent):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
    
    async def run_stream(
        self,
        *,
        task: str | BaseChatMessage | Sequence[BaseChatMessage] | None = None,
        cancellation_token: CancellationToken | None = None,
    ) -> AsyncGenerator[BaseAgentEvent | BaseChatMessage | TaskResult, None]:
        """Run the agent with the given task and return a stream of messages
        and the final task result as the last item in the stream."""
        if cancellation_token is None:
            cancellation_token = CancellationToken()
        input_messages: List[BaseChatMessage] = []
        output_messages: List[BaseAgentEvent | BaseChatMessage] = []
        if task is None:
            pass
        elif isinstance(task, str):
            text_msg = TextMessage(content=task, source="user", metadata={"internal": "yes"})
            input_messages.append(text_msg)
            output_messages.append(text_msg)
            yield text_msg
        elif isinstance(task, BaseChatMessage):
            task.metadata["internal"] = "yes"
            input_messages.append(task)
            output_messages.append(task)
            yield task
        else:
            if not task:
                raise ValueError("Task list cannot be empty.")
            for msg in task:
                if isinstance(msg, BaseChatMessage):
                    msg.metadata["internal"] = "yes"
                    if msg.metadata.get("attached_files"):
                        # 处理附件
                        attached_files = msg.metadata.get("attached_files")
                    input_messages.append(msg)
                    output_messages.append(msg)
                    yield msg
                else:
                    raise ValueError(f"Invalid message type in sequence: {type(msg)}")
        async for message in self.on_messages_stream(input_messages, cancellation_token):
            if isinstance(message, Response):
                yield message.chat_message
                output_messages.append(message.chat_message)
                yield TaskResult(messages=output_messages)
            else:
                yield message
                if isinstance(message, ModelClientStreamingChunkEvent):
                    # Skip the model client streaming chunk events.
                    continue
                output_messages.append(message)

# 创建一个工厂函数，用于并发访问时确保后端使用的Agent实例是隔离的。
async def create_agent() -> MyAssistantAgent:

    model_client = HepAIChatCompletionClient(
        model="deepseek-ai/deepseek-v3-1",
    )

    # Create assistant agent with ChromaDB memory
    assistant_agent = MyAssistantAgent(
        name="assistant_agent",
        system_message="""你是一个文档回答助手，在用户上传了文档后需要严格根据用户上传的文件内容进行回复。
""",
        description="一个文档回答助手",
        model_client=model_client,
        model_client_stream=True,
        model_context=BufferedChatCompletionContext(buffer_size = 10) # 限制最多20条消息
    )

    return assistant_agent

if __name__ == "__main__":

    asyncio.run(
        run_worker(
            # 智能体注册信息
            agent_name="File_Assistant",
            author = "xiongdb@ihep.ac.cn",
            permission='groups: drsai, payg; users: admin, xiongdb@ihep.ac.cn, ddf_free, yqsun@ihep.ac.cn; owner: xiongdb@ihep.ac.cn',
            description = "一个文档回答助手",
            version = "0.1.0",
            logo="https://aiapi.ihep.ac.cn/apiv2/files/file-8572b27d093f4e15913bebfac3645e20/preview",
            # 智能体实体
            agent_factory=create_agent, 
            # 后端服务配置
            port = 42817, 
            no_register=False,
            enable_openwebui_pipeline=True, 
            pipelines_dir="/home/xiongdb/drsai/examples/agent_groupchat/assistant_ragflow/pipelines/",
            history_mode = "backend",
            # use_api_key_mode = "backend",
        )
    )