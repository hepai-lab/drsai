"""
EdgeAgent Task Planning Module
任务规划与用户交互模块

负责:
1. 分析用户请求是否需要任务规划
2. 生成任务规划(可选调用Agent Skills或知识库)
3. 与前端用户交互获取计划反馈
4. 支持重新规划
"""

from typing import Dict, List, Optional, Any, AsyncGenerator
from pydantic import BaseModel
from loguru import logger
import json

from drsai.modules.managers.messages import (
    TextMessage,
    ModelClientStreamingChunkEvent,
)
from drsai.modules.components.model_client import ChatCompletionClient
from drsai.modules.components.model_context import ChatCompletionContext
from drsai.modules.baseagent import (
    UserMessage,
    AssistantMessage,
    CreateResult,
)
from autogen_core import CancellationToken


class TaskPlanStep(BaseModel):
    """单个任务步骤"""
    title: str  # 步骤标题
    details: str  # 详细描述
    agent_name: Optional[str] = None  # 执行此步骤的agent名称(如果需要)
    tool_or_skill: Optional[str] = None  # 需要使用的工具或技能


class TaskPlan(BaseModel):
    """任务规划"""
    needs_plan: bool  # 是否需要规划
    response: str  # 对用户的响应
    task: str  # 任务摘要
    plan_summary: str  # 规划摘要
    steps: List[Dict[str, Any]]  # 任务步骤列表


class TaskPlanner:
    """
    任务规划器
    负责分析用户请求、生成任务计划、与用户交互
    """

    def __init__(
        self,
        agent_name: str,
        model_client: ChatCompletionClient,
        skills_description: Optional[str] = None,
        enable_skills_for_planning: bool = True,
    ):
        """
        Args:
            agent_name: Agent名称
            model_client: 模型客户端
            skills_description: 可用的skills描述(用于规划时参考)
            enable_skills_for_planning: 是否在规划时可以调用skills
        """
        self.agent_name = agent_name
        self.model_client = model_client
        self.skills_description = skills_description or ""
        self.enable_skills_for_planning = enable_skills_for_planning

    def get_planning_system_prompt(self, with_skills: bool = False) -> str:
        """
        获取任务规划的系统提示词
        Args:
            with_skills: 是否包含skills信息
        Returns:
            系统提示词
        """
        base_prompt = """You are a task planning expert for scientific data analysis.

Your job is to:
1. Analyze the user's request
2. Determine if task planning is needed (complex multi-step tasks need planning)
3. If planning is needed, decompose the task into clear, executable steps

**When to plan:**
- Multi-step workflows (data processing + analysis + visualization)
- Complex analysis requiring multiple tools/skills
- Tasks needing coordination between different agents

**When NOT to plan:**
- Simple single-step requests (read a file, run a command)
- Direct questions with straightforward answers
- Tasks that are already clear and specific

**Output Format (JSON):**
```json
{
    "needs_plan": true/false,
    "response": "Your analysis and response to user",
    "task": "Brief task summary",
    "plan_summary": "Overview of the approach",
    "steps": [
        {
            "title": "Step 1 title",
            "details": "Detailed description of what to do",
            "agent_name": "AgentName (optional)",
            "tool_or_skill": "tool/skill name (optional)"
        }
    ]
}
```

**Important:**
- Keep steps actionable and specific
- Each step should have a clear outcome
- Consider dependencies between steps
- Mention which tools/skills/agents are needed
"""

        if with_skills and self.skills_description:
            base_prompt += f"""

**Available Agent Skills for Reference:**
{self.skills_description}

You can suggest loading specific skills in the plan if they're relevant.
"""

        return base_prompt

    async def analyze_and_plan(
        self,
        user_request: str,
        model_context: ChatCompletionContext,
        cancellation_token: CancellationToken,
        use_skills_context: bool = False,
    ) -> TaskPlan:
        """
        分析用户请求并生成任务计划

        Args:
            user_request: 用户请求
            model_context: 模型上下文
            cancellation_token: 取消令牌
            use_skills_context: 是否使用skills上下文辅助规划

        Returns:
            TaskPlan对象
        """
        try:
            # 构建规划请求消息
            planning_prompt = f"""User Request: {user_request}

Please analyze this request and provide a task plan in JSON format.
Consider:
1. Is this a complex task that needs planning?
2. What are the main steps required?
3. What tools, skills, or agents are needed?
4. Are there dependencies between steps?

Respond ONLY with valid JSON following the specified format."""

            # 准备消息
            planning_messages = [
                UserMessage(
                    content=self.get_planning_system_prompt(with_skills=use_skills_context),
                    source="system"
                ),
                UserMessage(content=planning_prompt, source="user")
            ]

            # 调用LLM生成计划
            result: CreateResult = await self.model_client.create(
                messages=planning_messages,
                cancellation_token=cancellation_token,
            )

            # 解析结果
            plan_json = self._extract_json_from_response(result.content)
            task_plan = TaskPlan(**plan_json)

            logger.info(f"Generated task plan: needs_plan={task_plan.needs_plan}, "
                       f"steps={len(task_plan.steps)}")

            return task_plan

        except Exception as e:
            logger.error(f"Failed to generate task plan: {e}")
            # 返回一个不需要规划的默认plan
            return TaskPlan(
                needs_plan=False,
                response=f"I'll help you with: {user_request}",
                task=user_request,
                plan_summary="Direct execution without detailed planning",
                steps=[]
            )

    def _extract_json_from_response(self, content: str) -> Dict[str, Any]:
        """
        从LLM响应中提取JSON
        Args:
            content: LLM响应内容
        Returns:
            解析后的JSON字典
        """
        # 尝试直接解析
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            pass

        # 尝试提取代码块中的JSON
        if "```json" in content:
            start = content.find("```json") + 7
            end = content.find("```", start)
            json_str = content[start:end].strip()
            return json.loads(json_str)
        elif "```" in content:
            start = content.find("```") + 3
            end = content.find("```", start)
            json_str = content[start:end].strip()
            return json.loads(json_str)

        # 如果都失败,抛出异常
        raise ValueError(f"Cannot extract JSON from response: {content}")

    async def send_plan_to_user(
        self,
        task_plan: TaskPlan,
        agent_name: str,
    ) -> TextMessage:
        """
        将任务计划发送给用户(前端)

        Args:
            task_plan: TaskPlan对象
            agent_name: Agent名称

        Returns:
            包含计划的TextMessage
        """
        plan_dict = task_plan.model_dump()

        plan_message = TextMessage(
            content=json.dumps(plan_dict, ensure_ascii=False),
            source=agent_name,
            metadata={"internal": "no", "type": "plan_message"},
        )

        logger.info(f"Sent plan to user with {len(task_plan.steps)} steps")
        return plan_message

    def parse_user_feedback(
        self,
        user_message: TextMessage
    ) -> Dict[str, Any]:
        """
        解析用户对计划的反馈

        Args:
            user_message: 用户消息

        Returns:
            包含用户反馈的字典 {accepted: bool, plan: Optional[Dict], feedback: str}
        """
        try:
            # 从metadata中获取用户请求
            user_request = user_message.metadata.get("user_request")
            if not user_request:
                return {"accepted": False, "feedback": "No user feedback found"}

            # 解析用户反馈
            feedback_data = json.loads(user_request)

            result = {
                "accepted": feedback_data.get("accepted", False),
                "plan": feedback_data.get("plan"),  # 修改后的计划
                "feedback": feedback_data.get("feedback", ""),  # 用户的文字反馈
            }

            logger.info(f"Parsed user feedback: accepted={result['accepted']}")
            return result

        except Exception as e:
            logger.error(f"Failed to parse user feedback: {e}")
            return {"accepted": False, "feedback": str(e)}

    async def replan_with_feedback(
        self,
        original_plan: TaskPlan,
        user_feedback: str,
        model_context: ChatCompletionContext,
        cancellation_token: CancellationToken,
    ) -> TaskPlan:
        """
        根据用户反馈重新规划

        Args:
            original_plan: 原始计划
            user_feedback: 用户反馈
            model_context: 模型上下文
            cancellation_token: 取消令牌

        Returns:
            更新后的TaskPlan对象
        """
        try:
            replan_prompt = f"""Original Task Plan:
{json.dumps(original_plan.model_dump(), indent=2, ensure_ascii=False)}

User Feedback:
{user_feedback}

Please revise the task plan based on the user's feedback.
Keep the same JSON format and make appropriate adjustments.

Respond ONLY with valid JSON."""

            # 准备消息
            planning_messages = [
                UserMessage(
                    content=self.get_planning_system_prompt(with_skills=True),
                    source="system"
                ),
                UserMessage(content=replan_prompt, source="user")
            ]

            # 调用LLM重新规划
            result: CreateResult = await self.model_client.create(
                messages=planning_messages,
                cancellation_token=cancellation_token,
            )

            # 解析结果
            plan_json = self._extract_json_from_response(result.content)
            revised_plan = TaskPlan(**plan_json)

            logger.info(f"Revised task plan based on feedback")
            return revised_plan

        except Exception as e:
            logger.error(f"Failed to replan with feedback: {e}")
            # 如果失败,返回原计划
            return original_plan

    async def send_step_execution_status(
        self,
        step_index: int,
        step: Dict[str, Any],
        plan_length: int,
        agent_name: str,
        progress_summary: Optional[str] = None,
    ) -> TextMessage:
        """
        发送当前步骤执行状态给前端

        Args:
            step_index: 步骤索引
            step: 步骤信息
            plan_length: 总步骤数
            agent_name: Agent名称
            progress_summary: 进度摘要

        Returns:
            状态消息
        """
        status_data = {
            "title": step.get("title", f"Step {step_index + 1}"),
            "index": step_index,
            "details": step.get("details", ""),
            "agent_name": step.get("agent_name", agent_name),
            "instruction": step.get("details", ""),
            "progress_summary": progress_summary or f"Executing step {step_index + 1} of {plan_length}",
            "plan_length": plan_length,
        }

        status_message = TextMessage(
            content=json.dumps(status_data, ensure_ascii=False),
            source=agent_name,
            metadata={"internal": "no", "type": "step_execution"},
        )

        logger.info(f"Sent step execution status: step {step_index + 1}/{plan_length}")
        return status_message


if __name__ == "__main__":
    # 简单测试
    import asyncio
    from drsai.modules.components.model_client import HepAIChatCompletionClient, ModelFamily

    async def test_planner():
        # 创建模型客户端
        model_client = HepAIChatCompletionClient(
            model="glm-4-flash",
            model_family=ModelFamily.GLM4,
        )

        # 创建规划器
        planner = TaskPlanner(
            agent_name="TestAgent",
            model_client=model_client,
        )

        # 测试规划
        user_request = "请帮我分析data.csv文件,提取关键统计信息,并生成一个可视化报告"

        from drsai.modules.components.model_context import BufferedChatCompletionContext
        context = BufferedChatCompletionContext(buffer_size=10)

        plan = await planner.analyze_and_plan(
            user_request=user_request,
            model_context=context,
            cancellation_token=CancellationToken(),
        )

        print("Generated Plan:")
        print(f"Needs Plan: {plan.needs_plan}")
        print(f"Task: {plan.task}")
        print(f"Steps: {len(plan.steps)}")
        for i, step in enumerate(plan.steps):
            print(f"  Step {i+1}: {step.get('title')}")

    # asyncio.run(test_planner())
    print("Task planner module created successfully")
