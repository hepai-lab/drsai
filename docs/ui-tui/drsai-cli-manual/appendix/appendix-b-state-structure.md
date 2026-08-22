## 附录 B: 状态保存/恢复数据结构

```json
{
  "type": "DrSaiCLIAssistantState",
  "llm_context": { ... },              // 对话历史（API 级消息列表）
  "defult_config_name": "minimax-m2.7-highspeed",
  "injected_prefix": "",               // Plan Mode 前缀或自定义 prefix
  "injected_suffix": "",               // 自定义 suffix
  "project_instructions": "...",       // DRSAI.md 合并内容
  "reasoning_effort": "medium",        // 推理强度
  "only_in_workspace": true,           // Workspace 限制是否开启
  "dangerous_allowed": false,          // 危险命令是否允许执行
  "default_subagent": "explore"        // 默认子智能体（/agent 设置，可选）
}
```

---

