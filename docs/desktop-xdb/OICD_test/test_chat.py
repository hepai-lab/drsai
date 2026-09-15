#!/usr/bin/env python3
"""测试指定模型在 IHEP AI 平台上的对话可用性。

用法:
  python test_chat.py <模型名>
  python test_chat.py <模型名> "你的提示词"
  python test_chat.py deepseek-v4-flash "1+1等于几"

也可作为模块导入:
  from test_chat import test_chat
  test_chat(token, "deepseek-v4-flash")
"""
import json
import sys
import urllib.request
import urllib.error

BASE_URL = "https://ai-dev.ihep.ac.cn/apiv2/v1"


def test_chat(token: str, model: str, message: str = "Say hi"):
    """测试单个模型的 chat completion 是否可用。"""
    payload = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": message}],
        "max_tokens": 10,
        "stream": False,
    }).encode("utf-8")

    req = urllib.request.Request(f"{BASE_URL}/chat/completions", data=payload, method="POST")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
            reply = result["choices"][0]["message"]["content"]
            print(f"  ✅ {model}: OK")
            print(f"     回复: {reply[:100]}")
            return True
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:300]
        print(f"  ❌ {model}: HTTP {e.code}")
        print(f"     {body}")
        return False
    except Exception as e:
        print(f"  ❌ {model}: {e}")
        return False


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python test_chat.py <模型名> [提示词]")
        print("示例: python test_chat.py deepseek-v4-flash")
        print("      python test_chat.py hepai/deepseek-v4-flash '1+1等于几'")
        sys.exit(1)

    model = sys.argv[1]
    msg = sys.argv[2] if len(sys.argv) > 2 else "Say hi"

    from get_token import get_oidc_token
    test_chat(get_oidc_token(), model, msg)
