## 20 微信接入

> **实现状态**：ilink Bot 长轮询模式已实现（`backend/wechat/`）。企业微信 Webhook 模式待实现。

### 20.1 两种接入模式

| 模式 | 技术方案 | 适用场景 | 实现状态 |
|------|---------|---------|---------|
| **微信个人号**（ilink） | ilink Bot 长轮询 API（`ilinkai.weixin.qq.com`） | 个人开发者，无需服务器公网 IP | ✅ 已实现 |
| **企业微信 Bot** | Webhook 推送（需公网可达） | 团队/企业内部部署 | ⏳ 待实现 |

### 20.2 启动微信接入

```bash
# 启动支持微信的 daemon（首次会触发自动扫码登录）
drsai daemon start --name my-bot --wechat

# 如凭据已存在且未过期，直接启动，无需再次扫码
drsai daemon start --name my-bot --wechat
```

**首次启动流程**：

```
drsai daemon start --name my-bot --wechat
  ↓
检测 credentials.json 是否存在且未过期
  ├── 存在且有效 → 直接启动 daemon + WeChatBot
  └── 不存在或已过期 → 触发终端扫码登录
                           ↓
                       获取二维码（终端 ASCII QR）
                           ↓
                       用户手机扫码确认
                           ↓
                       凭据保存到 ~/.drsai/workspace/wechat/credentials.json
                           ↓
                       启动 daemon + WeChatBot 长轮询主循环
```

> **注意**：扫码在 CLI 父进程中完成（有终端交互），而非在后台 daemon 进程中。这确保了二维码能正常显示在用户的终端上。

### 20.3 凭据生命周期

| 阶段 | 说明 |
|------|------|
| **首次启动** | `opendrsai daemon start --wechat` 自动触发扫码 → 保存到 `credentials.json` |
| **后续重启** | 凭据有效（<7天）→ 跳过扫码，直接启动 |
| **凭据过期** | 超过 7 天 → 自动重新触发扫码 |
| **手动登录** | `opendrsai wechat login` 可随时手动重新扫码 |
| **凭据位置** | `~/.drsai/workspace/wechat/credentials.json` |

**credentials.json 格式**：
```json
{
  "bot_token": "ilink_bot_token_xxx",
  "account_id": "ilink_bot_id_xxx",
  "user_id": "ilink_user_id_xxx",
  "base_url": "https://ilinkai.weixin.qq.com",
  "login_time": 1748908800.0,
  "hepai_api_key": "sk-xxx"
}
```

### 20.4 消息流架构

```
微信用户发消息到 ilink Bot
  ↓
daemon 进程内 WeChatBot 长轮询 getupdates
  ↓ (HTTPS, ilinkai.weixin.qq.com)
WeChatBot.handle_message()
  ├── 提取 user_id（from_user_id）
  ├── 路由到对应 AgentSession（每个微信用户独立 session）
  └── 调用 AgentSessionAdapter.a_drsai_ui_completions()
        ↓
  流式响应 → 分段（≤2048 字符）→ 调用 sendmessage 回复微信
```

**关键差异（与实际实现对齐）**：
- WeChatBot 通过**长轮询**（`getupdates`）拉取消息，而非被动接收 Webhook
- WeChatBot 运行在 daemon 进程内，不依赖外部端口暴露
- `--wechat-port` 参数当前仅用于端口占用检测，ilink 模式不需要本地端口

### 20.5 多用户会话隔离

每个微信用户（`from_user_id`）自动映射到独立的 AgentSession：

```
wechat_user_id → chat_id (微信用户 ID)
              → AgentSession (独立对话历史、独立工具调用)
```

**Session 持久化**：daemon 将微信会话映射保存到 `~/.drsai/workspace/daemons/<name>/wechat_sessions.json`，daemon 重启后不会丢失。

### 20.6 消息格式规范

| 微信消息类型 | 处理方式 |
|------------|---------|
| 文本消息 | 直接作为用户 prompt 传入 Agent |
| 图片消息 | 暂不支持（回复提示文字） |
| 语音消息 | 暂不支持（回复提示文字） |
| 文件消息 | 暂不支持（回复提示文字） |

**回复截断**：微信单条消息最长 2048 字符，超长回复自动分片发送（从换行处切割，每片 ≤2048 字符）。

**命令支持**：微信用户可使用以下命令（与 TUI `/` 命令一致）：

| 命令 | 说明 |
|------|------|
| `/help` | 显示帮助 |
| `/newsession` | 新建会话 |
| `/session` | 查看所有历史会话 |
| `/session <id>` | 切换到指定会话 |
| `/models` | 列出可用模型 |
| `/model <name>` | 切换模型 |
| `/agents` | 查看可用子智能体 |
| `/agent <name>` | 设置默认子智能体 |
| `/agent clear` | 取消默认子智能体 |

### 20.7 配置参数

| 参数 | 说明 | 默认值 |
|------|------|-------|
| `--wechat` | 启用微信 ilink Bot 接入 | 关闭 |
| `--wechat-port` | 端口占用检测（ilink 模式无需本地端口） | 自动从 `[9000, 9100)` 扫描 |
| `HEPAI_API_KEY` | HepAI/LLM API Key（写入 credentials.json） | — |

---

---

