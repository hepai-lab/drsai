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

