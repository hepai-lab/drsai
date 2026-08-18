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

