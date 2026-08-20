# OpenDrSai CLI 使用手册
## 目录

**第一部分：手册速查**

1. [总体介绍](#1-总体介绍)
2. [启动与配置](#2-启动与配置)
3. [完整命令速查表](#3-完整命令速查表)

**第二部分：各个块命令的详细解读**

4. [System Prompt 层级架构](#4-system-prompt-层级架构)
5. [Session 管理](#5-session-管理)
6. [Session 搜索与组织](#6-session-搜索与组织)
7. [模型与推理控制](#7-模型与推理控制)
8. [项目指令 (DRSAI.md)](#8-项目指令-drsaimd)
9. [记忆管理](#9-记忆管理)
10. [Plan Mode 与 Prompt 注入](#10-plan-mode-与-prompt-注入)
11. [状态与信息查看](#11-状态与信息查看)
12. [安全控制](#12-安全控制)
13. [图像多模态输入与 @ 文件路径引用 🆕](#13-图像多模态输入与-文件路径引用-)
14. [显示与交互控制](#14-显示与交互控制)
15. [中断与退出](#15-中断与退出)
16. [定时任务与通知推送](#16-定时任务与通知推送)
17. [TUI 行为与调优](#17-tui-行为与调优)
18. [Skill 管理](#18-skill-管理)
19. [Daemon 后台常驻服务](#19-daemon-后台常驻服务)
20. [微信接入](#20-微信接入)
21. [Subagent（子智能体 / Delegate）](#21-subagent子智能体-delegate)
22. [GFS 高能所文件系统集成](#22-gfs-高能所文件系统集成)

**附录**

- [附录 A: 配置文件路径](#附录-a-配置文件路径)
- [附录 B: 状态保存/恢复数据结构](#附录-b-状态保存恢复数据结构)
- [附录 C: 项目指令文件大小限制](#附录-c-项目指令文件大小限制)
- [附录 D: 启动时序](#附录-d-启动时序)
- [附录 E: 子智能体状态保存/恢复](#附录-e-子智能体状态保存恢复)

---
> **第一部分：手册速查** — 快速查阅所有命令与配置

---

## 1 总体介绍

### 1.1 OpenDrSai CLI 是什么？

OpenDrSai CLI 是 OpenDrSai 智能体框架的**本地交互式终端客户端**。在终端里即可与 AI 智能体连续对话、调用工具、管理多个会话，无需部署远程服务。也支持远程附加模式，连接到远端 gateway 运行。

### 1.2 核心能力一览

| 功能 | 说明 |
|------|------|
| **连续多轮对话** | 流式输出、工具调用、思考过程可视化 |
| **多 Session 管理** | 创建、切换、搜索、恢复多个独立会话，与工作目录自动绑定 |
| **项目指令系统** | 自动发现并加载项目目录中的 `DRSAI.md` / `CLAUDE.md`，让 AI 理解项目上下文 |
| **记忆管理** | 短期对话记忆 + 长期学习记忆，支持跨会话检索和手动摘要压缩 (`/compress`) |
| **动态模型切换** | 会话内即时切换 LLM 模型，支持 session-local 和 global 两种模式 |
| **Plan Mode** | 启用后 AI 先访谈用户确认计划再执行，适合复杂任务规划 |
| **推理控制** | 推理过程可视化、推理强度调节 (off / low / medium / high / xhigh) |
| **安全控制** | Workspace 路径限制 + 危险命令拦截，防止越界访问和误操作 |
| **Session 搜索与组织** | 自然语言搜索 (`/find`)、标签 (`/tag`)、置顶 (`/pin`)、归档 (`/archive`) |
| **子智能体 (Delegate)** | 将子任务委派给专门的子智能体，支持并行执行和并发控制 |
| **Skill 管理** | 安装、查看、删除、热重载技能，无需重启即可生效 |
| **Daemon 后台常驻** | gateway 提升为独立后台进程，TUI 随时 attach / detach |
| **微信接入** | 通过 ilink Bot 让微信用户与 Agent 对话，多用户独立会话 |
| **GFS 集成** | 通过 function-calling 直接读写高能所文件系统 bucket |
| **定时任务** | 配合 Worker 后端创建后台定时任务，终端自动推送完成通知 |
| **图像多模态输入** | `/image` 命令或 `@/path` 引用向视觉模型传入图像 |

---

---

## 2 启动与配置

### 2.1 安装

Linux/MacOS：`curl -fsSL https://ihepbox.ihep.ac.cn/ihepbox/index.php/s/vQFBjvXqAhxdPFb/download | bash`

Windows：`iwr -UseBasicParsing https://ihepbox.ihep.ac.cn/ihepbox/index.php/s/cG0oB5NEhQiEf5r/download | iex`

`请注意， Powershell版本需要>=5.1`

### 2.2 启动方式

**请注意，使用源码安装，或者老版本，使用以下所有命令时，将`opendrsai`命令换成`drsai`即可。**

```bash
# 默认启动（启动 Ink TUI + 自动 spawn gateway）
opendrsai

# 显式 chat 子命令
opendrsai chat

# 附加到远程 gateway（替代本地 spawn）
opendrsai chat --attach ws://remote-host:8765/attach

# 仅启动 gateway（不弹 UI，作为远程会话被附加）
opendrsai tui-gateway       # 设置 DRSAI_TUI_ENABLE_WS=1 开放 WebSocket

# 旧版 SSE gateway（仅供 Electron 桌面端兼容）
opendrsai gateway --port 8642
```

**相关链接**：

| 资源 | 地址 |
|------|------|
| 官网 | <https://opendrsai.ihep.ac.cn/> |
| TUI 启动界面操作指南 | <https://note.ihep.ac.cn/s/QgtE3Nlx2> |

**Node.js 依赖说明**：TUI 需要 Node.js ≥ 20。`opendrsai` 启动时按以下顺序解析：
1. `$DRSAI_NODE`（显式指定）
2. 系统 `node`（PATH 上）
3. `pnpm dev` / `npm run dev`（开发模式，源文件热加载）
4. 自动下载便携 Node 到 `~/.drsai/cache/node`（约 25 MB，仅在 wheel 内带 `dist/entry.mjs` 时启用）

设置 `DRSAI_NODE_NO_DOWNLOAD=1` 可禁用自动下载。设置 `DRSAI_NODE_MIRROR=https://npmmirror.com/mirrors/node` 可换镜像。

### 2.3 TUI 启动界面

启动后，终端会依次展示以下界面。首次运行和后续启动的体验不同。

#### 启动 Banner

终端顶部显示金色 banner，不清屏，保留之前的终端输出：

```
⚡ OpenDrSai
```

#### 首次运行 — 配置向导

首次启动（无配置文件且无 API Key 时），TUI 自动进入交互式配置向导：

```
⚡ OpenDrSai · setup

First run — choose a provider and enter your API key.

Your user id
  user › _                        ← 输入用户名（Enter 默认 anonymous）

Choose a provider:
▶ 1. HepAI        — 推荐 — IHEP/CAS 高速访问
  2. Anthropic    — Claude 系列模型
  3. OpenAI       — GPT 系列模型
  4. Skip         — 我会通过环境变量设置
                                  ← ↑/↓ 选择，Enter 确认，1-4 快捷跳转

HepAI API Key
Need one? visit https://aiapi.ihep.ac.cn/
  key › _                        ← 粘贴 API Key，Enter 提交

Base URL (optional — Enter to skip)
  url › _                        ← 留空使用默认地址

○ Saving config…
✓ Saved. Starting TUI…
```

**Provider 一览**：

| 选项 | Provider | 获取 Key 地址 | 默认 Base URL |
|------|----------|--------------|---------------|
| 1 | **HepAI**（推荐） | <https://aiapi.ihep.ac.cn/> | `https://aiapi.ihep.ac.cn/apiv2` |
| 2 | Anthropic | <https://console.anthropic.com/> | `https://api.anthropic.com` |
| 3 | OpenAI | <https://platform.openai.com/api-keys> | `https://api.openai.com/v1` |
| 4 | Skip | — | 通过环境变量设置 |

> 选择 Skip 会保存空配置，不再每次启动都弹出向导；后续可通过 `opendrsai config --api-key <KEY>` 补填。

#### 后续启动 — 恢复会话

配置完成后，后续启动直接恢复上次会话：

```
⚡ OpenDrSai
○ connecting to gateway…
○ resuming session myproject (a1b2…)…  first run can take ~30-60s for skill loading
📋 Memory  ~/.drsai/.../MEMORY.md (2/15 entries)

[ 对话区 ]
  user@example.com @ minimax-m2.7-highspeed  ·  turns: 5  ·  🔒 ws:on  ·  🛡 dg:off
  › _
```

- **Session 自动绑定**：根据当前工作目录自动恢复或创建 Session
- **Memory banner**：如果 `MEMORY.md` 有内容，启动时显示条目数摘要
- **首次 skill 加载**：第一次恢复某 Session 时需 30–60 秒加载技能，后续启动很快

#### 启动故障

如果 gateway 启动失败，显示：

```
✗ Failed to start: <错误信息>
Press Ctrl+D to exit.
```

### 2.4 CLI 参数

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

### 2.5 首次配置（命令行方式）

> TUI 内的首次配置向导见 [§2.3 TUI 启动界面](#23-tui-启动界面)。本节描述通过命令行参数或环境变量的配置方式。

如果 `cli_config.json` 不存在且无参数覆盖，CLI 会启动交互式配置向导：

```
  Welcome to DrSai CLI! Let's configure your profile.

  Config will be saved to: ~/.drsai/configs/cli_config.json

  Your user id: [anonymous]
  Default model name (e.g. minimax-m2.7-highspeed): 
```

配置文件位置: `~/.drsai/configs/cli_config.json`

### 2.6 配置管理（外部子命令）

除了 REPL 内的 `/config`，还有外部 Typer 子命令：

```bash
# 查看/更新配置
opendrsai config --show                # 显示当前配置（敏感值已遮蔽）
opendrsai config --json                # JSON 格式输出
opendrsai config --api-key <KEY>       # 更新 API Key
opendrsai config --plan-mode true      # 设置全局 Plan Mode

# Session 管理
opendrsai sessions                     # 列出所有已保存 Session
opendrsai sessions --clear             # 清除所有 Session

# 版本信息
opendrsai version                      # 显示版本号
```

---

---

## 3 完整命令速查表

### Session 管理

| 命令 | 别名 | 参数 | 说明 |
|------|------|------|------|
| `/new` | | `[name]` | 创建新 Session |
| `/switch` | | `<id\|name>` | 切换到另一个 Session |
| `/list` | `/ls` | | 列出所有 Session（默认排除已归档） |
| `/rename` | | `<name>` | 重命名当前 Session |
| `/history` | | | 显示对话历史 |
| `/save` | | | 保存（自动保存的占位命令） |
| `/retry` | | | 重试上一条消息 |
| `/resume` | | `<id\|name>` | 恢复之前的 Session |
| `/search` | | `<query>` | 搜索所有 Session（子串匹配） |
| `/copy` | | `[n]` | 复制助手回复到剪贴板 |
| `/clear` | `/cls` | | 清屏 |

### Session 搜索与组织

| 命令 | 别名 | 参数 | 说明 |
|------|------|------|------|
| `/find` | | `<query> [--cwd]` | 自然语言搜索 Session（语义+关键词混合，BM25 排名） |
| `/tag` | | `add\|remove\|list [tags...]` | 管理 Session 标签 |
| `/pin` | | | 置顶当前 Session |
| `/unpin` | | | 取消置顶 |
| `/archive` | | `[off]` | 归档当前 Session（隐藏）；`off` 取消归档 |

### 模型与推理

| 命令 | 别名 | 参数 | 说明 |
|------|------|------|------|
| `/model` | `/m` | `[name\|info\|add\|edit\|rm]` | 查看/切换模型 / 打开 ModelPicker / 管理模型库 |
| `/model add` | | `[alias]` | 弹出表单创建新模型；保存后自动切到新别名 |
| `/model edit` | | `[alias]` | 编辑已有模型；省略 alias 时先弹 picker |
| `/model rm` | | `<alias>` | 删除别名；当前会话/全局默认若被删自动 fallback |
| `/model_global` | `/mg` | `[name]` | 切换模型 (session + global) |
| `/models` | `/listmodels` | | 列出所有可用模型 |
| `/fast` | | `[on\|off]` | 快速切换到最快模型 |
| `/reasoning` | | `show\|hide\|off\|low\|medium\|high` | 推理控制（show/hide 通过 UI action 同步前端） |

### Plan Mode 与 Prompt 注入

| 命令 | 别名 | 参数 | 说明 |
|------|------|------|------|
| `/plan_mode` | `/pm` | `on\|off\|status` | Plan Mode (session-local) |
| `/pm_global` | `/pmg` | `on\|off\|status` | Plan Mode (session + global) |
| `/inject` | | `prefix\|suffix\|clear\|status` | Prompt 注入 |

### 项目指令

| 命令 | 参数 | 说明 |
|------|------|------|
| `/init` | | 创建 DRSAI.md |
| `/memory` | `show\|reload\|status` | 项目指令管理 |

### 记忆管理

| 命令 | 别名 | 参数 | 说明 |
|------|------|------|------|
| `/compress` | `/cmp` | `[keep_recent=N\|status]` | 手动压缩对话记忆（LLM 摘要），默认保留最近 6 条；`status` 查看 token 使用情况 |

### 状态与信息

| 命令 | 说明 |
|------|------|
| `/status` | 综合状态报告 |
| `/info` | Session 配置详情 |
| `/config` | CLI 连接配置 |

### 安全控制

| 命令 | 别名 | 参数 | 说明 |
|------|------|------|------|
| `/workspace` | `/ws` | `on\|off\|status` | Workspace 路径限制（默认 on） |
| `/dangerous` | `/dg` | `on\|off\|status` | 危险命令执行权限（默认 off，即拦截） |

### 图像多模态输入 🆕

| 命令 | 别名 | 参数 | 说明 |
|------|------|------|------|
| `/image` | `/img` | `<path> [path...] [描述]` | 发送一张或多张图像（可附带文字描述） |
| `@` | — | — | 在输入框中输入 `@` 激活 Path mode，列出当前目录文件/目录，选中后插入路径；带图像扩展名的 `@/path` 自动作为多模态附件发送 |

> 详见 [§13 图像多模态输入与 @ 文件路径引用](#13-图像多模态输入与--文件路径引用-)。

### 显示控制

| 命令 | 参数 | 说明 |
|------|------|------|
| `/verbose` | | 切换统计 footer |
| `/bell` | `on\|off` | 切换终端响铃 |

### 元命令

| 命令 | 别名 | 说明 |
|------|------|------|
| `/help` | `/h`, `/?` | 显示帮助 |
| `/quit` | `/exit`, `/q` | 优雅退出（保存状态） |
| Ctrl+D | — | 强制退出（任何状态均有效） |

### Subagent (子智能体/Delegate)

| 命令 | 别名 | 参数 | 说明 |
|------|------|------|------|
| `/agent` | | `<name>\|list\|clear` | 设置/清除默认子智能体，或列出所有可用子智能体 |
| `/delegate` | `/sub` | `<agent_type> <prompt>` | 手动向子智能体委派任务 |
| `/max_concurrent` | `/mc` | `<number\|status>` | 设置子智能体最大并行数（全局持久化） |

### Daemon 管理 (CLI)

| 命令 | 参数 | 说明 |
|------|------|------|
| `opendrsai daemon start` | `--name` `--port` `--wechat` `--wechat-port` `--model` `--restart` | 启动后台 daemon；加 `--wechat` 时若微信凭据缺失则自动触发终端扫码登录 |
| `opendrsai daemon stop` | `--name` `--all` | 停止 daemon（SIGTERM 优雅退出） |
| `opendrsai daemon status` | — | 查看所有 daemon 运行状态（PID、端口、模型、uptime） |
| `opendrsai daemon list` | `--json` | 输出精简列表，`--json` 为 JSON 格式 |
| `opendrsai daemon logs` | `--name` `--tail` `--follow` | 查看 daemon 日志 |
| `opendrsai daemon send` | `--name` `--session` `<消息>` | 向 daemon 中的 session 发送消息（调试用） |

### 微信接入 (CLI)

| 命令 | 参数 | 说明 |
|------|------|------|
| `opendrsai wechat login` | — | 单独执行微信 ilink Bot 扫码登录（保存凭据到 credentials.json） |

> **自动登录**：`opendrsai daemon start --wechat` 会在凭据缺失或过期时自动触发扫码流程，无需手动运行 `opendrsai wechat login`。

### TUI 内 Daemon 命令

| 命令 | 别名 | 参数 | 说明 |
|------|------|------|------|
| `/daemons` | — | — | 打开 Daemon 管理面板（attach / stop / 查看日志） |
| `/daemon-model` | `/dmodel` | `<name> [model]` | 查看或切换 daemon 模型 |


### Skill 管理

| 命令 | 别名 | 参数 | 说明 |
|------|------|------|------|
| `/skills` | `/skill` | | 打开 Skill 管理面板（查看 / 删除 / 热重载） |

> 详见 [§18 Skill 管理](#18-skill-管理)。

### GFS 集成

| 命令 | 别名 | 参数 | 说明 |
|------|------|------|------|
| `/gfs` | — | — | 打开 GFS 配置面板（状态查看、内联编辑、测试连接、清除配置） |

> GFS (高能所文件系统) 集成让 Agent 通过 function-calling 直接读写用户的 GFS bucket。详见 [§22](#22-gfs-高能所文件系统集成)。

---

---

> **第二部分：各个块命令的详细解读** — 每个功能模块的原理、流程与细节

---

## 4 System Prompt 层级架构

OpenDrSai CLI 的 System Prompt 由 6 个层级组成，从上到下排列。**越靠后的层级，LLM 越重视**：

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

---

## 5 Session 管理

Session 是 OpenDrSai CLI 的核心组织单元。每个 Session 有独立的对话历史、模型配置、注入提示词和项目指令。

### 5.1 自动 Session 绑定

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

### 5.2 Session 命令

| 命令 | 别名 | 参数 | 说明 |
|------|------|------|------|
| `/new` | | `[name]` | 创建新 Session。可选指定名称，默认以 cwd 目录名命名 |
| `/switch` | | `<id\|name>` | 切换到另一个 Session。可用 ID 前缀或名称匹配 |
| `/list` | `/ls` | | 列出所有 Session（默认排除已归档），标记当前 Session 和工作目录 |
| `/rename` | | `<name>` | 重命名当前 Session |
| `/history` | | | 显示当前 Session 的对话历史（每条消息截断到 80 字符） |
| `/save` | | | 手动保存（实际上每轮对话后自动保存，此命令为占位） |
| `/resume` | | `<id\|name>` | 恢复之前的 Session 并显示历史消息数 |
| `/search` | | `<query>` | 在所有 Session 中搜索（子串匹配，大小写不敏感） |
| `/find` | | `<query> [--cwd]` | 自然语言搜索 Session（语义+关键词混合，BM25 排名）。加 `--cwd` 限定当前目录 |
| `/tag` | | `add\|remove\|list [tags...]` | 管理 Session 标签 |
| `/pin` | | | 置顶当前 Session（在列表和快速访问中优先显示） |
| `/unpin` | | | 取消置顶 |
| `/archive` | | `[off]` | 归档当前 Session（从默认列表隐藏，可通过 `/find` 搜索恢复）；`off` 取消归档 |
| `/copy` | | `[n]` | 复制第 n 条最近的助手回复到剪贴板（默认 n=1） |

### 5.3 Session 切换流程

```
/switch my-session     →  1. 保存当前 agent 状态 (save_state)
                          2. 关闭当前 agent (_close_agent)
                          3. 切换 current_session_id
                          4. 初始化新 agent (_init_agent)
                          5. 加载新 Session 的历史状态 (load_state)
                          6. 加载/恢复项目指令
```

### 5.4 Session 状态持久化

每次对话轮次结束时，CLI 自动执行：

1. `agent.save_state()` → 收集完整状态（对话历史、模型、注入提示词、项目指令、推理强度）
2. `_save_thread_state()` → 压缩并写入 SQLite `Thread.state`
3. 更新 `Thread.status` 和 `Thread.updated_at`

---

---

## 6 Session 搜索与组织

当 Session 数量增多时，传统的 `/list` 和 `/search`（子串匹配）难以快速定位目标会话。OpenDrSai 提供了一套搜索与组织工具，让大量 Session 有序可查。

### 6.1 `/find` — 自然语言搜索

`/find` 使用 **语义+关键词混合搜索** 策略（三阶段）：

1. **关键词预筛选**: name + preview + workdir 子串匹配（快）
2. **FTS5 深度搜索**: 通过 `session_search_fts` 表 BM25 排名（中）
3. **综合评分**: 时间衰减 + 工作目录相关性 + 置顶加成

```bash
# 按内容语义搜索
/find 修复登录 bug 的那次会话
→ 🎯 myapp-auth-fix (3 days ago, 42 msgs) 相关度: 0.87

# 按项目+任务搜索
/find drsai 项目的 session 管理
→ 🎯 drsai-session-mgmt (current, 15 msgs) 相关度: 0.95

# 限定工作目录
/find --cwd 性能优化
→ 仅在当前工作目录的 Session 中搜索
```

> **底层实现**: 搜索使用 `session_search_fts`（trigram 分词器，支持 CJK 和部分匹配），启动时自动回填历史 Thread 数据，确保旧 Session 也能被检索。

### 6.2 `/tag` — 标签管理

为 Session 添加自定义标签，便于分类和筛选：

```bash
# 添加标签
/tag add bug urgent
→ ✓ 添加标签: #bug #urgent

# 查看标签
/tag list
→ Tags: bug, urgent, frontend

# 移除标签
/tag remove bug
→ ✓ 移除标签: #bug
```

标签存储在 `Thread.meta.tags` 中，并同步到 `session_search_fts`，可被 `/find` 搜索。

### 6.3 `/pin` / `/unpin` — 置顶

置顶的 Session 在 `/list`、`session.quick_access`、`session.workspace_map` 中优先显示：

```bash
/pin       → 📌 当前 Session 已置顶
/unpin     → 取消置顶
```

### 6.4 `/archive` — 归档

归档的 Session 从默认列表中隐藏，但仍可通过 `/find` 搜索恢复：

```bash
/archive          → 归档当前 Session（从默认列表隐藏）
/archive off      → 取消归档，重新出现在列表中
```

> **行为细节**: 归档后 `session.list` 默认排除该 Session，`session.most_recent` 也不会自动恢复归档 Session。`session.list` 支持 `include_archived=true` 参数包含归档项。

### 6.5 新增 RPC 方法

| 方法 | 说明 |
|------|------|
| `session.smart_search` | 语义+关键词混合搜索，返回 BM25 排名结果 |
| `session.workspace_map` | 工作目录→Session 映射 + 推荐 |
| `session.quick_access` | 优先级排序快速访问列表（workdir > pinned > recent） |
| `session.tag_add` | 添加标签 |
| `session.tag_remove` | 移除标签 |
| `session.pin` | 置顶 |
| `session.unpin` | 取消置顶 |
| `session.archive` | 归档/取消归档 |

### 6.6 SessionInfo 扩展字段

`SessionInfo` 数据结构新增以下字段（旧 Session 自动填充默认值，完全兼容）：

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `tags` | `list[str]` | `[]` | 用户自定义标签 |
| `pinned` | `bool` | `False` | 是否置顶 |
| `archived` | `bool` | `False` | 是否归档 |
| `relevance_score` | `float` | `0.0` | 搜索相关度评分 |

### 6.7 数据库底层变更

| 变更 | 说明 |
|------|------|
| `session_search_fts` FTS5 虚拟表 | Session 元数据搜索索引（trigram 分词） |
| 3 个 `idx_thread_*` 索引 | `user+workdir`、`user+updated_at`、`user+archived` |
| 3 个 `session_search_fts_*` 触发器 | INSERT/DELETE/UPDATE 自动同步 |
| 启动时自动回填 | 确保 `session_search_fts` 包含所有历史 Thread |

---

---

## 7 模型与推理控制

### 7.1 模型切换

OpenDrSai CLI 支持在会话内即时切换模型，有两种模式：

| 命令 | 别名 | 作用域 | 说明 |
|------|------|--------|------|
| `/model <alias>` | `/m` | session-local | 仅当前会话切换，不影响全局配置 |
| `/model_global <alias>` | `/mg` | session + global | 当前会话切换 + 保存为全局默认 |

**其他用法**：

```
/model                # 无参 → 弹出 ModelPicker 覆盖层
/model info <alias>   # 查看模型详细信息（model ID、token limit、推理支持）
```

**ModelPicker 快捷键**（在覆盖层内）：

| 按键 | 行为 |
|------|------|
| `↑/↓` | 移动光标 |
| `Enter` | 切换到光标行 |
| `1-9` | 跳到第 N 项并切换 |
| `f-z` | 跳到第 10+ 项并切换 |
| `a` | 新增模型（打开 ModelEditor） |
| `e` | 编辑光标行（打开 ModelEditor） |
| `d` | 删除光标行 |
| `Esc` | 关闭 |

### 7.2 模型库管理（add / edit / rm）

模型目录持久化到 `cli_config.json` 中 `llm_config_file` 指向的 YAML 文件。修改后**无需重启**，新别名立即可用。

```
/model add                      # 弹出空白表单
/model add <alias>              # 弹出表单，alias 预填
/model edit <alias>             # 直接编辑指定 alias
/model edit                     # 先弹 ModelPicker，按 e 选要编辑的
/model rm <alias>               # 删除别名
```

**ModelEditor 表单字段**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `alias` * | 文本 | 必填；不能含空格、不能以 `_` 开头 |
| `model_id` * | 文本 | 必填；如 `openai/gpt-5.5`、`anthropic/claude-sonnet-4-6` |
| `token_limit` | 整数 | 上下文窗口大小（输入 + 输出共享或独立，按模型而定） |
| `max_tokens` | 整数 | 单次最大输出 token；`0` = 自动（≈ token_limit × 25%） |
| `client_type` | 枚举 | `auto` / `openai` / `anthropic` |
| `reasoning supported` | 复选框 | 是否启用推理；关闭时下面两行禁用 |
| `param_type` | 枚举 | `none` / `adaptive` / `enabled` / `is_r1_model` / `reasoning_effort` / `minimax_format` / `zhipu_format` |
| `effort_levels` | 文本 | 逗号分隔，例如 `low,medium,high`；空 = 任意强度 |

**ModelEditor 快捷键**：

| 按键 | 行为 |
|------|------|
| `Tab` / `Shift+Tab` | 切换字段焦点（自动跳过禁用项） |
| `↑/↓` | 同上 |
| `←/→` | 切换枚举值（`client_type` / `param_type`） |
| `Space` | 切换复选框 / 推进枚举 |
| 任意可见字符 | 文本字段编辑；number 字段只接受数字 |
| `Backspace` | 删除一字符 |
| `Enter` | 提交（前端最低校验 + 后端权威校验） |
| `Esc` | 取消（不写盘） |

**提交语义**：
- 新增 alias：保存成功后**自动切到该模型**（session-local）。
- 编辑 alias 且不改名：当前会话不会自动重新加载该 alias 的 client，下次 `/model <alias>` 会拿到新配置。
- 编辑时改名（`alias` 改成了新值）：旧 alias 从目录中删除；新 alias 自动切到当前会话；如果旧 alias 是全局默认，自动改写默认指针。
- 校验失败：错误信息红字显示在表单底部，表单不关闭，用户改完再 Enter。

**后端校验规则**（所有规则在 `model.save` RPC 中强制执行）：
- `alias`：非空、不含空格、首字符字母数字、不以 `_` 开头、不与现有 alias 冲突（编辑时排除自己）
- `model_id`：非空
- `client_type` ∈ `{auto, openai, anthropic}`
- 若 `reasoning.supported = true`，`param_type` 必须在白名单内
- `token_limit` 和 `max_tokens` 必须为非负整数

**删除规则**：
- 不能删除最后一个剩余 alias（避免目录为空）
- 删除的若是当前会话使用的模型，自动切到第一个剩余 alias
- 删除的若是全局默认，自动改写默认指针到第一个剩余 alias

### 7.3 模型列表

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
    claude-sonnet-4-6                 ✅ extended      adaptive
    deepseek-v4-pro                   ✅ R1 model      unlimited
  ──────────────────────────────────────────────────────────────────────
```

### 7.4 快速模式

```
/fast                 # 切换到最快的模型别名（自动识别 highspeed/flash/haiku）
/fast off             # 切换回默认模型
```

### 7.5 推理控制

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

---

## 8 项目指令 (DRSAI.md)

### 8.1 设计理念

项目指令系统借鉴了 Claude Code 的 `CLAUDE.md` 机制，但适配了 OpenDrSai 的架构。它让 AI 在每次会话开始时自动理解你的项目上下文——构建命令、编码标准、架构决策、常见工作流等。

### 8.2 文件发现机制

从当前工作目录 (`cwd`) **向上遍历**目录树，发现指令文件：

**每个目录层级内的优先级**（只取第一个存在的）：

| 优先级 | 文件 | 说明 |
|--------|------|------|
| 1 | `.drsai/DRSAI.md` | OpenDrSai 原生格式（推荐） |
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

### 8.3 @import 语法

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

### 8.4 HTML 注释剥离

DRSAI.md 中非代码块区域的 HTML 注释 (`<!-- ... -->`) 在注入前被自动剥离，节省 context token。代码块内的注释保留不变：

````markdown
<!-- 这行注释会被剥离，不会浪费 token -->
这是实际指令内容。

```python
<!-- 这行注释在代码块内，会被保留 -->
def hello():
    pass
```
````

### 8.5 项目指令命令

| 命令 | 说明 |
|------|------|
| `/init` | 在当前项目目录生成初始 `DRSAI.md` 文件，并显示前 15 行预览 |
| `/memory` | 等同于 `/memory status` |
| `/memory show` | 显示完整项目指令内容（无截断） |
| `/memory reload` | 从磁盘重新加载项目指令并注入到当前会话（编辑 DRSAI.md 后立即生效） |
| `/memory status` | 列出所有发现的项目指令文件（路径、scope、行数、KB） |

### 8.6 /init 命令详解

`/init` 调用 `init_project_instructions(cwd)` 完成：

```
/init
# → 在 .drsai/DRSAI.md 创建初始文件
# → 自动检测: git、pyproject.toml、Makefile、Dockerfile、package.json 等
# → 生成: 项目名称、构建命令、编码标准、架构说明等模板
# → 自动将 DRSAI.local.md 加入 .gitignore
# → 在 TUI 覆盖层显示文件路径 + 前 15 行预览
```

如果 DRSAI.md 已存在，`/init` 不会覆盖，提示"Already exists" 并附加 reload 指引。

### 8.7 /memory status 输出示例

```
  Project instruction files:
    [org]     /etc/drsai/DRSAI.md             (32 lines)
    [project] /data/myproject/.drsai/DRSAI.md (45 lines, 1.8 KB)
    [local]   /data/myproject/DRSAI.local.md  (12 lines, 0.4 KB)

  Total: 2 project file(s), 57 lines, 2.2 KB
```

### 8.8 /memory reload 详解

```
/memory reload
# 1. load_project_instructions(cwd) 重新发现 + 拼接 + 展开 @imports
# 2. agent.inject_system_prompt(project_instructions=content)
# 3. 触发 session.info 刷新（让 status bar / badges 更新）
# 4. 显示已加载文件清单 + 任何警告
```

注意：reload 后**当前会话立即生效**，下一轮提问就会带上新指令。无需 `/clear` 或重启。

### 8.9 项目指令的持久化

项目指令在首次加载后通过 `save_state()` 持久化到 Session 状态中。下次恢复同一 Session 时，项目指令从状态中恢复而非重新从磁盘加载，除非用户显式使用 `/memory reload`。

---

---

## 9 记忆管理

### 9.1 记忆层级

OpenDrSai CLI 的记忆系统通过 `DrSaiSQLiteChatCompletionContext` 实现，内置两个核心工具：

| 工具 | 说明 | 调用方式 |
|------|------|----------|
| `retrieve_from_memory` | 从 SQLite FTS5 全文检索历史记忆 | AI 自动调用或 `/memory` 触发 |
| `summry_conversation_to_memory` | 将对话总结存入长期记忆 | AI 自动调用或手动触发 |
| `read_session_memory_by_index` | 按索引读取压缩前的原始消息 | 用于恢复被压缩的详细内容 |

### 9.2 手动压缩 (`/compress`)

`/compress` 命令主动触发 LLM 摘要压缩，无需等待 token 超限自动触发。

**语法**：

```
/compress                    使用默认 keep_recent=6 压缩
/compress keep_recent=N      保留最近 N 条消息，压缩更早的消息
/compress 10                 等价于 keep_recent=10
/cmp                         别名
/compress status             查看 token 使用情况（不执行压缩）
```

**压缩流程**（三层）：

1. **Layer 0 — flush**：将内存中待写的消息刷新到 `SessionMessage` 表
2. **Layer 1 — 工具结果清除**：`_compress_tool_results()` 将旧的工具调用结果替换为占位符（原始内容仍在 DB 中，可通过 `read_session_memory_by_index` 取回）
3. **Layer 2 — LLM 摘要**：`_incremental_compress()` 将 `keep_recent` 之前的消息发给 LLM 生成摘要，用一条 `UserMessage("[Compressed conversation history]\n{摘要}")` 替换旧消息；摘要同时写入 `SessionSummary` 表供 FTS5 检索

**压缩效果示例**：

```
✅ Memory compressed successfully!
  Messages:  28 → 7 (compressed 21)
  Tokens:    18500 → 3200 (saved 15300, 82.7%)

  Summary preview:
  用户讨论了 DrSai 项目的两个 bug 修复：SYSTEM_SKILLS_DIR 路径转义问题和 TUI banner 重复打印…
```

**进度反馈**：压缩期间（LLM 调用通常 10–60 秒），TUI 底部状态栏显示旋转 spinner 动画 `⠋ 正在压缩记忆 (保留最近 N 条)…`，完成后自动清除。

**注意事项**：

- 压缩仅修改内存中的 `_messages`，**不会删除** `SessionMessage` 表中的原始消息行
- 压缩后的状态通过 `save_state()` 持久化到 `Thread.state`，下次回溯时加载的是压缩后的消息列表
- 原始消息可通过 `retrieve_from_memory`（FTS5 检索）或 `read_session_memory_by_index`（按索引取回）访问
- 如果消息数 ≤ `keep_recent`，压缩不会执行（无需压缩）

### 9.3 记忆检索

`retrieve_from_memory` 使用 BM25 排序的 FTS5 全文检索：

- 标准 tokenizer 处理英文/拼音
- Trigram FTS 表处理 CJK/子串查询（标准 tokenizer 无结果时自动回退）
- 支持元数据条件过滤（如按 thread_id）
- 可调节相似度阈值和分页大小

### 9.4 记忆与 Session 的关系

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

---

## 10 Plan Mode 与 Prompt 注入

### 10.1 Plan Mode

Plan Mode 让 AI 在执行复杂任务前先访谈用户，逐个确认设计决策：

```
/plan_mode on         # 启用（session-local）
/plan_mode off        # 禁用（session-local）
/plan_mode status     # 查看当前状态

/pm on                # 简写
/pm_global on         # 启用并保存为全局默认
/pmg off              # 禁用并保存为全局默认
```

启用后，AI 的 system prompt 第 ① 层会被注入 `PLAN_MODE_SYSTEM_PROMPT` 常量（定义在 `backend/run_drsai_agent_factory.py:37`）：

> *"Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer. Ask the questions one at a time. If a question can be answered by exploring the codebase, explore the codebase instead."*

**启动时自动启用**：如果配置中 `plan_mode: true` 或使用了 `--plan-mode` 参数，CLI 会在启动时自动注入 Plan Mode 前缀。

**运行时切换**：`/plan_mode on` 不仅会写 `agent._injected_prefix = PLAN_MODE_SYSTEM_PROMPT`，还会立刻调用 `agent.update_system_prompt()` 重建 system message，下一轮提问立即带上前缀。`off` 会清空 prefix 并重建。

### 10.2 /inject 命令

`/inject` 允许动态注入自定义提示词到 system prompt：

```
/inject prefix <text>     # 注入前缀（在 ① 层）
/inject suffix <text>     # 注入后缀（在 ⑥ 层）
/inject clear             # 清除所有注入的 prefix/suffix
/inject status            # 显示当前注入状态
```

**注意**：`/inject` 只修改 prefix/suffix，不影响 project_instructions。如果要修改项目指令，使用 `/memory reload`。

---

---

## 11 状态与信息查看

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

---

## 12 安全控制

### 12.1 Workspace 限制 (`/workspace`)

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

### 12.2 危险命令控制 (`/dangerous`)

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

### 12.3 状态持久化

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

### 12.4 防篡改保护

`set_workspace_restriction`、`get_workspace_status`、`set_dangerous_allowed`、`get_dangerous_status` 四个 toggle 辅助函数被列入 `_TOGGLE_FUNC_NAMES` 过滤集。LLM 无法自行调用这些函数解除限制——只有用户通过 `/workspace` 或 `/dangerous` 命令才能切换状态。

### 12.5 底部工具栏指示

底部工具栏实时显示 workspace 和 dangerous 状态，以及当前默认子智能体（设置后）：

| 指示 | 含义 |
|------|------|
| `🤖 <name>` | 当前默认子智能体（通过 `/agent` 设置） |
| `🔒 ws:on` | Workspace 限制已开启 |
| `🔓 ws:off` | Workspace 限制已关闭 |
| `🛡 dg:off` | 危险命令保护已开启（拦截模式，默认） |
| `⚠️ dg:on` | 危险命令保护已关闭（允许模式） |

工具栏完整示例：

```
  user@example.com @ minimax-m2.7-highspeed  ·  turns: 5  ·  🤖 explore  ·  🔒 ws:on  ·  🛡 dg:off
```

---

---

## 13 图像多模态输入与 @ 文件路径引用 🆕

新版 TUI 支持在 CLI 中向视觉模型（如 Claude Sonnet、GPT-4o 等）传入图像，同时支持在输入框中用 `@` 触发当前工作目录的文件/目录路径选择。图像路径会自动复用多模态能力；非图像文件路径则作为普通输入文本的一部分提交，方便 Agent 根据路径继续读取或处理。

### 13.1 `/image` 命令

直接发送一张或多张图像作为一轮对话：

```
# 单张图像 + 描述
/image /tmp/photo.png 描述一下这张图片

# 多张图像 + 描述
/image /tmp/a.png ./b.jpg ~/pics/c.webp 比较这三张图

# 仅图像（无描述时自动用文件名）
/image ~/Desktop/screenshot.png

# /img 是 /image 的别名
/img ./diagram.png 解释这个流程图
```

**路径规则**：

| 写法 | 解析方式 |
|------|----------|
| `/abs/path.png` | 绝对路径 |
| `~/path.png` | 相对于用户主目录 |
| `./path.png` 或 `photos/img.png` | 相对于用户工作目录（即启动 `opendrsai` 时所在的目录） |

**限制**：
- 单张图像 ≤ 20 MB
- 单次最多 10 张图像
- 支持格式：`.png` `.jpg` `.jpeg` `.gif` `.webp` `.bmp` `.svg`

### 13.2 `@` 文件路径选择与 `@/path` 内联引用

在普通对话文本中输入独立的 `@`，TUI 会进入 **Path mode**，从当前工作目录列出文件/目录，帮助你把路径插入到输入框中：

```
请分析 @
```

输入 `@` 后，下方会显示类似竖列文件列表：

```
📂 1/8 — ↑↓ select · Tab complete · Enter open · Backspace back · Esc cancel
▸ 📁 src/
  📁 docs/
  📄 package.json
  📄 README.md
```

**Path mode 按键**：

| 按键 | 作用 |
|------|------|
| `↑` / `↓` | 在候选文件/目录中移动选择 |
| `Shift+Tab` | 反向循环候选项 |
| `Tab` | 补全当前选中项；如果是目录则进入目录，如果是文件则插入路径并退出 Path mode |
| `Enter` | 确认当前选中项；目录会进入，文件会插入路径并退出 |
| `Backspace` | 删除已输入的路径字符；删除到 `@` 时退出 Path mode |
| `Esc` | 取消 Path mode，并移除当前 `@` 路径片段 |
| 空格 | 保留当前 `@path` 文本并退出 Path mode |

插入路径后，它会成为普通输入文本的一部分。例如：

```
请解释 @./docs/architecture.md 的设计
```

如果插入的是图像文件路径，则会自动复用多模态输入能力：

```
请分析一下 @/tmp/chart.png 中的数据趋势

对比 @./before.png 和 @./after.png 的差异

看看 @~/Desktop/error.jpg 这个报错截图
```

带图像扩展名的 `@/path` 引用会在提交时被替换为 `[image: filename]` 标记，图像数据作为 `MultiModalMessage` 传给模型。`/image` 和 `@/path` 两种方式可以混用：

```
/image /tmp/a.png 然后再看 @./b.jpg 的细节
```

> ⚠️ 注意：只有带图像扩展名的 `@/path` 会被识别为图像并作为多模态附件发送。`@/tmp/readme.txt` 会保留为普通文本路径，不会自动读取为图像。

### 13.3 工作原理

```
用户输入 @ → TUI 调用 complete.path 列出当前目录 → 用户选择文件路径
  → 路径作为 @/path 文本插入输入框
  → 提交时 TUI 解析图像 @/path 或 /image → 读取图像文件 → base64 编码
  → JSON-RPC prompt.submit {text, images: [{base64, mime_type}]}
  → Gateway 构造 MultiModalMessage(content=[text, Image, ...])
  → Agent.run_stream(task=MultiModalMessage)
  → 视觉模型接收图像 + 文本
```

**注意事项**：
- 非视觉模型（不支持 vision）时，Agent 内部的 `_get_compatible_context` 会自动调用 `remove_images()` 去除图像，不会报错。
- `@` 路径候选由 gateway 的 `complete.path` RPC 提供；相对路径基于启动 `opendrsai` 时的用户工作目录。
- 图像文件读取在 TUI（Node.js）端完成，因此 **attach 模式也能正常工作**——即使 gateway 在远程机器上，本地图像仍可传入。

### 13.4 错误提示

| 场景 | 提示 |
|------|------|
| 文件不存在 | `⚠ File not found: ./photo.png (resolved: /home/user/project/photo.png)` |
| 格式不支持 | `⚠ Unsupported image format: .txt (./readme.txt)` |
| 文件过大 | `⚠ Image too large: 25.0 MB > 20 MB limit (./big.png)` |
| 图像过多 | `⚠ Too many images (max 10)` |

---

---

## 14 显示与交互控制

| 命令 | 说明 |
|------|------|
| `/clear` `/cls` | 清屏并显示 Session 信息 |
| `/verbose` | 切换每轮统计信息 footer（token、耗时、turn 数） |
| `/bell on/off` | 切换终端响铃（响应完成时响铃提示） |
| `/retry` | 重试上一条用户消息 |

**底部工具栏** (Bottom Toolbar)：始终显示当前用户 ID、模型名、turn 数、推理状态、Plan Mode 状态、默认子智能体、Workspace 和 Dangerous 状态：

```
  user@example.com @ minimax-m2.7-highspeed  ·  turns: 5  ·  🔒 ws:on  ·  🛡 dg:off
```

设置默认子智能体后，工具栏会显示当前活跃的子智能体：

```
  user@example.com @ minimax-m2.7-highspeed  ·  turns: 3  ·  🤖 explore  ·  🔒 ws:on  ·  🛡 dg:off
```

| 指示 | 含义 |
|------|------|
| `🤖 <name>` | 当前默认子智能体（通过 `/agent` 设置，所有消息路由到该子智能体） |
| `🔒 ws:on` | Workspace 限制已开启（默认） |
| `🔓 ws:off` | Workspace 限制已关闭 |
| `🛡 dg:off` | 危险命令保护已开启（拦截，默认） |
| `⚠️ dg:on` | 危险命令保护已关闭（允许） |

---

---

## 15 中断与退出

### 15.1 Ctrl+C 中断

新版 TUI 的 Ctrl+C 行为与旧版单进程 REPL **不同**，具体取决于当前状态：

| 状态 | Ctrl+C 行为 | 说明 |
|------|------------|------|
| **streaming（LLM 流式输出中）** | 发送 `prompt.cancel` RPC，立即中断当前流 | TUI `useInput` 拦截 → `controller.cancel()` → `prompt.cancel` RPC → `agent.interrupt()` |
| **空闲（等待用户输入）** | 进程收到 SIGINT → **直接退出** | 无 `useInput` 拦截，`entry.tsx` 的 `process.once('SIGINT')` 触发 `process.exit(130)` |

> ⚠️ **注意**：空闲状态下按 Ctrl+C 会**立即退出进程**，不会保存对话状态。如需优雅退出，请使用 `/quit` 或 Ctrl+D。

**中断流程（streaming 期间）**：
```
Ctrl+C (streaming)
  → TUI composerPane useInput 捕获 → controller.cancel(sessionId)
  → JSON-RPC prompt.cancel {session_id}
  → Gateway AgentSession.interrupt()
      1. agent.pause()  — 设置 CancellationToken + is_paused=True
      2. loop.call_soon_threadsafe(_cancel_all_tasks)
             — 取消 agent 事件循环上所有正在等待的 asyncio Task
             — 即使 LLM HTTP 请求正在等待响应，也立即抛出 CancelledError
      3. sleep(0.2s) — 等待取消传播
  → _async_run_turn 捕获 CancelledError
      → await agent.resume()  — 重置 is_paused=False（关键！否则下次对话失效）
      → status = "interrupted"，发出 message.complete 事件
  → 用户可继续输入下一条消息
```

> 💡 **修复说明（2026-06）**：旧版 `interrupt()` 只做 `pause() + sleep(50ms) + resume()`，50ms 远不足以等待 LLM HTTP 响应，导致 Ctrl+C 实际无效。新版直接取消 asyncio Task，并在 `_async_run_turn` 的异常处理中重置 `is_paused`，确保中断后 agent 可正常接受下一条消息。

**Gateway 进程免疫 SIGINT**：Python gateway 子进程完全忽略终端 Ctrl+C 信号，取消只能通过 RPC `prompt.cancel` 发起。

### 15.2 退出命令

| 命令 | 别名 | 说明 |
|------|------|------|
| `/quit` | `/exit`, `/q` | 优雅退出：通知 gateway 保存所有 session 状态后退出 |
| Ctrl+D | — | 优雅退出：发送 `gateway.shutdown` RPC，等待 gateway 保存状态（最多 5 秒），超时后强制终止 |

**退出流程（`/quit`）**：
```
/quit → TUI slash 命令 → controller.gw.kill() → useApp().exit()
  → gateway 子进程终止（状态已在各轮对话后自动保存）
```

**退出流程（Ctrl+D）**：
```
Ctrl+D → App useInput 捕获 → isExitingRef 防重入
  → gw.request('gateway.shutdown', {})  [异步，不等待]
  → 启动 5 秒超时保底计时器
  → Python gateway 收到 gateway.shutdown RPC：
      1. 遍历所有活跃 AgentSession，逐一调用 save_state()
      2. emit "gateway.exit" 事件通知 TUI
      3. 0.5s 后 sys.exit(0)
  → TUI 收到 gateway.exit 事件 → clearTimeout(保底计时器) → exit()
  如果 5 秒内未收到 gateway.exit → 保底计时器触发 → gw.kill() → exit()
```

> 💡 **修复说明（2026-06）**：旧版 Ctrl+D 直接调用 `gw.kill(); exit()`，gateway 被强杀时 session 状态未保存，下次启动时对话历史丢失。新版通过 `gateway.shutdown` RPC 实现优雅退出，`gateway.exit` 事件确认后再退出 TUI。

---

---

## 16 定时任务与通知推送

### 16.1 远程 Worker 模式

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

### 16.2 本地模式

无 Worker URL 时，定时任务推送不可用，终端提示：

```
  ℹ 定时任务推送需要 worker 后端 (配置 --url)
```

---

---

## 17 TUI 行为与调优

### 17.1 流式渲染策略

为了在 Windows PowerShell（特别是 Win10 的 PS 5.1 + 旧 `conhost.exe`）下保持流畅，TUI 采用了"流式期间纯文本、完成后再 Markdown"的渲染策略：

- **流式中**：[streamingAssistant.tsx](../apps/ui-tui/src/components/streamingAssistant.tsx) 把增量文本直接渲染为单个 `<Text>`，不做 Markdown 解析。这避免了 `MarkdownRenderer` 在每次 `message.delta` 时 O(n²) 重新解析整个 buffer，并且让 Ink 的 diff 只是单节点字符串更新，旧文本不会被重排——**滚动条也不会因重绘被弹回页面顶部**。
- **完成后**：turn 进入 `TranscriptPane` 的 `<Static>`，由 `MarkdownRenderer` 完整渲染**一次**，之后永不重绘，自然滚入终端的 scrollback 缓冲区。

事件合并节流由 [createGatewayEventHandler.ts](../apps/ui-tui/src/app/createGatewayEventHandler.ts) 完成：默认每 **80 ms** 把缓冲的文本批量 flush 到 store。可通过环境变量调节：

```bash
DRSAI_TUI_FLUSH_MS=120 drsai chat      # 慢终端调宽
DRSAI_TUI_FLUSH_MS=32  drsai chat      # 快终端调紧（最低 16，最高 500）
```

### 17.2 PowerShell 兼容性 (run_powershell 工具)

`run_powershell` 工具（在 `is_powershell=True` 时取代 `run_bash`）做了以下处理保证兼容旧版 PowerShell：

- **统一 UTF-8 输出**：wrapper 脚本在执行用户命令前设置 `[Console]::OutputEncoding`、`$OutputEncoding`、`$env:PYTHONIOENCODING=utf-8`、`$env:PYTHONUTF8=1`，防止 Win10 zh-CN 默认 OEM 编码（CP936）和 Python/Node 的 UTF-8 输出冲突导致解码挂起。
- **legacy PowerShell 用 EncodedCommand**：检测到 `powershell.exe`（PS 5.x）时改用 `-EncodedCommand <base64-UTF16LE>`，绕开 `-Command` 的内联 tokenizer，启动速度和稳定性都显著提升。`pwsh` 仍保持 `-Command` 便于排查。
- **解码容错**：`stdout.decode('utf-8', errors='replace')`，单字节坏数据不再导致整段输出消失。

详见 [operater_funs.py](../cores/python/packages/drsai/src/drsai/modules/agents/skills_agent/managers/operater_funs.py) 的 `_build_ps_command` 和 `_ps_args`。

### 17.3 前后端 RPC 映射

| RPC | 触发 | 用途 |
|------|------|------|
| `session.list` / `session.create` / `session.resume` / `session.history` | `/list` `/new` `/resume` `/history` | 会话管理 |
| `prompt.submit` / `prompt.cancel` | 用户提交 / Ctrl+C | 提交与中断 |
| `slash.exec` | 任何 `/foo` 命令 | 槽位命令分发；返回 `output` 或 `ui_action` |
| `complete.slash` / `complete.path` | TUI Tab 补全 | 自动补全后端 |
| `commands.catalog` | 启动时一次 | 提供给前端的命令注册表（用于补全） |
| `model.options` | `/model` 无参 | 列出可切模型（含 reasoning levels） |
| `model.save` | `ModelEditor` 提交 | 写入 / 改名 / 改字段；新增时自动切换 |
| `model.delete` | `/model rm` 或 picker `d` | 删除别名（带 fallback 保护） |
| `model.get` | `/model edit <alias>` | 取完整字段预填表单 |
| `approval.respond` / `clarify.respond` / `secret.respond` / `sudo.respond` | 交互覆盖层提交 | 工具调用授权回复 |
| `paste.collapse` | 长粘贴 | 折叠为 `[[ Pasted #N ... → /path.txt ]]` 占位符 |
| `skills.manage` | `/skills` 面板 | Skill CRUD + 热重载（`list/show/create/update/delete/reload`） |
| `gateway.shutdown` | Ctrl+D | 优雅退出：保存所有 session 状态，发出 `gateway.exit` 事件 |
| `memory.reload` (event) | `/memory reload` | gateway → UI 通知刷新 |
| `session.info` (event) | 状态变化 | 更新 StatusBar / badges |
| `gateway.exit` (event) | `gateway.shutdown` 完成后 | 通知 TUI 可安全退出 |
| **Subagent 事件流** | | |
| `subagent.spawn_requested` (event) | LLM Delegate 工具调用 | 通知 TUI 子智能体已启动（含 source + goal） |
| `subagent.start` (event) | 子智能体开始执行 | TUI StatusBar 显示 `⚡ <name>: <goal>` |
| `subagent.thinking` (event) | 子智能体流式输出 | 增量文本追加到当前 turn（与 `message.delta` 同等处理） |
| `subagent.tool` (event) | 子智能体工具调用 | TUI 可选展示子智能体的工具使用情况 |
| `subagent.progress` (event) | 子智能体阶段性进度 | 可选进度文本展示 |
| `subagent.complete` (event) | 子智能体完成 | 清除 StatusBar，未流式的最终文本一次性追加 |
| `subagent.delegate` (event) | `/delegate` 命令 | 手动委派时触发，携带 agent_type + prompt |

### 17.4 子智能体 TUI 渲染行为

子智能体（Delegate）的执行在 TUI 中有以下渲染行为：

**StatusBar 提示**：子智能体启动时，底部状态栏（StatusBar）会显示子智能体名称和任务目标（截断到 60 字符），完成后自动清除：

```
⚡ explore: Searching for config files…
```

**流式输出**：子智能体的思考/输出文本通过 `subagent.thinking` 事件流式传输，与主智能体的 `message.delta` 使用相同的缓冲刷新机制（默认每 **80 ms** flush），文本追加到当前 turn 的 buffer 中。这确保子智能体输出和普通对话输出在 TUI 中有完全一致的渲染体验。

**完成后渲染**：子智能体完成后，`subagent.complete` 事件：
1. 若子智能体已流式输出完毕 → 仅清除 StatusBar
2. 若子智能体为非流式（如某些远程 agent）→ 将最终文本作为一次性 delta 追加到 buffer
3. 缓冲区文本进入 `TranscriptPane` 的 `<Static>`，由 `MarkdownRenderer` 完整渲染一次

**事件处理代码路径**：`createGatewayEventHandler.ts:175-196` 中处理 `subagent.start`、`subagent.thinking`、`subagent.complete`、`subagent.tool`、`subagent.progress` 事件。详见 [createGatewayEventHandler.ts](../apps/ui-tui/src/app/createGatewayEventHandler.ts)。

### 17.5 命令注册表与 `cli_only` 标记

`backend/cli/commands.py` 中的 `COMMAND_REGISTRY` 是单一真相源，TUI 通过 `commands.catalog` RPC 拉取后用于 `/help` 和 Tab 补全。

从本次更新起，`cli_only=True` 标记已从 `/history` / `/save` / `/config` / `/info` / `/models` 上移除——它们的 gateway 处理器（`slash.py:cmd_history` 等）已经实现并可用，因此应该出现在 TUI 的补全列表与 `/help` 中。

---

---

## 18 Skill 管理

> **实现状态**：已实现（2026-06）。相关文件：`tui_gateway/handlers/skills.py`、`apps/ui-tui/src/components/skillsPane.tsx`、`composerPane.tsx`。

### 18.1 概念

**Skill** 是存储为 `SKILL.md` 文件的可复用技能包，Agent 在需要特定领域操作时按需加载。每个 Skill 占一个独立子目录：

```
~/.drsai/workspace/runs/<user_id>/configs/skills/
├── pdf/
│   └── SKILL.md
├── ragflow-knowledge/
│   └── SKILL.md
└── my-custom-skill/
    └── SKILL.md
```

**SKILL.md 格式**（YAML frontmatter + Markdown 正文）：
```markdown
---
name: my-skill
description: 一句话描述，Agent 用此判断何时激活本技能。
---

# 正文

详细的技能使用说明、工具调用步骤、注意事项…
```

Agent 每次对话前自动扫描 skills 目录，按 `description` 字段决定是否激活对应技能；激活时将 SKILL.md 正文注入 system prompt（Layer 2 按需加载）。

### 18.2 TUI Skill 管理面板

在 TUI 输入框输入 `/skills`（或 `/skill`）打开交互式管理面板：

```
⚡ Skills Manager
────────────────────────────────────────────────────────────
▶ pdf            — 处理PDF文件，包括阅读、创建和合并。
  ragflow-knowledge — 上传PDF到RAGFlow知识库时使用。
  playwright-cli  — 自动化浏览器交互，测试网页。
────────────────────────────────────────────────────────────
↑↓ navigate  Enter show  d delete  r reload  q dismiss
```

**面板操作**：

| 按键 | 功能 |
|------|------|
| `↑` / `↓` | 在技能列表中移动光标 |
| `Enter` | 查看高亮技能的完整 SKILL.md 内容 |
| `d` | 删除高亮技能（有二次确认） |
| `r` | 热重载：立即将技能变更应用到当前 Agent，无需重启 |
| `q` / `Esc` | 关闭面板，返回输入框 |

**详情视图**（按 Enter 后）：

```
⚡ Skills Manager
pdf — /home/user/.drsai/.../skills/pdf/SKILL.md
────────────────────────────────────────────────────────────
---
name: pdf
description: 处理PDF文件…
---

# 使用方法
…
────────────────────────────────────────────────────────────
Press Enter or Esc to go back
```

**删除确认视图**（按 `d` 后）：

```
Delete skill pdf?
This will permanently remove the skill directory.
Press y to confirm, n / Esc to cancel.
```

### 18.3 Gateway RPC：`skills.manage`

TUI 面板通过 `skills.manage` JSON-RPC 与 gateway 通信，支持以下 `action`：

| action | 必填参数 | 说明 |
|--------|---------|------|
| `list` | — | 列出所有已安装技能（name、description、大小、修改时间） |
| `show` | `name` | 返回指定技能的完整 SKILL.md 原文 |
| `create` | `name`, `content` | 新建技能目录 + SKILL.md，自动热重载 |
| `update` | `name`, `content` | 覆盖现有 SKILL.md，自动热重载 |
| `delete` | `name` | 删除整个技能目录，自动热重载 |
| `reload` | `session_id` | 仅触发 `agent.update_user_skills()`，不做文件操作 |

**示例调用（调试用）**：
```json
// 列出技能
{"jsonrpc":"2.0","id":1,"method":"skills.manage","params":{"action":"list"}}

// 创建技能
{"jsonrpc":"2.0","id":2,"method":"skills.manage","params":{
  "action":"create",
  "name":"my-skill",
  "session_id":"<sid>",
  "content":"---\nname: my-skill\ndescription: 我的技能\n---\n\n# 用法\n…"
}}
```

### 18.4 热重载机制

`create` / `update` / `delete` / `reload` 操作会立即触发当前 session 的 Agent 调用 `agent.update_user_skills()`，效果等同于文件修改后的自动检测，**无需重启 TUI 或 gateway**。

热重载路径：
```
skills.manage RPC
  → _reload_agent_skills(session_id)
    → _sessions[session_id].agent_session.agent.update_user_skills()
      → SkillLoader 重新扫描 skills 目录
      → 更新 _cached_skills_loader
      → 下一轮对话时生效
```

### 18.5 技能名称规范

技能目录名（即 `name` 参数）只允许字母、数字、连字符和下划线（`^[a-zA-Z0-9_\-]+$`），长度不超过 64 字符。不合法名称会收到 `4002` 错误。

---

---

## 19 Daemon 后台常驻服务

> **实现状态**：已实现。代码位于 `backend/daemon/`。本章记录用户侧接口与行为规范。

### 19.1 背景与动机

当前 TUI gateway 以**子进程模式**运行：TUI 启动时 spawn，TUI 退出时随之销毁。这导致：

- 用户关闭 TUI 后所有进行中的 Agent 会话立即中断
- 微信等外部渠道无法与 Agent 通信
- 长耗时任务（爬虫、代码生成等）无法后台持续运行

**Daemon 模式**将 gateway 提升为独立后台进程，TUI 作为其管理终端，随时可 attach/detach。

### 19.2 `opendrsai daemon` 命令

```bash
# 启动后台 daemon（首次启动或重启）
drsai daemon start [--name <name>] [--port <port>] [--model <alias>] [--wechat] [--wechat-port <port>] [--restart]

# 停止指定 daemon（或所有）
drsai daemon stop [--name <name>] [--all]

# 查看所有 daemon 运行状态
drsai daemon status

# 输出精简列表（适合脚本）
drsai daemon list [--json]

# 实时查看 daemon 日志
drsai daemon logs [--name <name>] [--tail 50] [--follow]

# 向 daemon 中的 session 发送消息（调试用，非 TUI 交互）
drsai daemon send --name <name> --session <sid> "消息内容"
```

**启动示例（含微信）**：
```
$ drsai daemon start --name research-bot --model claude-sonnet-4-5 --wechat

 微信凭据不存在或已过期，正在进入扫码登录流程...

 ==================================================
 微信 ilink Bot 登录
 ==================================================

 正在获取二维码...
 ██████████████████████████████████████████████████
 请用微信扫描上方二维码

 等待扫码...
   已扫码，请在手机上确认...
 ✅ 扫码成功！
 凭据已保存到: ~/.drsai/workspace/wechat/credentials.json

  启动 Daemon 'research-bot'...

  ✓ DrSai Daemon 'research-bot' 启动成功

  PID        : 42817
  模型       : claude-sonnet-4-5
  WebSocket  : ws://127.0.0.1:42500/ws
  管理 API   : http://127.0.0.1:42500/api
  微信接入   : ilink Bot 长轮询 (端口 9000)
  API Token  : dsk_XXXXXXXXXXXXXXXX
  日志文件   : ~/.drsai/logs/daemons/research-bot.log

在 TUI 中可使用 /daemons 命令查看和管理此 daemon。
```

> **微信自动登录**：当 `--wechat` 启用但凭据文件（`~/.drsai/workspace/wechat/credentials.json`）不存在或已过期（>7天）时，`start` 命令会在父进程中自动触发终端二维码扫码登录。登录成功后凭据被持久化，后续重启无需重新扫码。详见 [20 微信接入](#20-微信接入)。

### 19.3 Daemon 运行状态

```
$ drsai daemon status

NAME            PID     WS PORT  MODEL               WECHAT PORT  UPTIME   SESSIONS  STATUS
research-bot    42817   8765     claude-sonnet-4-5   9000         2h 14m   3         running
coding-helper   23456   8766     gpt-4o              —            45m      1         running
old-bot         —       8767     —                   —            —        —         stopped (stale pid)
```

**状态说明**：

| 状态 | 含义 |
|------|------|
| `running` | PID 文件存在且进程活跃 |
| `stopped` | PID 文件不存在（正常退出） |
| `stale pid` | PID 文件存在但进程已死（崩溃） |

### 19.4 文件存储

| 文件 | 路径 | 说明 |
|------|------|------|
| PID 文件 | `~/.drsai/workspace/daemons/<name>.pid` | 进程 PID（纯数字） |
| State 文件 | `~/.drsai/workspace/daemons/<name>.json` | 端口、Token、启动时间等 |
| 日志文件 | `~/.drsai/logs/daemons/<name>.log` | stdout + stderr 合并 |

**State 文件格式**：
```json
{
  "name": "research-bot",
  "pid": 42817,
  "ws_port": 8765,
  "wechat_port": 9000,
  "wechat_enabled": true,
  "api_token": "dsk_XXXXXXXXXXXXXXXX",
  "model": "claude-sonnet-4-5",
  "started_at": 1748908800.0,
  "log_file": "/home/user/.drsai/logs/daemons/research-bot.log"
}
```

### 19.5 端口分配策略

| 参数 | 默认值 | 说明 |
|------|-------|------|
| `--port` | 自动从 42500 起扫描第一个可用端口 | WebSocket + HTTP 管理 API 端口 |
| `--wechat-port` | 自动从 9000 起扫描第一个可用端口 | 微信 ilink Bot 端口（仅 `--wechat` 时启用） |

如未指定 `--port`，daemon 自动扫描 `[42500, 43000)` 区间内第一个未被占用的端口；`--wechat-port` 自动扫描 `[9000, 9100)` 区间。多 daemon 实例互不冲突。

### 19.6 TUI 内 Daemon 管理面板（`/daemons`）

在 TUI 中输入 `/daemons` 打开 daemon 管理面板：

```
🖥 Daemons Manager
────────────────────────────────────────────────────────────
  NAME           PORT   WECHAT  STATUS   SESSIONS  UPTIME
▶ research-bot   8765   9000    running  3         2h 14m
  coding-helper  8766   —       running  1         45m
────────────────────────────────────────────────────────────
↑↓ navigate  Enter attach  s stop  l logs  q dismiss
```

**面板操作**：

| 按键 | 功能 |
|------|------|
| `↑` / `↓` | 移动光标 |
| `Enter` | 以 WebSocket 模式 attach 到高亮 daemon |
| `s` | 停止高亮 daemon（有确认） |
| `l` | 显示最近 50 条日志（实时更新） |
| `q` / `Esc` | 关闭面板 |

### 19.7 WebSocket 协议兼容性

Daemon 的 WebSocket 服务使用与现有 stdio 管道**完全相同**的 JSON-RPC 协议，所有现有 RPC 方法（`session.*`、`prompt.*`、`slash.exec`、`model.*` 等）均可通过 WebSocket 调用，TUI 无需修改业务逻辑。

```
TUI (Ink)
  ↕  JSON-RPC over WebSocket (ws://127.0.0.1:<port>/ws)
Daemon Process (独立进程，常驻后台)
  ├── AgentSession × N（多会话并发）
  ├── 微信 Webhook 适配层（可选）
  └── SQLite 持久化
```

### 19.8 作为子智能体被调用

> 关于子智能体系统的完整说明（内置类型、自定义配置、默认路由、委派深度限制等），请参见专门的 **[21 Subagent / 子智能体](#21-subagent子智能体delegate)** 章节。本节仅说明 daemon 作为子智能体的调用方式。

TUI 可将后台 daemon 作为子智能体，通过 `subagent.invoke` RPC 调用：

```json
{
  "method": "subagent.invoke",
  "params": {
    "daemon_name": "research-bot",
    "session_id": "parent-session-id",
    "prompt": "帮我分析这个数据集",
    "context": "背景信息…",
    "stream": true
  }
}
```

调用后 daemon 将结果通过 `subagent.delta` / `subagent.complete` 事件流式推回 TUI，显示效果与本地子智能体相同。

### 19.9 Daemon 模型独立配置

Daemon 可以独立于主智能体使用不同的模型。Daemon 的模型配置优先级为：

```
启动时 --model 参数  >  /api/model 运行时切换  >  全局 CLI config 文件
```

#### 启动时指定模型

```bash
# daemon 使用 claude-haiku，主智能体可以使用其他模型
drsai daemon start --name coder --model claude-haiku
```

参数 `--model` / `-m` 指定 daemon 的默认模型别名（与 `/model` 命令中的别名一致）。如果不指定，daemon 使用全局 CLI config 中的默认模型。

#### 运行时切换模型 (TUI)

在 TUI 中使用 `/daemon-model` 命令查看或切换 daemon 的模型：

```
# 查看 daemon 当前模型
/daemon-model coder
→ Daemon 'coder' 当前模型: claude-haiku

# 切换 daemon 模型（新 session + 已有 session 同步切换）
/daemon-model coder gpt-4o
→ ✓ Daemon 'coder' 模型已切换为 'gpt-4o'。
   2 个活跃 session 已同步切换。
   新 session 将默认使用此模型。
```

| 命令 | 别名 | 说明 |
|------|------|------|
| `/daemon-model <name>` | `/dmodel` | 查看 daemon 当前模型 |
| `/daemon-model <name> <model>` | `/dmodel` | 切换 daemon 模型 |

运行时切换通过 daemon 的 `POST /api/model` HTTP 接口实现，同时更新环境变量和所有活跃 session 的模型。

---

---

## 20 微信接入

> **实现状态**：ilink Bot 长轮询模式已实现（`backend/wechat/`）。企业微信 Webhook 模式待实现。

### 20.1 两种接入模式

| 模式 | 技术方案 | 适用场景 | 实现状态 |
|------|---------|---------|---------|
| **微信个人号**（ilink） | ilink Bot 长轮询 API（`ilinkai.weixin.qq.com`） | 个人开发者，无需服务器公网 IP | ✅ 已实现 |
| **企业微信 Bot** | Webhook 推送（需公网可达） | 团队/企业内部部署 | ⏳ 待实现 |

### 20.2 启动微信接入

```bash
# 启动支持微信的 daemon（首次会触发自动扫码登录）
drsai daemon start --name my-bot --wechat

# 如凭据已存在且未过期，直接启动，无需再次扫码
drsai daemon start --name my-bot --wechat
```

**首次启动流程**：

```
drsai daemon start --name my-bot --wechat
  ↓
检测 credentials.json 是否存在且未过期
  ├── 存在且有效 → 直接启动 daemon + WeChatBot
  └── 不存在或已过期 → 触发终端扫码登录
                           ↓
                       获取二维码（终端 ASCII QR）
                           ↓
                       用户手机扫码确认
                           ↓
                       凭据保存到 ~/.drsai/workspace/wechat/credentials.json
                           ↓
                       启动 daemon + WeChatBot 长轮询主循环
```

> **注意**：扫码在 CLI 父进程中完成（有终端交互），而非在后台 daemon 进程中。这确保了二维码能正常显示在用户的终端上。

### 20.3 凭据生命周期

| 阶段 | 说明 |
|------|------|
| **首次启动** | `opendrsai daemon start --wechat` 自动触发扫码 → 保存到 `credentials.json` |
| **后续重启** | 凭据有效（<7天）→ 跳过扫码，直接启动 |
| **凭据过期** | 超过 7 天 → 自动重新触发扫码 |
| **手动登录** | `opendrsai wechat login` 可随时手动重新扫码 |
| **凭据位置** | `~/.drsai/workspace/wechat/credentials.json` |

**credentials.json 格式**：
```json
{
  "bot_token": "ilink_bot_token_xxx",
  "account_id": "ilink_bot_id_xxx",
  "user_id": "ilink_user_id_xxx",
  "base_url": "https://ilinkai.weixin.qq.com",
  "login_time": 1748908800.0,
  "hepai_api_key": "sk-xxx"
}
```

### 20.4 消息流架构

```
微信用户发消息到 ilink Bot
  ↓
daemon 进程内 WeChatBot 长轮询 getupdates
  ↓ (HTTPS, ilinkai.weixin.qq.com)
WeChatBot.handle_message()
  ├── 提取 user_id（from_user_id）
  ├── 路由到对应 AgentSession（每个微信用户独立 session）
  └── 调用 AgentSessionAdapter.a_drsai_ui_completions()
        ↓
  流式响应 → 分段（≤2048 字符）→ 调用 sendmessage 回复微信
```

**关键差异（与实际实现对齐）**：
- WeChatBot 通过**长轮询**（`getupdates`）拉取消息，而非被动接收 Webhook
- WeChatBot 运行在 daemon 进程内，不依赖外部端口暴露
- `--wechat-port` 参数当前仅用于端口占用检测，ilink 模式不需要本地端口

### 20.5 多用户会话隔离

每个微信用户（`from_user_id`）自动映射到独立的 AgentSession：

```
wechat_user_id → chat_id (微信用户 ID)
              → AgentSession (独立对话历史、独立工具调用)
```

**Session 持久化**：daemon 将微信会话映射保存到 `~/.drsai/workspace/daemons/<name>/wechat_sessions.json`，daemon 重启后不会丢失。

### 20.6 消息格式规范

| 微信消息类型 | 处理方式 |
|------------|---------|
| 文本消息 | 直接作为用户 prompt 传入 Agent |
| 图片消息 | 暂不支持（回复提示文字） |
| 语音消息 | 暂不支持（回复提示文字） |
| 文件消息 | 暂不支持（回复提示文字） |

**回复截断**：微信单条消息最长 2048 字符，超长回复自动分片发送（从换行处切割，每片 ≤2048 字符）。

**命令支持**：微信用户可使用以下命令（与 TUI `/` 命令一致）：

| 命令 | 说明 |
|------|------|
| `/help` | 显示帮助 |
| `/newsession` | 新建会话 |
| `/session` | 查看所有历史会话 |
| `/session <id>` | 切换到指定会话 |
| `/models` | 列出可用模型 |
| `/model <name>` | 切换模型 |
| `/agents` | 查看可用子智能体 |
| `/agent <name>` | 设置默认子智能体 |
| `/agent clear` | 取消默认子智能体 |

### 20.7 配置参数

| 参数 | 说明 | 默认值 |
|------|------|-------|
| `--wechat` | 启用微信 ilink Bot 接入 | 关闭 |
| `--wechat-port` | 端口占用检测（ilink 模式无需本地端口） | 自动从 `[9000, 9100)` 扫描 |
| `HEPAI_API_KEY` | HepAI/LLM API Key（写入 credentials.json） | — |

---

---

## 21 Subagent（子智能体 / Delegate）

> **实现状态**：核心功能已实现（2026-06）。相关文件：`drsai_assistant.py:_execute_subagent`、`managers/get_managers_tools.py:get_subagent_tools`、`daemon_subagent.py`、`slash.py:cmd_agent/cmd_delegate`、`createGatewayEventHandler.ts:subagent.*`。

### 21.1 概念

**Subagent（子智能体）** 是 OpenDrSai CLI 的分层任务委派机制。当主智能体遇到复杂任务时，可将子任务委派给专门的子智能体执行。子智能体具有以下特性：

- **隔离上下文**：子智能体拥有独立的对话上下文，**看不到**父智能体的对话历史（Hermes 风格）。必须在 `prompt` 和 `context` 字段中提供完整信息
- **独立工具集**：每个子智能体可使用不同的工具白名单/黑名单
- **独立模型**：可指定与父智能体不同的模型配置
- **超时控制**：子智能体有独立的超时时间限制
- **深度限制**：防止无限递归委派

**两种调用路径**：

| 路径 | 触发方式 | 说明 |
|------|---------|------|
| **Delegate 工具** | LLM 自动调用 `Delegate` tool | AI 自主判断何时委派、选择哪个子智能体类型 |
| **默认路由** | `/agent <name>` 设置 + 用户提问 | 所有用户消息直接路由到指定的默认子智能体 |

### 21.2 内置子智能体类型

系统内置两种子智能体类型（定义在 `drsai_assistant.py:BUILTIN_SUBAGENTS`）：

| 类型 | 名称 | 工具集 | 说明 |
|------|------|--------|------|
| `explore` | Read-only code explorer | `run_read`、`run_glob`、`run_grep` | 只读代码探索，禁止任何写入/执行操作 |
| `general` | General-purpose subagent | `*`（全部工具） | 通用子智能体，拥有完整工具访问权 |

**内置子智能体配置项**：

| 参数 | `explore` | `general` | 说明 |
|------|-----------|-----------|------|
| `max_turns` | 200 | 200 | 最大对话轮数 |
| `timeout` | 3600s (1h) | 3600s (1h) | 子任务超时 |
| `role` | `leaf` | `leaf` | 叶节点角色，禁止递归委派 |
| `disallowed_tools` | `Delegate`, `ScheduledTaskManager`, `UpdateUserConfig` | 同左 | 禁止递归委派、修改配置、创建定时任务 |

> ⚠️ **安全机制**：所有内置子智能体默认禁止使用 `Delegate` 工具，防止子智能体继续委派导致无限递归。叶节点角色（`role: "leaf"`）强制追加 `Delegate` 到黑名单。

### 21.3 自定义子智能体（SUBAGENT_CONFIG.json）

用户可通过 `SUBAGENT_CONFIG.json` 自定义子智能体，配置文件路径：

```
~/.drsai/workspace/runs/<user_id>/configs/SUBAGENT_CONFIG.json
```

支持四种子智能体类型：

| 类型 | 说明 | 运行模式 |
|------|------|---------|
| **DrSaiAgent** | 普通 Autogen Assistant，可使用工具 | 本地实例化 |
| **CodeExecutorAgent** | Docker / .venv 沙箱代码执行 | 本地沙箱 |
| **HepAIWorkerAgent** | 链接远程智能体（HepAI 服务） | 远程 API |
| **RemoteAgent** | 链接远程 OpenAI ChatCompletions 格式的代理（如 OpenClaw） | 远程 API |
| **DaemonAgent** | 运行中的后台 daemon 实例（由系统自动注入） | WebSocket |

**配置格式示例**：

```json
{
    "code_runner": {
        "type": "CodeExecutorAgent",
        "description": "沙箱代码执行子智能体",
        "tools": [],
        "prompt": "你是一个代码执行专家，在沙箱环境中运行代码并返回结果。",
        "venv_path": "/path/to/venv"
    },
    "pdf_searcher": {
        "type": "DrSaiAgent",
        "description": "PDF 文档检索子智能体",
        "tools": ["pdf_manual_search"],
        "prompt": "你是一个 PDF 文档检索智能体，基于 pdf_manual_search 工具查询手册内容。",
        "model": "openai/gpt-5.2",
        "model_type": "openai",
        "base_url": "https://aiapi.ihep.ac.cn/apiv2"
    },
    "remote_boss": {
        "type": "HepAIWorkerAgent",
        "description": "可执行 BOSS 作业提交的远程智能体",
        "tools": [],
        "prompt": "你是一个 BOSS 作业提交专家。",
        "model_remote_configs": {
            "name": "BOSS8Agent",
            "url": "https://aiapi.ihep.ac.cn/apiv2"
        }
    },
    "openclaw_agent": {
        "type": "RemoteAgent",
        "description": "连接到 OpenClaw 的远程智能体",
        "prompt": "",
        "tools": [],
        "model_remote_configs": {
            "model": "openclaw",
            "url": "http://127.0.0.1:18789/v1/chat/completions",
            "headers": {
                "Authorization": "Bearer <token>",
                "Content-Type": "application/json",
                "x-openclaw-agent-id": "main"
            }
        }
    }
}
```

**配置热加载**：修改 `SUBAGENT_CONFIG.json` 后，CLI 在每次对话轮次 `lazy_init()` 中通过文件修改时间自动检测变更并热重载（`update_user_subagents()`），**无需重启 TUI 或 gateway**。

**Daemon 自动注入**：如果后台有运行中的 daemon 进程，它们会被自动注入为 `daemon:<name>` 格式的子智能体类型：

```
子智能体列表:
- explore: Read-only code explorer...
- general: General-purpose subagent...
- daemon:research-bot: 运行中的后台 daemon (port=8765, type=DaemonAgent)
```

### 21.4 命令

#### `/agent` — 设置/清除默认子智能体

```
/agent                    # 等同于 /agent list
/agent list               # 列出所有可用子智能体
/agent <name>             # 设置默认子智能体（case-insensitive 匹配）
/agent clear              # 清除默认子智能体设置
```

**设置默认子智能体后**，所有用户消息将直接路由到该子智能体处理，主智能体不再参与 LLM 推理。子智能体的响应作为 `AssistantMessage` 写入对话上下文。

**默认子智能体优先级**（`on_messages_stream` 中）：
1. `_thread_state.default_subagent`（通过 `/agent` 命令设置，内存级，最高优先级）
2. `THREAD_CONFIG.json` 中持久化的 `default_subagent`（跨会话恢复）

```
# 将代码探索子智能体设为默认
/agent explore
# → Default subagent set to: explore

# 将 daemon 设为默认
/agent daemon:research-bot
# → Default subagent set to: daemon:research-bot

# 清除默认，恢复主智能体模式
/agent clear
# → Default subagent cleared
```

#### `/delegate` (别名 `/sub`) — 手动委派任务

```
/delegate <agent_type> <prompt>
/sub <agent_type> <prompt>
```

示例：
```
/delegate general 帮我用 Python 写一个快速排序并测试
/sub explore 搜索所有包含 "TODO" 的 Python 文件
```

手动委派触发 `subagent.delegate` 事件，由 TUI 前端处理。

#### `/max_concurrent` (别名 `/mc`) — 子智能体并发控制

```
/max_concurrent             # 查看当前并发设置
/max_concurrent 3           # 设置最大并行数为 3
/mc status                  # 查看状态（别名）
```

设置子智能体的最大并行执行数量，**全局持久化**（保存到 `cli_config.json`）。默认值为 5。

- 值范围：1–256
- 同时影响当前 session 的 agent 和全局默认配置
- 在 `/status` 中可查看当前值

### 21.5 Delegate 工具（LLM 自动调用）

子智能体系统通过 `Delegate` 工具暴露给 LLM，使 AI 能够**自主判断**何时委派子任务。

**工具 Schema**（`get_subagent_tools()` 生成）：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `description` | `string` | ✅ | 简短任务描述（3-5 词） |
| `prompt` | `string` | ✅ | 具体任务描述，包含代码、路径、约束等 |
| `agent_type` | `enum` | ✅ | 子智能体类型（所有可用类型枚举） |
| `context` | `string` | 可选 | 背景信息（文件路径、错误信息、项目结构等） |

**工具描述**包含所有可用子智能体类型的说明，使 LLM 能够正确选择合适的子智能体。

### 21.6 执行流程

#### Delegate 工具调用流程

```
LLM 调用 Delegate(prompt="...", agent_type="explore", context="...")
  ↓
_process_model_result() 检测到 Delegate 工具调用
  ↓
_execute_subagent(sub_agent_name="explore", prompt="...", context="...")
  ├── 1. _check_delegate_depth()  → 防止超过最大深度（默认 99）
  ├── 2. 根据 agent_type 创建子智能体:
  │       ├── DrSaiAgent → _create_local_subagent()（实例化新 DrSaiCLIAssistant）
  │       ├── DaemonAgent → _create_daemon_subagent()（WebSocket 连接 daemon）
  │       └── RemoteAgent  → _create_remote_subagent()（远程 API）
  ├── 3. _build_subagent_messages()  → 构造 Hermes 风格消息（不含父历史）
  ├── 4. subagent.on_messages_stream()  → 流式执行，带独立 Timeout + CancellationToken
  ├── 5. _tag_message()  → 给输出标记来源（如 "sub:explore"）
  └── 6. _safe_close_subagent()  → 清理独立 model_client 连接
  ↓
结果作为工具调用返回注入主智能体上下文
```

#### 并行子智能体执行

当 LLM 在同一轮中调用多次 `Delegate`（不同 agent_type），系统自动**并行执行**（通过 `_execute_subagents_parallel()`）：

- **并发控制**：`asyncio.Semaphore(max_concurrent=3)` 限制最多 3 个并行子智能体
- **结果合并**：`asyncio.Queue` 按到达顺序流式输出，每条消息标记来源
- **独立取消**：每个子智能体拥有独立 `CancellationToken`，父取消时通过 watcher 传播

### 21.7 委派深度限制

为防止无限递归委派，系统实施了委派深度检查：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `_delegate_depth` | 从 0 开始 | 当前委派深度 |
| `_max_delegate_depth` | 99 | 最大允许深度 |

每次 `_execute_subagent()` 调用 `_check_delegate_depth()`，超限时抛出 `DelegateDepthExceededError`：

```
⚠️ Cannot delegate further: max depth (99) exceeded (current: 99).
   This subagent is at the deepest allowed level.
```

`Delegate` 工具被列入 `_DEFAULT_DISALLOWED_FOR_SUBAGENTS` 黑名单，所有子智能体默认禁止再委派。

### 21.8 工具过滤

子智能体的工具列表通过以下机制确定：

```
1. cfg.tools (allowlist):
     "*" → 继承父智能体的全部工具
     ["run_read", "run_grep"] → 仅允许指定工具

2. cfg.disallowed_tools (blocklist) + 系统默认黑名单:
     _DEFAULT_DISALLOWED_FOR_SUBAGENTS = {Delegate, ScheduledTaskManager, UpdateUserConfig}
     叶节点角色 (role: leaf) → 追加 Delegate

3. agent_type 特殊规则:
     explore / plan → _READONLY_DISALLOWED_TOOLS（禁止所有写入/执行工具）
```

### 21.9 TUI 状态栏集成

子智能体执行时，TUI 底部状态栏实时显示子智能体信息：

| 状态 | StatusBar 显示 |
|------|---------------|
| 子智能体启动 | `⚡ explore: Searching for config files…` |
| 子智能体工作中 | `⚡ general: Writing test cases for module X…` |
| 子智能体完成 | 自动清除（恢复为空字符串） |
| 多个子智能体并行 | 按完成顺序逐个显示，最后完成的清除状态栏 |

详见 [17.4 子智能体 TUI 渲染行为](#174-子智能体-tui-渲染行为)。

### 21.10 Daemon 作为子智能体

运行中的 daemon 会自动注入为子智能体类型（`daemon:<name>`），可以通过以下方式调用：

```bash
# 查看可用的 daemon 子智能体
/agent list
# → - daemon:research-bot: 运行中的后台 daemon (port=8765, type=DaemonAgent)

# 设为默认子智能体
/agent daemon:research-bot

# 手动委派
/delegate daemon:research-bot 帮我分析这个数据集
```

**协议**：Daemon 子智能体通过 WebSocket JSON-RPC 与 daemon 通信：

```
DrSaiCLIAssistant (主智能体)
  ↓
DaemonSubagent (包装器)
  ↓  WebSocket ws://127.0.0.1:<port>/ws?token=<token>
Daemon Process (独立进程)
  ├── gateway.ready → 握手
  ├── session.create → 创建临时会话
  ├── prompt.submit → 提交任务
  └── message.delta / message.complete → 流式返回
```

详见 [19.8 作为子智能体被调用](#198-作为子智能体被调用)。

### 21.11 配置参考

| 参数 | 位置 | 说明 |
|------|------|------|
| `BUILTIN_SUBAGENTS` | `drsai_assistant.py` | 内置子智能体定义（explore、general） |
| `SUBAGENT_CONFIG.json` | `~/.drsai/workspace/runs/<user_id>/configs/` | 用户自定义子智能体 |
| `THREAD_CONFIG.json` | 同上 | 线程级默认子智能体（`/agent` 持久化） |
| `_thread_state.default_subagent` | 内存 | 会话级默认子智能体（`/agent` 设置，最高优先级） |

**环境变量**：

| 变量 | 说明 | 默认值 |
|------|------|-------|
| — | 子智能体超时（per subagent） | `600s` (10 分钟) |
| — | 最大并行子智能体数 | `3` |
| — | 委派深度上限 | `99` |

---

---

## 22 GFS 高能所文件系统集成

> **实现状态**：Personal 模式已实现（`modules/managers/gfs/`）。TUI 配置面板已实现（`/gfs`），支持状态查看、内联编辑、连接测试、配置清除。TUI 只支持 Personal 模式。

### 22.1 概述

GFS (高能所文件系统) 集成让 Agent 通过 function-calling 工具直接读写用户的 GFS bucket。Agent 可以：

- `gfs_ls` — 列出 bucket 内的文件/目录（输出截断至 5000 字符）
- `gfs_stat` — 查看文件元信息（大小、etag、修改时间）
- `gfs_read` — 读取文本文件全文（支持 `minilimit`/`maxlimit` 按行分页，输出截断至 5000 字符）
- `gfs_write` — 写入文本到 bucket
- `gfs_upload` — 上传本地文件到 bucket
- `gfs_download` — 下载文件到本地
- `gfs_share_url` — 生成临时预签名下载 URL（限时分享）
- `gfs_delete` — 删除文件

工具名以 `gfs_` 前缀，与 Agent 内置的 `run_read` / `run_write` 等本地文件工具共存，由 system prompt 引导选择。`gfs_read` 和 `gfs_ls` 的输出限制与 `run_read` 保持一致（5000 字符截断），防止单次工具调用占用过多上下文。

### 22.2 两种模式

| 模式 | 凭证来源 | 适用场景 | 是否需要管理员 Key |
|------|---------|---------|-------------------|
| **Personal**（个人） | 用户自己的 AK/SK | 本地 / 单用户实例（TUI `/gfs` 配置） | 否 |
| **Admin**（管理员） | 管理员 X-API-Key 按用户邮箱自动分配 | 多用户服务（生产 worker） | 是 |

> **TUI 只支持 Personal 模式。** Admin 模式由生产环境 worker 使用，不在 CLI/TUI 上下文中。

### 22.3 TUI 配置（`/gfs`）

在 TUI 中输入 `/gfs` 打开 GFS 配置面板。面板有两个视图：**状态视图**（默认）和**编辑视图**。

#### 状态视图

```
📁 GFS Configuration — 高能所文件系统

● GFS Tools: ENABLED (mode: personal)

Credentials:
▶ Enabled: true (Enter to toggle)
  Access Key: ***niLd (Enter to edit)
  Secret Key: ***QMgw (Enter to edit)
  Bucket: 20235-xiongdb (Enter to edit)
  Email: xiongdb@ihep.ac.cn (Enter to edit)
  S3 Endpoint: (default) (Enter to edit)

config: /home/xiongdb/.drsai/configs/cli_config.json

↑↓ navigate · Enter/→ edit · s toggle · t test · c clear · q quit
```

| 快捷键 | 功能 |
|--------|------|
| `↑` / `↓` | 上下移动光标，选中配置项（Enabled / Access Key / Secret Key / Bucket / Email / S3 Endpoint） |
| `Enter` | 光标在 Enabled 行 → 切换启用/禁用；在字段行 → 进入该字段编辑 |
| `→` (右箭头) | 进入当前选中字段的编辑（同 Enter 字段行） |
| `e` | 进入完整编辑表单（从第一个字段开始） |
| `t` | 测试连接（S3 健康检查，调用 `list_objects_v2`） |
| `s` | 切换启用/禁用 |
| `c` | 清除所有 GFS 配置 |
| `r` | 刷新配置状态 |
| `q` / `Esc` | 退出面板 |

#### 编辑视图

在状态视图选中某项后按 `Enter`、`→` 或按 `e` 进入编辑视图，可直接键盘输入修改字段内容：

- **↑ / ↓** 或 **Tab**：在 5 个字段间切换
- **键盘输入**：编辑当前字段文本（字符追加到末尾）
- **Backspace**：删除末尾字符
- **s**：在编辑视图中直接切换启用/禁用
- **Enter**：切换到下一个字段；在最后一个字段（S3 Endpoint）按 Enter 保存
- **Esc**：取消编辑，返回状态视图

已有的 AK/SK 显示为 `(unchanged — ***)`，留空表示不修改原值。

### 22.4 配置存储

GFS 配置持久化在 `~/.drsai/configs/cli_config.json` 的 `"gfs"` 键下：

```json
{
  "user_id": "xiongdb",
  "api_key": "...",
  "gfs": {
    "enabled": true,
    "mode": "personal",
    "access_key": "e94UWOls...",
    "secret_key": "2psxS5...",
    "bucket": "20235-xiongdb",
    "email": "xiongdb@ihep.ac.cn",
    "s3_endpoint": ""
  }
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `enabled` | 是 | `true`/`false`，总开关 |
| `mode` | 否 | `"personal"` / 留空（自动判定） |
| `access_key` | Personal 模式必填 | 个人 Access Key |
| `secret_key` | Personal 模式必填 | 个人 Secret Key |
| `bucket` | Personal 模式必填 | 完整桶名（如 `20235-xiongdb`） |
| `email` | 否 | 仅用于日志标识 |
| `s3_endpoint` | 否 | 默认 `https://fgws3-gfs.ihep.ac.cn` |

> **凭证获取**：在 https://gfs.ihep.ac.cn 网页端「密钥管理」页拿到自己的 AK/SK。

### 22.5 工具注入流程

```
Session 创建 (_ensure_agent_session)
  ↓ cli_config.load_config() → cli_cfg (含 "gfs" 子dict)
  ↓
create_agent(cli_cfg=cli_cfg)
  ↓ _build_gfs_tools(user_id, cli_cfg=cli_cfg)
     ↓ 只从 cli_cfg["gfs"] 读取配置（不读 os.environ）
     ↓ GfsCredential(access_key, secret_key, bucket, ...)
     ↓ GfsUserClient(cred) → make_gfs_tools_personal(client=client) → 8个工具
  ↓
DrSaiAssistant(tools=[..., *gfs_tools])
```

**重要**：GFS 工具在 Agent 创建时注入。保存配置后需重启 Session（`/new` 或 `/switch`）才能让新配置生效。

### 22.6 RPC 方法

| RPC 方法 | 说明 | 是否长操作 |
|----------|------|-----------|
| `gfs.status` | 读取当前 GFS 配置（凭证掩码显示） | 否 |
| `gfs.save` | 保存配置到 `cli_config.json`（不写入 `os.environ`） | 否 |
| `gfs.test` | 测试 GFS 连接（S3 健康检查） | 是（`_LONG_HANDLERS`） |
| `gfs.clear` | 清除 GFS 配置（同时清理 `os.environ` 中的残留） | 否 |

---

## 附录 A: 配置文件路径

| 文件 | 路径 | 说明 |
|------|------|------|
| CLI 配置 | `~/.drsai/configs/cli_config.json` | API Key、模型、Plan Mode、max_agent_concurrent、GFS 配置（`gfs` 子对象）等 |
| Session 存储 | SQLite `Thread` 表 | 对话历史、状态、元数据（含 tags/pinned/archived） |
| Agent Workspace | `~/.drsai/workspace/runs/<user_id>/` | Agent 工作目录 |
| Agent 配置 | `~/.drsai/workspace/runs/<user_id>/configs/` | AGENTS.md、TOOLS_CONFIG.json 等 |
| **子智能体配置** | `~/.drsai/workspace/runs/<user_id>/configs/SUBAGENT_CONFIG.json` | 用户自定义子智能体定义 |
| **线程配置** | `~/.drsai/workspace/runs/<user_id>/configs/THREAD_CONFIG.json` | 线程级默认子智能体持久化 |
| **Skills 目录** | `~/.drsai/workspace/runs/<user_id>/configs/skills/` | 用户安装的 Skill（每个子目录含 SKILL.md） |
| **Session 搜索索引** | SQLite `session_search_fts` 表 | Session 元数据 FTS5 全文搜索索引（trigram） |
| **Session 索引** | SQLite `idx_thread_user_*` | workdir/updated_at/archived 复合索引 |
| 项目指令 | `.drsai/DRSAI.md` (项目目录下) | 项目级指令 |
| 组织指令 | `/etc/drsai/DRSAI.md` (Linux) | 组织级策略 |
| **Daemon PID** | `~/.drsai/workspace/daemons/<name>.pid` | Daemon 进程 PID |
| **Daemon State** | `~/.drsai/workspace/daemons/<name>.json` | Daemon 端口、Token、配置 |
| **Daemon 日志** | `~/.drsai/logs/daemons/<name>.log` | Daemon stdout + stderr |
| **微信凭据** | `~/.drsai/workspace/wechat/credentials.json` | ilink Bot token、account_id、登录时间 |
| TUI 崩溃日志 | `~/.drsai/logs/tui_gateway_crash.log` | Gateway 未捕获异常记录 |

---

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
  "dangerous_allowed": false,          // 危险命令是否允许执行
  "default_subagent": "explore"        // 默认子智能体（/agent 设置，可选）
}
```

---

## 附录 C: 项目指令文件大小限制

| 限制 | 值 | 说明 |
|------|-----|------|
| 最大行数 | 200 行 | 超过时发出警告 |
| 最大大小 | 25 KB | 超过时发出警告 |
| @import 递归深度 | 5 层 | 防止循环导入 |
| @import 文件大小 | 100 KB | 单个导入文件上限 |

---

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
9. 加载子智能体配置 (SUBAGENT_CONFIG.json) — 合并内置 + 用户 + daemon 子智能体
10. 配置远程定时任务（如有 Worker URL）
11. 自动启用 Plan Mode（如配置要求）
12. 进入 REPL 主循环
```
---

---

## 附录 E: 子智能体状态保存/恢复

默认子智能体设置持久化在 Thread State 中：

```json
{
  "default_subagent": "explore",
  "...": "..."
}
```

- `/agent <name>` → 写入 `_thread_state.default_subagent` + 可选持久化到 `THREAD_CONFIG.json`
- `/agent clear` → 清空 `_thread_state.default_subagent`
- Session 恢复时：`_thread_state > THREAD_CONFIG.json`（内存优先）

---
