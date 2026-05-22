from pathlib import Path
import asyncio, os

from drsai.modules.components.model_client import  HepAIChatCompletionClient, ModelFamily
from drsai.modules.components.model_client.anthropic import (
    HepAIAnthropicChatCompletionClient,
    _MODEL_INFO
)
from drsai.modules.agents.skills_agent import DrSaiAssistant
from drsai.modules.managers.database import DatabaseManager
from drsai.configs.constant import FS_DIR

# HERE = Path(__file__).parent
# fs_dir = Path()
WORKSPACE = Path(FS_DIR) / "workspace"
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

# 高能所内部助手：附加说明可从环境变量追加（多行文本）
IHEP_AGENT_EXTRA_GUIDANCE = (os.getenv("IHEP_AGENT_EXTRA_GUIDANCE") or "").strip()

RAGFLOW_URL=os.getenv('RAGFLOW_URL') or "https://ragflow.ihep.ac.cn"
RAGFLOW_TOKEN=os.getenv('RAGFLOW_TOKEN')
MEMORY_DATASET_ID=os.getenv('MEMORY_DATASET_ID')
SYSTEM_SKILLS_DIR=os.getenv('SYSTEM_SKILLS_DIR')

llm_mode_config = {
    "hepai/minimax-m2.7": ("hepai/minimax-m2.7", 204000),
    "hepai/minimax-m2.7-highspeed": ("hepai/minimax-m2.7-highspeed", 204000),
    "minimax-m2.5": ("minimax/minimax-m2.5", 204000),
    "minimax-m2.5-highspeed": ("minimax/minimax-m2.5-highspeed", 204000),
    "minimax-m2.7": ("minimax/minimax-m2.7", 204000),
    "minimax-m2.7-highspeed": ("minimax/minimax-m2.7-highspeed", 204000),
    "claude-sonnet-4-6": ("anthropic/claude-sonnet-4-6", 200000),
    "claude-haiku-4-5": ("anthropic/claude-haiku-4-5", 200000),
    "claude-opus-4-6": ("anthropic/claude-opus-4-6", 200000),
    "gpt-4o": ("openai/gpt-4o", 128000),
    "gpt-4.1": ("openai/gpt-4.1", 1000000),
    "gpt-5.2": ("openai/gpt-5.2", 1000000),
    "gpt-5.4": ("openai/gpt-5.4", 1000000),
    "deepseek-r1(No image)": ("deepseek-ai/deepseek-r1", 128000),
    "deepseek-v3.2(No image)": ("deepseek-ai/deepseek-v3.2", 128000),
}

def create_agent(
        api_key: str|None = None, 
        thread_id: str|None = None, 
        user_id: str|None = None, 
        db_manager: DatabaseManager|None = None,
        defult_config_name: str|None = "hepai/minimax-m2.7-highspeed",
) -> DrSaiAssistant:
    
    # Define a model client. You can use other model client that implements
    # the `ChatCompletionClient` interface.
    
    def set_model_client(defult_config_name: str|None = "hepai/minimax-m2.7-highspeed") -> HepAIAnthropicChatCompletionClient| HepAIChatCompletionClient:
        llm_model, token_limit = llm_mode_config.get(defult_config_name, "minimax-m2.7-highspeed")
        if ("claude" in llm_model) or ("minimax" in llm_model):
            model_info=_MODEL_INFO["claude-sonnet-4-5"]
            model_info["token_model"] = "claude-3-5-sonnet-20240620"
            model_client = HepAIAnthropicChatCompletionClient(
                model=llm_model,
                base_url="https://aiapi.ihep.ac.cn/apiv2/anthropic",
                api_key=api_key,
                model_info=model_info,
                # temperature=0.5,
                max_tokens=int(token_limit*0.25),
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

    _ihep_internal_core = """你是中国科学院高能物理研究所（高能所/IHEP）的内部办公助手，服务对象主要是所内职工与学生。

**所内事务（务必引导查阅权威渠道，勿编造规章流程）**
当用户询问人事、考勤薪酬、课题经费与报销、采购资产、安全保密、网络账号与信息化、会议室访客班车、研究生培养、图书馆文献、行政办事流程等所内专项问题时：
1. 先简要说明你无法代替官方口径，具体以职能部门与现行文件为准。
2. 给出清晰的可行动指引：应登录哪个系统或访问哪个栏目、联系哪个职能处室（办公室）、工单或咨询电话类型（若你不知道具体分机或网址，不要捏造；说明「请在所内门户搜索关键词或询问本部门综合办」）。
3. 常用查阅方向（按主题举例，实际入口以所内门户/OA 为准）：
   - 规章制度与通知公告：高能所官网公开栏目 + **所内信息门户/协同办公（OA）**
   - ARP、科研项目与经费相关：**ARP / 科研管理系统**（名称以所内为准）
   - 报销与财务制度：**财务处**通知及 OA 指引
   - 人事人才与考勤：**人事处 / 人才办公室**相关栏目
   - IT、邮箱、VPN、软件：**信息化或用户服务**渠道（工单/帮助文档）
   - 文献与文献传递：**图书馆**
   - 本助手挂载的知识检索（若已配置）：**RAGFlow / 知识库** `https://ragflow.ihep.ac.cn` — 适合检索所内文档类材料；仍应与 OA 发布的最新版核对。

回答风格：简洁、条理分明；优先列出「去哪里看 / 找谁办 / 用什么系统」，再用一两句话补充注意事项即可。"""
    SYSTEM = _ihep_internal_core
    if IHEP_AGENT_EXTRA_GUIDANCE:
        SYSTEM = f"{_ihep_internal_core}\n\n**本实例补充说明（运维配置）**\n{IHEP_AGENT_EXTRA_GUIDANCE}"

    defult_config_name = defult_config_name or "hepai/minimax-m2.7-highspeed"
    _, token_limit = llm_mode_config.get(defult_config_name)
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
        # is_powershell=False,
        # skills and executor
        skills_dir=SYSTEM_SKILLS_DIR,
        # executor=local_executor,
        work_dir=WORKDIR,
        only_system_message=False,
        only_in_workspace=False,
        allolow_dangrous_cmd=True,
        allolow_basic_tools=None,
        # extra_work_dirs=[],
        # sub_agent_config = SUB_AGENTS,
        # max_turn_count=200,
        token_limit=int(token_limit*0.7),
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
            agent_name="Your Explorer",
            author = "ihep@ihep.ac.cn",
            permission='groups: "drsai, payg"; users: admin, xiongdb@ihep.ac.cn, ddf_free, yqsun@ihep.ac.cn; owner: xiongdb@ihep.ac.cn',
            # permission={
            #     "groups": "drsai, payg", 
            #     "users": [], 
            #     "owner": "admin"
            #     },
            description = "A personal assistant for you to explore the world.",
            version = "0.1.0",
            logo="https://aiapi.ihep.ac.cn/apiv2/files/file-a510f20c6c9d4443a582ad5b1dcc8f51/preview",
            examples=[
                "/help",
            ],
            agent_config = llm_mode_config,
            defult_config_name="gpt-5.2",
            # 智能体实体
            agent_factory=create_agent, 
            # 后端服务配置
            # controller_address = "http://127.0.0.1:42501",
            port = 42810, 
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