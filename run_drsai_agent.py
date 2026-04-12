from pathlib import Path
import asyncio, os

from drsai.modules.components.model_client import  HepAIChatCompletionClient, ModelFamily
from drsai.modules.components.model_client.anthropic import (
    HepAIAnthropicChatCompletionClient,
    _MODEL_INFO
)
from drsai.modules.agents.skills_agent import DrSaiAssistant
from drsai.modules.managers.database import DatabaseManager

HERE = Path(__file__).parent
WORKSPACE = HERE / "workspace"
WORKSPACE.mkdir(parents=True, exist_ok=True)
DATASET = WORKSPACE / "drsai"
DATASET.mkdir(parents=True, exist_ok=True)
WORKDIR = WORKSPACE / "runs"
WORKDIR.mkdir(parents=True, exist_ok=True)

from dotenv import load_dotenv
load_dotenv()

##########
# ENV
##########

RAGFLOW_URL=os.getenv('RAGFLOW_URL') or "https://ragflow.ihep.ac.cn"
RAGFLOW_TOKEN=os.getenv('RAGFLOW_TOKEN')
MEMORY_DATASET_ID=os.getenv('MEMORY_DATASET_ID')
SYSTEM_SKILLS_DIR=os.getenv('SYSTEM_SKILLS_DIR')

llm_mode_config = {
    "claude-sonnet-4-6": "anthropic/claude-sonnet-4-6",
    "claude-haiku-4-5": "anthropic/claude-haiku-4-5",
    "claude-opus-4-6": "anthropic/claude-opus-4-6",
    "minimax-m2.5": "minimax/minimax-m2.5",
    "minimax-m2.5-highspeed": "minimax/minimax-m2.5-highspeed",
    "minimax-m2.7": "minimax/minimax-m2.7",
    "minimax-m2.7-highspeed": "minimax/minimax-m2.7-highspeed",
    "gpt-4o": "openai/gpt-4o",
    "gpt-4.1": "openai/gpt-4.1",
    "gpt-5.2": "openai/gpt-5.2",
    "gpt-5.4": "openai/gpt-5.4",
    "deepseek-r1(No image)": "deepseek-ai/deepseek-r1",
    "deepseek-v3.2(No image)": "deepseek-ai/deepseek-v3.2",
}

def create_agent(
        api_key: str|None = None, 
        thread_id: str|None = None, 
        user_id: str|None = None, 
        db_manager: DatabaseManager|None = None,
        defult_config_name: str|None = "deepseek-v3.2(No image)",
) -> DrSaiAssistant:
    
    # Define a model client. You can use other model client that implements
    # the `ChatCompletionClient` interface.

    def set_model_client(defult_config_name: str|None = "deepseek-v3.2(No image)") -> HepAIAnthropicChatCompletionClient| HepAIChatCompletionClient:
        llm_model = llm_mode_config.get(defult_config_name, "deepseek-ai/deepseek-v3.2")
        if ("claude" in llm_model) or ("minimax" in llm_model):
            model_client = HepAIAnthropicChatCompletionClient(
                model=llm_model,
                base_url="https://aiapi.ihep.ac.cn/apiv2/anthropic",
                api_key=api_key,
                model_info=_MODEL_INFO["claude-sonnet-4-5"],
                # temperature=0.5,
                max_tokens=60000,
            )
        else:
            is_vision = True
            if "deepseek" in llm_model:
                is_vision = False
            model_client = HepAIChatCompletionClient(
                model=llm_model,
                api_key=api_key,
                base_url="https://aiapi.ihep.ac.cn/apiv2",
                model_info={
                        "vision": is_vision,
                        "function_calling": True,  # You must sure that the model can handle function calling
                        "json_output": True,
                        "structured_output": False,
                        "family": ModelFamily.GPT_41,
                        "multiple_system_messages":True,
                        "token_model": "gpt-4o-2024-11-20", # Default model for token counting
                    }
            )
        
        return model_client

    # Sub-agents configuration
#     SUB_AGENTS = {
#         "coder": {
#             "type": "DrSaiAgent",
#             "description": "Full agent for writing codes, implementing features and fixing bugs",
#             "tools": ["run_bash", "run_read", "run_write", "run_edit"],
#             "prompt": """You are a coding agent. Implement the requested changes efficiently. 
# If you want to test your code or editting, you must generate a shell script and ask sub agent-coder_executor to execute the code. The style of shell script should be as follows:

# ```bash

# # filename: xxx.sh

# your_code

# ```
# """,
#         },
#         "coder_executor": {
#             "type": "CodeExecutorAgent",
#             "description": "A computer terminal that performs no other action than running Python scripts (provided to it quoted in ```python code blocks), or sh shell scripts (provided to it quoted in ```sh code blocks).",
#             "tools": [],
#             "prompt": "A Code Execution Agent that generates and executes Python and shell scripts based on user instructions. Python code should be provided in ```python code blocks, and sh shell scripts should be provided in ```sh code blocks for execution. It ensures correctness, efficiency, and minimal errors while gracefully handling edge cases.",
#         },
#     }

    SUB_AGENTS = {}

    # SYSTEM = f"""You are a personal assistant."""
    SYSTEM = None

    return DrSaiAssistant(
        name="Assistant",
        model_client=set_model_client(defult_config_name),
        system_message=SYSTEM,
        reflect_on_tool_use=False,
        model_client_stream=True,  # Enable streaming tokens from the model client.
        # model_context=long_memory_context,
        # tools=[pdf_manual_search],
        # drsaiAgent specific
        thread_id=thread_id,
        db_manager=db_manager,
        user_id=user_id,
        set_model_client=set_model_client,
        llm_mode_config=llm_mode_config,
        defult_config_name=defult_config_name,
        is_powershell=False,
        # skills and executor
        skills_dir=SYSTEM_SKILLS_DIR,
        # executor=local_executor,
        work_dir=WORKDIR,
        only_in_workspace=False,
        # extra_work_dirs=[],
        # sub_agent_config = SUB_AGENTS,
        # max_turn_count=20,
        token_limit=50000,
        rag_flow_url=RAGFLOW_URL,
        rag_flow_token=RAGFLOW_TOKEN,
        memory_dataset_id=MEMORY_DATASET_ID,
    )

if __name__ == "__main__":
    from drsai.backend import run_worker, DrSaiAPP, run_console
    # asyncio.run(run_console(agent_factory=create_agent, task="What skills u have?"))
    # asyncio.run(run_console(agent_factory=create_agent, task="I want to write a python script to print hello world and run it in a shell. please plan before executing"))

    asyncio.run(
        run_worker(
            # 智能体注册信息
            agent_name="My Dr.Sai",
            author = "xiongdb@ihep.ac.cn",
            # permission='groups: "drsai, payg"; users: admin, xiongdb@ihep.ac.cn, ddf_free, yqsun@ihep.ac.cn; owner: xiongdb@ihep.ac.cn',
            # permission={
            #     "groups": "drsai, payg", 
            #     "users": [], 
            #     "owner": "admin"
            #     },
            description = "专属于您的AI智能体❤",
            version = "0.1.0",
            logo="https://aiapi.ihep.ac.cn/apiv2/files/file-8572b27d093f4e15913bebfac3645e20/preview",
            examples=[
                "/help",
                "你有哪些技能？",
                "我应该如何将openclaw作为我的子智能体？",
                "如何设置定时任务？"
            ],
            agent_config = llm_mode_config,
            defult_config_name="deepseek-v3.2(No image)",
            # 智能体实体
            agent_factory=create_agent, 
            # 后端服务配置
            # controller_address = "http://127.0.0.1:42501",
            port = 42858, 
            no_register=False,
            drsai_dir = DATASET,
            enable_openwebui_pipeline=False, 
            history_mode = "backend",
            # use_api_key_mode = "backend",
            # join_topics = ["drsai-agent"],
            # metadata={"others": "drsai-agent"},
            link_wechat = False,
        )
    )