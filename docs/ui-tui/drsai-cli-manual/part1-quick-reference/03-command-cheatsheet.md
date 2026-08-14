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

