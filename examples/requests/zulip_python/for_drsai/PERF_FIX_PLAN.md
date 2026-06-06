# Zulip Bridge 性能修复计划

针对 `bridge.py` 的性能问题制定的修复方案。问题按优先级排序，建议从 P0 开始。

## 问题清单与修复方案

### 🔴 P0-1 全局串行阻塞（最致命）

**问题**：`call_on_each_message(on_message)` 单线程长轮询，回调同步执行。每条消息走完整个 `chat_completion_stream`（可能十几秒）才处理下一条，多用户场景下互相阻塞。

**修复**：在 `on_message` 内为每条消息派发独立线程处理。

```python
def on_message(msg: dict) -> None:
    threading.Thread(target=_handle_message, args=(msg,), daemon=True).start()
```

把现有处理逻辑抽到 `_handle_message(msg)`。注意：多线程后所有共享状态（`Conversations`、Zulip client 调用）需确认线程安全。

**建议增强**：用 `ThreadPoolExecutor(max_workers=N)` 限制并发上限，避免突发流量打爆后端。

---

### 🔴 P0-2 后端调用无超时 → 永久冻结

**问题**：`client.chat.completions.create(...)` 未设 `timeout`，后端挂起会永久占用线程。串行模型下会冻死整个 bot。

**修复**：构造 OpenAI client 时设置超时。

```python
ai_client = OpenAI(
    api_key=DRSAI_API_KEY,
    base_url=DRSAI_BASE_URL,
    timeout=60.0,        # 总超时
    max_retries=1,
)
```

并在调用处捕获超时异常，向用户回发友好提示（现有 `try/except` 已覆盖，确认错误信息清晰即可）。

---

### 🟡 P1-1 会话存储内存无界增长

**问题**：`Conversations._store` 为每个 `chat_id`（每个 DM 对、每个 stream+topic）建 deque，永不回收。长期运行内存持续上涨。

**修复**：会话级别加 LRU 或 TTL 淘汰。

- 方案 A（LRU）：用 `OrderedDict` 限制最大会话数，超出淘汰最久未用。
- 方案 B（TTL）：记录每个会话最后活跃时间，定期清理过期会话。

```python
MAX_SESSIONS = int(os.environ.get("MAX_SESSIONS", "1000"))
# 在 append/history 时 move_to_end，超出 MAX_SESSIONS 时 popitem(last=False)
```

---

### 🟡 P1-2 历史轮数减半（语义 bug）

**问题**：`deque(maxlen=max_turns)` 限制的是**消息条数**，但每轮含 user+assistant 两条，导致 `HISTORY_TURNS=20` 实际只保留 10 轮，与命名和文档不符。

**修复**：将 maxlen 设为 `max_turns * 2`，或显式按轮计数。

```python
self._store: dict[str, deque] = defaultdict(lambda: deque(maxlen=max_turns * 2))
```

同时更新 README 中对 `HISTORY_TURNS` 的描述（"消息条数" vs "对话轮数"）以保持一致。

---

### 🟢 P2-1 流式编辑 API 调用放大

**问题**：`stream_to_zulip` 每 `0.6s` 调一次 `update_message`，长回复（60s）≈ 100 次写 API，叠加串行性进一步拖慢吞吐。
		
**修复**：
- 增大 `STREAM_EDIT_INTERVAL`（如 1.0s）。
- 仅在缓冲区内容相对上次有实质变化时才 update。
- 可选：按字符增量阈值（如新增 ≥40 字符）触发更新，而非纯时间驱动。

---

### 🟢 P2-2 全局锁粒度

**问题**：`Conversations` 用单个全局 `_lock` 保护所有会话。串行模型下无害，但 P0-1 多线程化后会成为争用点。

**修复**：改为按 key 分锁，或使用并发安全的数据结构。串行改并发后再处理即可。

---

## 修复顺序建议

| 阶段 | 内容 | 收益 | 风险 |
|---|---|---|---|
| 阶段一 | P0-1 并发 + P0-2 超时 | 最高，解决吞吐与冻结 | 需验证线程安全 |
| 阶段二 | P1-1 内存淘汰 + P1-2 历史 bug | 稳定性与正确性 | 低 |
| 阶段三 | P2-1 编辑频率 + P2-2 锁粒度 | 优化 | 低 |

## 验证方式

- 并发：多终端同时向 bot 发消息，确认互不阻塞。
- 超时：临时指向不可达后端，确认线程在 timeout 后释放并回发错误。
- 内存：长时间运行 + 制造大量 topic，观察 `_store` 大小受 `MAX_SESSIONS` 约束。
- 历史：连续多轮对话，确认实际保留轮数符合 `HISTORY_TURNS`。
