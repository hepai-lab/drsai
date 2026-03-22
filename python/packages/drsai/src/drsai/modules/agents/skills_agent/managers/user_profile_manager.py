"""
EdgeAgent User Profile Manager Module
用户画像与文件管理模块

管理EdgeAgent的用户特定文件结构:
work_dir/{user_id}/
├── AGENTS.md        # 用户画像和智能体配置
├── Memories/        # 按时间列表储存的记忆(按session组织)
├── Skills.md        # 任务执行历史总结
├── skills/          # 学习到的skills
├── TOOLS.md         # 工具使用偏好
└── USER.md          # 用户画像描述
"""

from pathlib import Path
from typing import Dict, List, Optional, Any
import json
from datetime import datetime
from loguru import logger
from pydantic import BaseModel
from drsai.modules.components.tool import (
    ToolSchema,
    ParametersSchema,
    )

class UserProfile(BaseModel):
    """用户画像数据模型"""
    user_id: str
    user_name: str
    agent_name: Optional[str] = None
    ask_before_plan: bool = False
    created_at: str = ""
    updated_at: str = ""

class TaskStep(BaseModel):
    """单个任务步骤的记录"""
    step_index: int
    step_title: str
    tool_or_skill_used: Optional[str] = None
    action_details: str
    result: str
    error: Optional[str] = None


class SessionMemory(BaseModel):
    """
    会话级别的记忆 - 对应一次完整的用户任务会话
    包含任务规划、执行过程、工具调用、错误修正等完整信息
    """
    session_id: str  # 对应 thread_id
    user_id: str
    start_time: str
    end_time: Optional[str] = None

    # 任务信息
    original_user_request: str  # 用户原始请求
    task_plan: Optional[Dict[str, Any]] = None  # 任务规划结果
    needs_plan: bool = False  # 是否需要规划

    # 执行过程
    execution_steps: List[TaskStep] = []  # 按顺序记录每个步骤

    # 工具和技能使用记录
    tools_used: List[str] = []
    skills_loaded: List[str] = []
    subagents_spawned: List[str] = []

    # 结果和学习
    final_result: Optional[str] = None
    errors_encountered: List[Dict[str, Any]] = []  # 错误及修正过程
    learned_patterns: List[str] = []  # 从本次任务学到的模式

    # 用户反馈
    user_feedback: Optional[Dict[str, Any]] = None

class UserProfileManager:
    """
    管理EdgeAgent用户画像、记忆、技能和偏好设置的文件管理器
    """

    def __init__(
            self, 
            agent_name: str,
            work_dir: str | Path,
            user_id: str,
            thread_id: str,
            user_config: UserProfile | None = None,
            ):
        """
        Args:
            work_dir: 工作目录根路径
            user_id: 用户唯一标识
        """
        
        self.agent_name = agent_name
        self.user_name = user_id
        self.work_dir = Path(work_dir)
        self.work_dir.mkdir(exist_ok=True)
        self.tmp_dir = self.work_dir / "tmp"
        self.tmp_dir.mkdir(exist_ok=True)
        self.download_dir = self.work_dir / "downloads"
        self.download_dir.mkdir(exist_ok=True)
        self.config_path = self.work_dir / "configs"
        self.config_path.mkdir(exist_ok=True)
        self.user_id = user_id
        self.thread_id = thread_id

        # 定义各个文件路径
        self.agents_md = self.config_path / "AGENTS.md" # 整体的系统提示词：用户画像和智能体配置
        self.subagent_config_path = self.config_path / "SUBAGENT_CONFIG.json" # 子智能体配置
        self.memorie_path = self.config_path / "MEMORY.md" # 用户近期的记忆
        self.memories_dir = self.config_path / "memories" # 用户所有的记忆文件
        self.memories_document_ids = self.memories_dir / "document_ids.json" # 记录每个记忆文件的RAGFlow文档ID
        self.skills_md = self.config_path / "SKILLS.md" # 调用技能描述，目前未用
        self.skills_dir = self.config_path / "skills" # 用户的所有
        self.tools_md = self.config_path / "TOOLS.md" # 用户的工作环境配置
        self.tools_config_path = self.config_path / "TOOLS_CONFIG.json" # 工具配置
        self.user_md = self.config_path / "USER.md" # 用户的个人描述
        self.user_config_path = self.config_path / "USER_CONFIG.json" # 用户配置
            
        # user's user profile
        self.first_time_setup = True
        if self.agents_md.exists():
            self.first_time_setup = False

        if not self.first_time_setup:
            self.user_config = self.load_user_config()
        elif user_config:
            self.user_config = user_config
        else:
            self.user_config = None

        # 初始化文件
        self._initialize_files()

    def _initialize_files(self):
        """初始化所有必要的文件"""
 
        if not self.user_config_path.exists():
            self._create_user_config()
        self.agent_name = self.user_config.agent_name
        self.user_name = self.user_config.user_name

        if not self.user_md.exists():
            self._create_user_md()

        if not self.tools_md.exists():
            self._create_tools_md()
        
        if not self.tools_config_path.exists():
            with self.tools_config_path.open("w", encoding='utf-8') as f:
                json.dump([], f, indent=4, ensure_ascii=False)

        if not self.skills_md.exists():
            self._create_skills_md()
        
        if not self.agents_md.exists():
            self._create_agents_md()
        
        if not self.subagent_config_path.exists():
            with self.subagent_config_path.open("w", encoding='utf-8') as f:
                json.dump({}, f, indent=4, ensure_ascii=False)
        
        # 创建目录
        if not self.memories_dir.exists():
            self.memories_dir.mkdir(exist_ok=True)
            with self.memories_document_ids.open("w", encoding='utf-8') as f:
                json.dump({}, f, indent=4, ensure_ascii=False)

        if not self.skills_dir.exists():
            self.skills_dir.mkdir(exist_ok=True)

    def _create_user_config(self):
        """创建用户配置文件"""
        
        if not self.user_config:
            self.user_config = UserProfile(
                user_id=self.user_id,
                user_name=self.user_id,
                agent_name=self.agent_name,
                ask_before_plan=False,
                created_at=datetime.now().isoformat(),
                updated_at=datetime.now().isoformat(),
            )
        with self.user_config_path.open("w", encoding='utf-8') as f:
            json.dump(self.user_config.model_dump(), f, indent=4, ensure_ascii=False)

    def _create_user_md(self):
        """创建USER.md文件"""
        content = f"""# User Profile: {self.user_name}

## Basic Information
- **User ID:** {self.user_id}
- **User Name:** {self.user_name}
- **What does the user call you:** {self.agent_name}
- **Pronouns:** *(optional)*
- **Timezone:** 
- **Notes:** 

## Preferences

*(What do they care about? What projects are they working on? What annoys them? What makes them laugh? Build this over time.)*

[User preferences and the agent's response style. To be filled based on user interactions]

---

The more you know, the better you can help. But remember — you're learning about a person, not building a dossier. Respect the difference.

"""
        self.user_md.write_text(content, encoding='utf-8')

    def _create_tools_md(self):
        """创建TOOLS.md文件"""
        content = f"""# Tool Preferences for User: {self.user_id}

## Environment Setup

### Working Directory: 
    - {self.work_dir}

### Temporary Directory
    - {self.tmp_dir}

### Download Directory
    - {self.download_dir}

### Congiguration Files
    - {self.config_path}/AGENTS.md
    - {self.config_path}/SUBAGENT_CONFIG.json
    - {self.config_path}/SKILLS.md
    - {self.config_path}/TOOLS.md
    - {self.config_path}/TOOLS_CONFIG.json
    - {self.config_path}/USER.md
    - {self.config_path}/USER_CONFIG.json

### Personal Skills and Memory dirs: 
    - {self.config_path}/skills
    - {self.config_path}/memories

### SSH setup: 
    - home-server → 192.168.1.100, user: admin

## Usage Preferences
[To be learned from user interactions]

## Frequently Used Tools and Skills
[To be tracked automatically]

**Note:** 

- Remember to perform operations such as downloading files in the Download Directory, and avoid interfering with the contents of other configured files.
"""
        self.tools_md.write_text(content, encoding='utf-8')

    def _create_agents_md(self):
        """创建AGENTS.md文件"""

        user_md = self.get_user_profile()
        tools_md = self.get_tools_preferences()

        content = f"""# {self.agent_name} Configuration for User: {self.user_name}

## Agent Capabilities

Your name is {self.agent_name} with the following capabilities:

1. **Task Planning & Decomposition**: Analyze user requirements and decompose into executable subtasks
2. **Multi-task Progress Management**: Automatically update task status to prevent information loss
3. **Tool & Skills Invocation**: Proactively load tools, agent skills, and spawn subagents
4. **Learning & Adaptation**: Summarize task execution patterns and save as reusable skills

**Note:** - When the user performs a non-greeting task fisrtly, attempt to retrieve relevant memories using the `retreve_from_memory` tool. 
- If the memory content is relevant, prioritize using the memory content for the reply and inform the user of the time when the memory was recorded, among other information. 
- If the memory content is not relevant, proceed with the following rules.

## Rules:

- Use Skill tool IMMEDIATELY when a task matches a skill description
- Use Task tool for subtasks needing focused exploration or implementation
- Use TodoWrite to track multi-step work
- Prefer tools over prose. Act, don't just explain.
- After finishing, summarize what changed.

## Workflow
1. Receive user task → Analyze if planning is needed
2. If planning needed → Generate plan → Get user approval
3. Execute tasks with progress tracking (TodoManager)
4. Record all actions, tool calls, errors in current session memory
5. Learn from execution → Save skills if requested by user
6. Handle errors → Request user help if blocked


{user_md}

{tools_md}
"""
        self.agents_md.write_text(content, encoding='utf-8')
    
    def _create_skills_md(self):
        """创建Skills.md文件"""
        content = f"""# Learned Skills for User: {self.user_id}

## Task Execution History Summary
[This file summarizes successful task execution patterns]

## Available Custom Skills
[Skills are stored in skills/ directory with SKILL.md format]

## Created: {datetime.now().isoformat()}
## Updated: {datetime.now().isoformat()}
"""
        self.skills_md.write_text(content, encoding='utf-8')

    def get_agent_system_prompt(self) -> str:
        """
        获取AGENTS.md作为系统提示词的一部分
        Returns:
            AGENTS.md的内容
        """
        try:
            return self.agents_md.read_text(encoding='utf-8')
        except Exception as e:
            logger.error(f"Failed to read AGENTS.md: {e}")
            return ""
    
    def load_subagents_config(self) -> dict:
        subagent_config_data = json.loads(self.subagent_config_path.read_text(encoding='utf-8'))
        return subagent_config_data
    
    def load_user_config(self) -> UserProfile:
        config_data = json.loads(self.user_config_path.read_text(encoding='utf-8'))
        return UserProfile(**config_data)

    def get_update_user_profile_tool(strict: bool = False) -> ToolSchema:
        parameters: ParametersSchema = {
            "type": "object",
            "properties": {
                "items": {
                    "type": "array",
                    "minItems": 1,
                    "description": "A list of configuration updates to apply in a single request.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "update_type": {
                                "type": "string",
                                "enum": ["agent", "user", "tool"],
                                "description": (
                                    "The target configuration to update. "
                                    "`agent` updates system/agent instructions, "
                                    "`user` updates user profile settings, "
                                    "`tool` updates tool preferences."
                                ),
                            }
                        },
                        "required": ["update_type"],
                        "additionalProperties": False,
                    },
                }
            },
            "required": ["items"],
            "additionalProperties": False,
        }

        tool_schema: ToolSchema = {
            "name": "UpdateUserProfile",
            "description": (
                "Apply one or more configuration updates in a single call. "
                "Each update specifies its target type (agent, user, or tool) "
            ),
            "parameters": parameters,
            "strict": strict,
        }
        return tool_schema
    
    def get_user_profile(self) -> str:
        """
        获取用户画像信息
        Returns:
            USER.md的内容
        """
        try:
            return self.user_md.read_text(encoding='utf-8')
        except Exception as e:
            logger.error(f"Failed to read USER.md: {e}")
            return ""

    def update_user_profile(self, content: str):
        """
        更新用户画像
        Args:
            content: 新的用户画像内容
        """
        try:
            self.user_md.write_text(content, encoding='utf-8')
            logger.info(f"Updated USER.md for {self.user_id}")
        except Exception as e:
            logger.error(f"Failed to update USER.md: {e}")

    def get_user_config_tool(self, strict: bool = False,) -> ToolSchema:
        """
        Update user profile configuration file based on user requirements, including assistant name, user name, interests, and preferences.

        Args:
            user_name: str  User's name
            agent_name: str  Assistant's name
            ask_before_plan: bool  Whether to show plan before execution
        """
        parameters = ParametersSchema(
            type="object",
            properties={
                "user_name": {
                    "type": "string",
                    "description": "User's name for personalized addressing"
                },
                "agent_name": {
                    "type": "string",
                    "description": "Assistant's name as preferred by the user"
                },
                "ask_before_plan": {
                    "type": "boolean",
                    "description": "Whether to show the plan and ask for user approval before executing complex tasks"
                },
            },
            required=[],  # All fields are optional, allowing partial updates
            additionalProperties=False,
        )
        tool_schema = ToolSchema(
            name="UpdateUserConfig",
            description="""Update user profile configuration including name, and assistant settings.

Use this tool when the user wants to:
- Change their name or how they want to be addressed
- Update the assistant's name
- Configure whether to ask before planning tasks

You can update one or multiple fields at once. Only provide the fields that need to be updated.""",
            parameters=parameters,
            strict=strict,
        )
        return tool_schema
    
    def update_user_config(self, **kwargs) -> str:
        """
        安全地更新用户配置并写入文件

        Args:
            **kwargs: 要更新的UserProfile字段，只接受UserProfile模型中定义的字段

        Raises:
            ValueError: 当传入无效字段、值无效或user_config未初始化时
            IOError: 当文件写入失败时
        """
        if self.user_config is None:
            raise ValueError("User config is not initialized")

        try:
            # 使用model_copy并自动添加updated_at
            kwargs['updated_at'] = datetime.now().isoformat()
            updated_config = self.user_config.model_copy(update=kwargs)

            # 写入文件并更新内存中的配置
            self.user_config_path.write_text(
                updated_config.model_dump_json(indent=4, ensure_ascii=False),
                encoding='utf-8'
            )
            self.user_config = updated_config

            self.agent_name = updated_config.agent_name
            self.user_name = updated_config.user_name

            logger.info(f"Successfully updated user config for {self.user_id}")
            return f"Successfully updated user config for {self.user_id}"

        except Exception as e:
            logger.error(f"Failed to update user config: {e}")
            # raise
            return f"Failed to update user config: {e}"

    def load_user_tools_config(self) -> dict:
        tools_config_data = json.loads(self.tools_config_path.read_text(encoding='utf-8'))
        return tools_config_data
    
    def get_tools_preferences(self) -> str:
        """
        获取工具偏好
        Returns:
            TOOLS.md的内容
        """
        try:
            return self.tools_md.read_text(encoding='utf-8')
        except Exception as e:
            logger.error(f"Failed to read TOOLS.md: {e}")
            return ""

    def update_tools_preferences(self, content: str):
        """
        更新工具偏好
        Args:
            content: 新的工具偏好内容
        """
        try:
            self.tools_md.write_text(content, encoding='utf-8')
            logger.info(f"Updated TOOLS.md for {self.user_id}")
        except Exception as e:
            logger.error(f"Failed to update TOOLS.md: {e}")


    def save_learned_skill(self, skill_name: str, skill_content: str) -> str:
        """
        保存学习到的skill
        Args:
            skill_name: skill名称
            skill_content: skill内容(应该是SKILL.md格式)
        Returns:
            保存的文件路径
        """
        try:
            skill_dir = self.skills_dir / skill_name
            skill_dir.mkdir(exist_ok=True)

            skill_file = skill_dir / "SKILL.md"
            skill_file.write_text(skill_content, encoding='utf-8')

            # 更新Skills.md
            self._update_skills_summary(skill_name)

            logger.info(f"Saved skill '{skill_name}' to {skill_file}")
            return str(skill_file)
        except Exception as e:
            logger.error(f"Failed to save skill: {e}")
            return ""

    def _update_skills_summary(self, skill_name: str):
        """更新Skills.md,添加新的skill记录"""
        try:
            content = self.skills_md.read_text(encoding='utf-8')
            timestamp = datetime.now().isoformat()
            new_entry = f"\n## {skill_name}\n- Added: {timestamp}\n- Location: skills/{skill_name}/SKILL.md\n"

            # 在文件末尾添加新条目
            content += new_entry
            self.skills_md.write_text(content, encoding='utf-8')
        except Exception as e:
            logger.error(f"Failed to update skills summary: {e}")

    def update_agents_config(self, new_content: str):
        """
        更新AGENTS.md配置
        Args:
            new_content: 新的配置内容
        """
        try:
            self.agents_md.write_text(new_content, encoding='utf-8')
            logger.info(f"Updated AGENTS.md for {self.user_id}")
        except Exception as e:
            logger.error(f"Failed to update AGENTS.md: {e}")

    def save_session_memory(self, session_memory: list[dict]):
        """
        保存会话记忆到Memories/目录
        Args:
            session_memory: list[dict]
        Returns:
            保存的文件路径
        """
        
        try:
            filename = f"session_{self.thread_id}.json"
            filepath = self.memories_dir / filename
            filepath.write_text(
                json.dumps(session_memory, indent=4, ensure_ascii=False),
                encoding='utf-8'
            )
            logger.info(f"Saved session memory to {filepath}")
            return str(filepath)
        except Exception as e:
            logger.error(f"Failed to save session memory: {e}")
    
    def update_document_ids(self, thread_id: str, document_id: str):
         
        memories_document_ids = json.loads(self.memories_document_ids.read_text(encoding='utf-8'))
        memories_document_ids[thread_id] = document_id
        self.memories_document_ids.write_text(
            json.dumps(memories_document_ids, indent=4, ensure_ascii=False),
            encoding='utf-8'
        )
    
    def get_document_ids(self, thread_id: str) -> str|None:
        """
        获取document_id
        Args:
            thread_id: 会话ID
        Returns:
            document_id
        """
        memories_document_ids = json.loads(self.memories_document_ids.read_text(encoding='utf-8'))
        return memories_document_ids.get(thread_id)

    # def create_session_memory(
    #     self,
    #     session_id: str,
    #     user_request: str,
    #     needs_plan: bool = False
    # ) -> SessionMemory:
    #     """
    #     创建一个新的会话记忆对象
    #     Args:
    #         session_id: 会话ID (对应thread_id)
    #         user_request: 用户原始请求
    #         needs_plan: 是否需要任务规划
    #     Returns:
    #         SessionMemory对象
    #     """
    #     return SessionMemory(
    #         session_id=session_id,
    #         user_id=self.user_id,
    #         start_time=datetime.now().isoformat(),
    #         original_user_request=user_request,
    #         needs_plan=needs_plan
    #     )

    # def save_session_memory(self, memory: SessionMemory) -> str:
    #     """
    #     保存会话记忆到Memories/目录
    #     Args:
    #         memory: SessionMemory对象
    #     Returns:
    #         保存的文件路径
    #     """
    #     try:
    #         timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    #         filename = f"session_{timestamp}_{memory.session_id}.json"
    #         filepath = self.memories_dir / filename

    #         filepath.write_text(
    #             memory.model_dump_json(indent=2),
    #             encoding='utf-8'
    #         )
    #         logger.info(f"Saved session memory to {filepath}")
    #         return str(filepath)
    #     except Exception as e:
    #         logger.error(f"Failed to save session memory: {e}")
    #         return ""

    # def load_session_memory(self, session_id: str) -> Optional[SessionMemory]:
    #     """
    #     加载指定session的记忆
    #     Args:
    #         session_id: 会话ID
    #     Returns:
    #         SessionMemory对象,如果不存在返回None
    #     """
    #     try:
    #         # 查找包含session_id的文件
    #         memory_files = list(self.memories_dir.glob(f"session_*_{session_id}.json"))
    #         if not memory_files:
    #             return None

    #         # 取最新的一个
    #         latest_file = sorted(memory_files, reverse=True)[0]
    #         content = json.loads(latest_file.read_text(encoding='utf-8'))
    #         return SessionMemory(**content)
    #     except Exception as e:
    #         logger.error(f"Failed to load session memory: {e}")
    #         return None

    # def search_memories(
    #     self,
    #     keywords: Optional[List[str]] = None,
    #     limit: int = 5
    # ) -> List[SessionMemory]:
    #     """
    #     搜索历史会话记忆
    #     Args:
    #         keywords: 搜索关键词列表
    #         limit: 返回结果数量限制
    #     Returns:
    #         SessionMemory对象列表
    #     """
    #     try:
    #         memories = []
    #         memory_files = sorted(
    #             self.memories_dir.glob("session_*.json"),
    #             reverse=True
    #         )[:limit * 2]  # 获取更多文件以便过滤

    #         for file in memory_files:
    #             try:
    #                 content = json.loads(file.read_text(encoding='utf-8'))
    #                 memory = SessionMemory(**content)

    #                 # 如果没有关键词,直接添加
    #                 if not keywords:
    #                     memories.append(memory)
    #                 else:
    #                     # 检查关键词是否在用户请求、任务步骤或结果中
    #                     searchable_text = f"{memory.original_user_request} "
    #                     searchable_text += " ".join([step.action_details for step in memory.execution_steps])
    #                     if memory.final_result:
    #                         searchable_text += f" {memory.final_result}"

    #                     if any(kw.lower() in searchable_text.lower() for kw in keywords):
    #                         memories.append(memory)

    #                 if len(memories) >= limit:
    #                     break
    #             except Exception as e:
    #                 logger.warning(f"Failed to load memory {file}: {e}")
    #                 continue

    #         return memories
    #     except Exception as e:
    #         logger.error(f"Failed to search memories: {e}")
    #         return []

    # def get_recent_memories(self, count: int = 5) -> List[SessionMemory]:
    #     """
    #     获取最近的会话记忆
    #     Args:
    #         count: 返回数量
    #     Returns:
    #         SessionMemory对象列表
    #     """
    #     return self.search_memories(limit=count)

    # def get_all_user_context(self) -> str:
    #     """
    #     获取所有用户上下文信息的摘要
    #     Returns:
    #         包含所有关键信息的字符串
    #     """
    #     context = []

    #     # AGENTS配置
    #     agents_content = self.get_agent_system_prompt()
    #     if agents_content:
    #         context.append("=== Agent Configuration ===")
    #         context.append(agents_content)

    #     # 用户画像
    #     user_content = self.get_user_profile()
    #     if user_content:
    #         context.append("\n=== User Profile ===")
    #         context.append(user_content)

    #     # 工具偏好
    #     tools_content = self.get_tools_preferences()
    #     if tools_content:
    #         context.append("\n=== Tool Preferences ===")
    #         context.append(tools_content)

    #     # 最近的记忆(简要)
    #     recent_memories = self.get_recent_memories(count=3)
    #     if recent_memories:
    #         context.append("\n=== Recent Session Memories (Last 3) ===")
    #         for mem in recent_memories:
    #             context.append(f"- Session {mem.session_id} [{mem.start_time}]:")
    #             context.append(f"  User Request: {mem.original_user_request[:150]}...")
    #             if mem.final_result:
    #                 context.append(f"  Result: {mem.final_result[:100]}...")
    #             context.append(f"  Tools Used: {', '.join(mem.tools_used)}")
    #             if mem.learned_patterns:
    #                 context.append(f"  Learned: {', '.join(mem.learned_patterns)}")

    #     return "\n".join(context)


# if __name__ == "__main__":
#     # 测试代码
#     manager = UserProfileManager("/tmp/test_edgeagent", "test_user_001")

#     # 测试创建会话记忆
#     session_memory = manager.create_session_memory(
#         session_id="thread_12345",
#         user_request="请帮我分析这个数据文件,提取关键信息并生成报告",
#         needs_plan=True
#     )

#     # 模拟添加任务规划
#     session_memory.task_plan = {
#         "needs_plan": True,
#         "steps": [
#             {"title": "读取数据文件", "details": "使用read工具读取文件内容"},
#             {"title": "数据分析", "details": "调用数据分析子智能体"},
#             {"title": "生成报告", "details": "整合结果并生成文字报告"}
#         ]
#     }

#     # 模拟添加执行步骤
#     session_memory.execution_steps.append(TaskStep(
#         step_index=0,
#         step_title="读取数据文件",
#         tool_or_skill_used="run_read",
#         action_details="读取文件 data.csv, 共1000行",
#         result="成功读取数据"
#     ))

#     session_memory.tools_used = ["run_read", "run_bash"]
#     session_memory.skills_loaded = ["data_analysis_basics"]
#     session_memory.end_time = datetime.now().isoformat()
#     session_memory.final_result = "任务完成,报告已生成"

#     # 保存会话记忆
#     manager.save_session_memory(session_memory)

#     # 测试搜索记忆
#     memories = manager.search_memories(keywords=["数据", "分析"])
#     print(f"Found {len(memories)} session memories")

#     # 测试获取完整上下文
#     context = manager.get_all_user_context()
#     print(context[:500])
