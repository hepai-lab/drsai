"""
step3_send.py — 步骤三：主动发送消息给微信用户
=================================================
原理：
  调用 POST /ilink/bot/sendmessage 向指定用户发消息。

  关键字段说明：
    from_user_id  : Bot 自己的 account_id（登录后获得）
    to_user_id    : 对方的 ilink_user_id
    context_token : 从收到的消息中取出，关联会话线程
                    如果是主动发起（非回复），可传空字符串
    client_id     : 唯一消息 ID，防止重复发送

  注意：
    - to_user_id 必须是 ilink_user_id，不是微信号，登录后保存在 credentials.json
    - context_token 传空可以发送，但消息可能不显示在正确的会话线程中

使用方式：
    python step3_send.py
    # 或在其他脚本中导入使用：
    from step3_send import send_text_to_self
"""

from wechat_api import WeChatAPI
from step1_login import load_credentials


def send_text_to_self(text: str) -> None:
    """
    向绑定的微信账号（自己）发送一条文字消息。
    适合用来测试消息发送是否正常。
    """
    creds = load_credentials()
    api = WeChatAPI(creds["bot_token"], creds.get("base_url", "https://ilinkai.weixin.qq.com"))

    account_id = creds["account_id"]
    user_id = creds["user_id"]

    print(f"发送消息给 {user_id}...")
    result = api.send_text(
        bot_account_id=account_id,
        to_user_id=user_id,
        context_token="",    # 主动发消息无 context_token
        text=text,
    )
    print(f"发送结果: {result}")


def send_text_to_user(to_user_id: str, context_token: str, text: str) -> None:
    """
    向任意 ilink_user_id 发送消息（通常在处理消息时调用）。

    参数：
        to_user_id    : 接收方的 ilink_user_id
        context_token : 从收到的消息中取出（回复时使用）
        text          : 消息文字内容
    """
    creds = load_credentials()
    api = WeChatAPI(creds["bot_token"], creds.get("base_url", "https://ilinkai.weixin.qq.com"))

    result = api.send_text(
        bot_account_id=creds["account_id"],
        to_user_id=to_user_id,
        context_token=context_token,
        text=text,
    )
    print(f"消息已发送 -> {to_user_id}: {text!r}, result={result}")


# ── 发送长消息（自动分段） ──────────────────────────────────────────────────────

MAX_LEN = 2048  # 微信单条消息建议不超过 2048 字符

def send_long_text(to_user_id: str, context_token: str, text: str) -> None:
    """
    自动将超长文字按段落拆分，分多条发送。
    """
    creds = load_credentials()
    api = WeChatAPI(creds["bot_token"], creds.get("base_url", "https://ilinkai.weixin.qq.com"))

    chunks = _split_text(text, MAX_LEN)
    for i, chunk in enumerate(chunks, 1):
        if len(chunks) > 1:
            print(f"发送第 {i}/{len(chunks)} 段...")
        api.send_text(creds["account_id"], to_user_id, context_token, chunk)


def _split_text(text: str, max_len: int) -> list[str]:
    if len(text) <= max_len:
        return [text]
    chunks = []
    while text:
        if len(text) <= max_len:
            chunks.append(text)
            break
        # 优先从换行处切
        split_at = text.rfind("\n", 0, max_len)
        if split_at < max_len * 0.3:
            split_at = max_len
        chunks.append(text[:split_at])
        text = text[split_at:].lstrip("\n")
    return chunks


# ── 独立运行：发送测试消息 ──────────────────────────────────────────────────────

def main():
    print("=" * 50)
    print("步骤三：发送测试消息")
    print("=" * 50)

    msg = input("\n请输入要发送的消息（回车使用默认）: ").strip()
    if not msg:
        msg = "你好！这是来自 Python 脚本的测试消息 🎉"

    send_text_to_self(msg)
    print("\n消息发送完成！请查看微信。")


if __name__ == "__main__":
    main()
