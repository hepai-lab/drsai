"""
step1_login.py — 步骤一：扫码登录，获取 bot_token
=====================================================
原理：
  ilink bot 登录流程分两阶段：
    阶段1：向服务端申请一个二维码（包含一个 URL 和一个 qrcode_id）
    阶段2：用微信扫描二维码，服务端轮询到扫码完成后返回 bot_token

  bot_token 是后续所有 API 请求的认证凭据，会保存到 credentials.json。

使用方式：
    pip install requests qrcode[pil] pillow
    python step1_login.py
"""

import json
import time
import os
import sys
import requests

BASE_URL = "https://ilinkai.weixin.qq.com"
CREDS_FILE = os.path.join(os.path.dirname(__file__), "credentials.json")
POLL_INTERVAL = 3  # 每3秒轮询一次扫码状态


# ── 阶段1：申请二维码 ──────────────────────────────────────────────────────────

def get_qrcode() -> tuple[str, str]:
    """
    向服务器申请登录二维码。

    返回：
        (qrcode_url, qrcode_id)
        qrcode_url: 二维码内容（一个 URL 字符串），用于生成二维码图像
        qrcode_id:  用于轮询扫码状态的 ID
    """
    url = f"{BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=3"
    resp = requests.get(url, timeout=15)
    resp.raise_for_status()
    data = resp.json()

    if data.get("ret") != 0 or not data.get("qrcode_img_content"):
        raise RuntimeError(f"获取二维码失败: {data}")

    return data["qrcode_img_content"], data["qrcode"]


def show_qrcode_in_terminal(qrcode_url: str) -> None:
    """
    在终端打印二维码（需要 qrcode 库）。
    如果没有安装 qrcode，则只打印二维码内容，让用户手动处理。
    """
    try:
        import qrcode
        qr = qrcode.QRCode(border=1)
        qr.add_data(qrcode_url)
        qr.make(fit=True)
        qr.print_ascii(invert=True)
        print("\n请用微信扫描上方二维码\n")
    except ImportError:
        print("\n[提示] 安装 qrcode 可在终端显示二维码: pip install qrcode[pil]")
        print(f"\n二维码内容（可复制到二维码生成器）:\n{qrcode_url}\n")


# ── 阶段2：轮询扫码状态 ────────────────────────────────────────────────────────

def wait_for_scan(qrcode_id: str) -> dict:
    """
    循环轮询扫码状态，直到用户确认登录或二维码过期。

    status 状态说明：
        "wait"      —— 等待扫码
        "scaned"    —— 已扫码，等待手机端确认
        "confirmed" —— 确认完成，返回 bot_token 等凭据
        "expired"   —— 二维码过期，需要重新申请

    返回：包含 bot_token、ilink_bot_id、ilink_user_id 的字典
    """
    print("等待扫码...")
    while True:
        url = f"{BASE_URL}/ilink/bot/get_qrcode_status?qrcode={qrcode_id}"
        try:
            resp = requests.get(url, timeout=15)
            resp.raise_for_status()
            data = resp.json()
        except requests.RequestException as e:
            print(f"  轮询出错，重试中: {e}")
            time.sleep(POLL_INTERVAL)
            continue

        status = data.get("status", "")

        if status == "wait":
            print("  等待扫码...", end="\r")
        elif status == "scaned":
            print("  已扫码，请在手机上确认...")
        elif status == "confirmed":
            print("\n✅ 扫码成功！")
            return data
        elif status == "expired":
            raise RuntimeError("二维码已过期")
        else:
            print(f"  未知状态: {status}")

        time.sleep(POLL_INTERVAL)


# ── 保存凭据 ───────────────────────────────────────────────────────────────────

def save_credentials(data: dict) -> None:
    """
    将登录凭据保存到 credentials.json，供后续步骤使用。

    保存内容：
        bot_token    —— API 认证 token
        account_id   —— Bot 的 ilink ID（发消息时作为 from_user_id）
        user_id      —— 绑定微信账号的 ilink user ID
        base_url     —— API 服务器地址（默认为 ilinkai.weixin.qq.com）
    """
    creds = {
        "bot_token":   data["bot_token"],
        "account_id":  data["ilink_bot_id"],
        "user_id":     data["ilink_user_id"],
        "base_url":    data.get("baseurl", BASE_URL),
    }
    with open(CREDS_FILE, "w", encoding="utf-8") as f:
        json.dump(creds, f, indent=2, ensure_ascii=False)
    print(f"凭据已保存到: {CREDS_FILE}")
    print(f"  account_id : {creds['account_id']}")
    print(f"  user_id    : {creds['user_id']}")


def load_credentials() -> dict:
    """从 credentials.json 加载凭据（供其他脚本调用）。"""
    if not os.path.exists(CREDS_FILE):
        raise FileNotFoundError(f"未找到凭据文件，请先运行 step1_login.py: {CREDS_FILE}")
    with open(CREDS_FILE, encoding="utf-8") as f:
        return json.load(f)


# ── 主流程 ─────────────────────────────────────────────────────────────────────

def main():
    print("=" * 50)
    print("步骤一：微信 ilink Bot 登录")
    print("=" * 50)

    while True:
        # 阶段1：获取二维码
        print("\n正在获取二维码...")
        try:
            qrcode_url, qrcode_id = get_qrcode()
        except Exception as e:
            print(f"获取二维码失败: {e}")
            sys.exit(1)

        # 展示二维码
        show_qrcode_in_terminal(qrcode_url)

        # 阶段2：等待扫码
        try:
            result = wait_for_scan(qrcode_id)
            break
        except RuntimeError as e:
            if "过期" in str(e):
                print("⚠️  二维码过期，自动刷新...\n")
                continue
            raise

    # 保存凭据
    save_credentials(result)
    print("\n登录完成！接下来运行 step2_receive.py 开始接收消息。")


if __name__ == "__main__":
    main()
