# wechat_python — 微信 ilink Bot Python 接入

用 Python 通过 **ilink bot 协议**接入个人微信，收发消息。

---

## 工作原理

```
微信手机  ←──发消息──→  ilinkai.weixin.qq.com  ←──长轮询──→  Python 脚本
                            (ilink bot API)
```

- 登录方式：扫码绑定个人微信账号，获得 `bot_token`
- 收消息：长轮询 `POST /ilink/bot/getupdates`（服务端保持连接约 30s）
- 发消息：`POST /ilink/bot/sendmessage`

---

## 文件结构

```
wechat_python/
├── wechat_api.py     # 核心 API 封装（三个接口 + 消息解析）
├── step1_login.py    # 步骤一：扫码登录，保存凭据
├── step2_receive.py  # 步骤二：长轮询接收消息（打印）
├── step3_send.py     # 步骤三：主动发送消息
├── bot.py            # 完整 Bot（接收 + 自动回复）
├── credentials.json  # 登录后自动生成，存放 bot_token 等
└── sync_buf.txt      # 消息游标，防止重复收历史消息
```

---

## 快速开始

### 1. 安装依赖

```bash
pip install requests qrcode[pil] pillow
```

### 2. 步骤一：扫码登录

```bash
python step1_login.py
```

终端会打印二维码（ASCII），用**微信**扫码后确认，凭据自动保存到 `credentials.json`。

### 3. 步骤二：验证收消息

```bash
python step2_receive.py
```

用微信向自己发一条消息，终端会打印消息内容。按 `Ctrl+C` 停止。

### 4. 步骤三：验证发消息

```bash
python step3_send.py
```

输入一条消息，脚本会把它发送到绑定的微信账号（自己）。

### 5. 运行完整 Bot

```bash
python bot.py
```

发送 `/help` 到微信查看命令列表，Bot 会自动回复。

---

## 自定义 Bot 逻辑

编辑 [bot.py](bot.py) 中的 `process_message` 函数：

```python
def process_message(text: str, from_user: str, creds: dict) -> str:
    # 替换以下逻辑为你的业务代码
    # 例如：调用 Claude API、查询数据库、执行命令等
    return f"[Echo] {text}"
```

**接入 Claude API 示例：**

```python
import anthropic

client = anthropic.Anthropic()

def process_message(text, from_user, creds):
    msg = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        messages=[{"role": "user", "content": text}]
    )
    return msg.content[0].text
```

---

## 关键注意事项

| 事项 | 说明 |
|------|------|
| `sync_buf.txt` | 消息游标，**不要删除**，否则重启后会重收历史消息 |
| `context_token` | 回复消息时必须带上，来自收到消息的字段 |
| `ret == -14` | session 过期，需重新运行 `step1_login.py` 扫码 |
| 消息去重 | 用 `message_id` 去重，相同 ID 只处理一次 |
| 长消息分段 | 单条建议不超过 2048 字符，`bot.py` 已自动分段 |

---

## API 接口速查

| 接口 | 方法 | 路径 |
|------|------|------|
| 获取登录二维码 | GET | `/ilink/bot/get_bot_qrcode?bot_type=3` |
| 查询扫码状态 | GET | `/ilink/bot/get_qrcode_status?qrcode=<id>` |
| 拉取消息（长轮询） | POST | `/ilink/bot/getupdates` |
| 发送消息 | POST | `/ilink/bot/sendmessage` |

**认证 Headers（每次请求都需要）：**
```
Authorization: Bearer <bot_token>
AuthorizationType: ilink_bot_token
X-WECHAT-UIN: <随机4字节base64>
```
