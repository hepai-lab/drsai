---
tags: OpenDrSai, 智能体开发实践
---

# OpenDrSai智能体开发实践-通用任务智能体构建过程

实例代码见：https://github.com/hepai-lab/drsai/tree/main/examples/agent_groupchat/assistant_skill/drsai_assistant

核心能力设计：

1. 用户个人画像/提示词/其他配置的动态更新：通过skilll指导
2. 子智能体、工具、skill的动态加载：通过skilll指导
3. 任务规划与分解：动态触发，通过skilll指导，
4. 任务循环：采用react架构，观察->思考->执行；管理工具化
5. 记忆注入与长期记忆：摘要+本地文件检索
6. 自我被动学习：转化为skill


# 1. 用户个人画像与提示词更新

- 文件管理结构：

```
runs/xiongdb@ihep.ac.cn/
└── configs
    ├── AGENTS.md
    ├── memories
    │   ├── document_ids.json
    │   └── session_727190db-5b54-4522-878d-4f7edd7c79ea.json
    ├── skills
    ├── SKILLS.md
    ├── SUBAGENT_CONFIG.json
    ├── TOOLS_CONFIG.json
    ├── TOOLS.md
    ├── USER_CONFIG.json
    └── USER.md
```

## 1.1.全局的用户个人配置

- USER_CONFIG.json

```json
{
    "user_id": "abc",
    "user_name": "abc",
    "agent_name": "Assistant",
    "ask_before_plan": false,
    "created_at": "2026-03-02T22:10:08.110417",
    "updated_at": "2026-03-02T22:10:08.110430"
}
```

即时更改的内容：

1. 用户名称
2. 对智能体的称呼
3. 是否需要先询问再执行任务 （暂无使用）

## 1.2.用户个人画像内容

- USER.md

```
# User Profile: {self.user_name}

## Basic Information
- **User ID:** {self.user_id}
- **User Name:** {self.user_name}
- **What does the user call you:** 
- **Pronouns:** *(optional)*
- **Timezone:** 
- **Notes:** 

## Preferences

*(What do they care about? What projects are they working on? What annoys them? What makes them laugh? Build this over time.)*

[User preferences and the agent's response style. To be filled based on user interactions]


---

The more you know, the better you can help. But remember — you're learning about a person, not building a dossier. Respect the difference.
```

## 1.3.用户的动态的工具配置及工具使用偏好

- TOOLS_CONFIG.json，包括：
    - mcp-std
    - 远程的mcp-sse
    - 本地函数

```json
[
    {
        "name": "mcp1",
        "type": "mcp-sse",
        "config": {
            "url": "https://example.com/sse",
            "token": "xxx",                   # 可选，若不需要鉴权可传空字符串 ""
            "headers": {...},                 # 可选，若提供则优先使用此 headers
            "timeout": 20,                    # 可选，默认 20
            "sse_read_timeout": 300           # 可选，默认 300
        }
    },
    {
        "name": "mcp2",
        "type": "mcp-std",
        "config": {
            "command":"conda",
            "args":[
                "run",
                "-n",
                "drsai",
                "--live-stream",
                "python",
                "/path/MCP_tools/mcp_std.py"
                ],
        }
    },
    {
        "name": "local_func",
        "type": "local_func",
        "config": {
            "description": "A local function about local function",
            "params": ["param1", "param2"],
            "path": "/path/to/local_func.py",
            "command": "python",
            "args": ["/path/to/local_func.py"],
            "env": {...}
        }
    }
]
```

- TOOLS.md：包括conda环境、SSH配置、工作目录等，用户可以自己设置任何偏好。

```
f"""# Tool Preferences for User: {self.user_id}

## Environment Setup Examples

### Working Directory: 
    - {self.work_dir}

### Personal Skills dirs: 
    - {self.work_dir}/skills

### SSH setup: 
    - home-server → 192.168.1.100, user: admin

## Usage Preferences
[To be learned from user interactions]

## Frequently Used Tools and Skills
[To be tracked automatically]
```

## 1.4.系统提示词

提示词分为开发者提示词与配置文件提示词

- 开发者提示词：在配置agent时确定，不可更改，用于给智能体施加固定规则。
- 配置文件AGENTS.md的内容，可以由用户通过对话进行更新。在下一轮任务进行自动加载更新。

- AGENTS.md

```
 f"""# {self.agent_name} Configuration for User: {self.user_name}

## Agent Capabilities

Your name is {self.agent_name}, a professional scientific data analysis assistant with the following capabilities:

1. **Task Planning & Decomposition**: Analyze user requirements and decompose into executable subtasks
2. **Multi-task Progress Management**: Automatically update task status to prevent information loss
3. **Tool & Skills Invocation**: Proactively load tools, agent skills, and spawn subagents
4. **Learning & Adaptation**: Summarize task execution patterns and save as reusable skills

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
```

## 1.5.用户画像与系统提示词动态更新方法

1. 使用Agent Skills的方式，引导智能体直接修改配置文件。
2. 在配置文件更新后，下次在run_stream访问时自动加载更新用户画像与系统提示词。

- **配置查看：**

![](https://note.ihep.ac.cn/uploads/176fe2b8-c252-4d9d-9e0a-c1aa34ed9275.png)

- **配置更新：**

![](https://note.ihep.ac.cn/uploads/1277de0f-458e-4cf5-ab09-95ca7a8e327c.png)


# 2.Agent skill、MCP与函数工具、子智能体的动态加载

## 2.1.Agent skills加载

在OpenDrSai中，可以使用SkillLoader模块通过skill路径/路径列表加载的技能到智能体的ToolCall列表中，主要分为两种：

1. 智能体开发者为用户预设的skills，在定义智能体实例时主动传入。
2. 在用户工作目录`{workerspace}/{user_id}/skills`中，用户可以自己通过记忆总结或者外部下载agent skills。在下次在`on_messages_stream`访问时自动更新到智能体的ToolCall列表中。

- TODO: 增加记忆总结为skill、下载skill、工具构建skill教程为预设的skills

- **Agent Skills查看：**

![](https://note.ihep.ac.cn/uploads/9d1f4e2b-e51a-4fe0-ad28-f2afd5fdf6fd.png)

## 2.2.MCP与函数工具动态加载

1. 基础工具：["run_bash", "run_read", "run_write", "run_edit"]，赋予智能体在工作区进行文件操作的能力。
2. 智能体开发者为用户预设的工具，在定义智能体实例时主动传入。
3. 动态的工具配置：通过`TOOLS_CONFIG.json`储存和更新，包括mcp-std、远程的mcp-sse、本地函数，在每次启动`on_messages_stream`时进行更新加载。MCP格式的更新到智能体的ToolCall列表中，本地的函数文件加载到系统提示词中使用`run_bash`执行。

- **MCP与函数工具更新/运行：**

![](https://note.ihep.ac.cn/uploads/c7f32851-ba21-408c-9875-28f40ca42633.png)

![](https://note.ihep.ac.cn/uploads/7f7e3fb3-f518-4380-8c9e-5e5991a2863d.png)


## 2.3.子智能体动态加载

目前的子智能体分为3种：

- CodeExecutorAgent：使用docker或者局部的.venv环境进行代码块执行。用户可以自定义传入.venv环境地址配置进行创建。
- DrSaiAgent：普通的Autogen Assistant，可以使用工具。
- HepAIWorkerAgent：链接远程的智能体。

```json
{
    "agent_01": { // the name of the agent
        "type": "CodeExecutorAgent", // the type of the agent
        "description": "The descrpiption of the agent",
        "tools": [], 
        "prompt": "The system prompt for the agent.",
        "venv_path": "/path/to/workerspace" // the path of the venv environment
    },
    "agent_02": {
        "type": "DrSaiAgent",
        "description": "The descrpiption of the agent",
        "tools": ["run_bash", "run_read", "run_write", "run_edit"], // the tools name that the agent can use
        "prompt": "The system prompt for the agent.",
        "model": "openai/gpt-5.2", // the model name
        "model_type": "openai", // or anthropic
        "base_url": "https://aiapi.ihep.ac.cn/apiv2" // if model_type is anthropic, using "https://aiapi.ihep.ac.cn/apiv2/anthropic"
    },
    "agent_03": {
        "type": "HepAIWorkerAgent", // the type of the agent
        "description": "The descrpiption of the agent",
        "tools": [], 
        "prompt": "The system prompt for the agent.",
        "model_remote_configs": {
            "name": "remote_model_name",
            "url": "https://aiapi.ihep.ac.cn/apiv2" // or any other url
        }
    }
}
```

**TODO:** 对DrSaiAgent智能体进行升级，可以循环执行任务

# 3.任务循环

## 3.1.管理工具-manager_tools

将任务执行与系统管理过程做成工具，方便准确更新：

- 用户全局变量配置参数更新工具：self._update_user_config_tools
- Agent skills调用工具：self._agent_skills_tools
- 子智能体调用工具：self._subagent_tools
- Todo list构建/更新工具：self._todo_tools

## 3.2.以react架构为基础的智能体工作流程

**核心逻辑**：观察->思考->回复->任务循环。通过Tool calling 调用对应的工具、skills、子智能体、任务创建/更新。如果模型仅返回非Tool calling回复，则直接进行回复后结束任务循环。任务循环中依次包含以下处理过程：

- LLM根据全局的上下文问做出回复
- 处理非Tool calling回复：handle_str_reponse
- 处理计划创建/更新：handle_todo_write
- 处理子智能体调用：handle_subagent_repsonse
- 处理skills读取：将对应的skill加入上下文
- 处理工具调用：_process_model_result
- 处理用户全局配置信息升级：将更新的信息加入上下文
- 处理错误的Tool calling回复：将错误信息加入上下文

## 3.3.人机交互

TODO：

- 计划模式，结合Dr.Sai UI的Plan模式进行更新
- 重要操作的询问模式

# 4.模型上下文与长短记忆管理

## 4.1.模型上下文管理

在DrSaiAssistant中使用了`DrSaiChatCompletionContext`模块进行模型上下文与长短记忆的管理。该模块直接与大模型进行上下文交互，接受三种类型的消息格式：`SystemMessage`, `UserMessage`, `AssistantMessage`，通过以下的方式进行注入：

```python
await model_context.add_message(
    AssistantMessage(
        content=model_result.content,
        source=agent_name,
        thought=getattr(model_result, "thought", None),
    )
)
```

通过以下方式获取注入到大模型：

```python
all_messages = await model_context.get_messages()
```

**上下文添加位置：**

- LLM根据全局的上下文问做出回复：以AssistantMessage格式注入
- 处理非Tool calling回复：上面已经添加，不再重复
- 处理计划创建/更新：将创建/更新的任务信息以UserMessage和`role=user`的格式注入
- 处理子智能体调用：将子智能体的response的内容以AssistantMessage注入
- 处理skills读取：将skill的完整内容以UserMessage和`role=user`的格式注入
- 处理工具调用：以UserMessage和`role=user`的格式注入
- 处理用户全局配置信息升级：将更新的成功/失败信息以AssistantMessage注入
- 处理错误的Tool calling回复：将错误信息UserMessage和`role=user`的格式注入
- 整个循环运行过程中的错误：以UserMessage和`role=user`的注入

## 4.2.长记忆压缩

使用了`DrSaiChatCompletionContext`中的长上下文压缩对上下文进行压缩，提示词为：

```python
COMPRESSION_PROMPT_EN = """
You are an assistant responsible for compressing long multi-agent conversations into concise, long-term memory summaries. You will receive a conversation containing the user, assistant {name}, and possibly other agents. Your task is to extract only the high-value, long-term information and produce a highly compressed and structured summary.

Please summarize the conversation from the following perspectives:

1. **The user’s initial goal, task description, and any relevant background information** (keep only information that remains useful later).
2. **Key actions, reasoning steps, and major decisions made by assistant {name}:**
   - Include the tools used, the purpose of each tool call, the main inputs, and the outputs or results.
   - If a tool call failed or returned an invalid result, briefly record the reason.
3. **The current outstanding request or the latest requirement from the user or other agents toward assistant {name}.**

Additional instructions:
- Ignore small talk, repeated confirmations, and temporary or low-value content.
- The input may contain Chinese, English, or mixed languages; keep the origin languages**, clearly structured.
- Compress aggressively to minimize token usage while keeping essential causal chains.
- Do not infer or invent any information that is not explicitly stated.

Output the final result as a structured bullet-point summary.
"""
```

压缩后智能体的上下文只会保留开头的两条`SystemMessage`+压缩后的记忆+最后一条`UserMessage`。

## 4.3.长期记忆的存储

1. 本地存储

在DrSaiAssistant中，完整的历史记录每轮对话结束后通过前端的chat_id保存到用户工作目录{workerspace}/{user_id}/memories中:

```json
// session_c1f3a1eb-7c4c-48f2-a24d-c1ddf6ccbdaa.json

[
    {
        "role": "user",
        "content": "hi",
        "source": null,
        "is_tool_call": false,
        "create_time": "2026-03-04 22:54:21"
    },
    {
        "role": "assistant",
        "content": "Hi abc! 👋 How can I help you today?",
        "source": null,
        "is_tool_call": false,
        "create_time": "2026-03-04 22:54:35"
    }
]
```

2. RAGFlow远程存储

- 为新的session_id(thread_id/chat_id)创建对应的document_id，并以`meta_fields={"user_id": user_id, "thread_id": thread_id}`进行标识。
- 每轮对话结束后，对话原文上传到对应document_id的ragflow服务器中
- 用户主动总结，相关工具`summry_conversation_to_memory`总结和上传到对应document_id的ragflow服务器中。

![](https://note.ihep.ac.cn/uploads/8011c278-2f99-45e0-9778-a369fc33e4fa.png)

暂时不考虑的：

- 每轮对话后使用大模型总结用户的对话内容，通过tool_call区分专业性与问候性对话。对应非问候性的问题和智能体回复内容进行总结分析，上传到对应document_id的ragflow服务器中（考虑太过频繁，已经注释。后面考虑周期性总结）

## 4.4.记忆检索机制

1. 使用`retreve_from_memory`被动的从ragflow服务器中检索相关记忆chunk

![](https://note.ihep.ac.cn/uploads/0872d65b-479b-4e5d-98df-1cd1d473c6dc.png)

2. 使用命令行检索和读取用户工作目录{workerspace}/{user_id}/memories中的真实内容。

# 5.错误处理与自主学习

TODO：skills+AGENT.md修改

- 工具创建skill
- 记忆检索工作流skill
- 自我执行逻辑修正的skill

# 附录

## 1.核心功能循环构建提示词

````
我想设计一个智能体系统EgdeAgent，是是应用于专业科学数据智能分析方面，需要面临专业任务拆解、多任务循环执行、外部知识或者agent skills智能加载、超长记忆智能压缩、长期记忆智能体加载、任务学习总结为agent skills储存等问题。我希望该智能体系统具有以下几种能力：

1.具有任务规划能力，首先能够根据用户的问题，分析是否需要进行任务规划。如果需要任务规划，可以在规划选择看是否需要调用以前任务学习的Agent Skills或者知识库帮助进行任务规划。这时候可以选择先指定计划，如果用户不满意选择重新制定计划时，再调用相应的Agent Skills或者知识库进行学习补充。

2.具有多任务进度自动更新能力，确保任务信息不会再执行过程中被弱化，导致执行效果不行。

3.能够根据任务情况，主动地调用工具、Agent Skills、子智能体执行相应地任务。

4. 能够根据具体的user_id建立独一无二的用户画像在，用户需要总结和学习完整的任务学习过程时对上一轮的任务规划、工具调用、错误于修正反馈进行

5. Agent Skills和长期记忆我都想通过本地文件去管理，可以参考以下的文件夹列表：
```
work_dir/{user_id}/
├── AGENTS.md # 根据用户特征，储存智能体能力、基本的工作流程、用户画像及文件记忆储存地址、学习到的agent skills的总结，作为初始的用户提示词，每次任务对话时不断更新。
├── Memories/ # 按照时间列表储存的用户与智能体的记忆json格式，可以直接同关键词或者rag进行检索
├── Skills.md # 历史总结的用户任务执行情况总结，
├── skills/ # 储存任务执行后用户主动学习的skills
├── TOOLS.md # 用户的一些环境、工具使用偏好
└── USER.md # 用户画像描述，用于用户需要定义自己的身份，在用户主动触发时更新。

6. 错误无法解决自动求助前端用户的能力，同时保持任务进度。
```


你需要根据以上的要求，参考`/home/xiongdb/drsai_dev/python/packages/drsai/src/drsai/modules/agents/skills_agent/assistant_skill.py`，在on_messages_stream函数中设计一个智能体的任务循环执行逻辑。

需要改写原来依赖模块的功能时一定要新开一个文件进行重写，不要覆盖原来的文件内容。

我提供几个基本的能力及功能和参考：

1. 任务生成以及获取前端用户同意或修改意见的代码见：/home/xiongdb/drsai_dev/examples/agent_groupchat/assistant_task_interaction.py

2. Agent skills的加载和获取的模块见：/home/xiongdb/drsai_dev/python/packages/drsai/src/drsai/modules/agents/skills_agent/skill_loader.py

3. EgdeAgent上下文管理是通过/home/xiongdb/drsai_dev/python/packages/drsai/src/drsai/modules/components/model_context/drsai_model_context.py中的DrSaiChatCompletionContext进行管理的。

4. 你可以参考`/home/xiongdb/drsai_dev/python/packages/drsai/src/drsai/modules/agents/skills_agent/assistant_skill.py`，通过tool call调用选择执行哪一项任务。

````

