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

