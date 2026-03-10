from pathlib import Path
import venv
import asyncio, os

from drsai.modules.components.model_client import  HepAIChatCompletionClient, ModelFamily
from drsai.modules.components.model_client.anthropic import (
    HepAIAnthropicChatCompletionClient,
    get_info,
    get_token_limit,
    _MODEL_INFO
)
from drsai.modules.components.model_context import DrSaiChatCompletionContext
from drsai.modules.agents.skills_agent import SkillAgent, DrSaiAssistant
from drsai.modules.baseagent import (
    DockerCommandLineCodeExecutor,
    LocalCommandLineCodeExecutor,
    CodeBlock
)
from drsai.modules.managers.database import DatabaseManager
from drsai.modules.managers.messages import (
    ModelClientStreamingChunkEvent,
    TextMessage,)

from pdf_manual_search import PDFManualSearcher

from dotenv import load_dotenv
load_dotenv()

llm_mode_config = {
    "claude-sonnet-4-6(High)":"anthropic/claude-sonnet-4-6",
    "claude-haiku-4-5(Fast)":"anthropic/claude-haiku-4-5",
    "minimax-m2.5": "minimax/minimax-m2.5",
    "minimax-m2.5-highspeed": "minimax/minimax-m2.5-highspeed",
    "gpt-4o": "openai/gpt-4o",
    "gpt-4.1": "openai/gpt-4.1",
    "gpt-5.2": "openai/gpt-5.2",
    "deepseek-r1(No image)": "deepseek-ai/deepseek-r1",
    "deepseek-v3.2(No image)": "deepseek-ai/deepseek-v3.2",
}

async def pdf_manual_search(
        question: str,
        max_items: int = 5,
        similarity_threshold: float = 0.2,
) -> str:
    """
    该函数通过匹配输入问题相近的文档目录及其对应的文件markdown文件位置，帮助进行下一步文档的仔细阅读
    Arguments:
        question: The question to search for.
        max_items: The maximum number of items to return.
        similarity_threshold: The similarity threshold for filtering results.
    """
    RAGFLOW_URL = os.getenv('RAGFLOW_URL')
    RAGFLOW_TOKEN = os.getenv('RAGFLOW_TOKEN')
    DATASET_ID = os.getenv("MANUAL_DATASET_ID")

    searcher = PDFManualSearcher(
        rag_flow_url=RAGFLOW_URL,
        rag_flow_token=RAGFLOW_TOKEN,
        dataset_id=DATASET_ID,
    )

    results = await searcher.search(
        question=question,
        page_size=max_items,
        similarity_threshold=similarity_threshold,
    )
    
    return searcher.format_results(results, is_detailed=True)

def create_agent(
        api_key: str|None = None, 
        thread_id: str|None = None, 
        user_id: str|None = None, 
        db_manager: DatabaseManager|None = None,
        defult_config_name: str|None = "claude-haiku-4-5",
) -> DrSaiAssistant:
    
    # Define a model client. You can use other model client that implements
    # the `ChatCompletionClient` interface.

    llm_model = llm_mode_config.get(defult_config_name, "openai/gpt-4o")
    if "claude" in llm_model:
        model_client = HepAIAnthropicChatCompletionClient(
            # model="claude-haiku-4-5",
            # model="claude-sonnet-4-6",
            model=llm_model,
            base_url="https://aiapi.ihep.ac.cn/apiv2/anthropic",
            api_key=api_key or os.environ.get("HEPAI_API_KEY"),
            model_info=_MODEL_INFO["claude-sonnet-4-5"],
            # temperature=0.5,
            max_tokens=60000,
        )
    else:
        is_vision = True
        if "deepseek" in llm_model:
            is_vision = False
        model_client = HepAIChatCompletionClient(
            # model="openai/gpt-4o",
            model=llm_model,
            api_key= api_key or os.environ.get("HEPAI_API_KEY"),
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

    # Code executor and working directory
    WORKDIR=os.getenv("WORKDIR")
    work_dir = Path(WORKDIR)
    work_dir.mkdir(exist_ok=True)
    venv_dir = work_dir / ".venv"
    venv_builder = venv.EnvBuilder(with_pip=True)
    venv_builder.create(venv_dir)
    venv_context = venv_builder.ensure_directories(venv_dir)
    local_executor = LocalCommandLineCodeExecutor(work_dir=work_dir, virtual_env_context=venv_context)

    #Agent skills 
    # skills_loader = SkillLoader(skills_dir=os.getenv("SKILLS_DIR"))

    # Sub-agents configuration
    SUB_AGENTS = {
        "explore": {
            "type": "DrSaiAgent",
            "description": "Read-only agent for exploring code, finding files, searching",
            "tools": ["run_bash", "run_read"],
            "prompt": "You are an exploration agent. Search and analyze, but never modify files. Return a concise summary.",
        },
        "coder": {
            "type": "DrSaiAgent",
            "description": "Full agent for writing codes, implementing features and fixing bugs",
            "tools": ["run_bash", "run_read", "run_write", "run_edit"],
            "prompt": """You are a coding agent. Implement the requested changes efficiently. 
If you want to test your code or editting, you must generate a shell script and ask sub agent-coder_executor to execute the code. The style of shell script should be as follows:

```bash

# filename: xxx.sh

your_code

```
""",
        },
        "coder_executor": {
            "type": "CodeExecutorAgent",
            "description": "A computer terminal that performs no other action than running Python scripts (provided to it quoted in ```python code blocks), or sh shell scripts (provided to it quoted in ```sh code blocks).",
            "tools": [],
            "prompt": "A Code Execution Agent that generates and executes Python and shell scripts based on user instructions. Python code should be provided in ```python code blocks, and sh shell scripts should be provided in ```sh code blocks for execution. It ensures correctness, efficiency, and minimal errors while gracefully handling edge cases.",
        },
        "plan": {
            "type": "DrSaiAgent",
            "description": "Planning agent for designing implementation strategies",
            "tools": ["run_bash", "read_file"],
            "prompt": "You are a planning agent. Analyze the codebase and output a numbered implementation plan. Do NOT make changes.",
        },
    }

    # Define an AssistantAgent with the model, tool, system message, and reflection enabled.
    # The system message instructs the agent via natural language.
    
    # SYSTEM = f"""You are a coding agent at {WORKDIR}.

    #     Loop: plan -> act with tools -> report.

    #     **Skills available** (invoke with Skill tool when task matches):
    #     {skills_loader.get_descriptions()}

    #     **Subagents available** (invoke with Task tool for focused subtasks):
    #     {get_agent_descriptions()}

    #     Rules:
    #     - Use Skill tool IMMEDIATELY when a task matches a skill description
    #     - Use Task tool for subtasks needing focused exploration or implementation
    #     - Use TodoWrite to track multi-step work
    #     - Prefer tools over prose. Act, don't just explain.
    #     - After finishing, summarize what changed."""
    
    SYSTEM = f"""You are a personal assistant. **NOTE**, when a user's question pertains to your skills in `Skill` tool, it is imperative to first refer to the relevant skills, for example:
- If the user needs to update the username, system prompts, etc., please be sure to refer to the `user_system_config` skill
- If the user needs to konwledge about the `spec - X-Ray Diffraction Software` , etc., can refer to the `pdf_manual_search` skill
"""

    return DrSaiAssistant(
        name="Assistant",
        model_client=model_client,
        system_message=SYSTEM,
        reflect_on_tool_use=False,
        model_client_stream=True,  # Enable streaming tokens from the model client.
        # model_context=long_memory_context,
        tools=[pdf_manual_search],
        # drsaiAgent specific
        thread_id=thread_id,
        db_manager=db_manager,
        user_id=user_id,
        # skills and executor
        skills_dir=os.getenv("SYSTEM_SKILLS_DIR"),
        executor=local_executor,
        work_dir=WORKDIR,
        only_in_workspace=False,
        sub_agent_config = SUB_AGENTS,
        max_turn_count=20,
        token_limit=50000,
        rag_flow_url=os.getenv('RAGFLOW_URL'),
        rag_flow_token=os.getenv('RAGFLOW_TOKEN'),
        memory_dataset_id=os.getenv('MEMORY_DATASET_ID'),
    )

async def test_agent_backend():

    agent = create_agent(
        thread_id="test_0001",
        user_id="xiongdb@ihep.ac.cn"
    )

    async for message in agent.run_stream(task="spec 控制软件spec中scan和dscan命令的区别是什么？"):
        if isinstance(message, ModelClientStreamingChunkEvent):
            print(message.content, end="", flush=True)
        else:
            print(message)

if __name__ == "__main__":
    from drsai.backend import run_worker, DrSaiAPP, run_console

    # asyncio.run(test_agent_backend())

    # asyncio.run(run_console(agent_factory=create_agent, task="What skills u have?"))
    # asyncio.run(run_console(agent_factory=create_agent, task="I want to write a python script to print hello world and run it in a shell. please plan before executing"))

    asyncio.run(
        run_worker(
            # 智能体注册信息
            agent_name="DrSaiAssistant",
            author = "xiongdb@ihep.ac.cn",
            # permission='groups: drsai, payg; users: admin, xiongdb@ihep.ac.cn, ddf_free, yqsun@ihep.ac.cn; owner: xiongdb@ihep.ac.cn',
            permission={
                "groups": "drsai, payg", 
                "users": ["admin", "xiongdb@ihep.ac.cn", ], 
                "owner": "xiongdb@ihep.ac.cn"
                },
            description = "A general assistant for PDF QA,writing code, implementing features, and fixing bugs.",
            version = "0.1.0",
            logo="https://aiapi.ihep.ac.cn/apiv2/files/file-8572b27d093f4e15913bebfac3645e20/preview",
            examples=[
                "What skills u have?",
                "spec 控制软件spec中scan和dscan命令的区别是什么？",
                "I want to write a python script to print hello world and run it in a shell. please plan before executing",
            ],
            agent_config = llm_mode_config,
            defult_config_name="claude-haiku-4-5",
            # 智能体实体
            agent_factory=create_agent, 
            # 后端服务配置
            port = 42810, 
            no_register=False,
            enable_openwebui_pipeline=True, 
            history_mode = "backend",
            # use_api_key_mode = "backend",
            join_topics = ["test"],
            metadata={"others": "test"},
        )
    )

    # format_results = asyncio.run(
    #    pdf_manual_search(question="spec 控制软件spec中scan和dscan命令的区别是什么？")
    # )
    # print(format_results)