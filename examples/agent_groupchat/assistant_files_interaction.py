from drsai import CancellationToken
from drsai.modules.baseagent import DrSaiAgent
from drsai.modules.components.model_client import HepAIChatCompletionClient
from drsai.modules.managers.database import DatabaseManager
from drsai.modules.managers.messages import TextMessage
from drsai.backend import run_worker, DrSaiAPP, run_console
import os, json, sys
import asyncio
current_file_abs_path = os.path.abspath(__file__)
parent_dir_abs_path = os.path.dirname(current_file_abs_path)
import base64
from drsai.utils.utils import upload_to_hepai_filesystem

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
    
# Create a factory function to ensure isolated Agent instances for concurrent access.
def create_agent(
        api_key: str|None = None, 
        thread_id: str|None = None, 
        user_id: str|None = None, 
        db_manager: DatabaseManager|None = None
) -> DrSaiAgent:
    
    # Define a model client. You can use other model client that implements
    # the `ChatCompletionClient` interface.
    model_client = HepAIChatCompletionClient(
        # model="deepseek-ai/deepseek-r1",
        model="openai/gpt-4o",
        api_key=api_key or os.environ.get("HEPAI_API_KEY"),
        base_url="https://aiapi.ihep.ac.cn/apiv2",
    )

    # Define an AssistantAgent with the model, tool, system message, and reflection enabled.
    # The system message instructs the agent via natural language.
    return DrSaiAgent(
        name="weather_agent",
        model_client=model_client,
        system_message="You are a helpful assistant.",
        reflect_on_tool_use=False,
        model_client_stream=True,  # Enable streaming tokens from the model client.
        thread_id=thread_id,
        db_manager=db_manager,
        user_id=user_id,
    )

async def test_files_interaction():

    file_base64, file_obj = get_knowledge_base64_and_url()
    attached_files = [
        {
            "name": "Your_specific_knowledge.md",
            "type": "text",
            "size": 0,
            "url": "",
            "base64": file_base64
        },
        {
            "name": "Your_specific_knowledge.md2",
            "type": "text",
            "size": 0,
            "url": file_obj["url"],
            "base64": ""
        }
    ]
    attached_files_json = json.dumps(attached_files)
    task = [
        TextMessage(
            source="user",
            content="hi",
            metadata={"attached_files": attached_files_json},
        )
    ]
    agent = create_agent()

    async for message in agent.run_stream(
        task=task,
    ):
        print(message)


if __name__ == "__main__":
    asyncio.run(test_files_interaction())

