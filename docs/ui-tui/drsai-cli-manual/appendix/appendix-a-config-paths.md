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

