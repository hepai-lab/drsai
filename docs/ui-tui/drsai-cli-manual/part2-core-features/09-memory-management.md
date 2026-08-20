## 9 记忆管理

### 9.1 记忆层级

OpenDrSai CLI 的记忆系统通过 `DrSaiSQLiteChatCompletionContext` 实现，内置两个核心工具：

| 工具 | 说明 | 调用方式 |
|------|------|----------|
| `retrieve_from_memory` | 从 SQLite FTS5 全文检索历史记忆 | AI 自动调用或 `/memory` 触发 |
| `summry_conversation_to_memory` | 将对话总结存入长期记忆 | AI 自动调用或手动触发 |
| `read_session_memory_by_index` | 按索引读取压缩前的原始消息 | 用于恢复被压缩的详细内容 |

### 9.2 手动压缩 (`/compress`)

`/compress` 命令主动触发 LLM 摘要压缩，无需等待 token 超限自动触发。

**语法**：

```
/compress                    使用默认 keep_recent=6 压缩
/compress keep_recent=N      保留最近 N 条消息，压缩更早的消息
/compress 10                 等价于 keep_recent=10
/cmp                         别名
/compress status             查看 token 使用情况（不执行压缩）
```

**压缩流程**（三层）：

1. **Layer 0 — flush**：将内存中待写的消息刷新到 `SessionMessage` 表
2. **Layer 1 — 工具结果清除**：`_compress_tool_results()` 将旧的工具调用结果替换为占位符（原始内容仍在 DB 中，可通过 `read_session_memory_by_index` 取回）
3. **Layer 2 — LLM 摘要**：`_incremental_compress()` 将 `keep_recent` 之前的消息发给 LLM 生成摘要，用一条 `UserMessage("[Compressed conversation history]\n{摘要}")` 替换旧消息；摘要同时写入 `SessionSummary` 表供 FTS5 检索

**压缩效果示例**：

```
✅ Memory compressed successfully!
  Messages:  28 → 7 (compressed 21)
  Tokens:    18500 → 3200 (saved 15300, 82.7%)

  Summary preview:
  用户讨论了 DrSai 项目的两个 bug 修复：SYSTEM_SKILLS_DIR 路径转义问题和 TUI banner 重复打印…
```

**进度反馈**：压缩期间（LLM 调用通常 10–60 秒），TUI 底部状态栏显示旋转 spinner 动画 `⠋ 正在压缩记忆 (保留最近 N 条)…`，完成后自动清除。

**注意事项**：

- 压缩仅修改内存中的 `_messages`，**不会删除** `SessionMessage` 表中的原始消息行
- 压缩后的状态通过 `save_state()` 持久化到 `Thread.state`，下次回溯时加载的是压缩后的消息列表
- 原始消息可通过 `retrieve_from_memory`（FTS5 检索）或 `read_session_memory_by_index`（按索引取回）访问
- 如果消息数 ≤ `keep_recent`，压缩不会执行（无需压缩）

### 9.3 记忆检索

`retrieve_from_memory` 使用 BM25 排序的 FTS5 全文检索：

- 标准 tokenizer 处理英文/拼音
- Trigram FTS 表处理 CJK/子串查询（标准 tokenizer 无结果时自动回退）
- 支持元数据条件过滤（如按 thread_id）
- 可调节相似度阈值和分页大小

### 9.4 记忆与 Session 的关系

```
Session A (thread_id: aaa...)
  ├── 短期对话记忆: 当前对话历史（自动压缩管理）
  ├── 长期记忆检索: 可跨 Session 搜索所有历史
  └── 状态持久化: save_state() → Thread.state
  
Session B (thread_id: bbb...)
  ├── 短期对话记忆: 独立的对话历史
  ├── 长期记忆检索: 同样可搜索 Session A 的内容
  └── 状态持久化: 独立的 Thread.state
```

短期记忆是 Session 级隔离的，长期记忆是 User 级共享的。

---

---

