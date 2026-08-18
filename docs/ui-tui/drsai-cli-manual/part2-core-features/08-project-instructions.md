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

