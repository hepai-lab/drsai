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

