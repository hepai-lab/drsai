#!/usr/bin/env python3
"""列出 IHEP AI 平台所有可用模型。

用法: python list_models.py
"""
import json
import urllib.request
import urllib.error

BASE_URL = "https://ai-dev.ihep.ac.cn/apiv2/v1"


def list_models(token: str) -> list:
    """获取平台所有可用模型列表。"""
    req = urllib.request.Request(f"{BASE_URL}/models")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")

    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read())
        models = data.get("data", [])

    print(f"Total: {len(models)} models\n")
    print(f"{'Model ID':45s}  {'Owner':30s}")
    print("-" * 77)
    for m in models:
        mid = m.get("id", "?")
        owner = m.get("owned_by", "?")
        print(f"  {mid:43s}  {owner:30s}")

    return models


if __name__ == "__main__":
    from get_token import get_oidc_token
    list_models(get_oidc_token())
