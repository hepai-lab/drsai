## 14 显示与交互控制

| 命令 | 说明 |
|------|------|
| `/clear` `/cls` | 清屏并显示 Session 信息 |
| `/verbose` | 切换每轮统计信息 footer（token、耗时、turn 数） |
| `/bell on/off` | 切换终端响铃（响应完成时响铃提示） |
| `/retry` | 重试上一条用户消息 |

**底部工具栏** (Bottom Toolbar)：始终显示当前用户 ID、模型名、turn 数、推理状态、Plan Mode 状态、默认子智能体、Workspace 和 Dangerous 状态：

```
  user@example.com @ minimax-m2.7-highspeed  ·  turns: 5  ·  🔒 ws:on  ·  🛡 dg:off
```

设置默认子智能体后，工具栏会显示当前活跃的子智能体：

```
  user@example.com @ minimax-m2.7-highspeed  ·  turns: 3  ·  🤖 explore  ·  🔒 ws:on  ·  🛡 dg:off
```

| 指示 | 含义 |
|------|------|
| `🤖 <name>` | 当前默认子智能体（通过 `/agent` 设置，所有消息路由到该子智能体） |
| `🔒 ws:on` | Workspace 限制已开启（默认） |
| `🔓 ws:off` | Workspace 限制已关闭 |
| `🛡 dg:off` | 危险命令保护已开启（拦截，默认） |
| `⚠️ dg:on` | 危险命令保护已关闭（允许） |

---

---

