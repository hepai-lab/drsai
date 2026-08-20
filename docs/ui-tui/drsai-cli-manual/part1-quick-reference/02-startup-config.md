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

