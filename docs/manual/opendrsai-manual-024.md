---
tags: OpenDrSai, 智能体开发实践
---

# OpenDrSai智能体开发实践-Mini Claude code开发

本教程为大家分享如何使用OpenDrSai框架实现具有Agent Skills接入、Subagent、代码执行沙盒、任务管理todo list等相结合的Mini Claude code

案例具体见：https://github.com/hepai-lab/drsai/tree/main/examples/agent_groupchat/assistant_skill

## 1. Agent Skills

### 1.1.什么是Agent Skill

Agent Skill 实际上一种知识外化，最核心的创新是渐进式披露（Progressive Disclosure）机制。这种机制将技能信息分为以下三个层次，智能体按需逐步加载，既确保必要时不遗漏细节，又避免一次性将过多内容塞入上下文窗口

具体结构如下：

```
Layer 1: Metadata（始终在内存中）
         只有 name + description
         ~100 tokens / skill

Layer 2: SKILL.md Body（触发后才加载）
         详细指南、代码示例、决策树
         < 5000 tokens

Layer 3: Resources（按需加载）
         scripts/, references/, assets/
         无限制
```

它的核心是知识的注入，提供决策指导，与MCP等直接展示能力的行为存在较大差异：

| 概念 | 本质 | 作用 | 例子 |
| - | - | - | - |
| Tool（工具） | 模型能做什么 | 执行动作 | bash、read_file、write_file、WebSearch |
| Skill（技能） | 模型知道怎么 |做指导决策 | PDF 处理、MCP 构建、前端设计、代码审查

工具是能力的边界——没有 bash 工具，模型无法执行命令。
技能是知识的注入——没有前端设计 Skill，模型写出的 UI 千篇一律。

因此可以说：

```
通用 Agent + 优秀 Skill = 特定领域的专家 Agent
```

模型能力是基座，Skill 质量决定了这个基座能发挥到什么程度。一个优秀的 Skill，能让通用 Agent 在特定领域的表现超越没有 Skill 加持的更强模型。

### 1.2.如何写好Agent Skill

Anthropic官方和最近爆火的openclaw提供了大量的skill：

- https://github.com/anthropics/skills/tree/main/skills
- https://github.com/openclaw/skills/tree/main/skills

下面展示我们应该如何写好Agent Skills

ShareAI给了大家一个核心公式：**`好 Skill = 专家独有的知识 - 大模型已有的知识`**

#### 标准 1：Token 效率——每个段落是否值得它的开销

Context window 是公共资源。一个 Skill 占用的 token，会挤压其他内容的空间——系统提示、对话历史、其他 Skill 的元数据、用户的实际请求。当你写一段"什么是 PDF"的解释时，你在浪费这个公共资源。Claude 已经知道什么是 PDF。这 100 个 token 本可以用来存放更有价值的信息。

#### 2. 标准 2：心智模型 vs 机械步骤——传递的是什么

下面展示了Ansthropic的frontend-design skill:

```
Before coding, understand the context and commit to a BOLD aesthetic direction:
- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: Pick an extreme: brutally minimal, maximalist chaos, retro-futuristic...
- **Differentiation**: What makes this UNFORGETTABLE?

NEVER use generic AI-generated aesthetics like overused font families (Inter, Roboto),
cliched color schemes (purple gradients on white backgrounds)...
```

专家和新手的差异不在于"会不会操作"，而在于"如何思考问题"。一个资深设计师和一个初学者，都会写 CSS。但设计师在写第一行代码之前，脑子里已经有了清晰的审美方向、用户场景、差异化定位。好的 Skill 传递的是这种思维方式，而不是机械的操作步骤。

#### 标准 3：反模式清单——明确什么不能做

几乎所有优秀的官方 Skill 都包含明确的"NEVER"清单。如`frontend-design`中的：

```
NEVER use generic AI-generated aesthetics like overused font families (Inter, Roboto, Arial),
cliched color schemes (particularly purple gradients on white backgrounds),
predictable layouts and component patterns...
```

`canvas-design`中的：

```
NEVER lose sight of the idea that this should be art, not something that's cartoony or amateur.
```

专家知识的一半是"知道什么能做"，另一半是"知道什么绝对不能做"。一个资深设计师看到紫色渐变配白色背景，会本能地皱眉——"太 AI 感了"。这种"什么不能做"的直觉，是踩过无数坑之后形成的。Claude 没有踩过这些坑。它不知道 Inter 字体已经被用滥了，不知道紫色渐变是 AI 生成内容的标志。好的 Skill 要把这些"绝对不能做"的事情明确写出来。这比"应该做什么"更有价值，因为它划定了品质的底线。你的 Skill 里有没有明确的"NEVER"清单？有没有告诉 Agent 什么是"垃圾做法"？

#### 标准 4：Description 触发机制——何时被激活

**关键点：** description 是唯一始终可见的部分。Agent 根据 description 决定是否激活这个 Skill。如果 description 太模糊，Skill 就无法在正确的时机被触发。

好的 description：

```
description: "Comprehensive document creation, editing, and analysis with support
for tracked changes, comments, formatting preservation, and text extraction.
When Claude needs to work with professional documents (.docx files) for:
(1) Creating new documents, (2) Modifying or editing content,
(3) Working with tracked changes, (4) Adding comments, or any other document tasks"
```

特点：

- 描述功能（what it does）
- 列出触发场景（when to use）
- 包含关键词（.docx files, tracked changes）

差的 description：

```
description: "处理文档相关功能"
```

问题：太模糊，Agent 不知道什么时候该用它。

#### 标准 5：自由度校准——与任务脆弱性匹配

不同类型的任务需要不同程度的约束。创意设计任务：需要高自由度。你给 Agent 一个审美方向，让它自己发挥。过度约束会扼杀创意。文件格式操作任务：需要低自由度。Word 文档的 OOXML 格式有严格的规范，一个字符写错就会导致文件损坏。这种任务需要精确的脚本和详细的步骤。

| 任务类型 | 应有的自由度 | 原因 | 示例Skill |
| - | - | - | - |
| 创意设计 | 高 | 多种方法有效，差异化是价值 | frontend-design |
| 代码审查 | 中 | 原则但需要判断 | 代码审查 Skill |
| 文件格式操作 |低 |操作脆弱，一致性关键 | docx, xlsx |

如何判断：问自己：这个任务容错率高还是低？如果 Agent 做错一步，后果是什么？

```
容错率高 → 给原则，不给步骤
容错率低 → 给脚本，少参数
```

#### 6. 标准 6：加载触发设计——Reference 能否被正确使用

很多 Skill 有详细的 reference 文档，但 Agent 不读。或者读太多。核心原因来自于不同 大模型 对 Skill 机制的训练程度不同。解决方案：

在工作流的关键节点嵌入强制加载指令。官方 docx Skill 的做法：

```
### Creating New Document

**MANDATORY - READ ENTIRE FILE**: Before proceeding, you MUST read
[`docx-js.md`](docx-js.md) (~500 lines) completely from start to finish.
**NEVER set any range limits when reading this file.**
```

"MANDATORY"、"MUST"、"NEVER" 不是装饰词，是确保 Agent 执行的关键信号。

**注意：** 这条标准只对有 reference 目录的中等/复杂 Skill 重要。简单型 Skill（如 frontend-design，43 行，无 reference）不需要考虑这个问题。

## 2.如何在OpenDrSai中使用Agent Skills（mini Claude code构建）

在OpenDrSai的框架中提供了`SkillAgent`，构造了mini Claude code的基本功能，如：Agent Skills/Subagent接入、代码执行沙盒、任务管理todo list等

### 2.1.为SkillAgent接入Agent Skills和子智能体

1. 在OpenDrSai的框架中提供了`SkillLoader`用于加载指定目录下的所有Agent Skills

```python
from drsai.modules.agents.skills_agent.skill_loader import SkillLoader
skills_loader = SkillLoader(skills_dir="Your/Path/to/skills")
skills_loader.get_descriptions() # 获取所有skills 的Metadata
```

2. 子智能体

`SkillAgent`支持子智能体功能，包括可以指定提示词和使用tools的`DrSaiAgent`与可执行代码的`CodeExecutorAgent`。在外部定义子智能体的配置示例如下：

````python
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
````

其中的coder_executor即为可执行代码的`CodeExecutorAgent`，需要为其配置代码执行的`CodeExecutor`，这里以可在指定文件夹执行代码的`LocalCommandLineCodeExecutor`为例，为了安全，可以选择`DockerCommandLineCodeExecutor`等执行器。

```python
from drsai.modules.baseagent import (
    DockerCommandLineCodeExecutor,
    LocalCommandLineCodeExecutor,
    CodeBlock
)
import venv

# Code executor and working directory
WORKDIR="/home/xiongdb/drsai_dev/examples/components/tmp/coding"
work_dir = Path(WORKDIR)
work_dir.mkdir(exist_ok=True)
venv_dir = work_dir / ".venv"
venv_builder = venv.EnvBuilder(with_pip=True)
venv_builder.create(venv_dir)
venv_context = venv_builder.ensure_directories(venv_dir)
local_executor = LocalCommandLineCodeExecutor(work_dir=work_dir, virtual_env_context=venv_context)
```

### 2.2.为SkillAgent接入基础工具

在`SkillAgent`中，为智能体赋予文件操作能力的基本工具："run_bash", "run_read", "run_write", "run_edit"，即命令行执行、文件读取、文件写入、文件编辑，从而模拟Cluade-Code的代码编辑能力。为了安全性，这些工具只能在指定的文件夹中使用：

```python
def get_operator_funcs(worker_dir: str|Path )->list[callable]:

    WORKDIR = Path(worker_dir)

    def safe_path(p: str) -> Path:
        """Ensure path stays within workspace."""
        path = (WORKDIR / p).resolve()
        if not path.is_relative_to(WORKDIR):
            raise ValueError(f"Path escapes workspace: {p}")
        return path


    def run_bash(cmd: str) -> str:
        """Execute shell command."""
        if any(d in cmd for d in ["rm -rf /", "sudo", "shutdown"]):
            return "Error: Dangerous command"
        try:
            r = subprocess.run(
                cmd, shell=True, cwd=WORKDIR,
                capture_output=True, text=True, timeout=60
            )
            return ((r.stdout + r.stderr).strip() or "(no output)")[:50000]
        except Exception as e:
            return f"Error: {e}"


    def run_read(path: str, limit: int = None) -> str:
        """
        Read file contents.
        
        Args:
            path : Path to file.
            limit : Maximum number of lines to read.
        """
        try:
            lines = safe_path(path).read_text().splitlines()
            if limit:
                lines = lines[:limit]
            return "\n".join(lines)[:50000]
        except Exception as e:
            return f"Error: {e}"


    def run_write(path: str, content: str) -> str:
        """Write content to file."""
        try:
            fp = safe_path(path)
            fp.parent.mkdir(parents=True, exist_ok=True)
            fp.write_text(content)
            return f"Wrote {len(content)} bytes to {path}"
        except Exception as e:
            return f"Error: {e}"


    def run_edit(path: str, old_text: str, new_text: str) -> str:
        """Replace exact text in file."""
        try:
            fp = safe_path(path)
            text = fp.read_text()
            if old_text not in text:
                return f"Error: Text not found in {path}"
            fp.write_text(text.replace(old_text, new_text, 1))
            return f"Edited {path}"
        except Exception as e:
            return f"Error: {e}"
    
    return [run_bash, run_read, run_write, run_edit]
```

### 2.3.赋予SkillAgent多任务执行的能力-Todolist

通过Tool Call让大模型生成/更新任务列表，并使用`TodoManager`进行更新管理：

```python
class TodoManager:
    """Task list manager with constraints. See v2 for details."""

    def __init__(self):
        self.items = []

    def update(self, items: list) -> str:
        validated = []
        in_progress = 0

        for i, item in enumerate(items):
            content = str(item.get("content", "")).strip()
            status = str(item.get("status", "pending")).lower()
            # active = str(item.get("activeForm", "")).strip()

            # if not content or not active:
            #     raise ValueError(f"Item {i}: content and activeForm required")
            if not content:
                raise ValueError(f"Item {i}: content and activeForm required")
            if status not in ("pending", "in_progress", "completed"):
                raise ValueError(f"Item {i}: invalid status")
            if status == "in_progress":
                in_progress += 1

            validated.append({
                "content": content,
                "status": status,
                # "activeForm": active
            })

        if in_progress > 1:
            raise ValueError("Only one task can be in_progress")

        self.items = validated[:20]
        return self.render()

    def get_task_prompt(self) -> str:
        """Returns the description of a task."""
        todo_list = self.render()
        return f"""Below is the current task list and status. You need to call the corresponding tool, skill, or sub agent according to the task status below to execute the subtasks with a status of "in_progress": \n\n{todo_list}"""
        
    def render(self) -> str:
        if not self.items:
            return "No todos."
        lines = []
        for t in self.items:
            mark = "[x]" if t["status"] == "completed" else \
                   "[>]" if t["status"] == "in_progress" else "[ ]"
            lines.append(f"{mark} {t['content']}")
        done = sum(1 for t in self.items if t["status"] == "completed")
        return "\n".join(lines) + f"\n({done}/{len(self.items)} done)"
```

### 2.4.SkillAgent如何调用基础工具、Agent Skills、子智能体以及执行多任务

在SkillAgent智能体内部，通过Tool Call让大模型选择使用什么功能进行下一步操作，每个功能的提示词如下：

```python
    def get_agent_skills_tools(self, strict: bool = False,) -> ToolSchema:
        """Get the skills' tools available to this agent."""
        
        parameters = ParametersSchema(
            type="object",
            properties={
                "skill": {
                        "type": "string",
                        "description": "Name of the skill to load"
                    }
            },
            required=["skill"],
            additionalProperties=False,
        )
        tool_schema = ToolSchema(
            name="Skill",
            description=f"""Load a skill to gain specialized knowledge for a task.

Available skills:
{self._skills_loader.get_descriptions()}

When to use:
- IMMEDIATELY when user task matches a skill description
- Before attempting domain-specific work (PDF, MCP, etc.)

The skill content will be injected into the conversation, giving you
detailed instructions and access to resources.""",
            parameters=parameters,
            strict=strict,
        )
        
        return tool_schema
    
    def get_todo_manager_tools(self, strict: bool = False,) -> ToolSchema:
        parameters = ParametersSchema(
            type="object",
            properties={
                "items": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "content": {"type": "string"},
                            "status": {
                                "type": "string",
                                "enum": ["pending", "in_progress", "completed"]
                            },
                            # "activeForm": {"type": "string"},
                        },
                    },
                },
            },
            required=["content", "status"], # , "activeForm"
            additionalProperties=False,
        )
        tool_schema = ToolSchema(
            name="TodoWrite",
            description="Create/Update task list.",
            parameters=parameters,
            strict=strict,
        )
        return tool_schema
    
    def get_subagent_tools(self, strict: bool = False,) -> ToolSchema:
        parameters = ParametersSchema(
            type="object",
            properties={
                "description": {
                    "type": "string",
                    "description":  "Short task description (3-5 words)"
                },
                "prompt": {
                    "type": "string",
                    "description": "The specific tasks that need to be executed by the sub agent. If the tasks include code blocks, files, etc. that need to be executed, they must be filled in completely."
                },
                "agent_type": {
                    "type": "string",
                    "enum": list(self._sub_agent_config.keys())
                },
            },
            required=["description", "prompt", "agent_type"],
            additionalProperties=False,
        )
        tool_schema = ToolSchema(
            name="Task",
            description=f"Spawn a subagent for a focused subtask.\n\nAgent types:\n{self._subagent_descriptions}",
            parameters=parameters,
            strict=strict,
        )
        return tool_schema
```

SkillAgent智能体通过以上的Tool Call调用实现处理不同的功能的核心的逻辑，具体见SkillAgent的`on_messages_stream`函数：

```python
            turn_count = 0
            while turn_count < self._max_turn_count:
                
                model_result = None
                async for inference_output in self._call_llm(
                    model_client=model_client,
                    model_client_stream=model_client_stream,
                    system_messages=system_messages,
                    model_context=model_context,
                    workbench=workbench,
                    handoff_tools=handoff_tools,
                    manager_tools=manager_tools,
                    agent_name=agent_name,
                    cancellation_token=cancellation_token,
                    output_content_type=output_content_type,
                ):
                    if self.is_paused:
                        raise asyncio.CancelledError()
                    
                    if isinstance(inference_output, CreateResult):
                        model_result = inference_output
                    else:
                        # Streaming chunk event
                        yield inference_output

                assert model_result is not None, "No model result was produced."

                # --- NEW: If the model produced a hidden "thought," yield it as an event ---
                if model_result.thought:
                    thought_event = ThoughtEvent(content=model_result.thought, source=agent_name)
                    yield thought_event
                    inner_messages.append(thought_event)

                # Add the assistant message to the model context (including thought if present)
                await model_context.add_message(
                    AssistantMessage(
                        content=model_result.content,
                        source=agent_name,
                        thought=getattr(model_result, "thought", None),
                    )
                )
                
                # If direct text response (string)
                if isinstance(model_result.content, str):
                    reponse = await self.handle_str_reponse(
                            model_result = model_result,
                            agent_name = agent_name,
                            format_string = format_string,
                            inner_messages = inner_messages,
                            output_content_type = output_content_type,)
                    
                    yield reponse
                    return

                # Otherwise, we have function calls
                assert isinstance(model_result.content, list) and all(
                    isinstance(item, FunctionCall) for item in model_result.content
                )
                
                # Log ToolCallRequestEvent
                tool_call_msg = ToolCallRequestEvent(
                    content=model_result.content,
                    source=agent_name,
                    models_usage=model_result.usage,
                )
                logger.debug(tool_call_msg)
                tools_name = [tool.name for tool in model_result.content] 
                yield AgentLogEvent(
                    title="I am using tools: " + " ".join(tools_name),
                    source=agent_name, 
                    content=str(tool_call_msg.content), 
                    content_type="tools")
                inner_messages.append(tool_call_msg)
                yield tool_call_msg

                # handle tool call
                for i in range(len(model_result.content)):
                    argument = json.loads(model_result.content[i].arguments)
                    tool_name = model_result.content[i].name
                    if tool_name == "TodoWrite":
                        async for message in self.handle_todo_write(
                            argument = argument,
                            agent_name = agent_name, 
                            model_context = model_context):
                            if isinstance(message, StopMessage):
                                yield message
                                return
                            yield message
                    elif tool_name == "Task":
                        async for message in self.handle_subagent_repsonse(
                            agent_name = agent_name,
                            model_client = model_client,
                            model_client_stream = model_client_stream,
                            model_context = model_context,
                            argument = argument,
                            cancellation_token = cancellation_token,
                            output_content_type = output_content_type,
                        ):
                            if isinstance(message, StopMessage):
                                yield message
                                return
                            yield message
                    elif tool_name == "Skill":
                        skill_content = self._skills_loader.run_skill(argument["skill"])
                        await model_context.add_message(
                            UserMessage(
                                content=f"Skill for {argument["skill"]}: {skill_content}",
                                source="user",
                            )
                        )
                    elif tool_name in self._basic_funcs_names:
                        async for message in self._process_model_result(
                            model_result=model_result,
                            inner_messages=inner_messages,
                            cancellation_token=cancellation_token,
                            agent_name=agent_name,
                            system_messages=system_messages,
                            model_context=model_context,
                            workbench=workbench,
                            handoff_tools=handoff_tools,
                            handoffs=handoffs,
                            model_client=model_client,
                            model_client_stream=model_client_stream,
                            reflect_on_tool_use=reflect_on_tool_use,
                            tool_call_summary_format=tool_call_summary_format,
                            tool_call_summary_prompt=self._tool_call_summary_prompt,
                            output_content_type=output_content_type,
                            format_string=format_string,
                        ):
                            if self.is_paused:
                                raise asyncio.CancelledError()
                            if isinstance(message, Response):
                                yield message.chat_message
                                # repetitive addition
                                # await model_context.add_message(
                                #     UserMessage(
                                #         content=message.chat_message.content,
                                #         source="user",
                                #     )
                                # )
                            else:
                                yield message
                    else:
                        await model_context.add_message(
                            UserMessage(
                                content=f"Unknown tool: {argument["name"]}",
                                source="user",
                            )
                        )

                turn_count += 1
```

### 2.5.如何启动自己的SkillAgent

````python
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
from drsai.modules.agents.skills_agent.skill_loader import SkillLoader
from drsai.modules.agents.skills_agent.operater_funs import get_operator_funcs

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

    # Agent skills 
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
````

# 参考：

1. https://mp.weixin.qq.com/s/hcqMHkTUVd5iIe7XdpNSzw
2. https://github.com/datawhalechina/hello-agents/blob/main/Extra-Chapter/Extra05-AgentSkills%E8%A7%A3%E8%AF%BB.md
3. https://github.com/shareAI-lab/mini-claude-code
4. https://mp.weixin.qq.com/s/lKwk0Kb-TWhZHs8_offuvA