"""
EdgeAgent User Profile Manager Module
用户画像与文件管理模块

管理EdgeAgent的用户特定文件结构:
work_dir/{user_id}/configs/
├── AGENTS.md            # 统一系统提示词 (System + User Profile + Skills + Tools prefs)
├── MEMORY.md            # 智能体笔记摘要 (由 CuratedMemoryStore 管理)
├── USER_CONFIG.json     # 结构化用户配置 (user_name, agent_name, ask_before_plan)
├── TOOLS_CONFIG.json    # 工具配置
├── SUBAGENT_CONFIG.json # 子智能体配置
├── THREAD_CONFIG.json   # 线程配置
├── SCHEDULED_TASKS.json # 定时任务
└── skills/              # 用户学习到的 skills
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
    管理用户画像、记忆、技能和偏好设置的文件管理器
    """

    def __init__(
            self, 
            agent_name: str,
            work_dir: str | Path,
            user_id: str,
            thread_id: str,
            ):
        """
        Args:
            work_dir: 工作目录根路径 (Agent Internal Storage)
            user_id: 用户唯一标识
            thread_id: 会话ID
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
        self.agents_md = self.config_path / "AGENTS.md" # 统一系统提示词：System + User Profile + Skills + Tools
        self.subagent_config_path = self.config_path / "SUBAGENT_CONFIG.json" # 子智能体配置
        self.memorie_path = self.config_path / "MEMORY.md" # 智能体笔记摘要 (由 CuratedMemoryStore 管理)
        self.skills_dir = self.config_path / "skills" # 用户的所有skills
        self.tools_config_path = self.config_path / "TOOLS_CONFIG.json" # 工具配置
        self.user_config_path = self.config_path / "USER_CONFIG.json" # 结构化用户配置
        self.thread_config_path = self.config_path / "THREAD_CONFIG.json" # Thread级别的配置（如默认子智能体）
            
        # user's user profile
        self.first_time_setup = True
        if self.agents_md.exists():
            self.first_time_setup = False

        # 初始化文件
        self._initialize_files()

    def _initialize_files(self):
        """初始化所有必要的文件"""
 
        if not self.user_config_path.exists():
            self._create_user_config()
            self.user_config = self.load_user_config()
        else:
            self.user_config = self.load_user_config()
        self.agent_name = self.user_config.agent_name
        self.user_name = self.user_config.user_name

        if not self.tools_config_path.exists():
            with self.tools_config_path.open("w", encoding='utf-8') as f:
                json.dump([], f, indent=4, ensure_ascii=False)

        if not self.agents_md.exists():
            self._create_agents_md()
        
        if not self.subagent_config_path.exists():
            with self.subagent_config_path.open("w", encoding='utf-8') as f:
                json.dump({}, f, indent=4, ensure_ascii=False)

        if not self.thread_config_path.exists():
            with self.thread_config_path.open("w", encoding='utf-8') as f:
                json.dump({}, f, indent=4, ensure_ascii=False)
        
        if not self.skills_dir.exists():
            self.skills_dir.mkdir(exist_ok=True)

        # 定时任务相关路径
        self.scheduled_tasks_path = self.config_path / "SCHEDULED_TASKS.json"
        if not self.scheduled_tasks_path.exists():
            with self.scheduled_tasks_path.open("w", encoding='utf-8') as f:
                json.dump({}, f, indent=4, ensure_ascii=False)

    def _create_user_config(self):
        """创建用户配置文件"""
        
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

    def _create_agents_md(self):
        """创建统一的 AGENTS.md — 直接包含 System + User Profile + Skills + Tools 偏好
        """
        content = f"""# System

You are an interactive tool that helps users with software engineering and scientific data analysis tasks. In addition to these tasks, you should provide educational insights about user's task along the way.

## Workflow
1. Receive user task → Analyze if planning is needed
2. If planning needed → Generate plan → Get user approval
3. Execute tasks:
   - Use `TodoWrite` to track multi-step work progress
   - Use `Skill` tool IMMEDIATELY when a task matches a skill description
   - Use `Delegate` tool to dispatch long-running subtasks (e.g. reading large files, complex code exploration, multi-file refactoring) to sub-agents
   - Prefer tools over prose — act, don't just explain
4. When reading code/files: prioritize `run_grep` for keyword searches → then `run_read`-related functions; avoid reading entire files first
5. For long-running tasks: stop polling after 2 rounds, remind user to schedule a task
6. Record all actions, tool calls, errors in session memory
7. Learn from execution → Save skills if requested by user
8. Handle errors → Request user help if blocked
9. After finishing, summarize what changed

## Proactive Memory Management
MEMORY.md is your persistent notebook across sessions — it survives process restarts and is injected into your system prompt at the start of every new session. Use it to **proactively learn** about the user, their projects, and lessons from past work.

### What belongs in MEMORY.md
- **User preferences & working style** — what they care about, what annoys them, coding conventions they enforce
- **Project context** — architecture, key file locations, non-obvious dependencies, deployment steps
- **Bug fixes & lessons learned** — root cause + fix approach for non-trivial issues (not "changed a typo")
- **Important task outcomes** — what was accomplished, what remains, key decisions made
- **User feedback & corrections** — "don't do X", "I prefer Y", "this is wrong because Z"

### When to proactively save to MEMORY.md

| Trigger | Action |
|---------|--------|
| Complex multi-step task completed (especially multi-interaction modifications) | `memory add` — summarize root cause + fix + key files. **Remind user afterwards.** |
| User gives explicit feedback or correction | `memory add` — record the preference/correction |
| Non-trivial bug fix | `memory add` — root cause + fix approach |
| Discovering project convention or architecture that isn't obvious from code | `memory add` — record for future sessions |
| Existing memory entry is outdated or wrong | `memory replace` — update with corrected info |

**After saving, always remind the user:** "I've saved this to memory for future sessions."

### When to save a session summary
- Use `summry_conversation_to_memory` at the end of **complex sessions** (multi-turn tasks, debugging sessions, architecture discussions)
- Include `keywords` (for searchability) and `questions` (natural-language queries that this summary answers)
- Simple single-question sessions don't need a summary

### When to retrieve from memory
- At session start: MEMORY.md content is **auto-injected** into your system prompt — no action needed
- When the user references past work: use `retrieve_from_memory` to search session summaries
- Before adding a new entry: use `memory read` to check for duplicates and stay within the 2200-char limit
- If MEMORY.md is near capacity: use `memory replace` to merge/condense older entries

### MEMORY.md entry format
Each entry should follow this structure:
```
[YYYY-MM-DD] Title: one-line summary. Key files: path1, path2. Fix/approach: brief details.
```
Rules:
- Start with a **date** tag `[YYYY-MM-DD]`
- Keep each entry **under 200 chars** when possible (hard limit ~300 chars)
- Reference **file paths + line numbers**, not raw code
- One topic per entry — don't merge unrelated items

### What NOT to save
- Trivial single-file reads, simple Q&A, routine tool calls
- Duplicate or near-duplicate entries (merge instead)
- Raw code snippets (reference file paths + line numbers instead)
- Sensitive data (API keys, passwords, tokens)

# User Profile

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

## Environment Setup

### Agent Internal Storage (OpenDrSai Workspace)
This is where OpenDrSai stores its own internal configuration and data. **This is NOT the user's project directory.**

#### Root Directory
    - {self.work_dir}

#### Configuration Files
    - {self.config_path}/AGENTS.md            # This file — unified system prompt
    - {self.config_path}/MEMORY.md            # Agent notes (managed by CuratedMemoryStore)
    - {self.config_path}/SUBAGENT_CONFIG.json  # Subagent settings
    - {self.config_path}/TOOLS_CONFIG.json     # Tool configuration
    - {self.config_path}/USER_CONFIG.json      # Structured user settings
    - {self.config_path}/THREAD_CONFIG.json    # Thread-level config
    - {self.config_path}/SCHEDULED_TASKS.json  # Scheduled tasks
    - {self.config_path}/skills/              # User's learned skills

### Temporary & Download Directories
    - {self.tmp_dir}        # For code generation/testing
    - {self.download_dir}   # For downloaded files

**Important Usage Rules:**
- **User's Project Files:** User's code, config, and project files are NOT in the Agent Internal Storage above. They are in the user's project directory (injected via system prompt).
- **OpenDrSai Internal Files:** The "Agent Internal Storage" is for OpenDrSai's own configuration. Don't modify files there unless explicitly asked.
- **File Operations:** Download files to the Download Directory. Generate and test code in the Temporary Directory.
"""
        self.agents_md.write_text(content, encoding='utf-8')

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
        安全地更新用户配置并写入文件。

        同时同步更新 AGENTS.md 中的 ``# User Profile`` section 里的
        Basic Information 字段（user_name, agent_name），保持结构化
        配置与系统提示词一致。

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

            # 写入 USER_CONFIG.json
            self.user_config_path.write_text(
                updated_config.model_dump_json(indent=4, ensure_ascii=False),
                encoding='utf-8'
            )
            self.user_config = updated_config

            self.agent_name = updated_config.agent_name
            self.user_name = updated_config.user_name

            # 同步更新 AGENTS.md 中的 User Profile Basic Information
            self._sync_agents_md_profile(updated_config)

            logger.info(f"Successfully updated user config for {self.user_id}")
            return f"Successfully updated user config for {self.user_id}"

        except Exception as e:
            logger.error(f"Failed to update user config: {e}")
            return f"Failed to update user config: {e}"

    def _sync_agents_md_profile(self, config: UserProfile) -> None:
        """同步结构化配置到 AGENTS.md 的 User Profile section。

        更新 AGENTS.md 中 ``## Basic Information`` 下的 user_name 和
        agent_name 行，使系统提示词与 USER_CONFIG.json 保持一致。
        其余 User Profile 内容（Preferences 等）保持不变。
        """
        try:
            content = self.agents_md.read_text(encoding='utf-8')
            lines = content.split('\n')
            updated_lines = []
            for line in lines:
                stripped = line.strip()
                if stripped.startswith('- **User Name:**'):
                    updated_lines.append(f'- **User Name:** {config.user_name}')
                elif stripped.startswith('- **What does the user call you:**'):
                    updated_lines.append(f'- **What does the user call you:** {config.agent_name}')
                else:
                    updated_lines.append(line)
            self.agents_md.write_text('\n'.join(updated_lines), encoding='utf-8')
        except Exception as e:
            logger.error(f"Failed to sync AGENTS.md profile: {e}")

    def load_user_tools_config(self) -> dict:
        from drsai.config.tool_registry import list_tool_resources, public_tool_config, resolve_tool_config

        return [
            {
                "tool_id": resource.tool_id, "type": resource.type,
                "config": (
                    resolve_tool_config(resource.config, self.config_path)
                    if resource.type in {"mcp-std", "mcp-sse", "mcp-http"}
                    else public_tool_config(resource.config)
                ),
                "name": resource.name, "enabled": resource.enabled, "source": resource.source,
            }
            for resource in list_tool_resources(self.config_path)
        ]
    
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
            if skill_file.exists():
                with skill_file.open("a", encoding='utf-8') as f:
                    f.write("\n" + skill_content)
            else:
                skill_file.write_text(skill_content, encoding='utf-8')

            logger.info(f"Saved skill '{skill_name}' to {skill_file}")
            return str(skill_file)
        except Exception as e:
            logger.error(f"Failed to save skill: {e}")
            return ""

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

    def load_thread_config(self, thread_id: str) -> dict:
        """
        加载特定thread的配置
        Args:
            thread_id: 会话ID
        Returns:
            thread配置字典
        """
        try:
            thread_configs = json.loads(self.thread_config_path.read_text(encoding='utf-8'))
            return thread_configs.get(thread_id, {})
        except Exception as e:
            logger.error(f"Failed to load thread config: {e}")
            return {}

    def save_thread_config(self, thread_id: str, config: dict):
        """
        保存特定thread的配置
        Args:
            thread_id: 会话ID
            config: 配置字典
        """
        try:
            thread_configs = json.loads(self.thread_config_path.read_text(encoding='utf-8'))
            thread_configs[thread_id] = config
            self.thread_config_path.write_text(
                json.dumps(thread_configs, indent=4, ensure_ascii=False),
                encoding='utf-8'
            )
            logger.info(f"Saved thread config for {thread_id}")
        except Exception as e:
            logger.error(f"Failed to save thread config: {e}")

    def get_default_subagent(self, thread_id: str) -> str | None:
        """
        获取指定thread的默认子智能体
        Args:
            thread_id: 会话ID
        Returns:
            子智能体名称，如果没有设置则返回None
        """
        thread_config = self.load_thread_config(thread_id)
        return thread_config.get("default_subagent")

    def set_default_subagent(self, thread_id: str, subagent_name: str):
        """
        设置指定thread的默认子智能体
        Args:
            thread_id: 会话ID
            subagent_name: 子智能体名称
        """
        thread_config = self.load_thread_config(thread_id)
        thread_config["default_subagent"] = subagent_name
        thread_config["updated_at"] = datetime.now().isoformat()
        self.save_thread_config(thread_id, thread_config)
        logger.info(f"Set default subagent for thread {thread_id}: {subagent_name}")

    def clear_default_subagent(self, thread_id: str):
        """
        清除指定thread的默认子智能体设置
        Args:
            thread_id: 会话ID
        """
        thread_config = self.load_thread_config(thread_id)
        if "default_subagent" in thread_config:
            del thread_config["default_subagent"]
            thread_config["updated_at"] = datetime.now().isoformat()
            self.save_thread_config(thread_id, thread_config)
            logger.info(f"Cleared default subagent for thread {thread_id}")

    def save_scheduled_task(self, task_data: dict) -> str:
        """
        保存或更新定时任务配置
        Args:
            task_data: 任务配置字典 (ScheduledTask.model_dump())
        Returns:
            task_id
        """
        try:
            tasks = json.loads(self.scheduled_tasks_path.read_text(encoding='utf-8'))
            task_id = task_data["task_id"]
            tasks[task_id] = task_data
            self.scheduled_tasks_path.write_text(
                json.dumps(tasks, indent=4, ensure_ascii=False),
                encoding='utf-8'
            )
            logger.info(f"Saved scheduled task {task_id} for user {self.user_id}")
            return task_id
        except Exception as e:
            logger.error(f"Failed to save scheduled task: {e}")
            raise

    def get_scheduled_tasks(self, session_id: Optional[str] = None) -> List[dict]:
        """
        获取当前用户的定时任务列表
        Args:
            session_id: 可选,过滤指定 session 的任务
        Returns:
            任务配置字典列表
        """
        try:
            tasks = json.loads(self.scheduled_tasks_path.read_text(encoding='utf-8'))
            result = list(tasks.values())
            if session_id:
                result = [t for t in result if t.get("session_id") == session_id]
            return result
        except Exception as e:
            logger.error(f"Failed to get scheduled tasks: {e}")
            return []

    def delete_scheduled_task(self, task_id: str) -> bool:
        """
        删除定时任务配置
        Args:
            task_id: 任务ID
        Returns:
            是否删除成功
        """
        try:
            tasks = json.loads(self.scheduled_tasks_path.read_text(encoding='utf-8'))
            if task_id not in tasks:
                return False
            del tasks[task_id]
            self.scheduled_tasks_path.write_text(
                json.dumps(tasks, indent=4, ensure_ascii=False),
                encoding='utf-8'
            )
            logger.info(f"Deleted scheduled task {task_id} for user {self.user_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to delete scheduled task: {e}")
            return False

    def update_scheduled_task_field(self, task_id: str, **fields) -> bool:
        """
        局部更新任务字段 (如 last_run, next_run, status 等)
        Args:
            task_id: 任务ID
            **fields: 要更新的字段
        Returns:
            是否更新成功
        """
        try:
            tasks = json.loads(self.scheduled_tasks_path.read_text(encoding='utf-8'))
            if task_id not in tasks:
                return False
            tasks[task_id].update(fields)
            self.scheduled_tasks_path.write_text(
                json.dumps(tasks, indent=4, ensure_ascii=False),
                encoding='utf-8'
            )
            return True
        except Exception as e:
            logger.error(f"Failed to update scheduled task field: {e}")
            return False

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
