# Session 管理

OpenDrSai TUI 的 Session 管理功能涵盖会话的创建、切换、搜索、重命名和清屏。所有会话数据自动持久化到本地 SQLite 数据库，无需手动保存。

## 命令速查

| 命令 | 别名 | 参数 | 说明 |
|------|------|------|------|
| `/new` | — | `[name]` | 创建新 Session |
| `/list` | `/ls` | `[--all]` | 列出当前工作目录的 Session（`--all` 列出所有工作目录） |
| `/resume` | — | `[id\|name]` | 恢复指定 Session（无参数时打开选择器） |
| `/find` | — | `<query> [--cwd]` | 自然语言搜索 Session（FTS5 + BM25 混合排名） |
| `/rename` | — | `<name>` | 重命名当前 Session |
| `/clear` | `/cls` | — | 清屏并刷新会话状态 |

---

## 命令详情

### `/new` — 创建新 Session

创建一个新的对话会话。创建后自动切换到新会话。

```
/new              # 创建匿名 Session
/new bug-fix      # 创建名为 "bug-fix" 的 Session
```

**技术链路**: `cmd_new` → `ui_action: "session.new"` → 前端调用 `session.create` RPC → 切换到新会话。

---

### `/list` — 列出 Session

打开交互式 Session Picker 面板，展示当前工作目录下的所有会话（已归档的默认隐藏）。

```
/list             # 仅当前工作目录
/list --all       # 所有工作目录
```

**Session Picker 快捷键**:

| 按键 | 功能 |
|------|------|
| `↑` / `↓` | 上下导航 |
| `Ctrl+P` / `Ctrl+N` | 同上下导航 |
| `PgUp` / `PgDn` | 翻页 |
| `g` / `G` | 跳到顶部 / 底部 |
| `1`-`9` | 快速选择前 9 个 |
| `Enter` | 打开选中的 Session |
| `p` | 置顶 / 取消置顶 |
| `a` | 归档 / 取消归档 |
| `t` | 添加标签 |
| `T` | 移除标签 |
| `Esc` | 关闭面板 |

> **注**: 置顶、归档、标签操作直接通过 RPC 调用后端 `session.pin`/`session.unpin`/`session.archive`/`session.tag_add`/`session.tag_remove`，不经过 slash 命令分发。

---

### `/resume` — 恢复 Session

恢复之前的会话。支持直接指定 Session ID 或名称，也可以不带参数打开选择器。

```
/resume           # 打开 Session Picker
/resume abc123    # 直接切换到 ID 前缀为 abc123 的 Session
/resume bug-fix   # 切换到名为 "bug-fix" 的 Session
```

**技术链路**: `cmd_resume` → `ui_action: "session.switch"` → 有 `target` 时直接切换，无 `target` 时打开 Session Picker。

---

### `/find` — 搜索 Session

使用 FTS5 + BM25 混合算法搜索所有会话。搜索范围包括会话名称、预览文本、消息内容和所属工作目录。结果按相关性得分 + 时间衰减 + 工作目录加权综合排序。

```
/find login error        # 搜索包含 "login error" 的会话
/find --cwd auth bug     # 仅在当前工作目录搜索
```

搜索结果展示在 SmartSearchPane 面板中，支持：

| 按键 | 功能 |
|------|------|
| `↑` / `↓` | 上下导航 |
| `1`-`9` | 快速选择前 9 个结果 |
| `Enter` | 打开选中的 Session |
| `Esc` | 关闭面板 |

每个结果显示会话名称、消息数、相关性得分和预览文本。

**搜索算法**: 纯本地 FTS5 全文检索，无需 embedding 模型。三阶段流程：
1. **关键词预过滤** — 子串匹配缩小候选集
2. **FTS5 深度搜索** — BM25 排名检索 session metadata + message 内容
3. **复合评分** — BM25 得分 + 时间衰减（半衰期 1 周）+ 工作目录加权

---

### `/rename` — 重命名当前 Session

```
/rename my-feature     # 将当前 Session 重命名为 "my-feature"
```

重命名后立即生效并持久化到数据库。

---

### `/clear` — 清屏

清除终端屏幕并刷新当前会话状态显示。

```
/clear
/cls
```

---

## 快捷操作

除了 slash 命令外，TUI 还提供以下快捷入口：

### Ctrl+W — 快速切换 Session

弹出 QuickSwitchPanel 面板，展示当前工作目录下的会话（置顶优先，按最近活跃排序）。支持数字键 1-9 快速选择。

### Session Picker 内联操作

在 `/list` 或 `/resume` 打开的 Session Picker 中，可以直接对会话进行置顶、归档和标签管理，无需退出面板。

---

## 数据持久化

- 所有 Session 自动保存到本地 SQLite 数据库
- Session 元数据（名称、标签、置顶/归档状态）存储在 `Thread.meta` JSON 字段
- 全文检索通过 SQLite FTS5 虚拟表实现（`session_search_fts`、`session_messages_fts`）
- 每个用户拥有独立的会话命名空间，通过 `user_id` 隔离
