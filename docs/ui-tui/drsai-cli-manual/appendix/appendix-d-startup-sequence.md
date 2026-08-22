## 附录 D: 启动时序

```
1. 加载 CLI 配置 (cli_config.json)
2. 初始化本地 SQLite 数据库
3. 打印 Banner
4. 检查 cwd 对应的 Session（恢复或创建）
5. 创建 Agent 实例 (DrSaiCLIAssistant) — 默认 only_in_workspace=True, dangerous_allowed=False
6. Agent.lazy_init()
7. 加载 Thread 状态 (load_state) — 恢复 workspace 和 dangerous 状态
8. 加载项目指令 (DRSAI.md) — 仅在未从状态恢复时
9. 加载子智能体配置 (SUBAGENT_CONFIG.json) — 合并内置 + 用户 + daemon 子智能体
10. 配置远程定时任务（如有 Worker URL）
11. 自动启用 Plan Mode（如配置要求）
12. 进入 REPL 主循环
```
---

---

