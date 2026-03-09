from drsai.modules.components.model_client import  HepAIChatCompletionClient
from drsai.modules.components.model_client.anthropic import (
    HepAIAnthropicChatCompletionClient,
    get_info,
    get_token_limit,
    _MODEL_INFO
)
from drsai.modules.components.model_context import DrSaiChatCompletionContext
from drsai.modules.agents.skills_agent.assistant_skill import SkillAgent
from drsai.modules.baseagent import (
    DockerCommandLineCodeExecutor,
    LocalCommandLineCodeExecutor,
    CodeBlock
)
from pathlib import Path
import venv
import asyncio, os
from drsai.modules.components.skills import SkillLoader

def create_agent() -> SkillAgent:
    
    # Define a model client. You can use other model client that implements
    # the `ChatCompletionClient` interface.
    model_client = HepAIChatCompletionClient(
        # model="anthropic/claude-sonnet-4-5", # 不能用
        # aliyun/qwen-coder-plus # 没有价格信息
        # model="openai/gpt-5-codex", # 返回为空
        # model="openai/gpt-5.2",
        model="openai/gpt-4o",
        # model="aliyun/qwen3-max-preview",

        api_key=os.environ.get("HEPAI_API_KEY"),
        base_url="https://aiapi.ihep.ac.cn/apiv2",
    )

    async_client = HepAIAnthropicChatCompletionClient(
        model="claude-haiku-4-5",
        base_url="https://aiapi.ihep.ac.cn/apiv2/anthropic",
        api_key=os.environ.get("HEPAI_API_KEY"),
        model_info=_MODEL_INFO["claude-haiku-4-5"],
        temperature=0.5,
        max_tokens=50000,
        )
    
    long_memory_context = DrSaiChatCompletionContext(
        agent_name = "assistant",
        model_client = async_client,
        token_limit = 50000,
    )


    # Code executor and working directory
    WORKDIR="/home/xiongdb/drsai_dev/examples/components/tmp/coding"
    work_dir = Path(WORKDIR)
    work_dir.mkdir(exist_ok=True)
    venv_dir = work_dir / ".venv"
    venv_builder = venv.EnvBuilder(with_pip=True)
    venv_builder.create(venv_dir)
    venv_context = venv_builder.ensure_directories(venv_dir)
    local_executor = LocalCommandLineCodeExecutor(work_dir=work_dir, virtual_env_context=venv_context)

    #Agent skills 
    skills_loader = SkillLoader(skills_dir="/home/xiongdb/drsai_dev/examples/agent_groupchat/assistant_skill/skills")

    # Sub-agents configuration
    SUB_AGENTS = {
        "explore": {
            "description": "Read-only agent for exploring code, finding files, searching",
            "tools": ["run_bash", "run_read"],
            "prompt": "You are an exploration agent. Search and analyze, but never modify files. Return a concise summary.",
        },
        "coder": {
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
            "description": "A computer terminal that performs no other action than running Python scripts (provided to it quoted in ```python code blocks), or sh shell scripts (provided to it quoted in ```sh code blocks).",
            "tools": [],
            "prompt": "A Code Execution Agent that generates and executes Python and shell scripts based on user instructions. Python code should be provided in ```python code blocks, and sh shell scripts should be provided in ```sh code blocks for execution. It ensures correctness, efficiency, and minimal errors while gracefully handling edge cases.",
        },
        "plan": {
            "description": "Planning agent for designing implementation strategies",
            "tools": ["run_bash", "read_file"],
            "prompt": "You are a planning agent. Analyze the codebase and output a numbered implementation plan. Do NOT make changes.",
        },
    }

    # System message for multi-task work
    def get_agent_descriptions() -> str:
        """Generate agent type descriptions for system prompt."""
        return "\n".join(
            f"- {name}: {cfg['description']}"
            for name, cfg in SUB_AGENTS.items()
        )
    
    SYSTEM = f"""You are a coding agent at {WORKDIR}.

        Loop: plan -> act with tools -> report.

        **Skills available** (invoke with Skill tool when task matches):
        {skills_loader.get_descriptions()}

        **Subagents available** (invoke with Task tool for focused subtasks):
        {get_agent_descriptions()}

        Rules:
        - Use Skill tool IMMEDIATELY when a task matches a skill description
        - Use Task tool for subtasks needing focused exploration or implementation
        - Use TodoWrite to track multi-step work
        - Prefer tools over prose. Act, don't just explain.
        - After finishing, summarize what changed."""
    
    # Define an AssistantAgent with the model, tool, system message, and reflection enabled.
    # The system message instructs the agent via natural language.
    return SkillAgent(
        name="Assistant",
        model_client=async_client,
        system_message=SYSTEM,
        reflect_on_tool_use=False,
        model_client_stream=True,  # Enable streaming tokens from the model client.
        model_context=long_memory_context,
        # tools=[],
        skills_loader=skills_loader,
        executor=local_executor,
        work_dir=WORKDIR,
        sub_agent_config = SUB_AGENTS,
    )

if __name__ == "__main__":
    # agent = create_agent()
    from drsai.backend import run_worker, DrSaiAPP, run_console
    # asyncio.run(run_console(agent_factory=create_agent, task="What skills u have?"))
    # asyncio.run(run_console(agent_factory=create_agent, task="I want to write a python script to print hello world and run it in a shell. please plan before executing"))

    asyncio.run(
        run_worker(
            # 智能体注册信息
            agent_name="mini_Skill_Agent",
            author = "xiongdb@ihep.ac.cn",
            permission='groups: drsai, payg; users: admin, xiongdb@ihep.ac.cn, ddf_free, yqsun@ihep.ac.cn; owner: xiongdb@ihep.ac.cn',
            description = "A test agent for Claude_code project.",
            version = "0.1.0",
            logo="https://aiapi.ihep.ac.cn/apiv2/files/file-8572b27d093f4e15913bebfac3645e20/preview",
            examples=[
                "What skills u have?",
                "I want to write a python script to print hello world and run it in a shell. please plan before executing",
            ],
            # 智能体实体
            agent_factory=create_agent, 
            # 后端服务配置
            port = 42812, 
            no_register=False,
            enable_openwebui_pipeline=True, 
            history_mode = "backend",
            # use_api_key_mode = "backend",
            join_topics = ["test"],
            metadata={"others": "test"},
        )
    )