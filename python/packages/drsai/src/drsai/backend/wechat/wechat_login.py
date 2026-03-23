import asyncio
import json
import os
import sys
import time
import httpx
from drsai.configs.constant import WECHAT_DIR

BASE_URL = "https://ilinkai.weixin.qq.com"
CREDS_FILE = os.path.join(WECHAT_DIR, "credentials.json")
POLL_INTERVAL = 3


# ── 阶段1：申请二维码 ──────────────────────────────────────────────────────────

async def get_qrcode() -> tuple[str, str]:
    """
    向服务器申请登录二维码。

    返回：
        (qrcode_url, qrcode_id)
        qrcode_url: 二维码内容（一个 URL 字符串），用于生成二维码图像
        qrcode_id:  用于轮询扫码状态的 ID
    """
    url = f"{BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=3"
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(url)
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

async def wait_for_scan(qrcode_id: str) -> dict:
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
    async with httpx.AsyncClient(timeout=15) as client:
        while True:
            url = f"{BASE_URL}/ilink/bot/get_qrcode_status?qrcode={qrcode_id}"
            try:
                resp = await client.get(url)
                resp.raise_for_status()
                data = resp.json()
            except httpx.HTTPError as e:
                print(f"  轮询出错，重试中: {e}")
                await asyncio.sleep(POLL_INTERVAL)
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

            await asyncio.sleep(POLL_INTERVAL)


# ── 保存凭据 ───────────────────────────────────────────────────────────────────

def save_credentials(data: dict, creds_file: str = CREDS_FILE) -> None:
    """
    将登录凭据保存到 credentials.json，供后续步骤使用。

    保存内容：
        bot_token    —— API 认证 token
        account_id   —— Bot 的 ilink ID（发消息时作为 from_user_id）
        user_id      —— 绑定微信账号的 ilink user ID
        base_url     —— API 服务器地址（默认为 ilinkai.weixin.qq.com）
        login_time   —— 登录时间戳（Unix 秒），用于判断凭据是否过期
    """
    creds = {
        "bot_token":   data["bot_token"],
        "account_id":  data["ilink_bot_id"],
        "user_id":     data["ilink_user_id"],
        "base_url":    data.get("baseurl", BASE_URL),
        "login_time":  time.time(),
    }
    with open(creds_file, "w", encoding="utf-8") as f:
        json.dump(creds, f, indent=2, ensure_ascii=False)
    print(f"凭据已保存到: {creds_file}")
    print(f"  account_id : {creds['account_id']}")
    print(f"  user_id    : {creds['user_id']}")


def is_credentials_valid(max_age_hours: float = 168.0, creds_file: str = CREDS_FILE) -> bool:
    """
    检查本地凭据文件是否存在且未超过有效期。

    参数：
        max_age_hours: 允许的最大登录时长（小时），默认 168 小时（7 天）

    返回：
        True  —— 凭据存在且在有效期内，可跳过扫码
        False —— 凭据不存在、缺少时间戳或已超期，需重新登录
    """
    if not os.path.exists(creds_file):
        return False
    try:
        with open(creds_file, encoding="utf-8") as f:
            creds = json.load(f)
    except (json.JSONDecodeError, OSError):
        return False

    login_time = creds.get("login_time")
    if not login_time:
        return False

    elapsed_hours = (time.time() - login_time) / 3600
    return elapsed_hours < max_age_hours


def load_credentials(creds_file: str = CREDS_FILE) -> dict:
    """从 credentials.json 加载凭据（供其他脚本调用）。"""
    if not os.path.exists(creds_file):
        raise FileNotFoundError(f"未找到凭据文件，请先运行 step1_login.py: {creds_file}")
    with open(creds_file, encoding="utf-8") as f:
        return json.load(f)


# ── HEPAI_API_KEY 录入 ─────────────────────────────────────────────────────────

async def _prompt_api_key(creds_file: CREDS_FILE) -> None:
    """
    提示用户输入 HEPAI_API_KEY，并将其写入 credentials.json。
    直接回车则沿用环境变量中的值（若已设置）。
    """
    existing = os.environ.get("HEPAI_API_KEY", "")
    if existing:
        hint = f"（回车沿用环境变量，末尾: ...{existing[-6:]}）"
    else:
        hint = "（回车跳过，后续将从环境变量 HEPAI_API_KEY 读取）"

    # input() 是阻塞调用，放到线程池中执行以保持异步友好
    key: str = await asyncio.to_thread(
        input, f"\n请输入 HEPAI_API_KEY {hint}: "
    )
    key = key.strip()

    if not key and not existing:
        print("  未提供 HEPAI_API_KEY，后续请确保环境变量已设置。")
        return

    api_key = key if key else existing

    # 读取已保存的凭据并追加 hepai_api_key 字段
    creds = load_credentials(creds_file = creds_file)
    creds["hepai_api_key"] = api_key
    # os.makedirs(WECHAT_DIR, exist_ok=True)
    with open(creds_file, "w", encoding="utf-8") as f:
        json.dump(creds, f, indent=2, ensure_ascii=False)
    print(f"  HEPAI_API_KEY 已保存（末尾: ...{api_key[-6:]}）")


# ── 主流程 ─────────────────────────────────────────────────────────────────────

async def login_wechat_main(max_age_hours: float = 168.0, creds_file: str = CREDS_FILE):
    """
    参数：
        max_age_hours: 凭据有效期（小时），默认 168 小时（7 天）。
                       在此时间内重启服务无需重新扫码。
    """
    # 如果凭据仍在有效期内，直接复用，跳过扫码
    if is_credentials_valid(max_age_hours, creds_file = creds_file):
        creds = load_credentials(creds_file = creds_file)
        elapsed_h = (time.time() - creds["login_time"]) / 3600
        print(f"✅ 检测到有效登录凭据（{elapsed_h:.1f} 小时前登录），跳过扫码。")
        # 若 HEPAI_API_KEY 尚未保存，仍需录入
        if not creds.get("hepai_api_key") and not os.environ.get("HEPAI_API_KEY"):
            await _prompt_api_key(creds_file = creds_file)
        return

    print("=" * 50)
    print("微信 ilink Bot 登录")
    print("=" * 50)

    while True:
        # 阶段1：获取二维码
        print("\n正在获取二维码...")
        try:
            qrcode_url, qrcode_id = await get_qrcode()
        except Exception as e:
            print(f"获取二维码失败: {e}")
            sys.exit(1)

        # 展示二维码
        show_qrcode_in_terminal(qrcode_url)

        # 阶段2：等待扫码
        try:
            result = await wait_for_scan(qrcode_id)
            break
        except RuntimeError as e:
            if "过期" in str(e):
                print("⚠️  二维码过期，自动刷新...\n")
                continue
            raise

    # 保存凭据
    save_credentials(result, creds_file = creds_file)

    # 录入 HEPAI_API_KEY
    await _prompt_api_key(creds_file = creds_file)

    print("登录成功！")

# if __name__ == "__main__":
#     asyncio.run(login_wechat_main())
