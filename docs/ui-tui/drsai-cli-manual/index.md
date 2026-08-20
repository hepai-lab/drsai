# OpenDrSai CLI 使用手册

> OpenDrSai CLI 是 OpenDrSai 智能体框架的**本地交互式终端客户端**。在终端里即可与 AI 智能体连续对话、调用工具、管理多个会话，无需部署远程服务。也支持远程附加模式，连接到远端 gateway 运行。

本手册已拆分为多个部分，请通过下方链接跳转到感兴趣的章节。

---

## 📖 目录

### 第一部分：手册速查

> 快速查阅所有命令与配置，入门首选。

| 章节 | 标题 | 链接 |
|------|------|------|
| §1 | 总体介绍 | [➜ 查看](part1-quick-reference/01-introduction.md) |
| §2 | 启动与配置 | [➜ 查看](part1-quick-reference/02-startup-config.md) |
| §3 | 完整命令速查表 | [➜ 查看](part1-quick-reference/03-command-cheatsheet.md) |

### 第二部分：核心功能详解

> 日常使用最频繁的功能：Session、模型、记忆、项目指令等。

| 章节 | 标题 | 链接 |
|------|------|------|
| §4 | System Prompt 层级架构 | [➜ 查看](part2-core-features/04-system-prompt.md) |
| §5 | Session 管理 | [➜ 查看](part2-core-features/05-session-management.md) |
| §6 | Session 搜索与组织 | [➜ 查看](part2-core-features/06-session-search.md) |
| §7 | 模型与推理控制 | [➜ 查看](part2-core-features/07-model-inference.md) |
| §8 | 项目指令 (DRSAI.md) | [➜ 查看](part2-core-features/08-project-instructions.md) |
| §9 | 记忆管理 | [➜ 查看](part2-core-features/09-memory-management.md) |
| §10 | Plan Mode 与 Prompt 注入 | [➜ 查看](part2-core-features/10-plan-mode.md) |
| §11 | 状态与信息查看 | [➜ 查看](part2-core-features/11-status-info.md) |

### 第三部分：安全与交互

> 安全控制、图像多模态输入、显示控制、中断退出等交互层功能。

| 章节 | 标题 | 链接 |
|------|------|------|
| §12 | 安全控制 | [➜ 查看](part3-security-interaction/12-security.md) |
| §13 | 图像多模态输入与 @ 文件路径引用 🆕 | [➜ 查看](part3-security-interaction/13-image-multimodal.md) |
| §14 | 显示与交互控制 | [➜ 查看](part3-security-interaction/14-display-control.md) |
| §15 | 中断与退出 | [➜ 查看](part3-security-interaction/15-interrupt-exit.md) |

### 第四部分：高级功能

> 定时任务、Skill、Daemon、微信、子智能体、GFS 等进阶能力。

| 章节 | 标题 | 链接 |
|------|------|------|
| §16 | 定时任务与通知推送 | [➜ 查看](part4-advanced/16-scheduled-tasks.md) |
| §17 | TUI 行为与调优 | [➜ 查看](part4-advanced/17-tui-tuning.md) |
| §18 | Skill 管理 | [➜ 查看](part4-advanced/18-skill-management.md) |
| §19 | Daemon 后台常驻服务 | [➜ 查看](part4-advanced/19-daemon.md) |
| §20 | 微信接入 | [➜ 查看](part4-advanced/20-wechat.md) |
| §21 | Subagent（子智能体 / Delegate） | [➜ 查看](part4-advanced/21-subagent.md) |
| §22 | GFS 高能所文件系统集成 | [➜ 查看](part4-advanced/22-gfs.md) |

### 附录

> 配置路径、数据结构、时序等底层参考细节。

| 附录 | 标题 | 链接 |
|------|------|------|
| A | 配置文件路径 | [➜ 查看](appendix/appendix-a-config-paths.md) |
| B | 状态保存/恢复数据结构 | [➜ 查看](appendix/appendix-b-state-structure.md) |
| C | 项目指令文件大小限制 | [➜ 查看](appendix/appendix-c-size-limits.md) |
| D | 启动时序 | [➜ 查看](appendix/appendix-d-startup-sequence.md) |
| E | 子智能体状态保存/恢复 | [➜ 查看](appendix/appendix-e-subagent-state.md) |

---

## 🗺️ 快速导航

**第一次使用？** 请按顺序阅读：
1. [§1 总体介绍](part1-quick-reference/01-introduction.md) → 了解 OpenDrSai CLI 是什么
2. [§2 启动与配置](part1-quick-reference/02-startup-config.md) → 安装并完成首次配置
3. [§3 完整命令速查表](part1-quick-reference/03-command-cheatsheet.md) → 浏览所有可用命令
4. [§5 Session 管理](part2-core-features/05-session-management.md) → 开始你的第一个会话

**查找特定功能？** 直接点击上方目录中的对应链接。

**想了解底层细节？** 查看附录部分的[配置文件路径](appendix/appendix-a-config-paths.md)和[启动时序](appendix/appendix-d-startup-sequence.md)。
