# DrSai CLI 使用手册

> 版本: 对应 `run_cli.py` (1871 行) + `cli/commands.py` 命令注册表
> 最后更新: 2026-05

---

## 目录

1. [总体介绍](#1-总体介绍)
2. [启动与配置](#2-启动与配置)
3. [System Prompt 层级架构](#3-system-prompt-层级架构)
4. [Session 管理](#4-session-管理)
5. [模型与推理控制](#5-模型与推理控制)
6. [项目指令 (DRSAI.md)](#6-项目指令-drsaimd)
7. [记忆管理](#7-记忆管理)
8. [Plan Mode 与 Prompt 注入](#8-plan-mode-与-prompt-注入)
9. [状态与信息查看](#9-状态与信息查看)
10. [安全控制](#10-安全控制)
11. [显示与交互控制](#11-显示与交互控制)
12. [中断与退出](#12-中断与退出)
13. [定时任务与通知推送](#13-定时任务与通知推送)
14. [完整命令速查表](#14-完整命令速查表)

---

## 1 总体介绍

### 1.1 DrSai CLI 是什么？

DrSai CLI 是 DrSai 智能体框架的**本地交互式终端客户端**。它直接在本地创建 `DrSaiCLIAssistant` 实例（无需远程 Worker），通过 REPL (Read-Eval-Print Loop) 提供连续多轮对话体验。

**核心能力**：

- **本地智能体**: 直接实例化 `DrSaiCLIAssistant`，无需部署远程服务
- **连续多轮对话**: 流式输出、工具调用、思考过程可视化
- **多 Session 管理**: 创建、切换、搜索、恢复多个独立会话，每个会话有独立的状态和对话历史
- **项目指令系统**: 自动发现并加载项目目录中的 `DRSAI.md` / `CLAUDE.md`，让 AI 理解你的项目上下文
- **记忆管理**: 通过 SQLite/RAGFlow 实现短期对话记忆 + 长期学习记忆，支持跨会话检索
- **动态模型切换**: 在会话内即时切换 LLM 模型，支持 session-local 和 global 两种模式
- **Plan Mode**: 启用后 AI 会先访谈用户确认计划再执行，适合复杂任务规划
- **Prompt 注入**: 可动态注入 prefix/suffix 到 system prompt，灵活控制 AI 行为
- **推理控制**: 支持推理过程可视化、推理强度调节 (off/low/medium/high/xhigh)
- **定时任务**: 配合 Worker 后端可创建后台定时任务，终端自动推送完成通知
- **Workspace 限制**: 默认开启，将 AI 的文件操作和 Shell 命令限制在项目目录 + 内部存储目录内，防止越界访问
- **危险命令控制**: 默认拦截 `sudo`、`rm -rf` 等系统级危险命令和 `python script.py`、`bash script.sh` 等脚本执行命令，可通过 `/dangerous on` 临时授权

### 1.2 特色功能详解

#### 记忆管理

DrSai CLI 的记忆系统分为两层：

| 层级 | 实现 | 作用 | 生命周期 |
|------|------|------|----------|
| 短期对话记忆 | `DrSaiSQLiteChatCompletionContext` | 当前会话的完整对话历史，支持 token 压缩 | session 级 |
| 长期学习记忆 | SQLite FTS5 (`session_messages_fts`) | 跨会话的知识存储，支持 BM25 全文检索 | user 级 |

用户可通过内置工具 `retrieve_from_memory` 和 `summry_conversation_to_memory` 进行记忆的检索和总结。系统在每个对话轮次结束时自动保存状态。

#### 状态管理

每个 Session 的状态通过 `Thread.state` 持久化到 SQLite 数据库。状态包含：

- **对话历史** (`llm_context`): 完整的 API 级消息列表
- **模型选择** (`defult_config_name`): session-local 的模型配置
- **注入提示词** (`injected_prefix`, `injected_suffix`): 动态注入的 prefix/suffix
- **项目指令** (`project_instructions`): 从 DRSAI.md 加载的项目级指令内容
- **推理强度** (`reasoning_effort`): 当前会话的推理设置
- **Workspace 限制** (`only_in_workspace`): 是否限制文件操作路径
- **危险命令控制** (`dangerous_allowed`): 是否允许危险和脚本执行命令

切换 Session 时，当前状态自动保存，新 Session 的状态自动恢复，实现无缝切换。

#### 多 Session 与目录绑定

DrSai CLI 的 Session 系统与**工作目录**绑定：

- 启动时自动检查 `cwd` 是否有对应的 Session
- 有 → 恢复该 Session 的对话历史和状态
- 无 → 创建新 Session，以目录名命名
- 通过 `workdir_sessions` 映射表维护目录与 Session 的关联

这意味着在项目 A 目录启动 CLI 会自动加载项目 A 的 Session，切换到项目 B 目录则加载项目 B 的 Session。

---

## 2 启动与配置

事先配置好环境变量：

```env
SYSTEM_SKILLS_DIR="/path/to/skills"
LLM_CONFIG_FILE="/path/to/llm_config.json"
HEPAI_API_KEY="<enter your key here>"
```

### 2.1 启动方式

```bash
# 默认启动（进入 REPL）
drsai

# 显式 chat 子命令
drsai chat

# 带参数启动
drsai --api-key <KEY> --model <MODEL> --user <EMAIL>
drsai --plan-mode    # 启用 Plan Mode
drsai --llm-config-file path/to/catalog.yaml
```

### 2.2 CLI 参数

| 参数 | 短写 | 说明 |
|------|------|------|
| `--url` | `-u` | Worker 服务 URL（用于远程定时任务） |
| `--api-key` | `-k` | HepAI API Key |
| `--model` | `-m` | 模型/智能体名称 |
| `--user` | | 用户 ID（邮箱） |
| `--llm-config` | | 默认 LLM 模型别名 |
| `--llm-config-file` | | LLM 模型目录文件路径 (YAML/JSON) |
| `--anthropic-api-key` | | Anthropic 格式 API Key |
| `--anthropic-base-url` | | Anthropic 格式 Base URL |
| `--openai-api-key` | | OpenAI 格式 API Key |
| `--openai-base-url` | | OpenAI 格式 Base URL |
| `--skills-dir` | | 系统 Skills 目录路径 |
| `--ragflow-url` | | RAGFlow 服务器 URL |
| `--ragflow-token` | | RAGFlow API Token |
| `--memory-dataset-id` | | 长期记忆 Dataset ID |
| `--plan-mode` | `-p` | 启用 Plan Mode |

### 2.3 首次配置

首次运行时，如果 `cli_config.json` 不存在且无参数覆盖，CLI 会启动交互式配置向导：

```
  Welcome to DrSai CLI! Let's configure your profile.

  Config will be saved to: ~/.drsai/configs/cli_config.json

  Your user id: [anonymous]
  Default model name (e.g. minimax-m2.7-highspeed): 
```

配置文件位置: `~/.drsai/configs/cli_config.json`

### 2.4 配置管理（外部子命令）

除了 REPL 内的 `/config`，还有外部 Typer 子命令：

```bash
# 查看/更新配置
drsai config --show                # 显示当前配置（敏感值已遮蔽）
drsai config --json                # JSON 格式输出
drsai config --api-key <KEY>       # 更新 API Key
drsai config --plan-mode true      # 设置全局 Plan Mode

# Session 管理
drsai sessions                     # 列出所有已保存 Session
drsai sessions --clear             # 清除所有 Session

# 版本信息
drsai version                      # 显示版本号
```

---

## 3 System Prompt 层级架构

DrSai CLI 的 System Prompt 由 6 个层级组成，从上到下排列。**越靠后的层级，LLM 越重视**：

```
① Prefix (session级)       ← /plan_mode、/inject prefix 设置
② Developer msg (硬编码)   ← 初始化时的 system_message 参数
③ AGENTS.md (全局用户级)   ← workspace/configs/AGENTS.md
④ Project instructions     ← DRSAI.md / CLAUDE.md（cwd 向上遍历）
⑤ Session_ID (固定行)      ← "Current Session_ID is <thread_id>"
⑥ Suffix (session级)       ← /inject suffix 设置
⑦ Tools prompt (追加)      ← 工具配置描述（在 ⑥ 之后追加）
```

**层级设计原则**：
- ①② 是系统/框架级约束，优先级最低但覆盖面最广
- ③④ 是用户/项目级指令，提供了具体的上下文
- ⑤⑥⑦ 是 session 级动态控制，最靠近 LLM 的输入末尾，影响力最强

**查看层级状态**：使用 `/memory status` 命令可以看到每一层的字符数和预览。

---

## 4 Session 管理

Session 是 DrSai CLI 的核心组织单元。每个 Session 有独立的对话历史、模型配置、注入提示词和项目指令。

### 4.1 自动 Session 绑定

启动时，CLI 根据当前工作目录 (`cwd`) 自动匹配或创建 Session：

```
# 在 /data/myproject 目录启动
cd /data/myproject
drsai
# → 自动创建名为 "myproject" 的 Session，绑定到该目录

# 再次在同一目录启动
drsai
# → 自动恢复之前的 Session（对话历史、模型、项目指令等）
```

### 4.2 Session 命令

| 命令 | 别名 | 参数 | 说明 |
|------|------|------|------|
| `/new` | | `[name]` | 创建新 Session。可选指定名称，默认以 cwd 目录名命名 |
| `/switch` | | `<id|name>` | 切换到另一个 Session。可用 ID 前缀或名称匹配 |
| `/list` | `/ls` | | 列出所有 Session，标记当前 Session 和工作目录 |
| `/rename` | | `<name>` | 重命名当前 Session |
| `/history` | | | 显示当前 Session 的对话历史（每条消息截断到 80 字符） |
| `/save` | | | 手动保存（实际上每轮对话后自动保存，此命令为占位） |
| `/resume` | | `<id|name>` | 恢复之前的 Session 并显示历史消息数 |
| `/search` | | `<query>` | 在所有 Session 中搜索（子串匹配，大小写不敏感） |
| `/copy` | | `[n]` | 复制第 n 条最近的助手回复到剪贴板（默认 n=1） |

### 4.3 Session 切换流程

```
/switch my-session     →  1. 保存当前 agent 状态 (save_state)
                          2. 关闭当前 agent (_close_agent)
                          3. 切换 current_session_id
                          4. 初始化新 agent (_init_agent)
                          5. 加载新 Session 的历史状态 (load_state)
                          6. 加载/恢复项目指令
```

### 4.4 Session 状态持久化

每次对话轮次结束时，CLI 自动执行：

1. `agent.save_state()` → 收集完整状态（对话历史、模型、注入提示词、项目指令、推理强度）
2. `_save_thread_state()` → 压缩并写入 SQLite `Thread.state`
3. 更新 `Thread.status` 和 `Thread.updated_at`

---

## 5 模型与推理控制

### 5.1 模型切换

DrSai CLI 支持在会话内即时切换模型，有两种模式：

| 命令 | 别名 | 作用域 | 说明 |
|------|------|--------|------|
| `/model <alias>` | `/m` | session-local | 仅当前会话切换，不影响全局配置 |
| `/model_global <alias>` | `/mg` | session + global | 当前会话切换 + 保存为全局默认 |

**其他用法**：

```
/model                # 查看当前模型（标注 session-local 或 default）
/model info <alias>   # 查看模型详细信息（model ID、token limit、推理支持）
```

### 5.2 模型列表

```
/models               # 列出所有可用模型，显示推理支持信息
/models reasoning     # 只列出支持推理的模型
```

输出示例：
```
  Available models (8 total)
  ──────────────────────────────────────────────────────────────────────
  Alias                              Reasoning       Effort Levels
  ──────────────────────────────────────────────────────────────────────
  → minimax-m2.7-highspeed           ❌ none          -
    claude-sonnet-4-20250514          ✅ extended      low, medium, high
    deepseek-r1                       ✅ R1 model      unlimited
  ──────────────────────────────────────────────────────────────────────
```

### 5.3 快速模式

```
/fast                 # 切换到最快的模型别名（自动识别 highspeed/flash/haiku）
/fast off             # 切换回默认模型
```

### 5.4 推理控制

```
/reasoning            # 切换推理框显示 (on/off)
/reasoning show       # 显示推理框
/reasoning hide       # 隐藏推理框
/reasoning low        # 设置推理强度为 low
/reasoning medium     # 设置推理强度为 medium
/reasoning high       # 设置推理强度为 high（自动开启推理框）
/reasoning xhigh      # 设置推理强度为 xhigh
```

推理强度通过 `DrSaiCLIAssistant.reasoning_effort` 属性设置，支持值：`off`, `low`, `medium`, `high`, `xhigh`。

---

## 6 项目指令 (DRSAI.md)

### 6.1 设计理念

项目指令系统借鉴了 Claude Code 的 `CLAUDE.md` 机制，但适配了 DrSai 的架构。它让 AI 在每次会话开始时自动理解你的项目上下文——构建命令、编码标准、架构决策、常见工作流等。

### 6.2 文件发现机制

从当前工作目录 (`cwd`) **向上遍历**目录树，发现指令文件：

**每个目录层级内的优先级**（只取第一个存在的）：

| 优先级 | 文件 | 说明 |
|--------|------|------|
| 1 | `.drsai/DRSAI.md` | DrSai 原生格式（推荐） |
| 2 | `.claude/CLAUDE.md` | Claude Code 兼容格式 |
| 3 | `DRSAI.md` | 项目根目录直放 |
| 4 | `CLAUDE.md` | Claude Code 兼容直放 |
| 5 | `DRSAI.local.md` | 个人偏好（加入 .gitignore） |
| 6 | `CLAUDE.local.md` | 个人偏好 |

**跨目录层级优先级**：
- 路径越靠近 `cwd` 的文件，在 system prompt 中越靠后 → LLM 越重视
- 父目录先读，子目录后读（与 Claude Code 一致）

**组织级指令**（可选）：
- Linux: `/etc/drsai/DRSAI.md`
- macOS: `/Library/Application Support/DrSai/DRSAI.md`

### 6.3 @import 语法

DRSAI.md 支持 `@path/to/file` 导入语法，在加载时递归展开：

```markdown
# 项目指令

## 概述
参见 @README.md 了解项目背景

## API 规则
参见 @docs/api-rules.md

## 用户配置
参见 @~/.drsai/configs/USER.md
```

- 相对路径: `@docs/api-rules.md` → 基于 DRSAI.md 所在目录
- 绝对路径: `@/etc/config.json`
- 用户目录: `@~/.drsai/configs/USER.md`
- 递归深度限制: 5 层
- 文件大小限制: 100KB

### 6.4 HTML 注释剥离

DRSAI.md 中非代码块区域的 HTML 注释 (`<!-- ... -->`) 在注入前被自动剥离，节省 context token。代码块内的注释保留不变：

```markdown
<!-- 这行注释会被剥离，不会浪费 token -->
这是实际指令内容。

```python
<!-- 这行注释在代码块内，会被保留 -->
def hello():
    pass
```
```

### 6.5 项目指令命令

| 命令 | 说明 |
|------|------|
| `/init` | 在当前项目目录生成初始 `DRSAI.md` 文件 |
| `/memory` | 显示当前加载的项目指令文件列表 |
| `/memory reload` | 从磁盘重新加载项目指令（编辑 DRSAI.md 后使用） |
| `/memory status` | 显示所有 system prompt 层的注入状态 |

### 6.6 /init 命令详解

`/init` 会分析项目目录结构，自动生成智能的初始 DRSAI.md：

```
/init
# → 在 .drsai/DRSAI.md 创建初始文件
# → 自动检测: git、pyproject.toml、Makefile、Dockerfile、package.json 等
# → 生成: 项目名称、构建命令、编码标准、架构说明等模板
# → 自动将 DRSAI.local.md 加入 .gitignore
```

如果 DRSAI.md 已存在，`/init` 不会覆盖，提示用户手动编辑。

### 6.7 /memory status 输出示例

```
  System prompt layers:
  ───────────────────────────────────────────────────────────
  ① Prefix (session):          0 chars
  ② Developer msg (hardcoded): 512 chars
  ③ AGENTS.md (global):         1024 chars
  ④ Project instructions:       2048 chars
     Source: .drsai/DRSAI.md (45 lines, project (myproject/.drsai))
  ⑤ Session_ID:                 fixed
  ⑥ Suffix (session):           0 chars
  ───────────────────────────────────────────────────────────
```

### 6.8 项目指令的持久化

项目指令在首次加载后通过 `save_state()` 持久化到 Session 状态中。下次恢复同一 Session 时，项目指令从状态中恢复而非重新从磁盘加载，除非用户显式使用 `/memory reload`。

---

## 7 记忆管理

### 7.1 记忆层级

DrSai CLI 的记忆系统通过 `DrSaiSQLiteChatCompletionContext` 实现，内置两个核心工具：

| 工具 | 说明 | 调用方式 |
|------|------|----------|
| `retrieve_from_memory` | 从 SQLite FTS5 全文检索历史记忆 | AI 自动调用或 `/memory` 触发 |
| `summry_conversation_to_memory` | 将对话总结存入长期记忆 | AI 自动调用或手动触发 |
| `read_session_memory_by_index` | 按索引读取压缩前的原始消息 | 用于恢复被压缩的详细内容 |

### 7.2 记忆检索

`retrieve_from_memory` 使用 BM25 排序的 FTS5 全文检索：

- 标准 tokenizer 处理英文/拼音
- Trigram FTS 表处理 CJK/子串查询（标准 tokenizer 无结果时自动回退）
- 支持元数据条件过滤（如按 thread_id）
- 可调节相似度阈值和分页大小

### 7.3 记忆与 Session 的关系

```
Session A (thread_id: aaa...)
  ├── 短期对话记忆: 当前对话历史（自动压缩管理）
  ├── 长期记忆检索: 可跨 Session 搜索所有历史
  └── 状态持久化: save_state() → Thread.state
  
Session B (thread_id: bbb...)
  ├── 短期对话记忆: 独立的对话历史
  ├── 长期记忆检索: 同样可搜索 Session A 的内容
  └── 状态持久化: 独立的 Thread.state
```

短期记忆是 Session 级隔离的，长期记忆是 User 级共享的。

---

## 8 Plan Mode 与 Prompt 注入

### 8.1 Plan Mode

Plan Mode 让 AI 在执行复杂任务前先访谈用户，逐个确认设计决策：

```
/plan_mode on         # 启用（session-local）
/plan_mode off        # 禁用（session-local）
/plan_mode status     # 查看当前状态

/pm on                # 简写
/pm_global on         # 启用并保存为全局默认
/pmg off              # 禁用并保存为全局默认
```

启用后，AI 的 system prompt 会被注入一段 Plan Mode 前缀：

> *"Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer. Ask the questions one at a time."*

**启动时自动启用**：如果配置中 `plan_mode: true` 或使用了 `--plan-mode` 参数，CLI 会在启动时自动注入 Plan Mode 前缀。

### 8.2 /inject 命令

`/inject` 允许动态注入自定义提示词到 system prompt：

```
/inject prefix <text>     # 注入前缀（在 ① 层）
/inject suffix <text>     # 注入后缀（在 ⑥ 层）
/inject clear             # 清除所有注入的 prefix/suffix
/inject status            # 显示当前注入状态
```

**注意**：`/inject` 只修改 prefix/suffix，不影响 project_instructions。如果要修改项目指令，使用 `/memory reload`。

---

## 9 状态与信息查看

| 命令 | 说明 |
|------|------|
| `/status` | 综合状态报告：连接、模型、API Key、Session、Agent 健康 |
| `/info` | Session 配置详情：用户 ID、模型、工具列表、Skills 目录 |
| `/config` | CLI 连接配置（敏感值遮蔽） |

### /status 输出示例

```
  DrSai v1.x  —  CLI Status

  Config:  ~/.drsai/configs/cli_config.json

  Connection
  Server URL     http://localhost:42858/apiv2
  Model          minimax-m2.7-highspeed
  User ID        user@example.com
  LLM config     minimax-m2.7-highspeed
  API key        sk-1...xxxx

  Agent Factory
  LLM catalog     <built-in default>
  Anthropic key   <not set>
  OpenAI key      sk-2...xxxx

  Agent Health
  ✓ Agent connected
  Tools           15 available

  Sessions
  Total saved:    3
    [aaa] myproject <-- current
    [bbb] experiment
    [ccc] default

  Stats   turns=5 tokens=2048→512 last=3.2s
```

---

## 10 安全控制

### 10.1 Workspace 限制 (`/workspace`)

Workspace 限制控制 AI 智能体的文件操作和 Shell 命令路径范围：

| 状态 | 含义 | 行为 |
|------|------|------|
| **on** (默认) | 🔒 限制开启 | 所有文件操作和 Shell 命令被限制在项目目录 (`cwd`) + 内部存储目录 |
| **off** | 🔓 限制关闭 | AI 可访问文件系统上的任何路径 |

```
/workspace on         # 启用限制（默认状态）
/workspace off        # 关闭限制（AI 可访问任意路径）
/workspace status     # 显示当前状态（默认行为）

/ws on                # 简写
/ws off               # 简写
/ws                   # 等同于 /ws status
```

**`/workspace status` 输出示例**：

```
  🔒 Workspace restriction: enabled
    Work dir:  /data/myproject
    Allowed:   /data/myproject, ~/.drsai/workspace/runs/user
    All file/shell operations are restricted to these directories.

  Usage: /workspace [on|off|status]
    on/off   - Enable/disable restriction (session-local)
    status   - Show current status (default)
```

### 10.2 危险命令控制 (`/dangerous`)

危险命令控制决定 AI 智能体的 `run_bash` / `run_bash_background` / `run_powershell` 是否拦截两类危险命令：

| 类别 | 拦截模式 | 被拦截的命令示例 |
|------|----------|-----------------|
| **`_DANGEROUS_PATTERNS`** | 系统级危险命令 | `sudo`, `rm -rf`, `shutdown`, `reboot`, `mkfs`, `dd`, `chmod 777 /` 等 |
| **`_SCRIPT_EXEC_PATTERNS`** | 脚本执行命令 | `python script.py`, `bash script.sh`, `sh script.sh`, `source script.sh`, `. ./script` |

**脚本执行模式的精确性**：`_SCRIPT_EXEC_PATTERNS` 只拦截**脚本文件执行**，不会误拦内联命令：

| 命令 | 是否被拦截 | 原因 |
|------|-----------|------|
| `python3 script.py` | ✅ 拦截 | 执行 .py 脚本文件 |
| `python3 -c "print(1)"` | ❌ 不拦截 | `-c` 是内联表达式，不是脚本执行 |
| `python3 -m pip install numpy` | ❌ 不拦截 | `-m` 是模块模式，不是脚本执行 |
| `bash script.sh` | ✅ 拦截 | 执行 shell 脚本文件 |
| `bash -c 'echo hello'` | ❌ 不拦截 | `-c` 是内联命令 |
| `pip install numpy` | ❌ 不拦截 | 不是脚本执行模式 |

| 状态 | 含义 | 行为 |
|------|------|------|
| **off** (默认) | 🛡 保护开启 | `_DANGEROUS_PATTERNS` + `_SCRIPT_EXEC_PATTERNS` 双重拦截 |
| **on** | ⚠️ 保护关闭 | 所有危险和脚本执行命令不被拦截 |

```
/dangerous on         # 允许所有危险和脚本执行命令
/dangerous off        # 重新开启保护（默认状态）
/dangerous status     # 显示当前状态（默认行为）

/dg on                # 简写
/dg off               # 简写
/dg                   # 等同于 /dg status
```

**被拦截时的返回信息**：

```
  Error: Dangerous command detected. Use /dangerous on to authorize.
  Error: Script execution command detected. Use /dangerous on to authorize.
```

被拦截的 tool call 返回错误字符串给 LLM，LLM 可继续对话并选择安全命令替代，不会中断整个对话流。

### 10.3 状态持久化

`/workspace` 和 `/dangerous` 的状态通过 `save_state()` 持久化到 Session 数据库：

```json
{
  "only_in_workspace": true,
  "dangerous_allowed": false
}
```

- 切换 Session 时，当前状态自动保存，新 Session 的状态自动恢复
- 重启 CLI 后，workspace 和 dangerous 状态从 Session 数据库恢复
- 通过 `load_state()` 中的 toggle helpers 同步闭包变量 (`_only_in_workspace[0]`, `_dangerous_allowed[0]`)

### 10.4 防篡改保护

`set_workspace_restriction`、`get_workspace_status`、`set_dangerous_allowed`、`get_dangerous_status` 四个 toggle 辅助函数被列入 `_TOGGLE_FUNC_NAMES` 过滤集。LLM 无法自行调用这些函数解除限制——只有用户通过 `/workspace` 或 `/dangerous` 命令才能切换状态。

### 10.5 底部工具栏指示

底部工具栏实时显示 workspace 和 dangerous 状态：

| 指示 | 含义 |
|------|------|
| `🔒 ws:on` | Workspace 限制已开启 |
| `🔓 ws:off` | Workspace 限制已关闭 |
| `🛡 dg:off` | 危险命令保护已开启（拦截模式，默认） |
| `⚠️ dg:on` | 危险命令保护已关闭（允许模式） |

工具栏完整示例：

```
  user@example.com @ minimax-m2.7-highspeed  ·  turns: 5  ·  🔒 ws:on  ·  🛡 dg:off
```

---

## 11 显示与交互控制

| 命令 | 说明 |
|------|------|
| `/clear` `/cls` | 清屏并显示 Session 信息 |
| `/verbose` | 切换每轮统计信息 footer（token、耗时、turn 数） |
| `/bell on/off` | 切换终端响铃（响应完成时响铃提示） |
| `/retry` | 重试上一条用户消息 |

**底部工具栏** (Bottom Toolbar)：始终显示当前用户 ID、模型名、turn 数、推理状态、Plan Mode 状态、Workspace 和 Dangerous 状态：

```
  user@example.com @ minimax-m2.7-highspeed  ·  turns: 5  ·  🔒 ws:on  ·  🛡 dg:off
```

| 指示 | 含义 |
|------|------|
| `🔒 ws:on` | Workspace 限制已开启（默认） |
| `🔓 ws:off` | Workspace 限制已关闭 |
| `🛡 dg:off` | 危险命令保护已开启（拦截，默认） |
| `⚠️ dg:on` | 危险命令保护已关闭（允许） |

---

## 12 中断与退出

### 12.1 Ctrl+C 中断

- **第一次 Ctrl+C**: 中断当前命令/LLM 调用，agent 进入 pause → resume 状态重置，可继续对话
- **第二次 Ctrl+C**: 退出 REPL

中断流程：
```
Ctrl+C → agent.pause() → await 0.1s → agent.resume() → "已中断，状态已重置"
```

### 12.2 退出命令

| 命令 | 别名 | 说明 |
|------|------|------|
| `/quit` | `/exit`, `/q` | 保存状态并退出 |

退出流程：
```
/quit → 停止通知轮询器 → 关闭远程 task_manager → _close_agent() → _hard_exit(0)
```

`_hard_exit` 使用 `os._exit()` 强制退出，避免等待后台线程 join（否则用户需要再按一次 Ctrl+C）。

---

## 13 定时任务与通知推送

### 13.1 远程 Worker 模式

配置了 Worker URL (`--url` 或 `cfg.url`) 时，CLI 启动远程定时任务管理：

```
drsai --url http://localhost:42858/apiv2
# → ✓ 定时任务已连接到 worker
# → ✓ 通知轮询已启动 (每30秒)
```

- `RemoteScheduledTaskManager`: 定时任务委托给后台 Worker 进程执行
- 后台轮询器: 每 30 秒检查 Worker 的 `/notifications` 接口
- 有通知时打印到终端：

```
  ✅ 定时任务通知: nightly-build — 成功 (2026-03-01 03:00)
    构建完成，所有测试通过
```

### 13.2 本地模式

无 Worker URL 时，定时任务推送不可用，终端提示：

```
  ℹ 定时任务推送需要 worker 后端 (配置 --url)
```

---

## 14 完整命令速查表

### Session 管理

| 命令 | 别名 | 参数 | 说明 |
|------|------|------|------|
| `/new` | | `[name]` | 创建新 Session |
| `/switch` | | `<id|name>` | 切换到另一个 Session |
| `/list` | `/ls` | | 列出所有 Session |
| `/rename` | | `<name>` | 重命名当前 Session |
| `/history` | | | 显示对话历史 |
| `/save` | | | 保存（自动保存的占位命令） |
| `/retry` | | | 重试上一条消息 |
| `/resume` | | `<id|name>` | 恢复之前的 Session |
| `/search` | | `<query>` | 搜索所有 Session |
| `/copy` | | `[n]` | 复制助手回复到剪贴板 |
| `/clear` | `/cls` | | 清屏 |

### 模型与推理

| 命令 | 别名 | 参数 | 说明 |
|------|------|------|------|
| `/model` | `/m` | `[name|info]` | 查看/切换模型 (session-local) |
| `/model_global` | `/mg` | `[name]` | 切换模型 (session + global) |
| `/models` | | `[reasoning]` | 列出所有可用模型 |
| `/fast` | | `[on|off]` | 快速切换到最快模型 |
| `/reasoning` | | `show|hide|off|low|medium|high` | 推理控制 |

### Plan Mode 与 Prompt 注入

| 命令 | 别名 | 参数 | 说明 |
|------|------|------|------|
| `/plan_mode` | `/pm` | `on|off|status` | Plan Mode (session-local) |
| `/pm_global` | `/pmg` | `on|off|status` | Plan Mode (session + global) |
| `/inject` | | `prefix|suffix|clear|status` | Prompt 注入 |

### 项目指令

| 命令 | 参数 | 说明 |
|------|------|------|
| `/init` | | 创建 DRSAI.md |
| `/memory` | `show|reload|status` | 项目指令管理 |

### 状态与信息

| 命令 | 说明 |
|------|------|
| `/status` | 综合状态报告 |
| `/info` | Session 配置详情 |
| `/config` | CLI 连接配置 |

### 安全控制

| 命令 | 别名 | 参数 | 说明 |
|------|------|------|------|
| `/workspace` | `/ws` | `on|off|status` | Workspace 路径限制（默认 on） |
| `/dangerous` | `/dg` | `on|off|status` | 危险命令执行权限（默认 off，即拦截） |

### 显示控制

| 命令 | 参数 | 说明 |
|------|------|------|
| `/verbose` | | 切换统计 footer |
| `/bell` | `on|off` | 切换终端响铃 |

### 元命令

| 命令 | 别名 | 说明 |
|------|------|------|
| `/help` | `/h`, `/?` | 显示帮助 |
| `/quit` | `/exit`, `/q` | 保存并退出 |

---

## 附录 A: 配置文件路径

| 文件 | 路径 | 说明 |
|------|------|------|
| CLI 配置 | `~/.drsai/configs/cli_config.json` | API Key、模型、Plan Mode 等 |
| Session 存储 | SQLite `Thread` 表 | 对话历史、状态、元数据 |
| Agent Workspace | `~/.drsai/workspace/runs/<user_id>/` | Agent 工作目录 |
| Agent 配置 | `~/.drsai/workspace/runs/<user_id>/configs/` | AGENTS.md、TOOLS_CONFIG.json 等 |
| 项目指令 | `.drsai/DRSAI.md` (项目目录下) | 项目级指令 |
| 组织指令 | `/etc/drsai/DRSAI.md` (Linux) | 组织级策略 |

## 附录 B: 状态保存/恢复数据结构

```json
{
  "type": "DrSaiCLIAssistantState",
  "llm_context": { ... },              // 对话历史（API 级消息列表）
  "defult_config_name": "minimax-m2.7-highspeed",
  "injected_prefix": "",               // Plan Mode 前缀或自定义 prefix
  "injected_suffix": "",               // 自定义 suffix
  "project_instructions": "...",       // DRSAI.md 合并内容
  "reasoning_effort": "medium",        // 推理强度
  "only_in_workspace": true,           // Workspace 限制是否开启
  "dangerous_allowed": false           // 危险命令是否允许执行
}
```

## 附录 C: 项目指令文件大小限制

| 限制 | 值 | 说明 |
|------|-----|------|
| 最大行数 | 200 行 | 超过时发出警告 |
| 最大大小 | 25 KB | 超过时发出警告 |
| @import 递归深度 | 5 层 | 防止循环导入 |
| @import 文件大小 | 100 KB | 单个导入文件上限 |

## 附录 D: 启动时序

```
1. 加载 CLI 配置 (cli_config.json)
2. 初始化本地 SQLite 数据库
3. 打印 Banner
4. 检查 cwd 对应的 Session（恢复或创建）
5. 创建 Agent 实例 (DrSaiCLIAssistant) — 默认 only_in_workspace=True, dangerous_allowed=False
6. Agent.lazy_init()
7. 加载 Thread 状态 (load_state) — 恢复 workspace 和 dangerous 状态
8. 加载项目指令 (DRSAI.md) — 仅在未从状态恢复时
9. 配置远程定时任务（如有 Worker URL）
10. 自动启用 Plan Mode（如配置要求）
11. 进入 REPL 主循环
```