

from drsai.modules.components.tool import (
    CancellationToken,
)
from drsai.modules.components.model_client import HepAIChatCompletionClient
from drsai.modules.components.task_manager import TaskType, TaskStatus, Task
from drsai.modules.components.model_context import BufferedChatCompletionContext
from drsai.modules.components.memory import RAGFlowMemory, RAGFlowMemoryConfig
from drsai.modules.managers.messages import (
    BaseChatMessage,
    BaseAgentEvent,
    TaskEvent, 
    AgentLogEvent,
    ModelClientStreamingChunkEvent,
    ThoughtEvent,
    TextMessage,
    MultiModalMessage,
    FileInfo,
    FilesContent,
    FilesEvent,
    Image,
    )
from drsai.modules.managers.database import DatabaseManager
from drsai.modules.baseagent import (
    DrSaiAgent, 
    CreateResult,
    Response, 
    AssistantMessage)
from drsai.backend import run_worker, Console, DrSaiAPP
from drsai.utils.utils import upload_to_hepai_filesystem

from typing import (
    AsyncGenerator, 
    List, 
    Sequence, 
    )
from loguru import logger
import os, json, time, base64
from pathlib import Path
# from dotenv import load_dotenv
# load_dotenv()
import asyncio, traceback
current_file_abs_path = os.path.abspath(__file__)
parent_dir_abs_path = os.path.dirname(current_file_abs_path)

def get_knowledge_base64_and_url():
    """获取知识库文件的base64编码"""
    try:
        file_path = os.path.join(parent_dir_abs_path, 'Your_specific_konwledge.md')
        if os.path.exists(file_path):
            with open(file_path, 'rb') as file:
                file_base64 = base64.b64encode(file.read()).decode('utf-8')
            file_obj = upload_to_hepai_filesystem(file_path=file_path)
            return (file_base64, file_obj)
        else:
            print(f"警告: 文件 {file_path} 不存在")
            return None
    except Exception as e:
        print(f"读取文件时出错: {e}")
        return None


class TaskAgent(DrSaiAgent):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
    

    async def on_messages_stream(
        self, messages: Sequence[BaseChatMessage], cancellation_token: CancellationToken
    ) -> AsyncGenerator[BaseAgentEvent | BaseChatMessage | Response, None]:
        """
        Process the incoming messages with the assistant agent and yield events/responses as they happen.
        
        There are three types of agent events to access drsai ui frontend:
        ModelClientStreamingChunkEvent - send the model client streaming chunk event to the frontend
        TaskEvent: send the task event to the frontend within the task manager
        AgentLogEvent: send the agent log event to the frontend
        """

        # monitor the pause event
        if self.is_paused:
            yield Response(
                chat_message=TextMessage(
                    content=f"The {self.name} is paused.",
                    source=self.name,
                    metadata={"internal": "yes"},
                )
            )
            return

        # Set up background task to monitor the pause event and cancel the task if paused.
        async def monitor_pause() -> None:
            await self._paused.wait()
            self.is_paused = True

        monitor_pause_task = asyncio.create_task(monitor_pause())
        inner_messages: List[BaseAgentEvent | BaseChatMessage] = []
        try:
            # Gather all relevant state here
            agent_name = self.name
            model_context = self._model_context
            memory = self._memory
            system_messages = self._system_messages
            workbench = self._workbench
            handoff_tools = self._handoff_tools
            handoffs = self._handoffs
            model_client = self._model_client
            model_client_stream = self._model_client_stream
            reflect_on_tool_use = self._reflect_on_tool_use
            tool_call_summary_format = self._tool_call_summary_format
            output_content_type = self._output_content_type
            format_string = self._output_content_type_format

            # test: yield agent log
            yield AgentLogEvent(
                title="I'm searching the memory.",
                content="Adding the memory to the model context",
                source=self.name,
                content_type = "log",
            )

            # test: yield file list
            file_base64, file_obj = get_knowledge_base64_and_url()
            ## base64 file
            base64_file = FileInfo(
                name = "Your_specific_knowledge.md",
                base64_content = file_base64,
                description="test file",
                download_method="base64"
            )
            ## url file
            url_file = FileInfo(
                name = "Your_specific_knowledge.md",
                url = file_obj["url"],
                description="test file",
                download_method="url"
            )
            files=FilesContent(
                files=[base64_file, url_file],
                title="测试文件列表",
                description="包含url下载和base64下载的测试文件列表",
            )
            yield FilesEvent(
                source=self.name,
                content=files.model_dump(),
            )

            # # click event
            # yield MultiModalMessage(
            #         content=[f"The tool: <test1> is running."],
            #         source=self.name,
            #         metadata={"internal": "no", "type": "browser_screenshot"},
            #     ) 
            # # click event
            # png_path = Path(os.path.join(parent_dir_abs_path, 'Your_specific_konwledge.png'))
            # image = Image.from_file(file_path=png_path)
            # yield MultiModalMessage(
            #         content=[f"The tool: <test2> is running.", image],
            #         source=self.name,
            #         metadata={"internal": "no", "type": "browser_screenshot"},
            #     )
            
            # STEP 1: Add new user/handoff messages to the model context
            await self._add_messages_to_context(
                model_context=model_context,
                messages=messages,
            )

            # STEP 2: Update model context with any relevant memory
            for event_msg in await self._update_model_context_with_memory(
                memory=memory,
                model_context=model_context,
                agent_name=agent_name,
            ):
                inner_messages.append(event_msg)
                yield event_msg

            # STEP 3: Run the first inference
            model_result = None
            async for inference_output in self._call_llm(
                model_client=model_client,
                model_client_stream=model_client_stream,
                system_messages=system_messages,
                model_context=model_context,
                workbench=workbench,
                handoff_tools=handoff_tools,
                agent_name=agent_name,
                cancellation_token=cancellation_token,
                output_content_type=output_content_type,
            ):
                if self.is_paused:
                    raise asyncio.CancelledError()
                
                if isinstance(inference_output, CreateResult):
                    model_result = inference_output
                else:
                    # Streaming chunk event
                    yield inference_output

            assert model_result is not None, "No model result was produced."

            # --- NEW: If the model produced a hidden "thought," yield it as an event ---
            if model_result.thought:
                thought_event = ThoughtEvent(content=model_result.thought, source=agent_name)
                yield thought_event
                inner_messages.append(thought_event)

            # Add the assistant message to the model context (including thought if present)
            await model_context.add_message(
                AssistantMessage(
                    content=model_result.content,
                    source=agent_name,
                    thought=getattr(model_result, "thought", None),
                )
            )

            # STEP 4: Process the model output
            async for output_event in self._process_model_result(
                model_result=model_result,
                inner_messages=inner_messages,
                cancellation_token=cancellation_token,
                agent_name=agent_name,
                system_messages=system_messages,
                model_context=model_context,
                workbench=workbench,
                handoff_tools=handoff_tools,
                handoffs=handoffs,
                model_client=model_client,
                model_client_stream=model_client_stream,
                reflect_on_tool_use=reflect_on_tool_use,
                tool_call_summary_format=tool_call_summary_format,
                tool_call_summary_prompt=self._tool_call_summary_prompt,
                output_content_type=output_content_type,
                format_string=format_string,
            ):
                yield output_event

        except asyncio.CancelledError:
            # If the task is cancelled, we respond with a message.
            yield Response(
                chat_message=TextMessage(
                    content="The task was cancelled by the user.",
                    source=self.name,
                    metadata={"internal": "yes"},
                ),
                inner_messages=inner_messages,
            )
        except Exception as e:
            logger.error(f"Error in {self.name}: {e}")
            logger.error(traceback.format_exc())
            # add to chat history
            await model_context.add_message(
                AssistantMessage(
                    content=f"An error occurred while executing the task: {e}",
                    source=self.name
                )
            )
            yield Response(
                chat_message=TextMessage(
                    content=f"An error occurred while executing the task: {e}",
                    source=self.name,
                    metadata={"internal": "no"},
                ),
                inner_messages=inner_messages,
            )
        finally:
            # Cancel the monitor task.
            try:
                monitor_pause_task.cancel()
                await monitor_pause_task
            except asyncio.CancelledError:
                pass

# 创建一个工厂函数，用于并发访问时确保后端使用的Agent实例是隔离的。
async def create_agent(
        api_key: str|None = None, 
        thread_id: str|None = None, 
        user_id: str|None = None, 
        db_manager: DatabaseManager|None = None,
) -> TaskAgent:

    model_client = HepAIChatCompletionClient(
        model="deepseek-ai/deepseek-v3.2",
    )

    # Create assistant agent with ChromaDB memory
    assistant_agent = TaskAgent(
        name="assistant_agent",
        system_message="""Your are a helpful assistant""",
        description="一个高能物理BESIII实验分析软件BOSS8的一个问答助手",
        model_client=model_client,
        model_client_stream=True,
        model_context=BufferedChatCompletionContext(buffer_size = 20), # 限制最多20条消息,
        thread_id=thread_id,
        db_manager=db_manager,
        user_id=user_id,
    )

    return assistant_agent

async def agent_event_output():
    agent_event = await create_agent()
    
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


if __name__ == "__main__":
    # asyncio.run(agent_event_output())
    asyncio.run(
        run_worker(
            # 智能体注册信息
            agent_name="Task_Assistant",
            author = "xiongdb@ihep.ac.cn",
            permission='groups: drsai, payg; users: admin, xiongdb@ihep.ac.cn, ddf_free, yqsun@ihep.ac.cn; owner: xiongdb@ihep.ac.cn',
            description = "一个任务系统的问答助手",
            version = "0.1.0",
            logo="https://aiapi.ihep.ac.cn/apiv2/files/file-8572b27d093f4e15913bebfac3645e20/preview",
            # 智能体实体
            agent_factory=create_agent, 
            # 后端服务配置
            port = 42850, 
            no_register=False,
            # enable_openwebui_pipeline=True, 
            # pipelines_dir="/home/xiongdb/drsai/examples/agent_groupchat/assistant_ragflow/pipelines/",
            history_mode = "backend",
            # use_api_key_mode = "backend",
        )
    )