# EdgeAgent - 专业科学数据智能分析助手

## 概述

EdgeAgent是一个面向专业科学数据分析的智能体系统，具备任务规划、多任务管理、技能学习、长期记忆等高级能力。

## 核心能力

### 1. 任务规划能力 (Task Planning)
- **智能分析**: 自动判断任务是否需要规划
- **多步骤分解**: 将复杂任务分解为可执行的子任务
- **用户交互**: 生成计划后获取用户反馈和确认
- **动态调整**: 支持根据用户反馈重新规划

**工作流程**:
```
用户请求 → 分析是否需要规划 → 生成计划 → 用户审核/修改 → 执行
```

### 2. 多任务进度自动更新 (Progress Management)
- 使用 `TodoManager` 管理任务列表
- 实时更新任务状态: `pending` → `in_progress` → `completed`
- 确保任务信息不会在执行过程中丢失
- 前端可视化展示任务进度

**任务状态示例**:
```
[ ] 读取数据文件
[>] 数据分析与统计  ← 当前进行中
[ ] 生成可视化图表
[ ] 创建分析报告
(1/4 done)
```

### 3. 智能工具/Skills/子智能体调用
- **基础工具**: `run_bash`, `run_read`, `run_write`, `run_edit`
- **Agent Skills**: 可加载专业领域知识和操作指南
- **子智能体**: 根据任务类型spawn专门的子agent
- **主动调用**: AI自主判断何时需要加载工具或技能

**支持的子智能体类型**:
- `data_analyst`: 数据分析专家
- `code_executor`: 代码执行器
- `report_generator`: 报告生成器
- 自定义子智能体...

### 4. 用户画像与长期记忆

#### 用户文件结构
```
work_dir/{user_id}/
├── AGENTS.md        # 智能体配置和用户画像摘要
├── Memories/        # 按session储存的完整任务记忆
│   ├── session_20260213_120000_thread_001.json
│   └── session_20260213_140000_thread_002.json
├── Skills.md        # 学习到的skills总结
├── skills/          # 自定义skills存储
│   ├── data_analysis_workflow/
│   │   └── SKILL.md
│   └── report_template/
│       └── SKILL.md
├── TOOLS.md         # 工具使用偏好
└── USER.md          # 用户画像详情
```

#### SessionMemory 结构
每个会话记忆包含:
```json
{
  "session_id": "thread_001",
  "user_id": "user_001",
  "start_time": "2026-02-13T12:00:00",
  "end_time": "2026-02-13T12:30:00",
  "original_user_request": "分析数据并生成报告",
  "task_plan": {
    "needs_plan": true,
    "steps": [...]
  },
  "execution_steps": [
    {
      "step_index": 0,
      "step_title": "读取数据",
      "tool_or_skill_used": "run_read",
      "action_details": "读取data.csv文件",
      "result": "成功读取1000行数据"
    }
  ],
  "tools_used": ["run_read", "run_bash"],
  "skills_loaded": ["data_analysis"],
  "subagents_spawned": ["data_analyst"],
  "final_result": "任务完成",
  "errors_encountered": [],
  "learned_patterns": ["CSV数据分析流程"]
}
```

### 5. 任务学习与Skill保存
- **自动记录**: 记录完整的任务执行过程
- **用户触发**: 用户主动请求时从任务总结学习
- **Skill格式**: 保存为标准SKILL.md格式
- **可复用**: 学习到的skills可在未来任务中加载使用

**学习触发方式**:
```python
# 在任务完成后,用户可以请求:
"请总结这次任务的经验,保存为一个skill"
```

### 6. 错误处理与用户求助
- **自动捕获**: 捕获执行过程中的所有错误
- **记录详情**: 保存错误类型、消息、发生步骤
- **尝试修复**: 先尝试自动恢复
- **用户求助**: 无法解决时主动请求用户帮助
- **保持进度**: 错误处理不影响任务进度跟踪

## 架构设计

### 模块组成

```
EdgeAgent
├── user_profile_manager.py    # 用户画像与文件管理
├── task_planner.py            # 任务规划与用户交互
├── memory_manager.py          # 长期记忆管理
├── edge_agent_core.py         # 核心执行逻辑
├── todo_manager.py            # 任务进度管理
├── skill_loader.py            # Skills加载器
└── operater_funs.py           # 基础工具函数
```

### 核心类

#### EdgeAgent
主智能体类,继承自 `DrSaiAgent` 和 `EdgeAgentCore`

#### UserProfileManager
管理用户特定的文件和记忆
- 创建和维护用户文件结构
- 读写用户画像、工具偏好等
- 保存和检索会话记忆

#### TaskPlanner
任务规划与用户交互
- 分析是否需要规划
- 生成任务计划
- 解析用户反馈
- 重新规划

#### LongTermMemoryManager
长期记忆管理
- 管理当前会话的SessionMemory
- 保存会话到文件
- 检索历史记忆
- 从任务学习并保存为skill

#### EdgeAgentCore
核心执行逻辑
- 完整的消息处理流程
- 任务计划执行
- 工具/Skills/子智能体调用
- 错误处理

## 使用方法

### 基本使用

```python
from drsai.modules.agents.skills_agent.assistant_for_you import EdgeAgent
from drsai.modules.components.model_client import HepAIChatCompletionClient, ModelFamily

# 创建EdgeAgent
agent = EdgeAgent(
    name="MyEdgeAgent",
    model_client=HepAIChatCompletionClient(
        model="glm-4-flash",
        model_family=ModelFamily.GLM4,
    ),
    sub_agent_config={
        "data_analyst": {
            "description": "数据分析专家",
            "prompt": "You are a data analysis expert.",
            "tools": "*",
        }
    },
    thread_id="unique_session_id",
    user_id="user_001",
)

# 运行
from drsai.backend import run_console
await run_console(
    agent_factory=lambda: agent,
    task="请分析这个数据文件并生成报告"
)
```

### 作为API服务

```python
from drsai.backend import run_worker

await run_worker(
    agent_name="EdgeAgent_SciData",
    agent_factory=create_edge_agent,
    port=42700,
    enable_openwebui_pipeline=True,
)
```

## 前端交互协议

### 计划消息 (Plan Message)
```json
{
  "type": "plan_message",
  "content": {
    "needs_plan": true,
    "response": "我将帮您完成数据分析任务",
    "task": "数据分析与报告生成",
    "plan_summary": "分4步完成任务",
    "steps": [
      {
        "title": "读取数据",
        "details": "使用run_read读取CSV文件",
        "agent_name": "EdgeAgent",
        "tool_or_skill": "run_read"
      }
    ]
  }
}
```

### 步骤执行状态 (Step Execution)
```json
{
  "type": "step_execution",
  "content": {
    "index": 0,
    "title": "读取数据",
    "details": "读取CSV文件内容",
    "agent_name": "EdgeAgent",
    "progress_summary": "正在执行步骤 1/4",
    "plan_length": 4
  }
}
```

### 用户反馈格式
```json
{
  "accepted": true,
  "plan": {
    "steps": [
      // 修改后的步骤列表(可选)
    ]
  },
  "feedback": "看起来不错,但是请在步骤2增加异常值检测"
}
```

## 配置说明

### 必需参数
- `name`: Agent名称
- `model_client`: 模型客户端
- `user_id`: 用户唯一标识
- `thread_id`: 会话唯一标识

### 可选参数
- `work_dir`: 工作目录(默认自动创建)
- `skills_dir`: Skills目录(默认使用用户目录)
- `sub_agent_config`: 子智能体配置
- `executor`: 代码执行器
- `max_turn_count`: 最大轮次(默认20)

### 子智能体配置示例
```python
sub_agent_config = {
    "agent_name": {
        "description": "智能体描述",
        "prompt": "系统提示词",
        "tools": ["tool1", "tool2"] or "*"  # "*"表示所有工具
    }
}
```

## 最佳实践

### 1. 任务规划
- 对于复杂的多步骤任务,EdgeAgent会自动生成计划
- 简单的单步任务直接执行,不需要规划
- 用户可以修改计划后再执行

### 2. Skills管理
- 将成功的任务流程保存为skills
- Skills会自动加载到用户的skills目录
- 下次类似任务时可以直接加载使用

### 3. 记忆利用
- EdgeAgent会自动保存每个会话的完整记忆
- 规划新任务时可以参考历史记忆
- 记忆可以通过关键词检索

### 4. 错误处理
- EdgeAgent会记录所有错误和修正过程
- 遇到无法解决的错误会请求用户帮助
- 错误处理经验会保存到SessionMemory

## 扩展开发

### 添加新的子智能体
```python
# 在sub_agent_config中添加
"my_custom_agent": {
    "description": "自定义智能体",
    "prompt": "您的系统提示词",
    "tools": ["需要的工具列表"]
}
```

### 添加自定义工具
```python
def my_custom_tool(param: str) -> str:
    """工具描述"""
    # 实现
    return result

# 添加到tools列表
tools = [FunctionTool(my_custom_tool)]
```

### 创建自定义Skill
在 `{user_skills_dir}/my_skill/SKILL.md`:
```markdown
---
name: my_skill
description: 技能简短描述
---

# 技能名称

## 使用场景
描述何时使用这个技能

## 操作步骤
1. 步骤1
2. 步骤2

## 示例
...
```

## 注意事项

1. **用户ID和线程ID**: 必须唯一,用于隔离不同用户和会话的数据
2. **工作目录**: 自动创建,确保有写权限
3. **模型选择**: 建议使用支持function calling的模型
4. **并发安全**: 不同user_id的EdgeAgent实例是隔离的
5. **记忆清理**: 长期运行需要定期清理旧的SessionMemory文件

## 故障排查

### 问题: 任务规划失败
- 检查模型客户端是否正常
- 查看日志中的详细错误信息
- 尝试简化用户请求

### 问题: Skills无法加载
- 确认skills目录存在
- 检查SKILL.md格式是否正确
- 查看SkillLoader日志

### 问题: 记忆保存失败
- 检查工作目录写权限
- 确认SessionMemory对象完整性
- 查看文件系统空间

## 示例代码

完整示例请参考:
- `/examples/agent_groupchat/edge_agent_example.py`

## 更新日志

### v1.0.0 (2026-02-13)
- 初始版本发布
- 支持任务规划与用户交互
- 多任务进度管理
- 长期记忆与技能学习
- 用户画像管理

## 贡献

欢迎提交问题和改进建议!

## 许可证

[您的许可证信息]
