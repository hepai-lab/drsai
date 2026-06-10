"""
EdgeAgent Long-term Memory Manager
长期记忆管理模块

整合:
1. UserProfileManager - 管理本地文件存储的记忆
2. DrSaiChatCompletionContext - 管理当前会话的上下文压缩
3. 提供记忆检索和学习功能
"""

from typing import List, Optional, Dict, Any
from pathlib import Path
from loguru import logger

from drsai.modules.components.model_context import ChatCompletionContext
from drsai.modules.baseagent import UserMessage
from .user_profile_manager import (
    UserProfileManager,
    SessionMemory,
    TaskStep,
)


class LongTermMemoryManager:
    """
    长期记忆管理器

    职责:
    1. 管理当前会话的SessionMemory对象
    2. 在会话结束时保存记忆到本地文件
    3. 在需要时检索历史记忆辅助任务规划
    4. 支持从成功任务中学习并保存为skills
    """

    def __init__(
        self,
        user_profile_manager: UserProfileManager,
        model_context: ChatCompletionContext,
        session_id: str,
    ):
        """
        Args:
            user_profile_manager: 用户配置管理器
            model_context: 模型上下文(用于管理当前会话)
            session_id: 当前会话ID (thread_id)
        """
        self.user_profile_manager = user_profile_manager
        self.model_context = model_context
        self.session_id = session_id

        # 当前会话的记忆对象
        self.current_session_memory: Optional[SessionMemory] = None

        # 尝试加载已存在的会话记忆
        self._load_or_create_session_memory()

    def _load_or_create_session_memory(self):
        """加载或创建当前会话的记忆对象"""
        # 尝试加载
        existing_memory = self.user_profile_manager.load_session_memory(self.session_id)

        if existing_memory:
            self.current_session_memory = existing_memory
            logger.info(f"Loaded existing session memory for {self.session_id}")
        else:
            # 创建新的(等待用户请求后初始化)
            self.current_session_memory = None
            logger.info(f"Will create new session memory for {self.session_id}")

    def start_session(self, user_request: str, needs_plan: bool = False):
        """
        开始新会话或更新会话信息

        Args:
            user_request: 用户请求
            needs_plan: 是否需要任务规划
        """
        if self.current_session_memory is None:
            self.current_session_memory = self.user_profile_manager.create_session_memory(
                session_id=self.session_id,
                user_request=user_request,
                needs_plan=needs_plan,
            )
            logger.info(f"Started new session memory for {self.session_id}")
        else:
            # 更新已有会话的信息
            if not self.current_session_memory.original_user_request:
                self.current_session_memory.original_user_request = user_request
            self.current_session_memory.needs_plan = needs_plan

    def set_task_plan(self, task_plan: Dict[str, Any]):
        """
        设置任务规划

        Args:
            task_plan: 任务规划字典
        """
        if self.current_session_memory:
            self.current_session_memory.task_plan = task_plan
            logger.info(f"Set task plan with {len(task_plan.get('steps', []))} steps")

    def add_execution_step(
        self,
        step_index: int,
        step_title: str,
        tool_or_skill_used: Optional[str],
        action_details: str,
        result: str,
        error: Optional[str] = None,
    ):
        """
        添加执行步骤记录

        Args:
            step_index: 步骤索引
            step_title: 步骤标题
            tool_or_skill_used: 使用的工具或技能
            action_details: 操作详情
            result: 执行结果
            error: 错误信息(如果有)
        """
        if not self.current_session_memory:
            logger.warning("Cannot add execution step: session not started")
            return

        step = TaskStep(
            step_index=step_index,
            step_title=step_title,
            tool_or_skill_used=tool_or_skill_used,
            action_details=action_details,
            result=result,
            error=error,
        )

        self.current_session_memory.execution_steps.append(step)

        # 更新工具/技能使用记录
        if tool_or_skill_used:
            if tool_or_skill_used not in self.current_session_memory.tools_used:
                self.current_session_memory.tools_used.append(tool_or_skill_used)

    def record_tool_usage(self, tool_name: str):
        """记录工具使用"""
        if self.current_session_memory and tool_name not in self.current_session_memory.tools_used:
            self.current_session_memory.tools_used.append(tool_name)

    def record_skill_loaded(self, skill_name: str):
        """记录加载的skill"""
        if self.current_session_memory and skill_name not in self.current_session_memory.skills_loaded:
            self.current_session_memory.skills_loaded.append(skill_name)

    def record_subagent_spawned(self, agent_type: str):
        """记录调用的子智能体"""
        if self.current_session_memory and agent_type not in self.current_session_memory.subagents_spawned:
            self.current_session_memory.subagents_spawned.append(agent_type)

    def add_error_record(self, error_info: Dict[str, Any]):
        """
        记录错误及修正过程

        Args:
            error_info: 错误信息字典,应包含 {type, message, step, solution}
        """
        if self.current_session_memory:
            self.current_session_memory.errors_encountered.append(error_info)

    def set_final_result(self, result: str):
        """
        设置最终结果

        Args:
            result: 最终结果描述
        """
        if self.current_session_memory:
            from datetime import datetime
            self.current_session_memory.final_result = result
            self.current_session_memory.end_time = datetime.now().isoformat()

    def add_learned_pattern(self, pattern: str):
        """
        添加学到的模式/经验

        Args:
            pattern: 学到的模式描述
        """
        if self.current_session_memory:
            self.current_session_memory.learned_patterns.append(pattern)

    def save_current_session(self) -> str:
        """
        保存当前会话记忆到文件

        Returns:
            保存的文件路径
        """
        if not self.current_session_memory:
            logger.warning("No session memory to save")
            return ""

        filepath = self.user_profile_manager.save_session_memory(self.current_session_memory)
        logger.info(f"Saved current session memory to {filepath}")
        return filepath

    async def retrieve_relevant_memories(
        self,
        keywords: List[str],
        limit: int = 3,
    ) -> List[SessionMemory]:
        """
        检索相关的历史记忆

        Args:
            keywords: 搜索关键词
            limit: 返回数量限制

        Returns:
            相关的SessionMemory列表
        """
        memories = self.user_profile_manager.search_memories(keywords=keywords, limit=limit)
        logger.info(f"Retrieved {len(memories)} relevant memories for keywords: {keywords}")
        return memories

    async def inject_relevant_memories_to_context(
        self,
        keywords: List[str],
        limit: int = 2,
    ):
        """
        检索相关记忆并注入到当前上下文中

        Args:
            keywords: 搜索关键词
            limit: 返回数量限制
        """
        memories = await self.retrieve_relevant_memories(keywords, limit)

        if memories:
            memory_text = "=== Relevant Historical Memories ===\n\n"
            for i, mem in enumerate(memories, 1):
                memory_text += f"**Memory {i}** (Session: {mem.session_id}):\n"
                memory_text += f"- Task: {mem.original_user_request}\n"
                memory_text += f"- Approach: {mem.plan_summary if mem.task_plan else 'Direct execution'}\n"
                memory_text += f"- Tools Used: {', '.join(mem.tools_used)}\n"
                if mem.learned_patterns:
                    memory_text += f"- Key Learnings: {'; '.join(mem.learned_patterns)}\n"
                memory_text += "\n"

            # 将记忆作为UserMessage添加到上下文
            await self.model_context.add_message(
                UserMessage(
                    content=memory_text,
                    source="memory_system"
                )
            )
            logger.info(f"Injected {len(memories)} memories into context")

    async def learn_from_session_and_save_skill(
        self,
        skill_name: str,
        skill_description: str,
    ) -> str:
        """
        从当前会话学习并保存为skill

        Args:
            skill_name: skill名称
            skill_description: skill描述

        Returns:
            保存的skill文件路径
        """
        if not self.current_session_memory:
            logger.warning("No session memory to learn from")
            return ""

        # 构建SKILL.md内容
        skill_content = f"""---
name: {skill_name}
description: {skill_description}
---

# {skill_name}

## Task Context
This skill was learned from session: {self.current_session_memory.session_id}

Original User Request:
{self.current_session_memory.original_user_request}

## Approach

"""
        # 添加任务规划
        if self.current_session_memory.task_plan:
            skill_content += "### Task Breakdown\n"
            steps = self.current_session_memory.task_plan.get('steps', [])
            for i, step in enumerate(steps, 1):
                skill_content += f"{i}. **{step.get('title', 'Step')}**: {step.get('details', '')}\n"
            skill_content += "\n"

        # 添加工具和技能使用
        if self.current_session_memory.tools_used:
            skill_content += "### Tools & Skills Used\n"
            for tool in self.current_session_memory.tools_used:
                skill_content += f"- {tool}\n"
            skill_content += "\n"

        # 添加关键步骤
        if self.current_session_memory.execution_steps:
            skill_content += "### Key Execution Steps\n"
            for step in self.current_session_memory.execution_steps:
                skill_content += f"**Step {step.step_index + 1}: {step.step_title}**\n"
                skill_content += f"- Tool/Skill: {step.tool_or_skill_used or 'N/A'}\n"
                skill_content += f"- Action: {step.action_details}\n"
                skill_content += f"- Result: {step.result}\n"
                if step.error:
                    skill_content += f"- Error Handled: {step.error}\n"
                skill_content += "\n"

        # 添加学到的经验
        if self.current_session_memory.learned_patterns:
            skill_content += "### Key Learnings\n"
            for pattern in self.current_session_memory.learned_patterns:
                skill_content += f"- {pattern}\n"
            skill_content += "\n"

        # 添加错误处理经验
        if self.current_session_memory.errors_encountered:
            skill_content += "### Error Handling\n"
            for error in self.current_session_memory.errors_encountered:
                skill_content += f"- **{error.get('type', 'Error')}**: {error.get('message', '')}\n"
                if error.get('solution'):
                    skill_content += f"  Solution: {error['solution']}\n"
            skill_content += "\n"

        # 保存skill
        filepath = self.user_profile_manager.save_learned_skill(skill_name, skill_content)
        logger.info(f"Learned and saved skill '{skill_name}' from session {self.session_id}")

        # 记录到当前会话
        self.add_learned_pattern(f"Created skill: {skill_name}")

        return filepath

    def get_session_summary(self) -> str:
        """
        获取当前会话的摘要

        Returns:
            会话摘要文本
        """
        if not self.current_session_memory:
            return "No active session"

        summary = f"""### Session Summary ({self.session_id})

**User Request:** {self.current_session_memory.original_user_request}

**Planning:** {'Yes' if self.current_session_memory.needs_plan else 'No'}

**Steps Executed:** {len(self.current_session_memory.execution_steps)}

**Tools Used:** {', '.join(self.current_session_memory.tools_used) if self.current_session_memory.tools_used else 'None'}

**Skills Loaded:** {', '.join(self.current_session_memory.skills_loaded) if self.current_session_memory.skills_loaded else 'None'}

**Errors:** {len(self.current_session_memory.errors_encountered)}

**Status:** {'Completed' if self.current_session_memory.end_time else 'In Progress'}
"""
        return summary


if __name__ == "__main__":
    # 测试代码
    from drsai.modules.components.model_context import BufferedChatCompletionContext

    # 创建测试环境
    user_manager = UserProfileManager("/tmp/test_edgeagent", "test_user_001")
    context = BufferedChatCompletionContext(buffer_size=10)

    memory_manager = LongTermMemoryManager(
        user_profile_manager=user_manager,
        model_context=context,
        session_id="test_session_001",
    )

    # 模拟会话
    memory_manager.start_session(
        user_request="测试数据分析任务",
        needs_plan=True
    )

    memory_manager.set_task_plan({
        "needs_plan": True,
        "steps": [
            {"title": "读取数据", "details": "读取CSV文件"},
            {"title": "数据分析", "details": "计算统计信息"},
        ]
    })

    memory_manager.add_execution_step(
        step_index=0,
        step_title="读取数据",
        tool_or_skill_used="run_read",
        action_details="读取文件test.csv",
        result="成功读取1000行数据"
    )

    memory_manager.set_final_result("任务完成")
    memory_manager.save_current_session()

    print("Memory manager test completed")
    print(memory_manager.get_session_summary())
