# TUI Session 管理优化方案

> 作者：DrSai Team · 2025-06  
> 状态：设计文档（待实施）

---

## 1. 背景与问题分析

### 1.1 当前架构

```
┌──────────────────────────────────┐
│  TUI 前端 (React/Ink + TS)       │
│  - SessionPicker                 │
│  - ComposerPane (命令拦截)        │
│  - Nanostores 状态管理            │
└──────────┬───────────────────────┘
           │ JSON-RPC 2.0 (stdin/stdout)
┌──────────▼───────────────────────┐
│  TUI Gateway (Python asyncio)     │
│  - handlers/session.py (10 RPC)   │
│  - handlers/slash.py (斜杠命令)   │
│  - CLISessionStore (history.py)   │
└──────────┬───────────────────────┘
           │
┌──────────▼───────────────────────┐
│  SQLite (drsai.db)                │
│  - Thread (meta: name, workdir)   │
│  - SessionMessage (FTS5)          │
│  - session_messages_fts (BM25)    │
│  - cli_config.json (缓存映射)     │
└──────────────────────────────────┘
```

### 1.2 核心问题

| # | 问题 | 影响 | 优先级 |
|---|------|------|--------|
| P1 | `search()` 和 `most_recent()` 全表扫描 500 条 Thread | session 数 >100 时响应 >1s | **P0** |
| P2 | 搜索仅支持关键词子串匹配，无语义理解 | 用户无法用自然语言找到历史 session | **P0** |
| P3 | 工作目录模式：同一目录可能有多个 session，无智能推荐 | 用户不知道该恢复哪个 | **P1** |
| P4 | `workdir_sessions` 缓存删除 session 后不清理 | 缓存指向无效 ID，启动时需回退查询 | **P1** |
| P5 | SessionPicker 无实时过滤/分组/排序 | 大量 session 时难以定位 | **P2** |
| P6 | 无快捷键快速在工作目录的 session 间切换 | 操作路径长（/switch → 选择 → Enter） | **P2** |
| P7 | Session 元数据不足（无标签/置顶/归档） | 无法组织管理大量 session | **P3** |

### 1.3 现有 RPC 方法

```python
# handlers/session.py
session.create        — 新建 thread (name + workdir)
session.list          — 分页列表（limit=50）
session.resume        — 切换到已有 thread；加载 agent
session.delete        — 删除 thread（⚠️ 不清理 workdir 缓存）
session.rename        — 改名
session.search        — 模糊搜索（name + preview 子串）
session.history       — 返回消息
session.interrupt     — 中断 agent
session.most_recent   — 当前工作目录最近 session
session.info          — 推送 session.info 事件
```

### 1.4 现有斜杠命令

```
/new [name]           → session.new UI action
/switch [target]      → session.switch UI action
/list                 → session.list UI action
/rename <name>        → 直接 rename
/search <query>       → 仅搜 name（⚠️ 不搜内容）
/resume [target]      → session.switch UI action
```

---

## 2. 优化方案总览

```
┌─────────────────────────────────────────────────────────────────┐
│                       TUI 前端层                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │SessionPicker│  │ SmartSearch  │  │ QuickSwitch (Ctrl+W)  │  │
│  │ (增强版)    │  │ (语义搜索)   │  │ (工作目录快捷面板)     │  │
│  │ · 实时过滤  │  │ · /find 命令 │  │ · 当前目录 session     │  │
│  │ · 分组排序  │  │ · BM25+关键词│  │ · 最近使用优先         │  │
│  │ · 标签/置顶 │  │ · 相关度排序 │  │ · 数字键快速选择       │  │
│  └──────┬──────┘  └──────┬───────┘  └───────────┬───────────┘  │
└─────────┼────────────────┼───────────────────────┼─────────────┘
          │                │                       │
          └────────────────┼───────────────────────┘
                           │ JSON-RPC 2.0
┌──────────────────────────▼──────────────────────────────────────┐
│                    后端 Gateway 层                                │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  session.smart_search    — 语义 + 关键词混合搜索          │   │
│  │  session.workspace_map   — 工作目录 session 映射+推荐     │   │
│  │  session.quick_access    — 优先级排序快速访问列表         │   │
│  │  session.tag_add/remove  — 标签管理                      │   │
│  │  session.pin/unpin       — 置顶/取消置顶                 │   │
│  │  session.archive         — 归档（不显示在列表中）         │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│                    存储优化层                                     │
│  ┌────────────────┐  ┌────────────────┐  ┌──────────────────┐  │
│  │  SQLite 索引    │  │  FTS5 会话搜索 │  │  缓存一致性修复  │  │
│  │  · user+workdir│  │  · session_     │  │  · delete 清理   │  │
│  │  · user+updated│  │    search_fts   │  │  · 安全读取      │  │
│  │  · user+archived│ │  · trigram CJK  │  │  · 启动验证      │  │
│  └────────────────┘  └────────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. 方案一：自然语言搜索 Session

### 3.1 使用场景

```bash
# 按内容语义搜索
> /find 修复登录 bug 的那次会话
→ 🎯 myapp-auth-fix (3 days ago, 42 msgs) 相关度: 0.87

# 按项目+任务搜索
> /find drsai 项目的 session 管理
→ 🎯 drsai-session-mgmt (current, 15 msgs) 相关度: 0.95

# 按工具使用搜索
> /find 用了 bash 命令安装依赖的
→ 🎯 myproject-setup (5 days ago, 28 msgs) 相关度: 0.72

# 限定工作目录
> /find --cwd 性能优化
→ 仅在当前工作目录的 session 中搜索
```

### 3.2 后端实现

#### 新 RPC 方法：`session.smart_search`

**文件**：`cores/python/packages/drsai/src/drsai/backend/tui_gateway/handlers/session.py`

```python
@method("session.smart_search")
def _smart_search(rid, params: dict) -> dict:
    """自然语言搜索 session（语义 + 关键词混合）。
    
    搜索策略：
    1. 关键词预筛选：name + preview + workdir 子串匹配（快）
    2. FTS5 深度搜索：通过 session_messages_fts 搜索消息内容（中）
    3. 综合评分：结合 BM25 分数 + 时间衰减 + 工作目录相关性
    
    Args:
        query: 自然语言查询
        limit: 返回数量（默认 10）
        workdir: 可选，限定工作目录
    """
```

#### 新斜杠命令：`/find`

**文件**：`cores/python/packages/drsai/src/drsai/backend/tui_gateway/handlers/slash.py`

```python
def cmd_find(ctx: SlashContext) -> dict:
    """自然语言搜索 session（替代原有的 /search）。"""
```

### 3.3 前端实现

#### 新组件：`SmartSearchPane`

**文件**：`apps/ui-tui/src/components/smartSearchPane.tsx`

- 输入框：接受自然语言查询
- 结果列表：显示 session 名称、相关度分数、preview
- 快捷键：1-9 直接选择、Enter 确认、Esc 取消

---

## 4. 方案二：工作目录智能识别与快速切换

### 4.1 使用场景

```bash
# 启动时检测到多个历史 session
$ cd /home/user/myproject && drsai tui

┌──────────────────────────────────────────┐
│ 🗂️ 此目录有 3 个历史会话：               │
│                                          │
│  1. myproject-main    (2h ago) ★ 最近    │
│  2. myproject-bugfix  (1d ago)           │
│  3. myproject-refactor (3d ago)          │
│                                          │
│ [Enter] 继续最近的  [1-3] 选择  [N] 新建 │
└──────────────────────────────────────────┘

# Ctrl+W 快速切换当前目录的 session
> [Ctrl+W]
┌──────────────────────────────────────┐
│ ⚡ 当前目录会话 (/home/user/myproject)│
│ ▶ 1. main-dev    (current) 📌        │
│   2. experimental                     │
│   3. testing                          │
│                                      │
│ ↑/↓ 切换 · Enter 选择 · N 新建 · Esc 取消│
└──────────────────────────────────────┘
```

### 4.2 后端实现

#### 新 RPC 方法：`session.workspace_map`

```python
@method("session.workspace_map")
def _workspace_map(rid, params: dict) -> dict:
    """获取工作目录的 session 映射。
    
    Returns:
        current_workdir: 当前工作目录
        sessions: 当前目录的所有 session
        recommended: 推荐的 session（综合评分）
        nearby_workdirs: 父/子目录的 session
    """
```

#### 新 RPC 方法：`session.quick_access`

```python
@method("session.quick_access")
def _quick_access(rid, params: dict) -> dict:
    """快速访问：优先级排序的 session 列表。
    
    排序规则：
    1. 当前工作目录的 sessions（置顶）
    2. 标记为 pinned 的 sessions
    3. 最近访问的 sessions
    """
```

### 4.3 前端实现

#### 新组件：`QuickSwitchPanel`

**文件**：`apps/ui-tui/src/components/quickSwitchPanel.tsx`

- 触发方式：`Ctrl+W`
- 显示当前工作目录的所有 session
- 优先显示 pinned 和最近使用的
- 支持数字键快速选择

---

## 5. 方案三：增强 SessionPicker 交互体验

### 5.1 实时过滤

在 SessionPicker 顶部添加过滤输入框，支持：
- 名称过滤
- 路径过滤
- 内容过滤
- ID 前缀匹配

### 5.2 多维度排序

| 快捷键 | 排序方式 | 说明 |
|--------|---------|------|
| `Ctrl+T` | 时间 | 最近更新优先（默认） |
| `Ctrl+N` | 名称 | 字母序 |
| `Ctrl+M` | 消息数 | 消息最多优先 |
| `Ctrl+D` | 工作目录 | 按目录分组 |

### 5.3 分组显示

按工作目录分组，当前目录置顶：

```
📁 /home/user/myproject (current)
  ▶ 1. main-dev         [abc12345]  42 msgs  📌
    2. bugfix            [def67890]  15 msgs

📁 /home/user/other-project
    3. api-design        [ghi11223]  28 msgs
    4. testing           [jkl44556]   8 msgs
```

### 5.4 标签和置顶

```
> /tag add bug urgent
✓ 添加标签: #bug #urgent

> /pin
✓ 已置顶当前 session

> /archive
✓ 已归档（可用 /find 搜索恢复）
```

---

## 6. 方案四：性能优化

### 6.1 数据库索引

在 `db_manager.py` 的 `_create_fts_tables` 方法中追加：

```sql
-- 复合索引：按 user_id + workdir 快速查询
CREATE INDEX IF NOT EXISTS idx_thread_user_workdir 
ON thread(user_id, json_extract(meta, '$.workdir'));

-- 复合索引：按 user_id + 最近更新排序
CREATE INDEX IF NOT EXISTS idx_thread_user_updated 
ON thread(user_id, updated_at DESC);

-- 索引：归档过滤
CREATE INDEX IF NOT EXISTS idx_thread_user_archived 
ON thread(user_id, json_extract(meta, '$.archived'));
```

### 6.2 Session FTS5 全文搜索表

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS session_search_fts USING fts5(
    thread_id UNINDEXED,
    user_id UNINDEXED,
    name,
    preview,
    workdir,
    tags,
    tokenize='trigram'  -- 支持 CJK 和部分匹配
);

-- 同步触发器
CREATE TRIGGER IF NOT EXISTS session_search_fts_insert
    AFTER INSERT ON thread
BEGIN
    INSERT INTO session_search_fts(thread_id, user_id, name, preview, workdir, tags)
    VALUES (
        NEW.thread_id,
        NEW.user_id,
        json_extract(NEW.meta, '$.name'),
        '',  -- preview 需要从 messages 提取，在应用层处理
        json_extract(NEW.meta, '$.workdir'),
        json_extract(NEW.meta, '$.tags')
    );
END;
```

### 6.3 优化 CLISessionStore 查询

用索引查询替代全表扫描：

```python
def most_recent_by_workdir(self, workdir: str) -> Optional[SessionInfo]:
    """使用索引查询（替代全表扫描）。"""
    
def list_by_workdir(self, workdir: str, limit: int = 50) -> list[SessionInfo]:
    """列出工作目录的所有 session。"""
    
def fast_search(self, query: str, limit: int = 20) -> list[SessionInfo]:
    """使用 FTS5 快速搜索。"""
```

---

## 7. 方案五：缓存一致性修复

### 7.1 问题

`workdir_sessions` 缓存在 `cli_config.json` 中，删除 session 后不清理：

```python
# session.delete 不清理缓存
@method("session.delete")
def _delete(rid, params: dict) -> dict:
    # ... 删除 Thread ...
    # ⚠️ 没有清理 cli_config.json 的 workdir_sessions 映射
```

### 7.2 修复

1. **在 `session.delete` 中清理缓存**
2. **在 `most_recent` 中验证缓存有效性**
3. **添加启动时缓存验证方法**

---

## 8. Session 元数据扩展

### 8.1 Thread.meta 新增字段

```python
meta = {
    "name": str,              # 现有：session 名称
    "workdir": str,           # 现有：工作目录
    "tags": list[str],        # 新增：用户标签
    "pinned": bool,           # 新增：置顶
    "archived": bool,         # 新增：归档
    "color": str,             # 新增：UI 颜色标记
    "last_model": str,        # 新增：最后使用的模型
    "total_tokens": int,      # 新增：累计 token 消耗
}
```

### 8.2 SessionInfo 扩展

```python
@dataclass
class SessionInfo:
    thread_id: str
    name: str
    updated_at: str
    message_count: int
    preview: str
    workdir: str = ""
    # 新增字段
    tags: list[str] = field(default_factory=list)
    pinned: bool = False
    archived: bool = False
    relevance_score: float = 0.0  # 搜索相关度
```

---

## 9. 实施路线图

### Phase 1: 基础设施（P0，1-2 天）

- [ ] 添加数据库索引（db_manager.py）
- [ ] 添加 session_search_fts 表和触发器
- [ ] 修复缓存一致性（session.delete 清理、most_recent 验证）
- [ ] 优化 CLISessionStore 查询方法

### Phase 2: 搜索增强（P0，2-3 天）

- [ ] 实现 session.smart_search RPC
- [ ] 实现 /find 斜杠命令
- [ ] 实现 SmartSearchPane 前端组件
- [ ] 扩展 SessionInfo 数据结构

### Phase 3: 工作目录增强（P1，2-3 天）

- [ ] 实现 session.workspace_map RPC
- [ ] 实现 session.quick_access RPC
- [ ] 实现 QuickSwitchPanel 前端组件（Ctrl+W）
- [ ] 启动时多 session 检测和推荐

### Phase 4: 交互增强（P2，2-3 天）

- [ ] SessionPicker 实时过滤
- [ ] SessionPicker 多维度排序
- [ ] SessionPicker 分组显示
- [ ] 标签/置顶/归档功能

---

## 10. 关键文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `cores/.../tui_gateway/handlers/session.py` | 修改 | 新增 smart_search/workspace_map/quick_access/tag/pin/archive RPC |
| `cores/.../tui_gateway/handlers/slash.py` | 修改 | 新增 /find /tag /pin /archive 命令 |
| `cores/.../backend/cli/history.py` | 修改 | 新增索引查询、FTS5 搜索、元数据方法 |
| `cores/.../backend/cli/config.py` | 修改 | 缓存一致性修复、安全读取方法 |
| `cores/.../managers/database/db_manager.py` | 修改 | 添加索引和 FTS 表 |
| `cores/.../agents/skills_agent/drsai_cli_assistant.py` | 修改 | SessionInfo 扩展字段 |
| `cores/.../managers/datamodel/db.py` | 无变更 | Thread.meta JSON 已足够 |
| `apps/ui-tui/src/components/sessionPicker.tsx` | 修改 | 增强过滤/排序/分组 |
| `apps/ui-tui/src/components/smartSearchPane.tsx` | 新增 | 自然语言搜索面板 |
| `apps/ui-tui/src/components/quickSwitchPanel.tsx` | 新增 | 快速切换面板 |
| `apps/ui-tui/src/components/composerPane.tsx` | 修改 | 新增 /find /tag 命令路由、Ctrl+W |
| `apps/ui-tui/src/gatewayTypes.ts` | 修改 | SessionInfo 扩展字段 |
| `apps/ui-tui/src/app.tsx` | 修改 | 启动时多 session 检测 |
| `apps/ui-tui/src/app/uiStore.ts` | 修改 | 新增 overlay 类型 |
