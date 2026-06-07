# Zulip ↔ OpenDrSai 桥接器

把 OpenDrSai 智能体接到 Zulip 频道 / 私聊。

```
Zulip 用户 ──发消息──> Zulip 服务器 ──长轮询──> bridge.py ──OpenAI ChatCompletions──> drsai backend ──> 智能体
                                                  ▲                                                       │
                                                  └─────────────────── 流式回复 ◄──────────────────────────┘
```

## 1. 准备 Zulip 机器人

1. 进入 Zulip Web → **Personal settings → Bots → Add a new bot**
2. Bot type 选 **Generic bot**，起个名字（如 `DrSai`）
3. 创建后点击 **Download zuliprc**，把文件放到当前目录并改名为 `.zuliprc`
4. 把机器人加入需要它响应的 stream（DM 不用订阅）

## 2. 启动 drsai 后端

```bash
conda activate drsai
drsai backend --agent-config agent_config.yaml
# 默认监听 http://localhost:8000/v1，模型名取自 agent_config.yaml
```

## 3. 安装桥接器依赖

```bash
pip install zulip openai
```

## 4. 运行

```bash
# 可通过环境变量覆盖默认配置
export DRSAI_BASE_URL="http://localhost:8000/v1"
export DRSAI_API_KEY="EMPTY"           # 本地后端可填任意非空字符串
export DRSAI_MODEL="myassistant"       # 与 agent_config.yaml 中的智能体名一致
export STREAM_REPLY=1                  # 是否开启流式编辑式回复 (1/0)
export HISTORY_TURNS=20                # 每个会话保留的最大消息条数

python bridge.py
```

## 使用

- **私聊**：直接给机器人发消息即可
- **频道**：在已加入机器人的 stream 中 `@**DrSai** 你好`
- **命令**：
  - `/help`  显示帮助
  - `/ping`  连通性测试
  - `/reset` 清空当前会话上下文（DM 或 stream/topic 维度独立）

## 设计说明

- 每个会话用 `chat_id` 隔离，drsai 后端可据此维护状态
  - 私聊：`dm:<sorted-user-ids>`
  - 频道：`stream:<stream_id>:<topic>`
- 历史在客户端裁剪到最近 `HISTORY_TURNS` 条；如需依赖后端长记忆，把 `HISTORY_TURNS` 调小即可。
- 流式回复用 `update_message` 周期性覆写占位消息（默认 0.6s 间隔），避免 Zulip 限流。
- 频道消息只在带 `is_mentioned` flag 或文本里包含 `@**bot-name**` 时才触发，避免噪音。

## 常见问题

- **频道里发消息没反应**：确认机器人订阅了该 stream，且消息中正确 @ 到它。
- **`session 过期 / 401`**：重新下载 `.zuliprc`。
- **空回复 / 报错"调用 drsai 后端失败"**：先单独跑 `examples/requests/drsai_oai_client_request.py` 确认后端可用，再确认 `DRSAI_MODEL` 与已注册智能体名一致。
