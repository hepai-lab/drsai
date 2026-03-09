"""
EdgeAgent 使用示例
展示如何使用EdgeAgent进行科学数据分析
"""

import asyncio
from pathlib import Path
import os

from drsai.modules.agents.skills_agent.assistant_learning import EdgeAgent
from drsai.modules.components.model_client import (
    HepAIChatCompletionClient, 
    ModelFamily)
from drsai.modules.components.model_client.anthropic import (
    HepAIAnthropicChatCompletionClient,
    get_info,
    get_token_limit,
    _MODEL_INFO
)
from drsai.modules.components.model_context import BufferedChatCompletionContext
from drsai.modules.baseagent import CodeExecutor, LocalCommandLineCodeExecutor
from drsai.backend import run_worker, run_console
from drsai import CancellationToken


def create_edge_agent() -> EdgeAgent:
    """
    创建EdgeAgent实例

    EdgeAgent特点:
    1. 自动任务规划与用户交互
    2. 多任务进度管理
    3. 智能工具/Skills/子智能体调用
    4. 长期记忆与学习能力
    5. 用户画像管理
    """

    # 模型客户端
    anthropic_client = HepAIAnthropicChatCompletionClient(
        model="claude-haiku-4-5",
        base_url="https://aiapi.ihep.ac.cn/apiv2/anthropic",
        api_key=os.environ.get("HEPAI_API_KEY"),
        model_info=_MODEL_INFO["claude-haiku-4-5"],
        temperature=0.5,
        max_tokens=50000,
        )

    # 上下文管理
    model_context = BufferedChatCompletionContext(buffer_size=20)

    # 代码执行器(用于子智能体)
    executor = LocalCommandLineCodeExecutor(
        work_dir="./workspace",
        timeout=60,
    )

    # 子智能体配置
    sub_agent_config = {
        "data_analyst": {
            "description": "专门用于数据分析任务",
            "prompt": "You are a data analysis expert. Analyze data and provide insights.",
            "tools": "*",  # 可以使用所有工具
        },
        "code_executor": {
            "description": "执行Python代码",
            "prompt": "You are a code execution agent. Execute code safely.",
            "tools": ["run_bash", "run_read", "run_write"],
        },
        "report_generator": {
            "description": "生成报告文档",
            "prompt": "You are a report generator. Create well-formatted reports.",
            "tools": ["run_read", "run_write"],
        },
    }

    # 创建EdgeAgent
    agent = EdgeAgent(
        name="SciDataAgent",
        model_client=anthropic_client,
        model_context=model_context,
        executor=executor,
        sub_agent_config=sub_agent_config,
        system_message="""You are EdgeAgent, a professional scientific data analysis assistant.

Your core capabilities:
1. **Task Planning**: Analyze user requests and create detailed execution plans
2. **Progress Management**: Track task progress with TodoManager
3. **Tool & Skills**: Intelligently load and use tools, skills, and spawn subagents
4. **Learning**: Learn from successful tasks and save as reusable skills
5. **User Profile**: Maintain user-specific preferences and memory

When receiving a task:
- First, analyze if planning is needed
- If yes, create a detailed plan and get user approval
- Execute step by step with clear progress updates
- Handle errors gracefully and request help when blocked
- Save successful workflows as skills when requested
""",
        description="Professional scientific data analysis assistant",
        skills_dir=None,  # Will use user's skills directory automatically
        work_dir=None,  # Will be created automatically based on user_id
        max_turn_count=20,
        model_client_stream=True,
        thread_id="test_thread_001",  # In production, this should be unique per session
        user_id="user_001",  # In production, this should be actual user ID
    )

    return agent


async def test_edge_agent_console():
    """在控制台测试EdgeAgent"""
    agent = create_edge_agent()

    # 测试任务
    task = """
    请帮我分析一个CSV数据文件:
    1. 读取文件内容
    2. 计算基本统计信息(均值、标准差等)
    3. 识别异常值
    4. 生成分析报告

    文件路径: ./data/sample.csv
    """

    print("=== Testing EdgeAgent ===")
    print(f"Task: {task}")
    print("\n" + "=" * 50 + "\n")

    from drsai.backend import Console

    console = Console()
    await console.run(agent_factory=lambda: agent, task=task)


async def test_edge_agent_api():
    """作为API服务运行EdgeAgent"""

    await run_worker(
        # 智能体注册信息
        agent_name="EdgeAgent_SciData",
        author="your_email@example.com",
        permission='groups: drsai; users: admin; owner: your_email@example.com',
        description="专业科学数据智能分析助手 - 支持任务规划、多任务管理、技能学习",
        version="1.0.0",
        examples=[
            "帮我分析这个数据文件并生成报告",
            "处理图像数据并提取特征",
            "执行批量数据转换任务",
        ],
        logo="https://your-logo-url.com/logo.png",

        # 智能体实体
        agent_factory=create_edge_agent,

        # 后端服务配置
        port=42700,
        no_register=False,
        enable_openwebui_pipeline=True,
        history_mode="backend",
        use_api_key_mode="backend",
    )


if __name__ == "__main__":
    # 选择运行模式

    # 模式1: 控制台测试
    # asyncio.run(test_edge_agent_console())

    # 模式2: API服务
    asyncio.run(test_edge_agent_api())
