from pathlib import Path
import asyncio, os
from loguru import logger
from drsai.modules.components.model_client import  HepAIChatCompletionClient, ModelFamily
from drsai.modules.components.model_client.anthropic import (
    HepAIAnthropicChatCompletionClient,
    _MODEL_INFO
)
from drsai.modules.agents.skills_agent import DrSaiAssistant
from drsai.modules.managers.database import DatabaseManager
from drsai.configs.constant import WORKSPACE_DIR, WORKSPACE_RUNS_DIR
from drsai.backend.run_drsai_agent_factory import ModelEntry, ReasoningConfig, DEFAULT_LLM_MODE_CONFIG

# HERE = Path(__file__).parent
# fs_dir = Path()
WORKSPACE = Path(WORKSPACE_DIR)
DATASET = WORKSPACE / "drsai"
DATASET.mkdir(parents=True, exist_ok=True)
WORKDIR = Path(WORKSPACE_RUNS_DIR)

from dotenv import load_dotenv
load_dotenv()

##########
# ENV
##########

RAGFLOW_URL=os.getenv('RAGFLOW_URL') or "https://ragflow.ihep.ac.cn"
RAGFLOW_TOKEN=os.getenv('RAGFLOW_TOKEN')
MEMORY_DATASET_ID=os.getenv('MEMORY_DATASET_ID')
SYSTEM_SKILLS_DIR=os.getenv('SYSTEM_SKILLS_DIR')

def _as_bool(value, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    text = str(value).strip().lower()
    if text in {"1", "true", "yes", "y", "on", "enable", "enabled"}:
        return True
    if text in {"0", "false", "no", "n", "off", "disable", "disabled"}:
        return False
    return default


def _build_gfs_tools(user_id: str | None) -> list:
    """根据环境开关，为指定用户生成 GFS function-calling 工具列表。

    支持两种模式（自动选择，互斥）：

    模式 A — Admin 模式（多用户服务）::

        DRSAI_GFS_ENABLED=true
        GFS_OPENAPI_KEY=<管理员 X-API-Key>

      Worker 持管理员 key，按 ``user_id`` (邮箱) 自动为每个用户拿 AKSK。
      原始用法，向后兼容。

    模式 B — Personal 模式（单用户本地实例）::

        DRSAI_GFS_ENABLED=true
        DRSAI_GFS_MODE=personal           # 显式声明（可选，缺省时按下面的优先级自动判定）
        GFS_ACCESS_KEY=<个人 AK>
        GFS_SECRET_KEY=<个人 SK>
        GFS_BUCKET=<完整桶名 e.g. 20235-xiongdb>
        GFS_USER_EMAIL=<可选，仅日志用>

      用户提供自己的 AKSK，**不需要** ``GFS_OPENAPI_KEY``。
      适合个人本地启动 / 拿不到 admin key 的场景。

    自动判定优先级：
      1. 显式 ``DRSAI_GFS_MODE=personal`` → 走 personal
      2. 显式 ``DRSAI_GFS_MODE=admin``    → 走 admin
      3. 同时配置了个人 AKSK 和 admin key → 走 personal（个人配置更具体）
      4. 仅配置 ``GFS_ACCESS_KEY`` 等     → 走 personal
      5. 其它情况                          → 走 admin

    失败时仅记日志，不抛异常，避免影响 agent 创建。
    """
    if not _as_bool(os.getenv("DRSAI_GFS_ENABLED"), default=False):
        return []

    mode = (os.getenv("DRSAI_GFS_MODE") or "").strip().lower()
    has_personal_creds = bool(
        os.getenv("GFS_ACCESS_KEY")
        and os.getenv("GFS_SECRET_KEY")
        and os.getenv("GFS_BUCKET")
    )

    if mode == "personal":
        use_personal = True
    elif mode == "admin":
        use_personal = False
    else:
        # 自动判定：有完整个人配置就用 personal
        use_personal = has_personal_creds

    try:
        if use_personal:
            from drsai.modules.managers.gfs import make_gfs_tools_personal
            tools = make_gfs_tools_personal(email=user_id or None)
            logger.info(
                f"GFS personal mode enabled: {len(tools)} tools registered "
                f"(user={user_id or 'personal@local'})"
            )
            return tools

        # admin 模式：必须有 user_id
        if not user_id:
            logger.info("GFS admin mode requires user_id; skipping.")
            return []
        from drsai.modules.managers.gfs import make_gfs_tools
        tools = make_gfs_tools(user_id)
        logger.info(
            f"GFS admin mode enabled for user {user_id}: {len(tools)} tools registered"
        )
        return tools
    except ImportError as e:
        logger.warning(f"DRSAI_GFS_ENABLED=true but gfs module import failed: {e}")
        return []
    except Exception as e:
        mode_label = "personal" if use_personal else "admin"
        logger.warning(
            f"GFS tool init failed (mode={mode_label}, user={user_id}): {e}. "
            "Falling back to no GFS."
        )
        return []

llm_mode_config = DEFAULT_LLM_MODE_CONFIG

def create_agent(
        api_key: str|None = None, 
        thread_id: str|None = None, 
        user_id: str|None = None, 
        db_manager: DatabaseManager|None = None,
        defult_config_name: str|None = "hepai/deepseek-v4-flash",
        anthropic_cache_enabled: bool | None = None,
        anthropic_cache_ttl: str | None = None,
        **extra_kwargs
) -> DrSaiAssistant:
    if anthropic_cache_enabled is None:
        anthropic_cache_enabled = _as_bool(os.getenv("DRSAI_ANTHROPIC_CACHE_ENABLED"), default=True)
    if anthropic_cache_ttl is None:
        anthropic_cache_ttl = os.getenv("DRSAI_ANTHROPIC_CACHE_TTL") or "1h"
    anthropic_cache_ttl = str(anthropic_cache_ttl)
    if anthropic_cache_ttl not in {"5m", "1h"}:
        anthropic_cache_ttl = "1h"
    anthropic_cache_control = (
        {"type": "ephemeral", "ttl": anthropic_cache_ttl}
        if anthropic_cache_enabled
        else None
    )
    
    # Define a model client. You can use other model client that implements
    # the `ChatCompletionClient` interface.
    
    def set_model_client(defult_config_name: str|None = "hepai/deepseek-v4-flash") -> HepAIAnthropicChatCompletionClient| HepAIChatCompletionClient:
        entry = llm_mode_config.get(defult_config_name, llm_mode_config["hepai/deepseek-v4-flash"])
        llm_model = entry.model
        token_limit = entry.token_limit
        max_tokens = entry.max_tokens
        if ("claude" in llm_model) or ("minimax" in llm_model):
            model_info = dict(_MODEL_INFO["claude-sonnet-4-5"])
            model_info["token_model"] = "claude-3-5-sonnet-20240620"
            if anthropic_cache_control is not None:
                model_info["anthropic_cache_control"] = anthropic_cache_control
            model_client = HepAIAnthropicChatCompletionClient(
                model=llm_model,
                base_url="https://aiapi.ihep.ac.cn/apiv2/anthropic",
                api_key=api_key,
                model_info=model_info,
                # temperature=0.5,
                max_tokens=max_tokens if max_tokens > 0 else int(token_limit*0.25),
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

    defult_config_name = defult_config_name or "hepai/deepseek-v4-flash"
    entry = llm_mode_config.get(defult_config_name)
    token_limit = entry.token_limit if entry else 64000

    # 可选：为该用户挂 GFS function-calling 工具
    extra_tools = _build_gfs_tools(user_id)

    return DrSaiAssistant(
        name="Assistant",
        model_client=set_model_client(defult_config_name),
        system_message=SYSTEM,
        reflect_on_tool_use=False,
        model_client_stream=True,  # Enable streaming tokens from the model client.
        # model_context=long_memory_context,
        tools=extra_tools or None,
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
            agent_name="My Dr.Sai 007",
            author = "xiongdb@ihep.ac.cn",
            # permission='groups: "drsai, payg"; users: admin, xiongdb@ihep.ac.cn, ddf_free, yqsun@ihep.ac.cn; owner: xiongdb@ihep.ac.cn',
            # permission={
            #     "groups": "drsai, payg", 
            #     "users": [], 
            #     "owner": "admin"
            #     },
            description = '{"en":"Your personal assistant❤","zh":"您的专属AI智能体❤"}',
            version = "0.1.0",
            logo="https://aiapi.ihep.ac.cn/apiv2/files/file-8572b27d093f4e15913bebfac3645e20/preview",
            examples=[
               {
                "en":"/help",
                "zh":"/帮助"
               },
               {
                "en":"/skills",
                "zh":"/技能"
               },
               {
                "en":"/settings",
                "zh":"/设置"
               }
            ],
            agent_config = llm_mode_config,
            defult_config_name="hepai/deepseek-v4-flash",
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