## 附录 E: 子智能体状态保存/恢复

默认子智能体设置持久化在 Thread State 中：

```json
{
  "default_subagent": "explore",
  "...": "..."
}
```

- `/agent <name>` → 写入 `_thread_state.default_subagent` + 可选持久化到 `THREAD_CONFIG.json`
- `/agent clear` → 清空 `_thread_state.default_subagent`
- Session 恢复时：`_thread_state > THREAD_CONFIG.json`（内存优先）

---
