## 11 状态与信息查看

| 命令 | 说明 |
|------|------|
| `/status` | 综合状态报告：连接、模型、API Key、Session、Agent 健康 |
| `/info` | Session 配置详情：用户 ID、模型、工具列表、Skills 目录 |
| `/config` | CLI 连接配置（敏感值遮蔽） |

### /status 输出示例

```
  DrSai v1.x  —  CLI Status

  Config:  ~/.drsai/configs/cli_config.json

  Connection
  Server URL     http://localhost:42858/apiv2
  Model          minimax-m2.7-highspeed
  User ID        user@example.com
  LLM config     minimax-m2.7-highspeed
  API key        sk-1...xxxx

  Agent Factory
  LLM catalog     <built-in default>
  Anthropic key   <not set>
  OpenAI key      sk-2...xxxx

  Agent Health
  ✓ Agent connected
  Tools           15 available

  Sessions
  Total saved:    3
    [aaa] myproject <-- current
    [bbb] experiment
    [ccc] default

  Stats   turns=5 tokens=2048→512 last=3.2s
```

---

---

