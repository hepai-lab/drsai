## 10 Plan Mode 与 Prompt 注入

### 10.1 Plan Mode

Plan Mode 让 AI 在执行复杂任务前先访谈用户，逐个确认设计决策：

```
/plan_mode on         # 启用（session-local）
/plan_mode off        # 禁用（session-local）
/plan_mode status     # 查看当前状态

/pm on                # 简写
/pm_global on         # 启用并保存为全局默认
/pmg off              # 禁用并保存为全局默认
```

启用后，AI 的 system prompt 第 ① 层会被注入 `PLAN_MODE_SYSTEM_PROMPT` 常量（定义在 `backend/run_drsai_agent_factory.py:37`）：

> *"Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer. Ask the questions one at a time. If a question can be answered by exploring the codebase, explore the codebase instead."*

**启动时自动启用**：如果配置中 `plan_mode: true` 或使用了 `--plan-mode` 参数，CLI 会在启动时自动注入 Plan Mode 前缀。

**运行时切换**：`/plan_mode on` 不仅会写 `agent._injected_prefix = PLAN_MODE_SYSTEM_PROMPT`，还会立刻调用 `agent.update_system_prompt()` 重建 system message，下一轮提问立即带上前缀。`off` 会清空 prefix 并重建。

### 10.2 /inject 命令

`/inject` 允许动态注入自定义提示词到 system prompt：

```
/inject prefix <text>     # 注入前缀（在 ① 层）
/inject suffix <text>     # 注入后缀（在 ⑥ 层）
/inject clear             # 清除所有注入的 prefix/suffix
/inject status            # 显示当前注入状态
```

**注意**：`/inject` 只修改 prefix/suffix，不影响 project_instructions。如果要修改项目指令，使用 `/memory reload`。

---

---

