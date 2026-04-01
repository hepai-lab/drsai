---
name: claude-code-backend-tool
description: |
  指导智能体如何使用claude_code_tool.py执行后台Claude Code任务。当用户需要执行长时间运行的代码分析、审查、修复或重构任务时立即使用此技能。当用户提到"后台执行"、"claude --print"、"长任务"、"代码分析"、"自动修复"、"代码审查"、"重构"或需要控制预算和时间时，必须使用此技能。
---

# Claude Code 后台执行工具技能

## 概述

`claude_code_tool.py` 是一个将 `claude --print` 命令包装为可后台执行、可查询进度的长任务工具。本技能指导智能体如何正确使用这个工具来满足用户的各种代码处理需求。

## 核心功能

工具提供两个核心函数：

| 函数 | 作用 |
|------|------|
| `run_claude_code(...)` | 提交任务，立即返回 `(task_id, 初始状态)` |
| `query_claude_code_status(task_id)` | 轮询查询任务状态和结果 |

## 何时使用本技能

**立即使用本技能当用户：**

1. **需要执行长时间运行的代码分析任务**
   - "帮我分析这个项目的代码质量"
   - "检查这个代码库的性能问题"
   - "审查这个项目的架构设计"

2. **需要自动修复代码问题**
   - "帮我修复所有Python文件的语法错误"
   - "自动修复代码中的安全漏洞"
   - "批量修改代码格式"

3. **需要代码审查或重构**
   - "审查最新提交的代码变更"
   - "重构这个模块以提高可维护性"
   - "将项目迁移到新版本"

4. **需要控制预算或时间**
   - "控制在0.5美元以内分析这个项目"
   - "快速检查这个目录的结构"
   - "深度分析但不要超过1美元"

5. **提到后台执行或长任务**
   - "后台运行这个分析任务"
   - "异步执行代码检查"
   - "不要阻塞当前会话"

## 参数配置指南

### `run_claude_code` 核心参数

| 参数 | 类型 | 默认值 | 作用 | 智能体使用建议 |
|------|------|--------|------|----------------|
| `prompt` | str | **必填** | 给Claude Code的指令 | 用自然语言清晰描述任务 |
| `cwd` | str | `"."` | 工作目录 | 设置为项目根目录 |
| `model` | str | None | 模型选择 | 复杂任务用"opus"，简单任务用"sonnet" |
| `permission_mode` | str | `"default"` | 权限模式 | 根据任务类型选择（见下表） |
| `allowed_tools` | list[str] | None | 白名单工具 | 限制工具权限确保安全 |
| `max_budget_usd` | float | None | 最大花费 | 始终设置预算控制成本 |
| `effort` | str | None | 努力等级 | 根据任务复杂度选择 |

### `permission_mode` 选择指南

| 模式 | 含义 | 使用场景 | 智能体选择标准 |
|------|------|----------|----------------|
| `"default"` | 危险操作询问，非危险自动执行 | **通用分析**，不确定用户意图时 | 默认选择，最安全 |
| `"acceptEdits"` | 自动接受文件编辑 | **批量修改**，用户明确要求修复代码 | 用户说"修复"、"修改"、"重构"时 |
| `"dontAsk"` | 不询问，自动执行所有操作 | **CI/CD自动化**，无人值守任务 | 用户要求"自动处理"、"不要问我"时 |
| `"plan"` | 只规划，不执行写操作 | **预览方案**，用户想先看改动 | 用户说"先告诉我方案"、"不要实际改动"时 |
| `"bypassPermissions"` | 完全绕过权限检查 | **沙箱环境**，完全信任环境 | 极少使用，仅在隔离环境 |

## 智能体决策流程图

当用户提出需求时，按以下流程决策：

```
用户需求 → 分析关键词 → 确定任务类型 → 配置参数 → 提交任务
```

### 关键词到参数映射表

| 用户关键词 | 参数影响 | 具体配置 |
|-----------|----------|----------|
| **深度/全面/详细/彻底** | model, effort | `model="opus"`, `effort="high"`或`"max"` |
| **快速/简单/概括/简要** | model, effort, budget | `model="sonnet"`, `effort="low"`, `max_budget_usd=0.02` |
| **修复/修改/改动/重构** | permission_mode, tools | `permission_mode="acceptEdits"`, `allowed_tools=["Read", "Edit", "Bash"]` |
| **先规划/预览/不要修改** | permission_mode | `permission_mode="plan"` |
| **自动/不要问我/直接** | permission_mode | `permission_mode="dontAsk"`或`"acceptEdits"` |
| **控制在X美元以内** | max_budget_usd | `max_budget_usd=X` |
| **JSON格式** | output_format | `output_format="json"` |
| **git相关** | allowed_tools | `allowed_tools=["Read", "Bash(git:*)"]` |

## 常见场景参数映射

### 场景1：深度代码质量分析
**用户说**："深度分析代码质量，找出所有潜在问题，控制在0.3美元以内"
```python
run_claude_code(
    prompt="深度分析代码质量，找出所有潜在问题",
    cwd="/path/to/project",
    model="opus",           # 关键词"深度" → opus
    allowed_tools=["Read", "Bash"],  # 分析任务，只读
    permission_mode="default",       # 未提修改，用default
    effort="high",          # 关键词"深度" → high
    max_budget_usd=0.3,     # 明确指定0.3美元
)
```

### 场景2：自动修复语法错误
**用户说**："自动修复语法错误，不要问我确认"
```python
run_claude_code(
    prompt="自动修复所有语法错误",
    cwd="/path/to/project",
    model="opus",           # 修复任务通常复杂，用opus
    permission_mode="acceptEdits",   # "自动修复" + "不要问我" → acceptEdits
    allowed_tools=["Read", "Edit", "Bash"],  # 需要Edit权限
    effort="max",           # 修复任务需要最大努力
    max_budget_usd=0.5,     # 修复任务默认0.5美元
)
```

### 场景3：迁移规划（只预览）
**用户说**："先帮我规划迁移到Python 3.12，不要实际修改"
```python
run_claude_code(
    prompt="规划迁移到Python 3.12的步骤",
    cwd="/path/to/project",
    model="sonnet",         # 规划任务中等复杂度
    permission_mode="plan",          # "先规划" + "不要修改" → plan
    allowed_tools=["Read", "Bash"],  # 只读分析
    effort="medium",        # 规划任务中等努力
    max_budget_usd=0.1,     # 规划任务默认0.1美元
)
```

### 场景4：快速目录检查
**用户说**："快速检查目录内容，低成本执行"
```python
run_claude_code(
    prompt="快速检查目录内容并概括",
    cwd="/path/to/project",
    model="sonnet",         # "快速" → sonnet
    permission_mode="default",       # 简单检查
    allowed_tools=["Read", "Bash(ls:*)", "Bash(find:*)"],  # 限制工具
    effort="low",           # "快速" → low
    max_budget_usd=0.02,    # "低成本" → 0.02美元
)
```

### 场景5：CI/CD自动化审查
**用户说**："自动化代码审查，输出JSON格式"
```python
run_claude_code(
    prompt="自动化代码审查",
    cwd="/path/to/project",
    model="sonnet",         # 审查任务中等复杂度
    permission_mode="dontAsk",       # "自动化" → dontAsk
    allowed_tools=["Read", "Bash(git:*)"],  # 审查通常需要git
    output_format="json",   # 明确要求JSON格式
    effort="low",           # 自动化任务快速执行
    max_budget_usd=0.05,    # 自动化任务低成本
)
```
```

### 场景3：预览重构方案（只规划）
```python
run_claude_code(
    prompt="规划如何将这个项目迁移到Python 3.12，列出所有需要改动的地方",
    cwd="/path/to/project",
    permission_mode="plan",          # 只规划不执行
    model="sonnet",         # 中等复杂度
    effort="medium",        # 中等努力
    max_budget_usd=0.1,     # 低成本预览
)
```

### 场景4：CI/CD自动化审查
```python
run_claude_code(
    prompt="审查最新提交的变更，检查是否符合项目代码规范",
    cwd="/repo",
    model="sonnet",         # 快速审查
    permission_mode="dontAsk",       # 无人值守自动执行
    allowed_tools=["Read", "Bash(git:*)"],  # 限制只使用git命令
    output_format="json",   # 机器可读格式
    effort="low",           # 快速检查
    max_budget_usd=0.05,    # 严格控制成本
)
```

### 场景5：快速目录检查（低成本）
```python
run_claude_code(
    prompt="这个目录下主要有哪些模块？用3句话概括",
    cwd="/path/to/project",
    model="sonnet",         # 简单任务
    allowed_tools=["Read", "Bash(ls:*)", "Bash(find:*)"],  # 限制工具
    permission_mode="default",
    effort="low",           # 低努力
    max_budget_usd=0.02,    # 极低成本
)
```

## 预算配置指导

**必须始终设置max_budget_usd！** 根据任务类型设置合理预算：

### 预算推荐表
| 任务类型 | 推荐预算 | 说明 |
|----------|----------|------|
| **快速检查** | 0.02-0.05美元 | 简单目录查看、文件统计 |
| **代码分析** | 0.1-0.3美元 | 中等复杂度分析、代码审查 |
| **深度分析** | 0.3-0.5美元 | 复杂架构分析、性能优化 |
| **自动修复** | 0.5-1.0美元 | 代码修复、重构任务 |
| **迁移规划** | 0.1-0.2美元 | 技术栈迁移方案设计 |

### 预算提取规则
1. **用户明确指定**：直接使用用户指定的预算
2. **用户未指定**：根据上表推荐值设置
3. **询问用户**：如果无法确定，询问用户预算限制

## 任务状态监控

### 状态查询最佳实践
```python
from claude_code_tool import query_claude_code_status
import time

def monitor_task(task_id, check_interval=5):
    """
    监控任务状态的函数
    """
    print(f"开始监控任务 {task_id}")
    
    while True:
        status = query_claude_code_status(task_id)
        current_status = status["status"]
        
        # 报告状态
        if current_status == "IN_PROGRESS":
            print("⏳ 任务进行中...")
        elif current_status == "DONE":
            print("✅ 任务完成！")
            result = status["result"]
            
            if result["returncode"] == 0:
                print("输出内容:", result["stdout"][:500] + "..." if len(result["stdout"]) > 500 else result["stdout"])
            else:
                print(f"⚠️  任务返回非零代码: {result['returncode']}")
                print(f"错误信息: {result['stderr']}")
            
            break
        elif current_status == "ERROR":
            print(f"❌ 任务失败: {status.get('message', '未知错误')}")
            break
        elif current_status == "TODO":
            print("🔄 任务排队中...")
        
        time.sleep(check_interval)

# 使用示例
monitor_task(task_id)
```

### 状态返回值详解
```json
{
  "id": "任务UUID",
  "status": "DONE",          // 状态: TODO | IN_PROGRESS | DONE | ERROR
  "result": {
    "returncode": 0,          // 0=成功, 非0=失败
    "stdout": "Claude输出内容...",
    "stderr": "错误信息（如果有）",
    "cmd": "执行的claude命令"
  },
  "message": "状态描述信息"
}
```

### 错误处理策略
```python
status = query_claude_code_status(task_id)

if status["status"] == "ERROR":
    error_type = "未知错误"
    error_msg = status.get("message", "")
    
    # 常见错误类型识别
    if "permission" in error_msg.lower():
        error_type = "权限错误"
        solution = "检查permission_mode设置，可能需要改为plan或default"
    elif "budget" in error_msg.lower() or "cost" in error_msg.lower():
        error_type = "预算错误"
        solution = "增加max_budget_usd或简化任务"
    elif "timeout" in error_msg.lower():
        error_type = "超时错误"
        solution = "增加effort等级或简化任务"
    else:
        solution = "查看详细错误信息并调整参数"
    
    print(f"❌ {error_type}: {error_msg}")
    print(f"💡 建议: {solution}")
```

## 完整工作流程

### 步骤1：分析用户需求
1. 确定任务类型（分析、修复、审查、重构）
2. 判断是否需要写权限
3. 评估任务复杂度
4. 询问用户预算限制（如未提供）

### 步骤2：配置参数
1. 根据任务类型选择`permission_mode`
2. 根据复杂度选择`model`和`effort`
3. 设置`max_budget_usd`（必须设置！）
4. 限制`allowed_tools`确保安全

### 步骤3：提交任务
```python
# 示例：深度代码分析
task_id, init_status = run_claude_code(
    prompt="深度分析src/目录下的代码结构，找出设计模式使用不当的地方",
    cwd="/home/user/project",
    model="opus",
    permission_mode="default",
    allowed_tools=["Read", "Bash"],
    effort="high",
    max_budget_usd=0.4,
)
```

### 步骤4：监控进度
1. 定期查询任务状态
2. 向用户报告进度
3. 处理完成或错误状态

## 最佳实践

### 安全第一
1. **始终设置预算**：避免意外高额费用
2. **限制工具权限**：只开放必要的工具
3. **谨慎使用写权限**：确认用户意图后再使用`acceptEdits`

### 成本控制
1. 简单任务：`max_budget_usd=0.02-0.05`
2. 中等任务：`max_budget_usd=0.1-0.3`
3. 复杂任务：`max_budget_usd=0.5-1.0`

### 性能优化
1. 快速检查：`effort="low"`, `model="sonnet"`
2. 深度分析：`effort="high"`或`"max"`, `model="opus"`

## 故障排除

### 常见问题
1. **任务卡住**：检查`query_claude_code_status`返回的状态
2. **权限错误**：确认`permission_mode`设置正确
3. **预算超支**：立即停止任务，检查`max_budget_usd`设置

### 错误处理
```python
status = query_claude_code_status(task_id)
if status["status"] == "ERROR":
    error_msg = status.get("message", "未知错误")
    print(f"任务失败: {error_msg}")
    # 根据错误类型采取相应措施
```

## 总结

本技能使智能体能够：
1. **智能识别**用户何时需要后台Claude Code任务
2. **安全配置**任务参数，防止意外修改或高额费用
3. **高效执行**各种代码处理任务
4. **实时监控**任务进度和状态

**记住：当用户提到代码分析、修复、审查、重构或后台任务时，立即使用本技能！**